"use strict";

/**
 * @fileoverview Sliding Window Counter rate limiter middleware.
 * O(1) memory per key, ~0.003% error rate, IETF RateLimit-* headers.
 */

const NodeCache = require("node-cache");
const { logger } = require("../../utils/logger");

class RateLimiterMiddleware {
    constructor(options = {}) {
        this._max =
            options.max ?? parseInt(process.env.RATE_LIMIT_MAX || "100", 10);
        this._windowMs =
            options.windowMs ??
            parseInt(process.env.RATE_LIMIT_WINDOW_MS || "900000", 10);
        this._keyBy = options.keyBy ?? "ip";
        this._skip = options.skip ?? null;
        this._onLimit = options.onLimit ?? null;
        this._dryRun = options.dryRun ?? false;
        this._label = options.label ?? "RateLimit";
        this._store =
            options.store ??
            new NodeCache({
                stdTTL: 3600,
                checkperiod: 120,
                useClones: false,
                deleteOnExpire: true,
            });

        if (this._max <= 0) throw new RangeError("Rate Limit max must be > 0");
        if (this._windowMs <= 0)
            throw new RangeError("Rate Limit windowMs must be > 0");

        this.handle = this.handle.bind(this);
    }

    handle(req, res, next) {
        if (req.method === "OPTIONS" || req.path === "/api/health")
            return next();
        if (this._skip?.(req)) return next();

        const key = this._getKey(req);
        const result = this._slidingWindowCounter(key);

        this._setHeaders(res, {
            limit: this._max,
            remaining: result.remaining,
            resetAt: result.resetAt,
            windowMs: this._windowMs,
        });

        if (!result.allowed) {
            const retryAfter = Math.ceil((result.resetAt - Date.now()) / 1000);
            res.setHeader("Retry-After", retryAfter);

            logger.warn(`[${this._label}] Limit exceeded`, {
                key,
                ip: RateLimiterMiddleware.extractIp(req),
                path: req.path,
                method: req.method,
                count: result.count,
                max: this._max,
                windowMs: this._windowMs,
                dryRun: this._dryRun,
            });

            if (this._dryRun) return next();

            if (this._onLimit) {
                return this._onLimit(req, res, {
                    ...result,
                    retryAfter,
                    max: this._max,
                    windowMs: this._windowMs,
                });
            }

            return res.status(429).json({
                status: "error",
                code: 429,
                message: "Too many requests. Please try again later.",
                error: {
                    type: "RateLimitExceeded",
                    details: [
                        { field: "retryAfter", issue: `${retryAfter} seconds` },
                    ],
                    hint: "Wait before retrying.",
                },
            });
        }

        logger.debug(`[${this._label}] Pass`, {
            key,
            count: result.count,
            remaining: result.remaining,
        });

        next();
    }

    getStats() {
        return this._store.getStats();
    }

    clearKey(key) {
        const n = this._store.del(key);
        logger.info("Rate Limit Key cleared", { key, deleted: n });
        return n;
    }

    flushAll() {
        this._store.flushAll();
        logger.warn("Rate Limit All data flushed");
    }

    // ── Private helpers ───────────────────────────────────────────────────

    _getKey(req) {
        if (typeof this._keyBy === "function") return this._keyBy(req);
        return (
            RateLimiterMiddleware.keyGenerators[this._keyBy] ??
            RateLimiterMiddleware.keyGenerators.ip
        )(req);
    }

    _slidingWindowCounter(key) {
        const now = Date.now();
        const windowSec = this._windowMs / 1000;
        const windowStart = Math.floor(now / this._windowMs) * this._windowMs;
        const prevKey = `${key}:${windowStart - this._windowMs}`;
        const currKey = `${key}:${windowStart}`;

        const prevCount = this._store.get(prevKey) ?? 0;
        const currCount = this._store.get(currKey) ?? 0;

        const elapsed = now - windowStart;
        const weight = (this._windowMs - elapsed) / this._windowMs;

        const estimated = prevCount * weight + currCount;
        const resetAt = windowStart + this._windowMs;

        if (estimated >= this._max) {
            return {
                allowed: false,
                count: Math.ceil(estimated),
                remaining: 0,
                resetAt,
            };
        }

        this._store.set(currKey, currCount + 1, windowSec * 2);
        const newEstimate = prevCount * weight + (currCount + 1);

        return {
            allowed: true,
            count: Math.ceil(newEstimate),
            remaining: Math.max(0, Math.floor(this._max - newEstimate)),
            resetAt,
        };
    }

    _setHeaders(res, { limit, remaining, resetAt, windowMs }) {
        const resetSec = Math.ceil(resetAt / 1000);
        const windowSec = Math.ceil(windowMs / 1000);
        res.setHeader("RateLimit-Limit", limit);
        res.setHeader("RateLimit-Remaining", remaining);
        res.setHeader("RateLimit-Reset", resetSec);
        res.setHeader("RateLimit-Policy", `${limit};w=${windowSec}`);
    }

    // ── Static helpers ────────────────────────────────────────────────────

    static extractIp(req) {
        if (process.env.TRUST_PROXY === "true") {
            const forwarded = req.headers["x-forwarded-for"];
            if (forwarded) {
                const ip = forwarded.split(",")[0].trim();
                if (ip) return ip;
            }
        }
        return req.ip || req.socket?.remoteAddress || "unknown";
    }

    static keyGenerators = {
        ip: (req) => `rl:ip:${RateLimiterMiddleware.extractIp(req)}`,
        user: (req) =>
            req.user?.sub
                ? `rl:user:${req.user.sub}`
                : `rl:ip:${RateLimiterMiddleware.extractIp(req)}`,
        apiKey: (req) => {
            const key = req.headers["x-api-key"];
            return key
                ? `rl:apikey:${key}`
                : `rl:ip:${RateLimiterMiddleware.extractIp(req)}`;
        },
        ipAndRoute: (req) =>
            `rl:ip+route:${RateLimiterMiddleware.extractIp(req)}:${req.route?.path || req.path}`,
        userAndRoute: (req) => {
            const id = req.user?.sub || RateLimiterMiddleware.extractIp(req);
            return `rl:user+route:${id}:${req.route?.path || req.path}`;
        },
    };
}

// ── Preset instances ──────────────────────────────────────────────────────────

const defaultRateLimiter = new RateLimiterMiddleware({
    label: "RateLimit:default",
});

const authRateLimiter = new RateLimiterMiddleware({
    max: 10,
    windowMs: 15 * 60 * 1000,
    label: "RateLimit:auth",
    onLimit: (req, res, { retryAfter }) =>
        res.status(429).json({
            status: "error",
            code: 429,
            message: "Too many attempts. Please wait before trying again.",
            error: {
                type: "RateLimitExceeded",
                details: [
                    { field: "retryAfter", issue: `${retryAfter} seconds` },
                ],
            },
        }),
});

const burstRateLimiter = new RateLimiterMiddleware({
    max: 5,
    windowMs: 60_000,
    keyBy: "user",
    label: "RateLimit:burst",
});

const perRouteRateLimiter = new RateLimiterMiddleware({
    max: 30,
    windowMs: 60_000,
    keyBy: "ipAndRoute",
    label: "RateLimit:perRoute",
});

module.exports = {
    RateLimiterMiddleware,
    defaultRateLimiter,
    authRateLimiter,
    burstRateLimiter,
    perRouteRateLimiter,
};
