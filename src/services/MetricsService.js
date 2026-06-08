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

/**
 * @constant {number} Server-error rate (5xx-only) that raises a WARNING alert.
 * Tuned for the server-only error rate: 4xx are excluded from the SLI, so a
 * sustained 1% of serviced requests failing with 5xx is already abnormal.
 */
const ERROR_RATE_WARNING_THRESHOLD = 0.01;

/**
 * @constant {number} Server-error rate (5xx-only) that raises a CRITICAL alert.
 * Sustained 5% of serviced requests returning 5xx is an active outage.
 */
const ERROR_RATE_CRITICAL_THRESHOLD = 0.05;

/**
 * @constant {number} Heap utilization (heapUsed / heap_size_limit) that raises a
 * WARNING. Measured against the real V8 ceiling, NOT heapTotal — heapTotal is only
 * what V8 has committed so far and naturally sits near 100% by design, so dividing
 * by it produced permanent false "critical" heap alerts.
 */
const HEAP_UTILIZATION_WARNING_THRESHOLD = 0.75;

/**
 * @constant {number} Heap utilization (heapUsed / heap_size_limit) that raises a
 * CRITICAL alert — the process is genuinely approaching OOM at this point.
 */
const HEAP_UTILIZATION_CRITICAL_THRESHOLD = 0.9;

/**
 * @constant {number} GC overhead (% of wall-clock time spent paused in GC over the
 * last poll window) that raises a WARNING. A healthy process sits well under 2%;
 * sustained > 5% means V8 is collecting far more than it should — the signature of
 * a process running too close to its heap ceiling (GC thrashing).
 */
const GC_OVERHEAD_WARNING_THRESHOLD = 5;

/** @constant {number} GC overhead that raises a CRITICAL alert — collection is starving the event loop. */
const GC_OVERHEAD_CRITICAL_THRESHOLD = 10;

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
                heapLimitMb: Math.round(
                    snapshot.system.memory.heapSizeLimit / 1024 / 1024,
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
     *   1. Server-error rate (5xx-only) > 1% warning / > 5% critical, across all routes
     *   2. P99 latency > 2000ms on any individual route
     *   3. Heap usage > 75% (warning) / > 90% (critical) of the V8 heap ceiling
     *   4. Event-loop lag > 100ms
     *   5. GC overhead > 5% (warning) / > 10% (critical) of wall-clock time
     *   6. Memory leak suspected — sustained post-major-GC live-set growth
     *
     * Note: the global error rate is computed from 5xx responses only — client
     * errors (4xx) are excluded so auth failures, validation rejections, and
     * scanner noise never trip the availability alert. See MetricsStore.computeRates.
     *
     * @param {object} [snapshot] - Optional pre-fetched snapshot; fetches fresh if omitted
     * @returns {Array<{ rule: string, severity: string, value: number, route?: string }>}
     */
    static evaluateAlerts(snapshot = null) {
        const snap = snapshot || MetricsService.getSnapshot();
        const alerts = [];

        // Rule 1 — high global SERVER-error rate (5xx-only; 4xx excluded)
        const errorRate = snap.totals.errorRate;
        if (errorRate > ERROR_RATE_WARNING_THRESHOLD) {
            const isCritical = errorRate > ERROR_RATE_CRITICAL_THRESHOLD;
            const severity = isCritical ? "critical" : "warning";
            const threshold = isCritical
                ? ERROR_RATE_CRITICAL_THRESHOLD
                : ERROR_RATE_WARNING_THRESHOLD;
            alerts.push({
                rule: "HIGH_ERROR_RATE",
                severity,
                value: errorRate,
                description: `Global server-error rate is ${(errorRate * 100).toFixed(2)}% (threshold: ${(threshold * 100).toFixed(0)}%, 5xx only)`,
            });
            logger[isCritical ? "crit" : "warning"](
                metricsMessages.ALERT_TRIGGERED("HIGH_ERROR_RATE", severity),
                {
                    errorRate,
                    serverErrorsTotal: snap.totals.serverErrorsTotal,
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

        // Rule 3 — heap pressure (measured against the real V8 ceiling, not heapTotal)
        const heapLimit = snap.system.memory.heapSizeLimit;
        const heapUtilization =
            heapLimit > 0 ? snap.system.memory.heapUsed / heapLimit : 0;
        if (heapUtilization > HEAP_UTILIZATION_WARNING_THRESHOLD) {
            const isCritical =
                heapUtilization > HEAP_UTILIZATION_CRITICAL_THRESHOLD;
            const severity = isCritical ? "critical" : "warning";
            const threshold = isCritical
                ? HEAP_UTILIZATION_CRITICAL_THRESHOLD
                : HEAP_UTILIZATION_WARNING_THRESHOLD;
            alerts.push({
                rule: "HIGH_HEAP",
                severity,
                value: heapUtilization,
                description: `Heap usage is ${(heapUtilization * 100).toFixed(1)}% of the V8 limit (threshold: ${(threshold * 100).toFixed(0)}%)`,
            });
            logger[isCritical ? "crit" : "warning"](
                metricsMessages.ALERT_TRIGGERED("HIGH_HEAP", severity),
                {
                    heapUtilization,
                    heapUsedMb: Math.round(
                        snap.system.memory.heapUsed / 1024 / 1024,
                    ),
                    heapLimitMb: Math.round(heapLimit / 1024 / 1024),
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

        // Rule 5 — GC overhead (process spending too much time collecting)
        const gcOverhead = snap.system.gc?.overheadPct ?? 0;
        if (gcOverhead > GC_OVERHEAD_WARNING_THRESHOLD) {
            const isCritical = gcOverhead > GC_OVERHEAD_CRITICAL_THRESHOLD;
            const severity = isCritical ? "critical" : "warning";
            const threshold = isCritical
                ? GC_OVERHEAD_CRITICAL_THRESHOLD
                : GC_OVERHEAD_WARNING_THRESHOLD;
            alerts.push({
                rule: "HIGH_GC_OVERHEAD",
                severity,
                value: gcOverhead,
                description: `GC overhead is ${gcOverhead}% of wall-clock time (threshold: ${threshold}%)`,
            });
            logger[isCritical ? "crit" : "warning"](
                metricsMessages.ALERT_TRIGGERED("HIGH_GC_OVERHEAD", severity),
                {
                    overheadPct: gcOverhead,
                    majorCollections: snap.system.gc?.major?.count,
                },
            );
        }

        // Rule 6 — suspected memory leak (sustained post-major-GC live-set growth)
        const trend = snap.system.memoryTrend;
        if (trend?.suspected) {
            const mbPerMin = (trend.growthBytesPerMin / (1024 * 1024)).toFixed(2);
            const windowMin = Math.round(trend.windowMs / 60_000);
            alerts.push({
                rule: "MEMORY_LEAK_SUSPECTED",
                severity: "warning",
                value: trend.growthBytesPerMin,
                description: `Post-GC heap is climbing ~${mbPerMin} MB/min over ${windowMin} min across ${trend.sampleCount} major-GC baselines — investigate for a leak`,
            });
            logger.warning(
                metricsMessages.ALERT_TRIGGERED("MEMORY_LEAK_SUSPECTED", "warning"),
                {
                    growthBytesPerMin: trend.growthBytesPerMin,
                    windowMs: trend.windowMs,
                    firstHeapUsedMb: Math.round(trend.firstHeapUsed / 1024 / 1024),
                    lastHeapUsedMb: Math.round(trend.lastHeapUsed / 1024 / 1024),
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
