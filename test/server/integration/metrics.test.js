"use strict";

/**
 * Integration tests for the /api/v1/metrics resource.
 *
 * Fires real HTTP requests through the full middleware stack (auth, CSRF, rate
 * limiting, response shaping). Verifies:
 *   - access control on each route (401 unauth, 403 under-privileged, 200 ok)
 *   - the snapshot carries the new memory ceiling + GC/leak instrumentation
 *   - the standard { status, code, message, data } envelope + X-Request-ID
 *   - frontend ingestion happy/sad paths (CSRF-protected POST)
 *
 * AuditLogMiddleware fires AuditLogService.insertAsync after every response; with
 * no Oracle in tests that background retry loop starves the event loop. A
 * dedicated sinon sandbox stubs it for the lifetime of this suite — kept separate
 * from any per-test sinon.restore() so it is never accidentally removed.
 */

const { expect } = require("chai");
const sinon = require("sinon");
const request = require("supertest");
const agent = require("../helpers/request");
const app = require("../../../src/app");
const { signToken } = require("../helpers/auth");
const AuditLogService = require("../../../src/services/AuditLogService");

const adminToken = signToken({ userLevel: 2 });
const userToken = signToken({ userLevel: 1 });

const _auditSandbox = sinon.createSandbox();
before(function () {
  if (!AuditLogService.insertAsync.isSinonProxy) {
    _auditSandbox.stub(AuditLogService, "insertAsync").resolves();
  }
});
after(function () {
  _auditSandbox.restore();
});

describe("GET /api/v1/metrics (snapshot, userLevel >= 2)", function () {
  it("returns 401 without a token", async function () {
    const res = await agent.get("/api/v1/metrics");
    expect(res.status).to.equal(401);
  });

  it("returns 403 for an under-privileged user (level 1)", async function () {
    const res = await agent.get("/api/v1/metrics").set("Authorization", `Bearer ${userToken}`);
    expect(res.status).to.equal(403);
  });

  it("returns 200 with the standard envelope for an admin", async function () {
    const res = await agent.get("/api/v1/metrics").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).to.equal(200);
    expect(res.body).to.include.keys("status", "code", "message", "data");
    expect(res.body.status).to.equal("success");
  });

  it("snapshot exposes the real heap ceiling (heapSizeLimit)", async function () {
    const res = await agent.get("/api/v1/metrics").set("Authorization", `Bearer ${adminToken}`);
    const { memory } = res.body.data.system;
    expect(memory).to.have.property("heapSizeLimit").that.is.a("number");
    expect(memory.heapSizeLimit).to.be.greaterThan(memory.heapTotal);
  });

  it("snapshot exposes GC breakdown, overhead, and the memoryTrend leak detector", async function () {
    const res = await agent.get("/api/v1/metrics").set("Authorization", `Bearer ${adminToken}`);
    const { gc, memoryTrend } = res.body.data.system;
    expect(gc).to.include.keys("major", "minor", "incremental", "weakcb", "overheadPct", "recent");
    expect(memoryTrend).to.include.keys("suspected", "growthBytesPerMin", "windowMs", "sampleCount");
    expect(memoryTrend.suspected).to.be.a("boolean");
  });

  it("sets X-Request-ID on the response", async function () {
    const res = await agent.get("/api/v1/metrics").set("Authorization", `Bearer ${adminToken}`);
    expect(res.headers).to.have.property("x-request-id");
  });
});

describe("GET /api/v1/metrics/summary (userLevel >= 1)", function () {
  it("returns 401 without a token", async function () {
    expect((await agent.get("/api/v1/metrics/summary")).status).to.equal(401);
  });

  it("returns 200 for a standard user and includes heapLimitMb", async function () {
    const res = await agent.get("/api/v1/metrics/summary").set("Authorization", `Bearer ${userToken}`);
    expect(res.status).to.equal(200);
    expect(res.body.data.system).to.include.keys("heapUsedMb", "heapTotalMb", "heapLimitMb");
  });
});

describe("GET /api/v1/metrics/alerts (userLevel >= 2)", function () {
  it("returns 403 for an under-privileged user", async function () {
    const res = await agent.get("/api/v1/metrics/alerts").set("Authorization", `Bearer ${userToken}`);
    expect(res.status).to.equal(403);
  });

  it("returns an alerts array + count for an admin", async function () {
    const res = await agent.get("/api/v1/metrics/alerts").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).to.equal(200);
    expect(res.body.data).to.have.property("alerts").that.is.an("array");
    expect(res.body.data).to.have.property("count").that.is.a("number");
  });
});

describe("POST /api/v1/metrics/frontend (CSRF-protected, no auth)", function () {
  let csrfAgent;
  let csrfToken;

  beforeEach(async function () {
    csrfAgent = request.agent(app);
    const tokenRes = await csrfAgent.get("/api/v1/csrf/token");
    csrfToken = tokenRes.body.token;
  });

  it("rejects a POST with no CSRF token (403)", async function () {
    const res = await csrfAgent.post("/api/v1/metrics/frontend").send([{ type: "vital", name: "LCP", value: 1 }]);
    expect(res.status).to.equal(403);
  });

  it("accepts a valid vitals batch with a CSRF token (200)", async function () {
    const res = await csrfAgent
      .post("/api/v1/metrics/frontend")
      .set("x-csrf-token", csrfToken)
      .send([{ type: "vital", name: "LCP", value: 1234, rating: "good" }]);
    expect(res.status).to.equal(200);
    expect(res.body.status).to.equal("success");
  });

  it("rejects a non-array payload with 400 (not CSRF)", async function () {
    const res = await csrfAgent
      .post("/api/v1/metrics/frontend")
      .set("x-csrf-token", csrfToken)
      .send({ not: "an array" });
    expect(res.status).to.equal(400);
  });

  it("rejects an oversized batch (>50 events) with 400", async function () {
    const payload = Array.from({ length: 51 }, () => ({ type: "vital", name: "CLS", value: 0.1 }));
    const res = await csrfAgent.post("/api/v1/metrics/frontend").set("x-csrf-token", csrfToken).send(payload);
    expect(res.status).to.equal(400);
  });
});
