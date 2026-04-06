"use strict";

/**
 * @fileoverview Security filter middleware.
 * Blocks vulnerability scanning patterns, path traversal,
 * script injection, and suspicious HTTP methods.
 * Tracks suspicious IPs in-memory with auto-block after threshold.
 */

const { logger } = require("../../utils/logger");

class SecurityFilterMiddleware {
    constructor(options = {}) {
        this._maliciousPatterns = options.maliciousPatterns ?? [
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
            /\.\.[/\\]/,
            /\/\.\.\//,
            /\\\.\\\./,
            /<script>/i,
            /<iframe>/i,
            /javascript:/i,
            /onerror=/i,
            /onload=/i,
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
            /\/TiVoConnect/,
            /\/NFuse\//,
            /\/CCMAdmin\//,
            /\/vncviewer\.jar/,
            /\/robots\.txt/,
            /\/level\/99\//,
            /\/hb1\//,
        ];

        this._whitelistedPaths = options.whitelistedPaths ?? [
            /^\/$/,
            /^\/health$/,
            /^\/api\//,
            /^\/api-docs/,
        ];

        this._blockedMethods =
            options.blockedMethods ??
            new Set(["TRACE", "TRACK", "PROPFIND", "SEARCH"]);

        this._suspiciousIPs = new Map();
        this._suspiciousThreshold = options.suspiciousThreshold ?? 10;
        this._blockDurationMs = options.blockDurationMs ?? 60 * 60 * 1000;

        // Cleanup stale entries every hour
        this._cleanupTimer = setInterval(
            () => {
                const cutoff = Date.now() - 24 * 60 * 60 * 1000;
                for (const [ip, r] of this._suspiciousIPs) {
                    if (r.lastSeen < cutoff) this._suspiciousIPs.delete(ip);
                }
            },
            60 * 60 * 1000,
        );
        if (this._cleanupTimer.unref) this._cleanupTimer.unref();

        this.handle = this.handle.bind(this);
    }

    handle(req, res, next) {
        const ip = req.ip || req.connection?.remoteAddress || "unknown";
        const reqPath = req.path;
        const method = req.method;

        if (this._whitelistedPaths.some((p) => p.test(reqPath))) return next();

        const record = this._suspiciousIPs.get(ip);
        if (record && record.blockedUntil > Date.now()) {
            logger.debug("Request from blocked IP", {
                ip,
                method,
                path: reqPath,
            });
            return res.status(403).json({
                status: "error",
                code: 403,
                message: "Forbidden",
                error: { type: "Forbidden" },
            });
        }

        if (this._blockedMethods.has(method)) {
            this._trackSuspiciousIP(ip);
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

        if (this._maliciousPatterns.some((p) => p.test(reqPath))) {
            this._trackSuspiciousIP(ip);
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

    getStats() {
        const now = Date.now();
        const blocked = [];
        const suspicious = [];

        for (const [ip, r] of this._suspiciousIPs) {
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
            totalTracked: this._suspiciousIPs.size,
            blocked: blocked.length,
            suspicious: suspicious.length,
            blockedIPs: blocked,
            suspiciousIPs: suspicious,
        };
    }

    _trackSuspiciousIP(ip) {
        const now = Date.now();
        const record = this._suspiciousIPs.get(ip) || {
            count: 0,
            blockedUntil: 0,
            lastSeen: now,
        };

        if (record.blockedUntil > now) return true;

        record.count++;
        record.lastSeen = now;

        if (record.count >= this._suspiciousThreshold) {
            record.blockedUntil = now + this._blockDurationMs;
            logger.warn("IP blocked due to suspicious activity", {
                ip,
                requestCount: record.count,
                blockedUntil: new Date(record.blockedUntil).toISOString(),
            });
        }

        this._suspiciousIPs.set(ip, record);
        return record.blockedUntil > now;
    }
}

const defaultSecurityFilter = new SecurityFilterMiddleware();
module.exports = { SecurityFilterMiddleware, defaultSecurityFilter };
