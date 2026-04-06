"use strict";

/**
 * @fileoverview Centralized Error Handling Middleware
 * @description All errors funnel through here. Formats AppError instances and
 * unexpected errors into the standard API error response shape.
 */

const { logger } = require("../../utils/logger");
const { AppError } = require("../../constants/errors");

/**
 * Capture the response body for downstream logging.
 */
function captureResponseBody(req, res, next) {
    const oldWrite = res.write;
    const oldEnd = res.end;
    const chunks = [];

    res.write = function (chunk, ...args) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        oldWrite.apply(res, [chunk, ...args]);
    };

    res.end = function (chunk, ...args) {
        if (chunk) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        res.locals.body = Buffer.concat(chunks).toString("utf8");
        oldEnd.apply(res, [chunk, ...args]);
    };

    next();
}

/**
 * Global error-handling middleware.
 * Must be registered **after** all routes.
 *
 * @param {Error} err
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} _next
 */
function errorHandler(err, req, res, _next) {
    // Default to 500 for unexpected errors
    const statusCode = err.statusCode || err.status || 500;
    const isOperational = err.isOperational || false;

    // Log the error
    if (statusCode >= 500) {
        logger.error(err.message, {
            statusCode,
            stack: err.stack,
            path: req.originalUrl,
            method: req.method,
            ip: req.ip,
            requestId: req.id,
        });
    } else {
        logger.warn(err.message, {
            statusCode,
            path: req.originalUrl,
            method: req.method,
            requestId: req.id,
        });
    }

    const response = {
        status: "error",
        code: statusCode,
        message: isOperational ? err.message : "Internal server error",
        error: {
            type: err.name || "Error",
            ...(err.details ? { details: err.details } : {}),
            ...(err.hint ? { hint: err.hint } : {}),
            ...(process.env.NODE_ENV === "development"
                ? { stack: err.stack }
                : {}),
        },
    };

    res.status(statusCode).json(response);
}

/**
 * Catch-all for 404 — unknown routes.
 */
function notFoundHandler(req, res, _next) {
    res.status(404).json({
        status: "error",
        code: 404,
        message: `Route ${req.method} ${req.originalUrl} not found`,
        error: {
            type: "NotFoundError",
            hint: "Check the URL and HTTP method.",
        },
    });
}

module.exports = {
    errorHandler,
    notFoundHandler,
    captureResponseBody,
};
