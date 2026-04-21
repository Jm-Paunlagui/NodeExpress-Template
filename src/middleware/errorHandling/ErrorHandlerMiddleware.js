"use strict";

/**
 * @fileoverview Centralized error handling middleware.
 *
 * All errors funnel through here. The classifier identifies error types
 * (AppError, Oracle ORA-XXXXX, JWT, parse, payload) and returns an accurate,
 * sanitised response in all environments — never leaking SQL, bind variables,
 * or stack traces to clients in production.
 */

const { logger } = require("../../utils/logger");
const ORA_MAP = require("./OraCode");

class ErrorHandlerMiddleware {
    constructor() {
        this.handle = this.handle.bind(this);
        this.notFoundHandler = this.notFoundHandler.bind(this);
        this.captureResponseBody = this.captureResponseBody.bind(this);
    }

    // ─── Main handler ──────────────────────────────────────────────────────────

    handle(err, req, res, _next) {
        const classified = this._classify(err);
        const { statusCode, message, type, details, hint, rawMessage } = classified;

        if (statusCode >= 500) {
            logger.error(rawMessage ?? err.message, {
                statusCode,
                stack: err.stack,
                path: req.originalUrl,
                method: req.method,
                ip: req.ip,
                requestId: req.id,
            });
        } else {
            logger.warn(rawMessage ?? err.message, {
                statusCode,
                path: req.originalUrl,
                method: req.method,
                requestId: req.id,
            });
        }

        const isDev = process.env.NODE_ENV === "development";
        const response = {
            status: "error",
            code: statusCode,
            message,
            error: {
                type,
                ...(details ? { details } : {}),
                ...(hint   ? { hint }    : {}),
                ...(isDev  ? { stack: err.stack } : {}),
            },
        };

        res.status(statusCode).json(response);
    }

    // ─── Error classifier ──────────────────────────────────────────────────────

    /**
     * Classifies any error into a normalised shape:
     *   { statusCode, message, type, details?, hint?, rawMessage? }
     *
     * Priority order:
     *   1. AppError (already operational + classified)
     *   2. Oracle DB errors (ORA-XXXXX anywhere in message)
     *   3. JWT errors
     *   4. HTTP-level framework errors (body-parser, multer)
     *   5. Fallback generic 500
     */
    _classify(err) {
        // 1. AppError — already operational and classified
        if (err.isOperational) {
            return {
                statusCode: err.statusCode || err.status || 500,
                message:    err.message,
                type:       err.name || "AppError",
                details:    err.details,
                hint:       err.hint,
            };
        }

        // 2. Oracle DB errors
        if (err.message && /ORA-\d+/.test(err.message)) {
            return this._classifyOracle(err);
        }

        // 3. JWT errors
        if (err.name === "JsonWebTokenError") {
            return { statusCode: 401, message: "Invalid or malformed token.", type: "AuthenticationError" };
        }
        if (err.name === "TokenExpiredError") {
            return { statusCode: 401, message: "Token has expired. Please sign in again.", type: "AuthenticationError" };
        }
        if (err.name === "NotBeforeError") {
            return { statusCode: 401, message: "Token is not yet valid.", type: "AuthenticationError" };
        }

        // 4. Body-parser / framework errors
        if (err.type === "entity.parse.failed") {
            return { statusCode: 400, message: "Malformed JSON in request body.", type: "ParseError" };
        }
        if (err.type === "entity.too.large") {
            return { statusCode: 413, message: "Request body exceeds the size limit.", type: "PayloadTooLargeError" };
        }
        if (err.status === 400 && err.message?.toLowerCase().includes("invalid")) {
            return { statusCode: 400, message: err.message, type: "BadRequestError" };
        }

        // 5. Fallback — preserve any explicit status code from the error
        return {
            statusCode:  err.statusCode || err.status || 500,
            message:     "Internal server error",
            type:        err.name || "Error",
            rawMessage:  err.message,
        };
    }

    /**
     * Extracts the ORA code from the error message and returns a clean, safe
     * client message. The raw DB message (with SQL / binds) is stored in
     * rawMessage for the logger — it is never sent to the client.
     */
    _classifyOracle(err) {
        const match = err.message.match(/ORA-(\d+)/);
        const code  = match ? parseInt(match[1], 10) : 0;
        const known = ORA_MAP[code];

        return {
            statusCode:  known?.status ?? 500,
            message:     known?.msg    ?? "A database error occurred.",
            type:        "DatabaseError",
            hint:        `ORA-${String(code).padStart(5, "0")}`,
            rawMessage:  err.message,
        };
    }

    // ─── 404 handler ──────────────────────────────────────────────────────────

    notFoundHandler(req, res, _next) {
        res.status(404).json({
            status: "error",
            code:    404,
            message: `Route ${req.method} ${req.originalUrl} not found`,
            error: {
                type: "NotFoundError",
                hint: "Check the URL and HTTP method.",
            },
        });
    }

    // ─── Response body capture ────────────────────────────────────────────────

    captureResponseBody(req, res, next) {
        const oldWrite = res.write;
        const oldEnd   = res.end;
        const chunks   = [];

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
}

const defaultErrorHandler = new ErrorHandlerMiddleware();
module.exports = { ErrorHandlerMiddleware, defaultErrorHandler };
