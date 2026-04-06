"use strict";

/**
 * @fileoverview HTTP security headers middleware.
 * Wraps helmet in a class for consistent architecture.
 */

const helmet = require("helmet");

class HelmetMiddleware {
    constructor(options = {}) {
        this._helmet = helmet({
            contentSecurityPolicy: options.contentSecurityPolicy ?? {
                directives: {
                    defaultSrc: ["'self'"],
                    scriptSrc: ["'self'"],
                    styleSrc: ["'self'", "'unsafe-inline'"],
                    imgSrc: ["'self'", "data:"],
                    connectSrc: ["'self'"],
                    fontSrc: ["'self'"],
                    objectSrc: ["'none'"],
                    frameSrc: ["'none'"],
                },
            },
            crossOriginEmbedderPolicy:
                options.crossOriginEmbedderPolicy ?? true,
            crossOriginOpenerPolicy: options.crossOriginOpenerPolicy ?? true,
            crossOriginResourcePolicy: options.crossOriginResourcePolicy ?? {
                policy: "same-origin",
            },
            dnsPrefetchControl: options.dnsPrefetchControl ?? { allow: false },
            frameguard: options.frameguard ?? { action: "deny" },
            hidePoweredBy: options.hidePoweredBy ?? true,
            hsts: options.hsts ?? {
                maxAge: 31536000,
                includeSubDomains: true,
                preload: true,
            },
            ieNoOpen: options.ieNoOpen ?? true,
            noSniff: options.noSniff ?? true,
            referrerPolicy: options.referrerPolicy ?? {
                policy: "strict-origin-when-cross-origin",
            },
            xssFilter: options.xssFilter ?? true,
        });

        this.handle = this.handle.bind(this);
    }

    handle(req, res, next) {
        return this._helmet(req, res, next);
    }
}

const defaultHelmet = new HelmetMiddleware();
module.exports = { HelmetMiddleware, defaultHelmet };
