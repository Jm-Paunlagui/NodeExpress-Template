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

// ─── HTTP status title map ─────────────────────────────────────────────────────

/**
 * Human-readable title for each HTTP status code, aligned with RFC 9110.
 * Used to populate the `title` field of every error response so clients
 * always receive a machine-stable label alongside the free-text message.
 */
const HTTP_STATUS_TITLES = {
    // 4xx Client Errors
    400: "Bad Request",
    401: "Unauthorized Access",
    403: "Forbidden Access",
    404: "Not Found",
    405: "Method Not Allowed",
    409: "Conflict Detected",
    410: "Gone Permanently",
    413: "Payload Too Large",
    422: "Unprocessable Entity",
    423: "Locked Resource",
    429: "Too Many Requests",
    440: "Session Timeout",
    498: "Invalid Token",
    // 5xx Server Errors
    500: "Internal Server Error",
    502: "Bad Gateway",
    503: "Service Unavailable",
    523: "Origin Unreachable",
};

/**
 * Returns the standard title for an HTTP status code.
 * Falls back to a broad category label for unmapped codes.
 *
 * @param {number} code
 * @returns {string}
 */
function getStatusTitle(code) {
    if (HTTP_STATUS_TITLES[code]) return HTTP_STATUS_TITLES[code];
    if (code >= 500) return "Server Error";
    if (code >= 400) return "Client Error";
    if (code >= 300) return "Redirect";
    return "Error";
}

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
 * `title` is auto-derived from `code` via `getStatusTitle()` — callers
 * do not need to supply it.
 *
 * @param {string} message
 * @param {number} [code=500]
 * @param {{ type?: string, details?: Array, hint?: string, stack?: string }} [opts]
 */
function sendError(message, code = 500, opts = {}) {
    return {
        status: "error",
        code,
        title: getStatusTitle(code),
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

module.exports = { sendSuccess, sendError, RESPONSE_MESSAGES, HTTP_STATUS_TITLES, getStatusTitle };
