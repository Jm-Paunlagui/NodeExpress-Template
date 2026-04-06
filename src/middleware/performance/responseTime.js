"use strict";

/**
 * @fileoverview Response-time tracking middleware.
 * Uses process.hrtime.bigint() for microsecond precision.
 * Sets X-Response-Time header and aggregates per-route metrics.
 */

const { logger } = require("../../utils/logger");

const responseTimeMetrics = new Map();

const SLOW_THRESHOLD = 1000; // 1 s
const VERY_SLOW_THRESHOLD = 3000; // 3 s

// ── Middleware ─────────────────────────────────────────────────────────────────

function trackResponseTime(req, res, next) {
    const startTime = process.hrtime.bigint();

    // Inject X-Response-Time header on writeHead
    const originalWriteHead = res.writeHead;
    res.writeHead = function (statusCode, statusMessage, headers) {
        if (!res.headersSent && !res.getHeader("X-Response-Time")) {
            const ms = Number(
                (process.hrtime.bigint() - startTime) / BigInt(1_000_000),
            );
            res.setHeader("X-Response-Time", `${ms}ms`);
        }
        return originalWriteHead.call(this, statusCode, statusMessage, headers);
    };

    // Collect metrics on finish
    res.on("finish", () => {
        const ms = Number(
            (process.hrtime.bigint() - startTime) / BigInt(1_000_000),
        );
        const route = `${req.method} ${req.route?.path || req.path}`;

        const m = responseTimeMetrics.get(route) || {
            count: 0,
            totalTime: 0,
            minTime: Infinity,
            maxTime: 0,
            slowCount: 0,
            verySlowCount: 0,
        };

        m.count++;
        m.totalTime += ms;
        if (ms < m.minTime) m.minTime = ms;
        if (ms > m.maxTime) m.maxTime = ms;
        if (ms > SLOW_THRESHOLD) m.slowCount++;
        if (ms > VERY_SLOW_THRESHOLD) m.verySlowCount++;

        responseTimeMetrics.set(route, m);

        if (ms > SLOW_THRESHOLD) {
            logger.warn(`Slow response: ${route} took ${ms}ms`);
        }
    });

    next();
}

// ── Metrics ───────────────────────────────────────────────────────────────────

function getPerformanceMetrics() {
    const out = {};
    for (const [route, d] of responseTimeMetrics) {
        out[route] = {
            ...d,
            avgTime: d.count ? Math.round(d.totalTime / d.count) : 0,
            slowRate: d.count
                ? `${((d.slowCount / d.count) * 100).toFixed(2)}%`
                : "0%",
            verySlowRate: d.count
                ? `${((d.verySlowCount / d.count) * 100).toFixed(2)}%`
                : "0%",
        };
    }
    return out;
}

function getSlowRoutes() {
    const routes = [];
    for (const [route, d] of responseTimeMetrics) {
        const avg = d.count ? d.totalTime / d.count : 0;
        const slowRate = d.count ? d.slowCount / d.count : 0;
        if (avg > SLOW_THRESHOLD || slowRate > 0.1) {
            routes.push({
                route,
                avgTime: Math.round(avg),
                slowRate: `${(slowRate * 100).toFixed(2)}%`,
                totalRequests: d.count,
            });
        }
    }
    return routes.sort((a, b) => b.avgTime - a.avgTime);
}

function resetMetrics() {
    responseTimeMetrics.clear();
}

module.exports = {
    trackResponseTime,
    getPerformanceMetrics,
    getSlowRoutes,
    resetMetrics,
    SLOW_THRESHOLD,
    VERY_SLOW_THRESHOLD,
};
