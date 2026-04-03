"use strict";

/**
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │                     Custom Rate Limiter                                 │
 * │                                                                         │
 * │  Algorithm : Sliding Window Counter (weighted approximation)            │
 * │  Storage   : node-cache (in-memory, no Redis required)                  │
 * │  Headers   : IETF draft-ietf-httpapi-ratelimit-headers (RateLimit-*)    │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * WHY SLIDING WINDOW COUNTER?
 * ───────────────────────────
 * Fixed window  → allows 2× burst at window boundaries (naive, avoid)
 * Sliding log   → perfectly accurate but O(n) memory per key (expensive)
 * Sliding counter (this) → weighted blend of two fixed windows. O(1) memory,
 *   ~0.003% error rate in practice. Best balance of precision and efficiency.
 *
 * HOW IT WORKS:
 * ─────────────
 *   weight    = (windowMs - elapsed_in_current_window) / windowMs
 *   estimated = (prev_window_count × weight) + curr_window_count
 *
 *   If estimated >= max → reject.
 *   The "weight" smoothly fades out the previous window as time passes.
 *
 * USAGE:
 * ──────
 *   const limiter = require('../middleware/rateLimiter');
 *
 *   app.use('/api', limiter.default);             // global default
 *   router.post('/login', limiter.auth, handler); // strict auth routes
 *   router.get('/export', limiter.burst, handler);// expensive endpoints
 *
 *   // Custom limiter
 *   const myLimiter = limiter.createLimiter({ max: 5, windowMs: 60_000 });
 *
 *   // Per-user limiting (after authenticate middleware)
 *   const userLimiter = limiter.createLimiter({ max: 200, keyBy: 'user' });
 */

const NodeCache = require("node-cache");
const logger = require("../utils/logger");

// ─── Internal store ───────────────────────────────────────────────────────────
// Dedicated cache instance — never shares space with app data.
const store = new NodeCache({
    stdTTL: 3600, // 1-hour hard cap prevents unbounded memory growth
    checkperiod: 120, // sweep expired keys every 2 minutes
    useClones: false,
    deleteOnExpire: true,
});

// ─── IP extraction ────────────────────────────────────────────────────────────

/**
 * Safely extract the real client IP.
 * Trusts X-Forwarded-For only when TRUST_PROXY=true (set when behind nginx/LB).
 * Prevents IP spoofing by untrusted clients injecting X-Forwarded-For.
 */
const extractIp = (req) => {
    if (process.env.TRUST_PROXY === "true") {
        const forwarded = req.headers["x-forwarded-for"];
        if (forwarded) {
            const ip = forwarded.split(",")[0].trim();
            if (ip) return ip;
        }
    }
    return req.ip || req.socket?.remoteAddress || "unknown";
};

// ─── Key generators ───────────────────────────────────────────────────────────

const keyGenerators = {
    /** By client IP (default – always available, no auth required) */
    ip: (req) => `rl:ip:${extractIp(req)}`,

    /** By authenticated user ID. Falls back to IP for unauthenticated requests. */
    user: (req) =>
        req.user?.sub ? `rl:user:${req.user.sub}` : `rl:ip:${extractIp(req)}`,

    /** By API key header. Falls back to IP if header is absent. */
    apiKey: (req) => {
        const key = req.headers["x-api-key"];
        return key ? `rl:apikey:${key}` : `rl:ip:${extractIp(req)}`;
    },

    /**
     * By IP + route path.
     * Isolates limits per-endpoint so one slow route can't drain the global budget.
     */
    ipAndRoute: (req) =>
        `rl:ip+route:${extractIp(req)}:${req.route?.path || req.path}`,

    /**
     * By user (if authed) + route.
     * Finest granularity — per-user, per-endpoint.
     */
    userAndRoute: (req) => {
        const id = req.user?.sub || extractIp(req);
        return `rl:user+route:${id}:${req.route?.path || req.path}`;
    },
};

// ─── Sliding window counter ───────────────────────────────────────────────────

/**
 * Core sliding window counter algorithm.
 *
 * Uses two adjacent fixed windows and weights the previous window's count
 * by how much of it still overlaps with the current sliding window.
 * This gives O(1) memory per key with near-perfect accuracy.
 *
 * @param {string} key
 * @param {number} windowMs
 * @param {number} max
 * @returns {{ allowed: boolean, count: number, remaining: number, resetAt: number }}
 */
const slidingWindowCounter = (key, windowMs, max) => {
    const now = Date.now();
    const windowSec = windowMs / 1000;
    const windowStart = Math.floor(now / windowMs) * windowMs; // epoch of current fixed window
    const prevKey = `${key}:${windowStart - windowMs}`;
    const currKey = `${key}:${windowStart}`;

    const prevCount = store.get(prevKey) ?? 0;
    const currCount = store.get(currKey) ?? 0;

    // How far (0→1) into the current window are we?
    const elapsed = now - windowStart;
    const weight = (windowMs - elapsed) / windowMs; // previous window's remaining share

    // Weighted estimate of requests in the conceptual sliding window
    const estimated = prevCount * weight + currCount;

    const resetAt = windowStart + windowMs;

    if (estimated >= max) {
        return {
            allowed: false,
            count: Math.ceil(estimated),
            remaining: 0,
            resetAt,
        };
    }

    // Increment current window; TTL = 2× window so previous window survives long enough
    store.set(currKey, currCount + 1, windowSec * 2);

    const newEstimate = prevCount * weight + (currCount + 1);

    return {
        allowed: true,
        count: Math.ceil(newEstimate),
        remaining: Math.max(0, Math.floor(max - newEstimate)),
        resetAt,
    };
};

// ─── Header writer ────────────────────────────────────────────────────────────

/**
 * Set IETF-standard rate-limit response headers.
 * https://www.ietf.org/archive/id/draft-ietf-httpapi-ratelimit-headers-07.txt
 */
const setHeaders = (res, { limit, remaining, resetAt, windowMs }) => {
    const resetSec = Math.ceil(resetAt / 1000);
    const windowSec = Math.ceil(windowMs / 1000);
    res.setHeader("RateLimit-Limit", limit);
    res.setHeader("RateLimit-Remaining", remaining);
    res.setHeader("RateLimit-Reset", resetSec); // Unix timestamp
    res.setHeader("RateLimit-Policy", `${limit};w=${windowSec}`);
};

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create a configurable rate-limiter middleware.
 *
 * @param {object}          [opts]
 * @param {number}          [opts.max=100]         Max requests per window
 * @param {number}          [opts.windowMs=900_000] Window size in ms
 * @param {string|Function} [opts.keyBy='ip']       Key strategy:
 *                                                   'ip' | 'user' | 'apiKey' |
 *                                                   'ipAndRoute' | 'userAndRoute' |
 *                                                   (req) => string
 * @param {Function}        [opts.skip]             (req) => bool  skip if true
 * @param {Function}        [opts.onLimit]          Custom block handler (req, res, info) => void
 * @param {boolean}         [opts.dryRun=false]     Log violations but never block
 * @param {string}          [opts.label]            Label for log messages
 *
 * @returns {import('express').RequestHandler}
 *
 * @example
 * // 60 req / min per user
 * const limiter = createLimiter({ max: 60, windowMs: 60_000, keyBy: 'user' });
 *
 * // Skip admin IPs entirely
 * const limiter = createLimiter({
 *   skip: (req) => process.env.ADMIN_IPS?.split(',').includes(extractIp(req)),
 * });
 *
 * // Per-tenant key
 * const limiter = createLimiter({
 *   keyBy: (req) => `tenant:${req.headers['x-tenant-id'] || 'anon'}`,
 * });
 */
const createLimiter = ({
    max = 100,
    windowMs = 900_000,
    keyBy = "ip",
    skip = null,
    onLimit = null,
    dryRun = false,
    label = "RateLimit",
} = {}) => {
    if (max <= 0) throw new RangeError("[RateLimit] max must be > 0");
    if (windowMs <= 0) throw new RangeError("[RateLimit] windowMs must be > 0");

    const getKey =
        typeof keyBy === "function"
            ? keyBy
            : (keyGenerators[keyBy] ?? keyGenerators.ip);

    return (req, res, next) => {
        // Always let OPTIONS and health checks pass
        if (req.method === "OPTIONS" || req.path === "/api/health")
            return next();

        // Custom skip predicate
        if (skip?.(req)) return next();

        const key = getKey(req);
        const result = slidingWindowCounter(key, windowMs, max);

        setHeaders(res, {
            limit: max,
            remaining: result.remaining,
            resetAt: result.resetAt,
            windowMs,
        });

        if (!result.allowed) {
            const retryAfter = Math.ceil((result.resetAt - Date.now()) / 1000);
            res.setHeader("Retry-After", retryAfter);

            logger.warn(`[${label}] Limit exceeded`, {
                key,
                ip: extractIp(req),
                path: req.path,
                method: req.method,
                count: result.count,
                max,
                windowMs,
                dryRun,
            });

            if (dryRun) return next();

            if (onLimit)
                return onLimit(req, res, {
                    ...result,
                    retryAfter,
                    max,
                    windowMs,
                });

            return res.status(429).json({
                error: {
                    message: "Too many requests. Please try again later.",
                    retryAfter,
                },
            });
        }

        logger.debug(`[${label}] Pass`, {
            key,
            count: result.count,
            remaining: result.remaining,
        });

        next();
    };
};

// ─── Presets ──────────────────────────────────────────────────────────────────

/**
 * 100 req / 15 min – general API traffic, keyed by IP.
 * Configurable via RATE_LIMIT_MAX + RATE_LIMIT_WINDOW_MS env vars.
 */
const defaultLimiter = createLimiter({
    max: parseInt(process.env.RATE_LIMIT_MAX || "100", 10),
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || "900000", 10),
    keyBy: "ip",
    label: "RateLimit:default",
});

/**
 * 10 req / 15 min – login, register, OTP, forgot-password.
 * Tight window forces long pauses between brute-force attempts.
 */
const authLimiter = createLimiter({
    max: 10,
    windowMs: 15 * 60 * 1000,
    keyBy: "ip",
    label: "RateLimit:auth",
    onLimit: (req, res, { retryAfter }) =>
        res.status(429).json({
            error: {
                message: "Too many attempts. Please wait before trying again.",
                retryAfter,
            },
        }),
});

/**
 * 5 req / 1 min – expensive endpoints (PDF export, report generation).
 * Keyed by user so authenticated users have their own isolated budget.
 */
const burstLimiter = createLimiter({
    max: 5,
    windowMs: 60_000,
    keyBy: "user",
    label: "RateLimit:burst",
});

/**
 * 30 req / 1 min – per-IP, per-route.
 * Prevents a user hammering one specific endpoint without
 * affecting their overall API allowance.
 */
const perRouteLimiter = createLimiter({
    max: 30,
    windowMs: 60_000,
    keyBy: "ipAndRoute",
    label: "RateLimit:perRoute",
});

// ─── Introspection ────────────────────────────────────────────────────────────

/** Current store stats – hits, misses, key count. For monitoring endpoints. */
const getStats = () => store.getStats();

/**
 * Manually clear a specific key (e.g. unban a user after admin review).
 * @param {string} key – e.g. 'rl:ip:1.2.3.4'
 */
const clearKey = (key) => {
    const n = store.del(key);
    logger.info("[RateLimit] Key cleared", { key, deleted: n });
    return n;
};

/** Flush ALL rate-limit data. Use with caution in production. */
const flushAll = () => {
    store.flushAll();
    logger.warn("[RateLimit] All data flushed");
};

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
    // Ready-to-use middleware presets
    default: defaultLimiter,
    auth: authLimiter,
    burst: burstLimiter,
    perRoute: perRouteLimiter,

    // Factory for custom limiters
    createLimiter,

    // Key generators (for composing custom key strategies)
    keyGenerators,
    extractIp,

    // Introspection / admin
    getStats,
    clearKey,
    flushAll,
};
