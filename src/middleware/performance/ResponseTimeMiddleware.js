"use strict";

/**
 * @fileoverview Response-time tracking middleware.
 * Uses process.hrtime.bigint() for microsecond precision.
 * Sets X-Response-Time header and aggregates per-route metrics.
 */

const { logger } = require("../../utils/logger");

class ResponseTimeMiddleware {
    constructor(options = {}) {
        this._slowThreshold = options.slowThreshold ?? 1000;
        this._verySlowThreshold = options.verySlowThreshold ?? 3000;
        this._metrics = new Map();

        this.handle = this.handle.bind(this);
    }

    handle(req, res, next) {
        const startTime = process.hrtime.bigint();

        const originalWriteHead = res.writeHead;
        res.writeHead = function (statusCode, statusMessage, headers) {
            if (!res.headersSent && !res.getHeader("X-Response-Time")) {
                const ms = Number(
                    (process.hrtime.bigint() - startTime) / BigInt(1_000_000),
                );
                res.setHeader("X-Response-Time", `${ms}ms`);
            }
            return originalWriteHead.call(
                this,
                statusCode,
                statusMessage,
                headers,
            );
        };

        res.on("finish", () => {
            const ms = Number(
                (process.hrtime.bigint() - startTime) / BigInt(1_000_000),
            );
            const route = `${req.method} ${req.route?.path || req.path}`;

            const m = this._metrics.get(route) || {
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
            if (ms > this._slowThreshold) m.slowCount++;
            if (ms > this._verySlowThreshold) m.verySlowCount++;

            this._metrics.set(route, m);

            if (ms > this._slowThreshold) {
                logger.warn(`Slow response: ${route} took ${ms}ms`);
            }
        });

        next();
    }

    getPerformanceMetrics() {
        const out = {};
        for (const [route, d] of this._metrics) {
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

    getSlowRoutes() {
        const routes = [];
        for (const [route, d] of this._metrics) {
            const avg = d.count ? d.totalTime / d.count : 0;
            const slowRate = d.count ? d.slowCount / d.count : 0;
            if (avg > this._slowThreshold || slowRate > 0.1) {
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

    resetMetrics() {
        this._metrics.clear();
    }
}

const defaultResponseTime = new ResponseTimeMiddleware();
module.exports = { ResponseTimeMiddleware, defaultResponseTime };
