"use strict";

const { logger } = require("../../utils/logger");
const { nanoid } = require("../../utils/nanoidLoader");

/**
 * Middleware that adds a unique request ID to each incoming request
 * and logs request / response details for traceability.
 */

/**
 * Inject a unique X-Request-ID into every request.
 */
function addRequestId(req, res, next) {
    req.id = `req_${nanoid(10)}`;
    res.setHeader("X-Request-ID", req.id);
    next();
}

/**
 * Build a structured log message from the request.
 */
function createRequestMessage(req) {
    const url = req.originalUrl || req.url;
    let message = `[${req.method} @ ${url}]`;

    // Query params (only include if present)
    if (Object.keys(req.query).length > 0) {
        const params = Object.entries(req.query)
            .map(([k, v]) => `${k}=${v}`)
            .join("&");
        message += ` [PARAMS @ ${params}]`;
    }

    // Body (only include for POST/PUT/PATCH and when there's content)
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

/**
 * Comprehensive request / response logger middleware.
 * Logs incoming requests and completed responses with timing.
 */
function requestLogger(req, res, next) {
    const startTime = Date.now();
    const url = req.originalUrl || req.url;

    const excludedUrls = [
        ...(process.env.LOG_EXCLUDE_HEALTH === "true" ? ["/health"] : []),
        ...(process.env.LOG_EXCLUDE_URLS
            ? process.env.LOG_EXCLUDE_URLS.split(",")
            : []),
    ];

    const shouldLog = !excludedUrls.some((u) => url.includes(u.trim()));
    const isOptions = req.method === "OPTIONS";

    if (shouldLog && !isOptions) {
        logger.logIncomingRequest(req, createRequestMessage(req));
    }

    const originalEnd = res.end;
    res.end = function (...args) {
        const duration = Date.now() - startTime;
        if (shouldLog && !isOptions) {
            logger.logCompletedRequest(
                req,
                res,
                duration,
                createRequestMessage(req),
            );
        }
        originalEnd.apply(this, args);
    };

    next();
}

module.exports = {
    addRequestId,
    requestLogger,
    createRequestMessage,
};
