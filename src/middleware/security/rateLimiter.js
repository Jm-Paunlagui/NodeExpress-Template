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
 * USAGE:
 *   const limiter = require('../middleware/security/rateLimiter');
 *
 *   app.use('/api', limiter.default);             // global default
 *   router.post('/login', limiter.auth, handler); // strict auth routes
 *   router.get('/export', limiter.burst, handler);// expensive endpoints
 *
 *   // Custom limiter
 *   const myLimiter = limiter.createLimiter({ max: 5, windowMs: 60_000 });
 */

const NodeCache = require("node-cache");
const { logger } = require("../../utils/logger");

// ─── Internal store ───────────────────────────────────────────────────────────
const store = new NodeCache({
    stdTTL: 3600,
    checkperiod: 120,
    useClones: false,
    deleteOnExpire: true,
});

// ─── IP extraction ────────────────────────────────────────────────────────────

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
    ip: (req) => `rl:ip:${extractIp(req)}`,
    user: (req) =>
        req.user?.sub ? `rl:user:${req.user.sub}` : `rl:ip:${extractIp(req)}`,
    apiKey: (req) => {
        const key = req.headers["x-api-key"];
        return key ? `rl:apikey:${key}` : `rl:ip:${extractIp(req)}`;
    },
    ipAndRoute: (req) =>
        `rl:ip+route:${extractIp(req)}:${req.route?.path || req.path}`,
    userAndRoute: (req) => {
        const id = req.user?.sub || extractIp(req);
        return `rl:user+route:${id}:${req.route?.path || req.path}`;
    },
};

// ─── Sliding window counter ───────────────────────────────────────────────────

const slidingWindowCounter = (key, windowMs, max) => {
    const now = Date.now();
    const windowSec = windowMs / 1000;
    const windowStart = Math.floor(now / windowMs) * windowMs;
    const prevKey = `${key}:${windowStart - windowMs}`;
    const currKey = `${key}:${windowStart}`;

    const prevCount = store.get(prevKey) ?? 0;
    const currCount = store.get(currKey) ?? 0;

    const elapsed = now - windowStart;
    const weight = (windowMs - elapsed) / windowMs;

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

const setHeaders = (res, { limit, remaining, resetAt, windowMs }) => {
    const resetSec = Math.ceil(resetAt / 1000);
    const windowSec = Math.ceil(windowMs / 1000);
    res.setHeader("RateLimit-Limit", limit);
    res.setHeader("RateLimit-Remaining", remaining);
    res.setHeader("RateLimit-Reset", resetSec);
    res.setHeader("RateLimit-Policy", `${limit};w=${windowSec}`);
};

// ─── Factory ──────────────────────────────────────────────────────────────────

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
        if (req.method === "OPTIONS" || req.path === "/api/health")
            return next();

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

        logger.debug(`[${label}] Pass`, {
            key,
            count: result.count,
            remaining: result.remaining,
        });

        next();
    };
};

// ─── Presets ──────────────────────────────────────────────────────────────────

const defaultLimiter = createLimiter({
    max: parseInt(process.env.RATE_LIMIT_MAX || "100", 10),
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || "900000", 10),
    keyBy: "ip",
    label: "RateLimit:default",
});

const authLimiter = createLimiter({
    max: 10,
    windowMs: 15 * 60 * 1000,
    keyBy: "ip",
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

const burstLimiter = createLimiter({
    max: 5,
    windowMs: 60_000,
    keyBy: "user",
    label: "RateLimit:burst",
});

const perRouteLimiter = createLimiter({
    max: 30,
    windowMs: 60_000,
    keyBy: "ipAndRoute",
    label: "RateLimit:perRoute",
});

// ─── Introspection ────────────────────────────────────────────────────────────

const getStats = () => store.getStats();

const clearKey = (key) => {
    const n = store.del(key);
    logger.info("[RateLimit] Key cleared", { key, deleted: n });
    return n;
};

const flushAll = () => {
    store.flushAll();
    logger.warn("[RateLimit] All data flushed");
};

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
    default: defaultLimiter,
    auth: authLimiter,
    burst: burstLimiter,
    perRoute: perRouteLimiter,
    createLimiter,
    keyGenerators,
    extractIp,
    getStats,
    clearKey,
    flushAll,
};
