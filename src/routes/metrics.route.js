"use strict";

/**
 * @fileoverview Routes for the /api/v1/metrics resource.
 *
 * Route map:
 *   GET  /api/v1/metrics           Full snapshot  (auth: userLevel >= 2)
 *   GET  /api/v1/metrics/summary   Summary        (auth: userLevel >= 1)
 *   GET  /api/v1/metrics/alerts    Alert evals    (auth: userLevel >= 2)
 *   POST /api/v1/metrics/frontend  FE ingestion   (no auth — pre-auth telemetry)
 *
 * The frontend ingestion endpoint has a tighter rate limit (30 req/min) to
 * prevent abuse without requiring authentication.
 */

const express = require("express");
const router = express.Router();

const MetricsController = require("../controllers/MetricsController");
const AuthMiddleware = require("../middleware/authentication/AuthMiddleware");
const { RateLimiterMiddleware } = require("../middleware/security/RateLimiterMiddleware");

// Dedicated stricter limiter for the unauthenticated frontend ingestion endpoint
const frontendIngestLimiter = new RateLimiterMiddleware({
  max: 30,
  windowMs: 60_000,
  label: "FrontendMetricsIngest",
});

// ─── Authenticated read routes ────────────────────────────────────────────────

// Full snapshot — senior admin level
router.get(
  "/",
  AuthMiddleware.authenticate,
  AuthMiddleware.requireAccess((user) => user.userLevel >= 2),
  MetricsController.getSnapshot,
);

// Summary — standard user level (useful for sidebar dashlets)
router.get(
  "/summary",
  AuthMiddleware.authenticate,
  AuthMiddleware.requireAccess((user) => user.userLevel >= 1),
  MetricsController.getSummary,
);

// Alert evaluations — senior admin level
router.get(
  "/alerts",
  AuthMiddleware.authenticate,
  AuthMiddleware.requireAccess((user) => user.userLevel >= 2),
  MetricsController.getAlerts,
);

// ─── Unauthenticated frontend ingestion ──────────────────────────────────────
// No auth: this endpoint is called before the user logs in (pre-auth telemetry).
// The tighter rate limiter mitigates abuse.

router.post(
  "/frontend",
  frontendIngestLimiter.handle.bind(frontendIngestLimiter),
  MetricsController.ingestFrontend,
);

module.exports = router;
