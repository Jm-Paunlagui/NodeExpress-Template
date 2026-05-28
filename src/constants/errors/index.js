"use strict";

/**
 * @fileoverview App-wide error messages, codes, types, and AppError class.
 */

// ─── AppError ─────────────────────────────────────────────────────────────────

/**
 * Operational error — throw from services/controllers.
 * The global errorHandler middleware formats these for the client.
 */
class AppError extends Error {
    /**
     * @param {string} message  - Human-readable message
     * @param {number} statusCode - HTTP status code (default 500)
     * @param {object} [opts]
     * @param {string} [opts.type]    - Error type label (e.g. 'ValidationError')
     * @param {Array}  [opts.details] - Field-level error details
     * @param {string} [opts.hint]    - Helpful hint for the consumer
     */
    constructor(message, statusCode = 500, opts = {}) {
        super(message);
        this.name = opts.type || "AppError";
        this.statusCode = statusCode;
        this.isOperational = true;
        this.details = opts.details || undefined;
        this.hint = opts.hint || undefined;
        Error.captureStackTrace(this, this.constructor);
    }
}

// ─── Auth error messages ──────────────────────────────────────────────────────

const AUTH_ERRORS = {
    USER_NOT_FOUND: "Authentication required. Please log in.",
    FORBIDDEN_ACCESS: "You do not have permission to access this resource.",
    TOKEN_EXPIRED: "Token has expired. Please log in again.",
    TOKEN_INVALID: "Invalid token. Please log in again.",
    MISSING_CREDENTIALS: "Username and password are required.",
    INVALID_CREDENTIALS: "Invalid username or password.",
    ACCOUNT_INTEGRITY_FAILED:
        "Account integrity check failed. Please contact support.",
    ACCOUNT_LOCKED:
        "Too many failed sign-in attempts. Please wait before trying again.",
    ACCOUNT_LOCKED_PERMANENTLY:
        "Account locked due to too many failed attempts. Please contact HR to reset your password.",
};

// ─── Validation error messages ────────────────────────────────────────────────

const VALIDATION_ERRORS = {
    MISSING_FIELDS: "Missing required fields.",
    INVALID_INPUT: "Invalid input data.",
    INVALID_ID: "Invalid ID format.",
};

// ─── General error messages ───────────────────────────────────────────────────

const GENERAL_ERRORS = {
    INTERNAL_SERVER_ERROR:
        "An unexpected error occurred. Please try again later.",
    NOT_FOUND: "The requested resource was not found.",
    CONFLICT: "A resource with the same identifier already exists.",
    SERVICE_UNAVAILABLE: "Service temporarily unavailable.",
};

// ─── Admin Management error messages ─────────────────────────────────────────

const ADMIN_ERRORS = {
    ADMIN_NOT_FOUND:
        "Admin record not found. Verify the Employee ID and try again.",
    ADMIN_ALREADY_EXISTS: "This employee is already registered as an admin.",
    DEFAULT_PASSWORD_FORBIDDEN:
        "The new password cannot be the same as the system default password. Choose a unique password.",
    SIGNATURE_RESET_REQUIRED:
        "Admin record integrity check failed. A signature reset is required before this record can be modified.",
};

// ─── Metrics error messages ───────────────────────────────────────────────────

const METRICS_ERRORS = {
    METRICS_UNAVAILABLE: "Metrics data is temporarily unavailable.",
    INVALID_PAYLOAD: "Invalid metrics payload. Expected a non-empty array of events.",
    PAYLOAD_TOO_LARGE: "Metrics payload exceeds the maximum of 50 events per request.",
};

// ─── Audit Log error messages ─────────────────────────────────────────────────

const AUDIT_LOG_ERRORS = {
    INVALID_DATE_RANGE:
        "Invalid date range. fromDate must be before toDate and both must be valid ISO dates.",
    AUDIT_LOG_TRACE_NOT_FOUND:
        "No audit log record found for the requested ID.",
    AUDIT_LOG_INVALID_REQUEST_ID:
        "Invalid request ID format.",
    AUDIT_LOG_INVALID_DATE_FORMAT:
        "Invalid date — expected YYYY-MM-DD.",
};

// ─── Changelog error messages ─────────────────────────────────────────────────

const CHANGELOG_ERRORS = {
    ENTRY_NOT_FOUND:   "Changelog entry not found.",
    STORE_UNAVAILABLE: "Changelog data store is temporarily unavailable.",
    INVALID_ENTRY:     "Invalid changelog entry data.",
};

module.exports = {
    AppError,
    AUTH_ERRORS,
    VALIDATION_ERRORS,
    GENERAL_ERRORS,
    ADMIN_ERRORS,
    AUDIT_LOG_ERRORS,
    METRICS_ERRORS,
    CHANGELOG_ERRORS,
};
