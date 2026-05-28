"use strict";

/**
 * @fileoverview Barrel export for the metrics middleware subsystem.
 *
 * Usage:
 *   const { metricsStore, defaultMetrics } = require('./middleware/metrics');
 */

module.exports = {
  ...require("./MetricsStore"),
  ...require("./MetricsMiddleware"),
};
