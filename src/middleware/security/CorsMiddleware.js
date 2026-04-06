"use strict";

/**
 * @fileoverview Network-aware CORS middleware.
 * Supports explicit origins via env, plus dynamic patterns for localhost,
 * private networks, VPN, and corporate domains.
 */

const cors = require("cors");
const { logger } = require("../../utils/logger");

class CorsMiddleware {
    constructor(options = {}) {
        this._explicitOrigins =
            options.origins ??
            (process.env.CORS_ORIGINS
                ? process.env.CORS_ORIGINS.split(",")
                      .map((o) => o.trim())
                      .filter(Boolean)
                : []);

        this._dynamicPatterns = options.patterns ?? [
            /^https?:\/\/localhost:\d+$/,
            /^https?:\/\/127\.0\.0\.1:\d+$/,
            /^https?:\/\/192\.168\.\d+\.\d+:\d+$/,
            /^https?:\/\/10\.\d+\.\d+\.\d+:\d+$/,
            /^https?:\/\/172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+:\d+$/,
            /^https?:\/\/.+\.local(:\d+)?$/,
            /^https?:\/\/.+\.lan(:\d+)?$/,
            /^https?:\/\/.+\.corp(\..+)?$/i,
            /^https?:\/\/.+\.vpn(\..+)?$/i,
            /^https?:\/\/.+\.internal(\..+)?$/i,
        ];

        this._cors = cors({
            origin: (origin, callback) => {
                if (!origin) return callback(null, true);
                if (this._explicitOrigins.includes(origin))
                    return callback(null, true);
                if (this._dynamicPatterns.some((p) => p.test(origin)))
                    return callback(null, true);

                logger.warn(`CORS: origin blocked — ${origin}`);
                callback(new Error(`Origin ${origin} not allowed by CORS`));
            },
            credentials: options.credentials ?? true,
            methods: options.methods ?? [
                "GET",
                "POST",
                "PUT",
                "DELETE",
                "PATCH",
                "OPTIONS",
                "HEAD",
            ],
            allowedHeaders: options.allowedHeaders ?? [
                "Content-Type",
                "Authorization",
                "X-CSRF-Token",
                "X-Request-ID",
                "X-Requested-With",
                "X-Client-Username",
                "X-Client-Id",
                "Accept",
                "Accept-Encoding",
                "Accept-Language",
                "Cache-Control",
            ],
            exposedHeaders: options.exposedHeaders ?? [
                "X-Request-ID",
                "X-Response-Time",
                "X-CSRF-Token",
                "Content-Disposition",
                "RateLimit-Limit",
                "RateLimit-Remaining",
                "RateLimit-Reset",
            ],
            maxAge: options.maxAge ?? 86400,
            optionsSuccessStatus: options.optionsSuccessStatus ?? 200,
        });

        this.handle = this.handle.bind(this);
    }

    handle(req, res, next) {
        return this._cors(req, res, next);
    }
}

const defaultCors = new CorsMiddleware();
module.exports = { CorsMiddleware, defaultCors };
