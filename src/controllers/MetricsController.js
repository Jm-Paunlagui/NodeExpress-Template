"use strict";

/**
 * @fileoverview HTTP controller for the /api/v1/metrics resource.
 * Thin layer: validates nothing beyond HTTP concerns, delegates all logic to MetricsService.
 * Every async method is wrapped in catchAsync — unhandled rejections route to ErrorHandlerMiddleware.
 */

const { catchAsync } = require("../utils/catchAsync");
const { sendSuccess, RESPONSE_MESSAGES } = require("../constants/responses");
const { logger } = require("../utils/logger");
const { metricsMessages } = require("../constants/messages");
const MetricsService = require("../services/MetricsService");

class MetricsController {
  /**
   * GET /api/v1/metrics
   * Returns the full in-process metrics snapshot.
   * Requires userLevel >= 2.
   */
  static getSnapshot = catchAsync(async (_req, res) => {
    const snapshot = MetricsService.getSnapshot();
    logger.info(metricsMessages.SNAPSHOT_FETCHED());
    res.json(sendSuccess(RESPONSE_MESSAGES.METRICS_FETCHED, snapshot));
  });

  /**
   * GET /api/v1/metrics/summary
   * Returns an abbreviated summary: totals, top-5 slow routes, alert count.
   * Requires userLevel >= 1.
   */
  static getSummary = catchAsync(async (_req, res) => {
    const summary = MetricsService.getSummary();
    logger.info(metricsMessages.SUMMARY_FETCHED());
    res.json(sendSuccess(RESPONSE_MESSAGES.METRICS_SUMMARY_FETCHED, summary));
  });

  /**
   * GET /api/v1/metrics/alerts
   * Evaluates all alert rules and returns triggered alerts.
   * Requires userLevel >= 2.
   */
  static getAlerts = catchAsync(async (_req, res) => {
    const alerts = MetricsService.evaluateAlerts();
    logger.info(metricsMessages.ALERTS_FETCHED());
    res.json(sendSuccess(RESPONSE_MESSAGES.METRICS_ALERTS_FETCHED, { alerts, count: alerts.length }));
  });

  /**
   * POST /api/v1/metrics/frontend
   * Ingests an array of frontend metric events (web vitals + JS errors).
   * No auth required — pre-auth telemetry.
   */
  static ingestFrontend = catchAsync(async (req, res) => {
    await MetricsService.ingestFrontendMetrics(req.body);
    res.json(sendSuccess(RESPONSE_MESSAGES.METRICS_FRONTEND_INGESTED, null));
  });
}

module.exports = MetricsController;
