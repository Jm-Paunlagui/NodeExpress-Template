"use strict";

/**
 * @fileoverview Health check routes.
 *
 * Route map:
 *   GET /api/v1/health        Legacy combined check — backward compatible
 *   GET /api/v1/health/live   Liveness: is the process alive? Never checks DB.
 *   GET /api/v1/health/ready  Readiness: are all dependencies healthy?
 *
 * The /live endpoint is safe for Kubernetes/PM2 liveness probes — it never
 * contacts the DB and therefore never causes false restarts due to DB flakiness.
 *
 * The /ready endpoint pings all named Oracle pools and returns 503 if any
 * are unreachable, allowing load-balancers to stop sending traffic during
 * pool recovery or cold start.
 */

const express = require("express");
const router = express.Router();
const os = require("os");

const db = require("../config");
const { catchAsync } = require("../utils/catchAsync");
const { sendSuccess, sendError } = require("../constants/responses");
const { POOL_NAMES } = require("../config/database");

// ─── Helper: probe a single pool with a timeout ───────────────────────────────

/**
 * Ping a named Oracle pool with a SELECT 1 FROM DUAL.
 * Returns { status: "up", latencyMs } or { status: "down", error }.
 *
 * @param {string} poolName - Named connection registered in database.js
 * @returns {Promise<{ status: string, latencyMs?: number, error?: string }>}
 */
async function probePool(poolName) {
  const start = Date.now();
  try {
    await db.withConnection(poolName, async (conn) => {
      await conn.execute("SELECT 1 FROM DUAL");
    });
    return { status: "up", latencyMs: Date.now() - start };
  } catch (err) {
    return { status: "down", error: err.message || "Connection failed" };
  }
}

// ─── GET /health/live → mounted at /api/v1/health/live ───────────────────────

/**
 * Liveness probe — is the Node.js process alive and able to handle requests?
 * Always returns 200 as long as the process is running.
 * Used by Kubernetes/PM2: a non-200 response triggers a process restart.
 * Never performs any DB check so it cannot false-positive due to DB flakiness.
 */
router.get("/live", (_req, res) => {
  res.json(sendSuccess("OK", {
    alive: true,
    pid: process.pid,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  }));
});

// ─── GET /health/ready → mounted at /api/v1/health/ready ────────────────────

/**
 * Readiness probe — are all dependencies connected and the app ready to serve?
 * Probes all named Oracle pools in parallel.
 * Returns 200 when all deps are up, 503 when any dep is down.
 * Load-balancers should stop routing traffic on 503.
 */
router.get("/ready", catchAsync(async (_req, res) => {
  const pools = [POOL_NAMES.USER_ACCOUNT, POOL_NAMES.MEAL];
  const results = await Promise.all(pools.map(probePool));

  // Build a friendlier key name: "oracle_userAccount", "oracle_Meal"
  const namedChecks = {};
  for (let i = 0; i < pools.length; i++) {
    namedChecks[`oracle_${pools[i]}`] = results[i];
  }

  const allUp = results.every((r) => r.status === "up");

  if (allUp) {
    res.json(sendSuccess("Ready", { ready: true, checks: namedChecks }));
  } else {
    res.status(503).json(sendError("Service Unavailable", 503, {
      type: "ServiceUnavailableError",
      hint: "One or more database pools are unreachable.",
    }));
  }
}));

// ─── GET / → mounted at /api/v1/health (legacy combined) ────────────────────

/**
 * Legacy combined health check — kept for backward compatibility with existing
 * monitoring integrations that hit this endpoint. Returns 200 regardless of
 * DB status (database field reflects actual connectivity).
 */
router.get("/", catchAsync(async (_req, res) => {
  const data = {
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
    host: os.hostname(),
    pid: process.pid,
    database: "unknown",
  };

  try {
    await db.withConnection(POOL_NAMES.USER_ACCOUNT, async (conn) => {
      await conn.execute("SELECT 1 FROM DUAL");
    });
    data.database = "connected";
  } catch {
    data.database = "disconnected";
  }

  res.json(sendSuccess("OK", data));
}));

module.exports = router;
