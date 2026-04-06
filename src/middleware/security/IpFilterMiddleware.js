"use strict";

/**
 * @fileoverview CIDR-aware IP allowlist middleware.
 * Restricts access to trusted IP addresses or CIDR ranges.
 */

const { logger } = require("../../utils/logger");

class IpFilterMiddleware {
    constructor(options = {}) {
        this._enabled =
            options.enabled ?? process.env.ENABLE_IP_FILTER === "true";
        this._allowedIps =
            options.allowedIps ??
            (process.env.ALLOWED_IPS
                ? process.env.ALLOWED_IPS.split(",").map((s) => s.trim())
                : []);

        this.handle = this.handle.bind(this);
    }

    handle(req, res, next) {
        if (!this._enabled || this._allowedIps.length === 0) return next();

        const clientIp = IpFilterMiddleware.extractClientIp(req);
        const allowed = this._allowedIps.some((entry) =>
            entry.includes("/")
                ? IpFilterMiddleware.ipInCidr(clientIp, entry)
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
    }

    static ipInCidr(ip, cidr) {
        const [range, bits] = cidr.split("/");
        const mask = bits
            ? ~((1 << (32 - parseInt(bits, 10))) - 1)
            : 0xffffffff;
        const ipNum = IpFilterMiddleware.ipToNum(ip);
        const rangeNum = IpFilterMiddleware.ipToNum(range);
        return (ipNum & mask) === (rangeNum & mask);
    }

    static ipToNum(ip) {
        return (
            ip
                .split(".")
                .reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>>
            0
        );
    }

    static extractClientIp(req) {
        let ip = req.ip || req.socket?.remoteAddress || "unknown";
        if (ip.startsWith("::ffff:")) ip = ip.slice(7);
        return ip;
    }
}

const defaultIpFilter = new IpFilterMiddleware();
module.exports = { IpFilterMiddleware, defaultIpFilter };
