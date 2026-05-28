"use strict";

const express = require("express");
const router = express.Router();

// ─── Route modules ────────────────────────────────────────────────────────────

const healthRoutes = require("./health.route");
const csrfRoutes = require("./csrf.route");
const authRoutes = require("./auth.route");
const auditLogRoutes           = require("./audit-log.route");
const metricsRoutes            = require("./metrics.route");
const clientRoutes             = require("./client.route");
const changelogRoutes          = require("./changelog.route");


// ─── Mount routes ─────────────────────────────────────────────────────────────

// Health check — mounted at /health so all three paths are:
//   GET /api/v1/health        legacy combined check
//   GET /api/v1/health/live   liveness probe
//   GET /api/v1/health/ready  readiness probe
router.use("/health", healthRoutes);

// CSRF routes
router.use("/csrf", csrfRoutes);

// Auth routes
router.use("/auth", authRoutes);

// Audit Log routes
router.use("/audit-logs", auditLogRoutes);

// Metrics routes (observability)
router.use("/metrics", metricsRoutes);

// Client-side error ingestion (ErrorBoundary reports)
router.use("/client", clientRoutes);

// Changelog / Version History
router.use("/changelog", changelogRoutes);

module.exports = router;
