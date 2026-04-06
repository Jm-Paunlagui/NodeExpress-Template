"use strict";

/**
 * @fileoverview Security Filter Middleware
 * Blocks common vulnerability scanning patterns, path traversal,
 * script injection, and suspicious HTTP methods EARLY in the pipeline.
 *
 * Suspicious IPs are tracked in-memory and auto-blocked after a threshold.
 */

const { logger } = require("../../utils/logger");

// ── Malicious path patterns ──────────────────────────────────────────────────

const MALICIOUS_PATTERNS = [
    // Vulnerability scanners
    /\/services$/,
    /\/bea_wls_internal\//,
    /\/weblogic\//,
    /\/redfish\//,
    /\/appliance\/avtrans/,
    /\/dana-na\/auth/,
    /\/Synchronization$/,
    /\/webui\/auth/,
    /\/rest\/api\/latest\/repos/,
    /\/o\/docs\//,
    /\/bin\/login\/XWiki/,
    /\/bin\/get\/Main\/SolrSearch/,
    /\/ws$/,
    /\/Apriso\//,
    /\/userRpm\//,
    /\/adv_index\.htm/,
    /\/hp\/device\//,
    /_layouts\/15\//,
    /\/core\/auth\/login\//,
    /\/cli\/ws/,
    /\/login\/login/,

    // Path traversal
    /\.\.[/\\]/,
    /\/\.\.\//,
    /\\\.\\\./,

    // Script injection
    /<script>/i,
    /<iframe>/i,
    /javascript:/i,
    /onerror=/i,
    /onload=/i,

    // File extensions that should never reach a Node API
    /\.asp$/i,
    /\.aspx$/i,
    /\.jsp$/i,
    /\.cgi$/i,
    /\.pl$/i,
    /\.php$/i,
    /\.cfm$/i,
    /\.class$/i,
    /\.jar$/i,
    /\.nsf$/i,
    /\.htm$/i,

    // Common scanner paths
    /\/TiVoConnect/,
    /\/NFuse\//,
    /\/CCMAdmin\//,
    /\/vncviewer\.jar/,
    /\/robots\.txt/,
    /\/level\/99\//,
    /\/hb1\//,
];

// ── Whitelisted paths ─────────────────────────────────────────────────────────

const WHITELISTED_PATHS = [/^\/$/, /^\/health$/, /^\/api\//, /^\/api-docs/];

// ── Blocked HTTP methods ──────────────────────────────────────────────────────

const BLOCKED_METHODS = new Set(["TRACE", "TRACK", "PROPFIND", "SEARCH"]);

// ── IP tracking ───────────────────────────────────────────────────────────────

const suspiciousIPs = new Map();
const SUSPICIOUS_THRESHOLD = 10;
const BLOCK_DURATION_MS = 60 * 60 * 1000; // 1 hour

function _trackSuspiciousIP(ip) {
    const now = Date.now();
    const record = suspiciousIPs.get(ip) || {
        count: 0,
        blockedUntil: 0,
        lastSeen: now,
    };

    if (record.blockedUntil > now) return true; // already blocked

    record.count++;
    record.lastSeen = now;

    if (record.count >= SUSPICIOUS_THRESHOLD) {
        record.blockedUntil = now + BLOCK_DURATION_MS;
        logger.warn("IP blocked due to suspicious activity", {
            ip,
            requestCount: record.count,
            blockedUntil: new Date(record.blockedUntil).toISOString(),
        });
    }

    suspiciousIPs.set(ip, record);
    return record.blockedUntil > now;
}

// Cleanup stale entries every hour
const _cleanupTimer = setInterval(
    () => {
        const cutoff = Date.now() - 24 * 60 * 60 * 1000;
        for (const [ip, r] of suspiciousIPs) {
            if (r.lastSeen < cutoff) suspiciousIPs.delete(ip);
        }
    },
    60 * 60 * 1000,
);
if (_cleanupTimer.unref) _cleanupTimer.unref();

// ── Middleware ─────────────────────────────────────────────────────────────────

function securityFilter(req, res, next) {
    const ip = req.ip || req.connection?.remoteAddress || "unknown";
    const reqPath = req.path;
    const method = req.method;

    // Fast-path: whitelisted paths pass through
    if (WHITELISTED_PATHS.some((p) => p.test(reqPath))) return next();

    // Is this IP currently blocked?
    const record = suspiciousIPs.get(ip);
    if (record && record.blockedUntil > Date.now()) {
        logger.debug("Request from blocked IP", { ip, method, path: reqPath });
        return res.status(403).json({
            status: "error",
            code: 403,
            message: "Forbidden",
            error: { type: "Forbidden" },
        });
    }

    // Blocked HTTP methods
    if (BLOCKED_METHODS.has(method)) {
        _trackSuspiciousIP(ip);
        logger.warn("Blocked suspicious HTTP method", {
            ip,
            method,
            path: reqPath,
        });
        return res.status(405).json({
            status: "error",
            code: 405,
            message: "Method Not Allowed",
            error: { type: "MethodNotAllowed" },
        });
    }

    // Malicious path patterns — return 404 to avoid revealing filter
    if (MALICIOUS_PATTERNS.some((p) => p.test(reqPath))) {
        _trackSuspiciousIP(ip);
        logger.debug("Blocked malicious request", {
            ip,
            method,
            path: reqPath,
        });
        return res.status(404).json({
            status: "error",
            code: 404,
            message: "Not Found",
            error: { type: "NotFound" },
        });
    }

    next();
}

// ── Stats ─────────────────────────────────────────────────────────────────────

function getSecurityStats() {
    const now = Date.now();
    const blocked = [];
    const suspicious = [];

    for (const [ip, r] of suspiciousIPs) {
        if (r.blockedUntil > now) {
            blocked.push({
                ip,
                count: r.count,
                blockedUntil: new Date(r.blockedUntil).toISOString(),
            });
        } else if (r.count > 0) {
            suspicious.push({
                ip,
                count: r.count,
                lastSeen: new Date(r.lastSeen).toISOString(),
            });
        }
    }

    return {
        totalTracked: suspiciousIPs.size,
        blocked: blocked.length,
        suspicious: suspicious.length,
        blockedIPs: blocked,
        suspiciousIPs: suspicious,
    };
}

module.exports = { securityFilter, getSecurityStats };
