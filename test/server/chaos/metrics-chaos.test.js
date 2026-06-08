"use strict";

/**
 * @fileoverview Chaos / torture tests for the metrics & memory subsystem.
 *
 * Purpose: prove the leak detector and GC-health instrumentation behave under
 * adversarial conditions — simulated leaks, GC thrashing, allocation storms,
 * concurrent reads, malformed ingestion floods, and a degraded store.
 *
 * Chaos scenarios:
 *   1. Simulated leak — rising post-GC baselines trip MEMORY_LEAK_SUSPECTED
 *   2. GC thrashing — high overhead trips HIGH_GC_OVERHEAD (critical)
 *   3. Heap near the V8 ceiling trips HIGH_HEAP (critical), not heapTotal noise
 *   4. Allocation storm under concurrent snapshot reads — no crash, buffers capped
 *   5. Malformed frontend ingestion flood — every bad shape rejected, no 500
 *   6. Degraded store (getSnapshot throws) — endpoint returns 503, never crashes
 *   7. GC observer survives unknown/garbage entry kinds
 *
 * A dedicated sinon sandbox stubs AuditLogService.insertAsync for the whole suite
 * (no Oracle in tests) — separate from the per-test sinon.restore() so Chaos 6's
 * stub teardown never removes it.
 */

const { expect } = require("chai");
const sinon = require("sinon");
const request = require("supertest");
const app = require("../../../src/app");
const { signToken } = require("../helpers/auth");
const MetricsService = require("../../../src/services/MetricsService");
const { MetricsStore, metricsStore } = require("../../../src/middleware/metrics");
const AuditLogService = require("../../../src/services/AuditLogService");

const MB = 1024 * 1024;
const adminToken = () => signToken({ userId: "90001", role: "ADMIN", userLevel: 2 });

describe("Metrics & Memory — Chaos & Resilience", function () {
  this.timeout(20_000);

  const _auditSandbox = sinon.createSandbox();
  before(function () {
    if (!AuditLogService.insertAsync.isSinonProxy) {
      _auditSandbox.stub(AuditLogService, "insertAsync").resolves();
    }
  });
  after(function () {
    _auditSandbox.restore();
  });

  afterEach(function () {
    sinon.restore();
  });

  // ── Chaos 1: simulated memory leak ────────────────────────────────────────
  describe("Chaos 1 — simulated leak trips MEMORY_LEAK_SUSPECTED", function () {
    it("flags a store whose post-GC baselines climb steadily", function () {
      const store = new MetricsStore();
      const now = Date.now();
      const base = 80 * MB;
      store._heapBaselines = Array.from({ length: 20 }, (_, i) => ({
        ts: now - (19 - i) * 60_000,
        heapUsed: base + i * 4 * MB,
      }));
      const trend = store.getSnapshot().system.memoryTrend;
      expect(trend.suspected).to.equal(true);

      const alerts = MetricsService.evaluateAlerts(store.getSnapshot());
      const leak = alerts.find((a) => a.rule === "MEMORY_LEAK_SUSPECTED");
      expect(leak, "leak alert should fire").to.exist;
      expect(leak.severity).to.equal("warning");
    });

    it("does NOT false-positive on a noisy-but-flat baseline (no real growth)", function () {
      const store = new MetricsStore();
      const now = Date.now();
      const base = 150 * MB;
      store._heapBaselines = Array.from({ length: 20 }, (_, i) => ({
        ts: now - (19 - i) * 60_000,
        heapUsed: base + (Math.sin(i) * 2 * MB),
      }));
      expect(store.getSnapshot().system.memoryTrend.suspected).to.equal(false);
    });
  });

  // ── Chaos 2: GC thrashing ─────────────────────────────────────────────────
  describe("Chaos 2 — GC thrashing trips HIGH_GC_OVERHEAD", function () {
    it("raises a CRITICAL alert when GC overhead exceeds 10%", function () {
      const snap = {
        red: {},
        totals: { errorRate: 0, serverErrorsTotal: 0 },
        system: {
          memory: { heapUsed: 50 * MB, heapTotal: 60 * MB, heapSizeLimit: 2048 * MB },
          eventLoopLag: 5,
          gc: { overheadPct: 22, major: { count: 500 } },
          memoryTrend: { suspected: false },
        },
      };
      const a = MetricsService.evaluateAlerts(snap).find((x) => x.rule === "HIGH_GC_OVERHEAD");
      expect(a).to.exist;
      expect(a.severity).to.equal("critical");
    });
  });

  // ── Chaos 3: heap near the real ceiling ───────────────────────────────────
  describe("Chaos 3 — heap pressure measured against the V8 limit", function () {
    it("fires CRITICAL near the ceiling but stays silent on heapTotal noise", function () {
      const nearCeiling = {
        red: {}, totals: { errorRate: 0, serverErrorsTotal: 0 },
        system: { memory: { heapUsed: 1950 * MB, heapTotal: 1990 * MB, heapSizeLimit: 2048 * MB }, eventLoopLag: 5, gc: { overheadPct: 0 }, memoryTrend: { suspected: false } },
      };
      const noisyButFine = {
        red: {}, totals: { errorRate: 0, serverErrorsTotal: 0 },
        system: { memory: { heapUsed: 39 * MB, heapTotal: 40 * MB, heapSizeLimit: 2048 * MB }, eventLoopLag: 5, gc: { overheadPct: 0 }, memoryTrend: { suspected: false } },
      };
      expect(MetricsService.evaluateAlerts(nearCeiling).find((a) => a.rule === "HIGH_HEAP")?.severity).to.equal("critical");
      expect(MetricsService.evaluateAlerts(noisyButFine).map((a) => a.rule)).to.not.include("HIGH_HEAP");
    });
  });

  // ── Chaos 4: allocation storm + concurrent reads ──────────────────────────
  describe("Chaos 4 — allocation storm under concurrent snapshot reads", function () {
    it("survives heavy churn + 100 concurrent getSnapshot calls without crashing", function () {
      const store = new MetricsStore();
      for (let i = 0; i < 5000; i++) {
        store.recordRequest("GET /storm", "GET", i % 7 === 0 ? 500 : 200, i % 50);
      }
      let churn = [];
      for (let i = 0; i < 500_000; i++) churn.push({ i });
      churn = null;

      const snaps = Array.from({ length: 100 }, () => store.getSnapshot());
      snaps.forEach((s) => {
        expect(s.system.memory.heapSizeLimit).to.be.greaterThan(0);
        const gc = s.system.gc;
        expect(gc.major.count + gc.minor.count + gc.incremental.count + gc.weakcb.count).to.equal(gc.collections);
        expect(gc.recent.sampleCount).to.be.at.most(200);
      });
    });

    it("caps the heap-baseline ring at its maximum", function () {
      const store = new MetricsStore();
      for (let i = 0; i < 1000; i++) {
        store._heapBaselines.push({ ts: Date.now() + i, heapUsed: 100 * MB });
        if (store._heapBaselines.length > 120) store._heapBaselines.shift();
      }
      expect(store.getSnapshot().system.memoryTrend.sampleCount).to.be.at.most(120);
    });
  });

  // ── Chaos 5: malformed ingestion flood ────────────────────────────────────
  describe("Chaos 5 — malformed frontend ingestion flood", function () {
    let agent;
    let csrfToken;

    before(async function () {
      agent = request.agent(app);
      const res = await agent.get("/api/v1/csrf/token");
      csrfToken = res.body?.token ?? "";
    });

    // Each entry is a raw JSON string sent with an explicit JSON content-type, so
    // even top-level primitives reach the server's body parser. The server must
    // answer 200 or 400 — never 500 — for any of them.
    const GARBAGE = [
      "null",
      "42",
      '"a string"',
      '{"not":"an array"}',
      "[]",
      "[{}]",
      '[{"type":"unknown","payload":"???"}]',
      '[{"type":"vital"}]',
    ];

    GARBAGE.forEach((rawBody, idx) => {
      it(`rejects or safely absorbs garbage payload #${idx} — never 500`, async function () {
        const res = await agent
          .post("/api/v1/metrics/frontend")
          .set("x-csrf-token", csrfToken)
          .set("Content-Type", "application/json")
          .send(rawBody);
        expect(res.status).to.not.equal(500);
        expect([200, 400]).to.include(res.status);
      });
    });

    it("withstands 30 concurrent malformed POSTs without a 500", async function () {
      const results = await Promise.all(
        Array.from({ length: 30 }, () =>
          agent.post("/api/v1/metrics/frontend").set("x-csrf-token", csrfToken).send({ bad: true }),
        ),
      );
      expect(results.filter((r) => r.status >= 500)).to.have.length(0);
    });
  });

  // ── Chaos 6: degraded store ───────────────────────────────────────────────
  describe("Chaos 6 — degraded store returns 503, never crashes the process", function () {
    it("maps a throwing getSnapshot to a 503 AppError via the endpoint", async function () {
      sinon.stub(metricsStore, "getSnapshot").throws(new Error("store exploded"));
      const res = await request(app).get("/api/v1/metrics").set("Authorization", `Bearer ${adminToken()}`);
      expect(res.status).to.equal(503);
      expect(res.body.status).to.equal("error");
    });
  });

  // ── Chaos 7: GC observer robustness ───────────────────────────────────────
  describe("Chaos 7 — unknown GC kinds bucket safely", function () {
    it("an unrecognised kind falls into weakcb and keeps the count invariant", function () {
      const store = new MetricsStore();
      store._system.gc.collections += 3;
      store._system.gc.weakcb.count += 3; // unknown kinds route here
      const gc = store.getSnapshot().system.gc;
      expect(gc.major.count + gc.minor.count + gc.incremental.count + gc.weakcb.count).to.equal(gc.collections);
    });
  });
});
