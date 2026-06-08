"use strict";

/**
 * Unit tests for MetricsService.evaluateAlerts() — the alert rule engine.
 *
 * evaluateAlerts accepts a snapshot argument directly, so each rule can be
 * exercised against a hand-built synthetic snapshot with no need to drive the
 * real store. Focus: the memory/GC rules added for leak & GC-health detection.
 *
 *   Rule 3 — HIGH_HEAP            (heapUsed / heapSizeLimit, NOT heapTotal)
 *   Rule 5 — HIGH_GC_OVERHEAD     (gc.overheadPct)
 *   Rule 6 — MEMORY_LEAK_SUSPECTED (memoryTrend.suspected)
 *
 * Also covers getSummary() exposing heapLimitMb, and ingestFrontendMetrics
 * validation.
 */

const { expect } = require("chai");
const sinon = require("sinon");
const MetricsService = require("../../../../src/services/MetricsService");
const { metricsStore } = require("../../../../src/middleware/metrics");

const MB = 1024 * 1024;

/** Build a minimal healthy snapshot; override `system`/`totals` per test. */
function makeSnapshot(overrides = {}) {
  return {
    red: {},
    totals: { errorRate: 0, serverErrorsTotal: 0 },
    system: {
      memory: { heapUsed: 40 * MB, heapTotal: 60 * MB, heapSizeLimit: 2048 * MB },
      eventLoopLag: 5,
      gc: { overheadPct: 0.5, major: { count: 3 } },
      memoryTrend: { suspected: false, growthBytesPerMin: 0, windowMs: 0, sampleCount: 0 },
      ...(overrides.system || {}),
    },
    ...overrides,
  };
}

function ruleNames(alerts) {
  return alerts.map((a) => a.rule);
}

describe("MetricsService.evaluateAlerts() — memory & GC rules", function () {
  it("raises NO alerts for a healthy snapshot", function () {
    const alerts = MetricsService.evaluateAlerts(makeSnapshot());
    expect(alerts).to.be.an("array").that.is.empty;
  });

  describe("Rule 3 — HIGH_HEAP (against the real V8 limit)", function () {
    it("does NOT fire when heapTotal is nearly full but the limit is not", function () {
      const snap = makeSnapshot({
        system: { memory: { heapUsed: 38 * MB, heapTotal: 40 * MB, heapSizeLimit: 2048 * MB }, eventLoopLag: 5, gc: { overheadPct: 0 }, memoryTrend: { suspected: false } },
      });
      expect(ruleNames(MetricsService.evaluateAlerts(snap))).to.not.include("HIGH_HEAP");
    });

    it("fires WARNING above 75% of the limit", function () {
      const snap = makeSnapshot({
        system: { memory: { heapUsed: 1600 * MB, heapTotal: 1700 * MB, heapSizeLimit: 2048 * MB }, eventLoopLag: 5, gc: { overheadPct: 0 }, memoryTrend: { suspected: false } },
      });
      const heap = MetricsService.evaluateAlerts(snap).find((a) => a.rule === "HIGH_HEAP");
      expect(heap).to.exist;
      expect(heap.severity).to.equal("warning");
    });

    it("fires CRITICAL above 90% of the limit", function () {
      const snap = makeSnapshot({
        system: { memory: { heapUsed: 1900 * MB, heapTotal: 1950 * MB, heapSizeLimit: 2048 * MB }, eventLoopLag: 5, gc: { overheadPct: 0 }, memoryTrend: { suspected: false } },
      });
      const heap = MetricsService.evaluateAlerts(snap).find((a) => a.rule === "HIGH_HEAP");
      expect(heap).to.exist;
      expect(heap.severity).to.equal("critical");
    });
  });

  describe("Rule 5 — HIGH_GC_OVERHEAD", function () {
    it("stays silent at healthy overhead (<5%)", function () {
      const snap = makeSnapshot({ system: { memory: makeSnapshot().system.memory, eventLoopLag: 5, gc: { overheadPct: 1.5 }, memoryTrend: { suspected: false } } });
      expect(ruleNames(MetricsService.evaluateAlerts(snap))).to.not.include("HIGH_GC_OVERHEAD");
    });

    it("fires WARNING between 5% and 10%", function () {
      const snap = makeSnapshot({ system: { memory: makeSnapshot().system.memory, eventLoopLag: 5, gc: { overheadPct: 7, major: { count: 99 } }, memoryTrend: { suspected: false } } });
      const a = MetricsService.evaluateAlerts(snap).find((x) => x.rule === "HIGH_GC_OVERHEAD");
      expect(a).to.exist;
      expect(a.severity).to.equal("warning");
    });

    it("fires CRITICAL above 10%", function () {
      const snap = makeSnapshot({ system: { memory: makeSnapshot().system.memory, eventLoopLag: 5, gc: { overheadPct: 13, major: { count: 99 } }, memoryTrend: { suspected: false } } });
      const a = MetricsService.evaluateAlerts(snap).find((x) => x.rule === "HIGH_GC_OVERHEAD");
      expect(a).to.exist;
      expect(a.severity).to.equal("critical");
    });
  });

  describe("Rule 6 — MEMORY_LEAK_SUSPECTED", function () {
    it("does not fire when the trend is stable", function () {
      const snap = makeSnapshot({ system: { memory: makeSnapshot().system.memory, eventLoopLag: 5, gc: { overheadPct: 0 }, memoryTrend: { suspected: false, growthBytesPerMin: 1000, windowMs: 600000, sampleCount: 12 } } });
      expect(ruleNames(MetricsService.evaluateAlerts(snap))).to.not.include("MEMORY_LEAK_SUSPECTED");
    });

    it("fires a WARNING when the store flags a suspected leak", function () {
      const snap = makeSnapshot({
        system: {
          memory: makeSnapshot().system.memory,
          eventLoopLag: 5,
          gc: { overheadPct: 0 },
          memoryTrend: { suspected: true, growthBytesPerMin: 3 * MB, windowMs: 10 * 60_000, sampleCount: 15, firstHeapUsed: 100 * MB, lastHeapUsed: 160 * MB },
        },
      });
      const a = MetricsService.evaluateAlerts(snap).find((x) => x.rule === "MEMORY_LEAK_SUSPECTED");
      expect(a).to.exist;
      expect(a.severity).to.equal("warning");
      expect(a.description).to.match(/MB\/min/);
    });
  });

  it("can raise heap, GC-overhead, and leak alerts simultaneously", function () {
    const snap = makeSnapshot({
      system: {
        memory: { heapUsed: 1900 * MB, heapTotal: 1950 * MB, heapSizeLimit: 2048 * MB },
        eventLoopLag: 5,
        gc: { overheadPct: 12, major: { count: 80 } },
        memoryTrend: { suspected: true, growthBytesPerMin: 3 * MB, windowMs: 10 * 60_000, sampleCount: 15, firstHeapUsed: 100 * MB, lastHeapUsed: 160 * MB },
      },
    });
    const names = ruleNames(MetricsService.evaluateAlerts(snap));
    expect(names).to.include.members(["HIGH_HEAP", "HIGH_GC_OVERHEAD", "MEMORY_LEAK_SUSPECTED"]);
  });
});

describe("MetricsService.getSummary()", function () {
  afterEach(() => sinon.restore());

  it("exposes heapLimitMb alongside heapUsedMb / heapTotalMb", function () {
    sinon.stub(metricsStore, "getSnapshot").returns(makeSnapshot());
    const summary = MetricsService.getSummary();
    expect(summary.system).to.include.keys("heapUsedMb", "heapTotalMb", "heapLimitMb");
    expect(summary.system.heapLimitMb).to.equal(2048);
  });
});

describe("MetricsService.ingestFrontendMetrics() — validation", function () {
  afterEach(() => sinon.restore());

  it("rejects a non-array payload with 400", async function () {
    try {
      await MetricsService.ingestFrontendMetrics({ not: "an array" });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err.statusCode || err.status).to.equal(400);
    }
  });

  it("rejects an empty array with 400", async function () {
    try {
      await MetricsService.ingestFrontendMetrics([]);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err.statusCode || err.status).to.equal(400);
    }
  });

  it("rejects more than 50 events with 400", async function () {
    const payload = Array.from({ length: 51 }, () => ({ type: "vital", name: "LCP", value: 1 }));
    try {
      await MetricsService.ingestFrontendMetrics(payload);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err.statusCode || err.status).to.equal(400);
    }
  });

  it("accepts a valid batch and routes events to the store", async function () {
    const vital = sinon.stub(metricsStore, "recordFrontendVital");
    const error = sinon.stub(metricsStore, "recordFrontendError");
    await MetricsService.ingestFrontendMetrics([
      { type: "vital", name: "LCP", value: 1200, rating: "good" },
      { type: "error", message: "boom", stack: "x" },
    ]);
    expect(vital.calledOnce).to.equal(true);
    expect(error.calledOnce).to.equal(true);
  });
});
