"use strict";

/**
 * @fileoverview Business logic for the metrics domain.
 * Evaluates alert rules against the MetricsStore snapshot and handles
 * frontend metrics ingestion with validation.
 */

const { metricsStore } = require("../middleware/metrics");
const { AppError, METRICS_ERRORS } = require("../constants/errors");
const { logger } = require("../utils/logger");
const { metricsMessages } = require("../constants/messages");

class MetricsService {
    // ========================================
    // SNAPSHOT & ALERTS
    // ========================================

    /**
     * Return the full metrics snapshot from the in-process store.
     *
     * @returns {object} Full metrics snapshot (see MetricsStore.getSnapshot)
     * @throws {AppError} 503 if snapshot retrieval fails unexpectedly
     */
    static getSnapshot() {
        try {
            return metricsStore.getSnapshot();
        } catch (err) {
            throw new AppError(METRICS_ERRORS.METRICS_UNAVAILABLE, 503, {
                type: "MetricsError",
                hint: err.message,
            });
        }
    }

    /**
     * Return a concise summary: totals, top-5 slowest routes, and active alert count.
     *
     * @returns {{ totals: object, topSlowRoutes: Array, alertCount: number, uptime: number }}
     */
    static getSummary() {
        const snapshot = MetricsService.getSnapshot();
        const alerts = MetricsService.evaluateAlerts(snapshot);

        // Top 5 routes by p95 latency descending
        const topSlowRoutes = Object.entries(snapshot.red)
            .map(([route, m]) => ({ route, ...m }))
            .sort((a, b) => b.p95 - a.p95)
            .slice(0, 5);

        return {
            uptime: snapshot.uptime,
            totals: snapshot.totals,
            system: {
                heapUsedMb: Math.round(
                    snapshot.system.memory.heapUsed / 1024 / 1024,
                ),
                heapTotalMb: Math.round(
                    snapshot.system.memory.heapTotal / 1024 / 1024,
                ),
                eventLoopLag: snapshot.system.eventLoopLag,
            },
            topSlowRoutes,
            alertCount: alerts.length,
        };
    }

    /**
     * Evaluate all alert rules against a metrics snapshot.
     * Returns an array of triggered alert objects (empty array = all clear).
     *
     * Alert rules:
     *   1. Error rate > 5% across all routes
     *   2. P99 latency > 2000ms on any individual route
     *   3. Heap usage > 80% of heapTotal
     *   4. Event-loop lag > 100ms
     *
     * @param {object} [snapshot] - Optional pre-fetched snapshot; fetches fresh if omitted
     * @returns {Array<{ rule: string, severity: string, value: number, route?: string }>}
     */
    static evaluateAlerts(snapshot = null) {
        const snap = snapshot || MetricsService.getSnapshot();
        const alerts = [];

        // Rule 1 — high global error rate
        if (snap.totals.errorRate > 0.05) {
            alerts.push({
                rule: "HIGH_ERROR_RATE",
                severity: "warning",
                value: snap.totals.errorRate,
                description: `Global error rate is ${(snap.totals.errorRate * 100).toFixed(2)}% (threshold: 5%)`,
            });
            logger.warning(
                metricsMessages.ALERT_TRIGGERED("HIGH_ERROR_RATE", "warning"),
                {
                    errorRate: snap.totals.errorRate,
                },
            );
        }

        // Rule 2 — per-route p99 latency spike
        for (const [route, m] of Object.entries(snap.red)) {
            if (m.p99 > 2000) {
                alerts.push({
                    rule: "HIGH_LATENCY",
                    severity: "warning",
                    route,
                    value: m.p99,
                    description: `P99 latency for ${route} is ${m.p99}ms (threshold: 2000ms)`,
                });
                logger.warning(
                    metricsMessages.ALERT_TRIGGERED("HIGH_LATENCY", "warning"),
                    {
                        route,
                        p99: m.p99,
                    },
                );
            }
        }

        // Rule 3 — heap pressure
        const heapPct =
            snap.system.memory.heapTotal > 0
                ? snap.system.memory.heapUsed / snap.system.memory.heapTotal
                : 0;
        if (heapPct > 0.8) {
            alerts.push({
                rule: "HIGH_HEAP",
                severity: "critical",
                value: heapPct,
                description: `Heap usage is ${(heapPct * 100).toFixed(1)}% of total (threshold: 80%)`,
            });
            logger.critical(
                metricsMessages.ALERT_TRIGGERED("HIGH_HEAP", "critical"),
                {
                    heapPct,
                    heapUsedMb: Math.round(
                        snap.system.memory.heapUsed / 1024 / 1024,
                    ),
                    heapTotalMb: Math.round(
                        snap.system.memory.heapTotal / 1024 / 1024,
                    ),
                },
            );
        }

        // Rule 4 — event-loop lag
        if (snap.system.eventLoopLag > 100) {
            alerts.push({
                rule: "EVENT_LOOP_LAG",
                severity: "warning",
                value: snap.system.eventLoopLag,
                description: `Event-loop lag is ${snap.system.eventLoopLag}ms (threshold: 100ms)`,
            });
            logger.warning(
                metricsMessages.ALERT_TRIGGERED("EVENT_LOOP_LAG", "warning"),
                {
                    lagMs: snap.system.eventLoopLag,
                },
            );
        }

        return alerts;
    }

    // ========================================
    // FRONTEND METRICS INGESTION
    // ========================================

    /**
     * Validate and store an array of frontend metric events (vitals + errors).
     *
     * Validation rules:
     *   - payload must be an array
     *   - payload must be non-empty
     *   - payload may not exceed 50 items per request
     *   - each item must have a "type" field: "vital" | "error"
     *
     * @param {Array} payload - Array of frontend metric events from the client
     * @throws {AppError} 400 on validation failure
     */
    static async ingestFrontendMetrics(payload) {
        if (!Array.isArray(payload)) {
            throw new AppError(METRICS_ERRORS.INVALID_PAYLOAD, 400, {
                type: "ValidationError",
                hint: "Send a JSON array of metric events in the request body.",
            });
        }

        if (payload.length === 0) {
            throw new AppError(METRICS_ERRORS.INVALID_PAYLOAD, 400, {
                type: "ValidationError",
                hint: "The payload array must contain at least one event.",
            });
        }

        if (payload.length > 50) {
            throw new AppError(METRICS_ERRORS.PAYLOAD_TOO_LARGE, 400, {
                type: "ValidationError",
                hint: "Split into batches of at most 50 events per request.",
            });
        }

        let vitalCount = 0;
        let errorCount = 0;

        for (const event of payload) {
            if (!event || typeof event !== "object") continue;

            if (event.type === "vital") {
                metricsStore.recordFrontendVital(
                    String(event.name || "UNKNOWN").slice(0, 200),
                    Number(event.value) || 0,
                    String(event.rating || "unknown").slice(0, 50),
                    event.context || {},
                );
                vitalCount++;
                logger.debug(metricsMessages.FRONTEND_INGESTED(1), {
                    eventType: "vital",
                    name: String(event.name || "UNKNOWN").slice(0, 200),
                    url: String(event.url || "").slice(0, 500),
                    component: String(event.component || "").slice(0, 200),
                    rating: event.rating,
                });
            } else if (event.type === "error") {
                metricsStore.recordFrontendError(
                    String(event.message || "").slice(0, 500),
                    String(event.stack || "").slice(0, 2000),
                    event.context || {},
                );
                errorCount++;
                logger.notice(metricsMessages.FRONTEND_INGESTED(1), {
                    eventType: "error",
                    message: String(event.message || "").slice(0, 500),
                    url: String(event.url || "").slice(0, 500),
                    component: String(event.component || "").slice(0, 200),
                });
            }
        }

        logger.info(metricsMessages.FRONTEND_INGESTED(payload.length), {
            vitalCount,
            errorCount,
        });
    }
}

module.exports = MetricsService;
