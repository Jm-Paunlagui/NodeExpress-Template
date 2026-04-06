"use strict";

/**
 * @fileoverview Request traceability middleware.
 * Injects unique X-Request-ID per request, logs incoming and completed
 * requests with structured messages.
 */

const { logger } = require("../../utils/logger");
const { nanoid } = require("../../utils/nanoidLoader");

class TraceabilityMiddleware {
    constructor(options = {}) {
        this._excludedUrls = options.excludedUrls ?? [
            ...(process.env.LOG_EXCLUDE_HEALTH === "true" ? ["/health"] : []),
            ...(process.env.LOG_EXCLUDE_URLS
                ? process.env.LOG_EXCLUDE_URLS.split(",")
                : []),
        ];

        this.handle = this.handle.bind(this);
    }

    handle(req, res, next) {
        // Inject unique request ID
        req.id = `req_${nanoid(10)}`;
        res.setHeader("X-Request-ID", req.id);

        const startTime = Date.now();
        const url = req.originalUrl || req.url;
        const isOptions = req.method === "OPTIONS";
        const shouldLog = !this._excludedUrls.some((u) =>
            url.includes(u.trim()),
        );

        if (shouldLog && !isOptions) {
            logger.logIncomingRequest(
                req,
                TraceabilityMiddleware.createRequestMessage(req),
            );
        }

        const originalEnd = res.end;
        res.end = function (...args) {
            const duration = Date.now() - startTime;
            if (shouldLog && !isOptions) {
                logger.logCompletedRequest(
                    req,
                    res,
                    duration,
                    TraceabilityMiddleware.createRequestMessage(req),
                );
            }
            originalEnd.apply(this, args);
        };

        next();
    }

    static createRequestMessage(req) {
        const url = req.originalUrl || req.url;
        let message = `[${req.method} @ ${url}]`;

        if (Object.keys(req.query).length > 0) {
            const params = Object.entries(req.query)
                .map(([k, v]) => `${k}=${v}`)
                .join("&");
            message += ` [PARAMS @ ${params}]`;
        }

        if (["POST", "PUT", "PATCH"].includes(req.method)) {
            let bodyContent = "";
            if (!req.body) {
                bodyContent = "req.body is undefined";
            } else if (typeof req.body !== "object") {
                bodyContent = `req.body is ${typeof req.body}: ${req.body}`;
            } else if (Object.keys(req.body).length === 0) {
                bodyContent = "req.body is empty object";
            } else {
                bodyContent = Object.entries(req.body)
                    .map(([key, value]) => {
                        if (value === null) return `${key}=null`;
                        if (value === undefined) return `${key}=undefined`;
                        if (typeof value === "object") {
                            try {
                                const json = JSON.stringify(value);
                                return `${key}=${json.length > 500 ? json.substring(0, 497) + "..." : json}`;
                            } catch {
                                return `${key}=[Complex Object]`;
                            }
                        }
                        return `${key}=${value}`;
                    })
                    .join(", ");
            }
            message += ` [BODY @ ${bodyContent}]`;
        }

        return message;
    }
}

const defaultTraceability = new TraceabilityMiddleware();
module.exports = { TraceabilityMiddleware, defaultTraceability };
