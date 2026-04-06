"use strict";

const { logger } = require("../../utils/logger");

/**
 * IP filtering middleware — restricts access to trusted IP addresses or CIDR ranges.
 *
 * Configuration via env vars:
 *   ALLOWED_IPS       comma-separated allowlist  (e.g. "10.0.0.0/8,192.168.1.0/24")
 *   ENABLE_IP_FILTER  set to "true" to activate  (disabled by default)
 *
 * When ENABLE_IP_FILTER is not "true", the middleware is a pass-through.
 */

/**
 * Check whether an IPv4 address falls within a CIDR range.
 * @param {string} ip
 * @param {string} cidr - e.g. "10.0.0.0/8" or plain IP "10.0.0.1"
 * @returns {boolean}
 */
function ipInCidr(ip, cidr) {
    const [range, bits] = cidr.split("/");
    const mask = bits ? ~((1 << (32 - parseInt(bits, 10))) - 1) : 0xffffffff;
    const ipNum = ipToNum(ip);
    const rangeNum = ipToNum(range);
    return (ipNum & mask) === (rangeNum & mask);
}

function ipToNum(ip) {
    return (
        ip
            .split(".")
            .reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0
    );
}

/**
 * Extract the real client IP, stripping IPv6-mapped prefix.
 */
function extractClientIp(req) {
    let ip = req.ip || req.socket?.remoteAddress || "unknown";
    if (ip.startsWith("::ffff:")) ip = ip.slice(7);
    return ip;
}

/**
 * Create IP filter middleware.
 * @param {object} [opts]
 * @param {string[]} [opts.allowedIps] - Override env var
 * @returns {import('express').RequestHandler}
 */
function createIpFilter(opts = {}) {
    const enabled = process.env.ENABLE_IP_FILTER === "true";
    const allowedRaw =
        opts.allowedIps ||
        (process.env.ALLOWED_IPS
            ? process.env.ALLOWED_IPS.split(",").map((s) => s.trim())
            : []);

    if (!enabled || allowedRaw.length === 0) {
        // Pass-through when disabled
        return (_req, _res, next) => next();
    }

    return (req, res, next) => {
        const clientIp = extractClientIp(req);

        const allowed = allowedRaw.some((entry) =>
            entry.includes("/")
                ? ipInCidr(clientIp, entry)
                : clientIp === entry,
        );

        if (!allowed) {
            logger.warn("IP blocked by filter", {
                ip: clientIp,
                path: req.path,
                operation: "IP_FILTER_BLOCKED",
            });
            return res.status(403).json({
                status: "error",
                code: 403,
                message: "Access denied",
            });
        }

        next();
    };
}

module.exports = { createIpFilter, ipInCidr, extractClientIp };
