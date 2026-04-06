"use strict";

/**
 * @fileoverview Security filter, rate limit, IP filter, CSRF log messages.
 * Used ONLY in logger calls — never thrown or sent to clients.
 */

const middlewareMessages = {
    IP_BLOCKED: (ip, path) => `IP blocked by filter: ${ip} on ${path}`,
    RATE_LIMIT_EXCEEDED: (ip, path, count, max) =>
        `Rate limit exceeded for ${ip} on ${path} (${count}/${max}).`,
    CSRF_TOKEN_GENERATED: (ip) => `CSRF token generated for ${ip}.`,
    CSRF_VALIDATION_FAILED: (ip, url) =>
        `CSRF validation failed for ${ip} on ${url}.`,
    SECURITY_FILTER_BLOCKED: (ip, method, path) =>
        `Security filter blocked ${method} ${path} from ${ip}.`,
    SUSPICIOUS_IP_TRACKED: (ip, count) =>
        `Suspicious IP tracked: ${ip} (${count} offenses).`,
    SUSPICIOUS_IP_BLOCKED: (ip, blockedUntil) =>
        `IP ${ip} blocked until ${blockedUntil}.`,
    CORS_ORIGIN_BLOCKED: (origin) => `CORS: origin blocked — ${origin}`,
};

module.exports = { middlewareMessages };
