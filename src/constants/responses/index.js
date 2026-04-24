"use strict";

/**
 * @fileoverview API response helpers and success message strings.
 *
 * Rule:
 *   sendSuccess / sendError → used in res.json(sendSuccess(...))
 *   RESPONSE_MESSAGES       → string constants used as message arguments
 *   Log messages            → belong in constants/messages/ instead
 *   Thrown error strings    → belong in constants/errors/ instead
 */

// ─── Response helpers ─────────────────────────────────────────────────────────

/**
 * Build a standard success response body.
 * @param {string} message
 * @param {*} [data]
 * @returns {{ status: string, code: number, message: string, data: * }}
 */
function sendSuccess(message, data = null) {
    return {
        status: "success",
        code: 200,
        message,
        data,
    };
}

/**
 * Build a standard error response body.
 * The global ErrorHandlerMiddleware builds its own response inline,
 * but this helper is available for controllers that need to return
 * a non-throwing error shape.
 *
 * @param {string} message
 * @param {number} [code=500]
 * @param {{ type?: string, details?: Array, hint?: string, stack?: string }} [opts]
 */
function sendError(message, code = 500, opts = {}) {
    return {
        status: "error",
        code,
        message,
        error: {
            type: opts.type ?? "AppError",
            ...(opts.details ? { details: opts.details } : {}),
            ...(opts.hint ? { hint: opts.hint } : {}),
            ...(opts.stack && process.env.NODE_ENV !== "production"
                ? { stack: opts.stack }
                : {}),
        },
    };
}

// ─── Response message strings ─────────────────────────────────────────────────

const RESPONSE_MESSAGES = {
    // Auth
    LOGIN_SUCCESS: "Login successful.",
    LOGOUT_SUCCESS: "Logged out successfully.",
    TOKEN_REFRESHED: "Token refreshed successfully.",

    // Generic CRUD
    FETCHED: "Data fetched successfully.",
    CREATED: "Resource created successfully.",
    UPDATED: "Resource updated successfully.",
    DELETED: "Resource deleted successfully.",
};

module.exports = { sendSuccess, sendError, RESPONSE_MESSAGES };
