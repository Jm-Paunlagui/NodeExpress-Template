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
    // 2xx Success
    207: "Multi-Status",
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
 * @param {number} [code=200] - HTTP status code to include in the response body.
 *   Pass 201 for resource-creation responses (res.status(201).json(sendSuccess(..., ..., 201))).
 * @returns {{ status: string, code: number, message: string, data: * }}
 */
function sendSuccess(message, data = null, code = 200) {
    return {
        status: "success",
        code,
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
    PASSWORD_CHANGED: "Password changed successfully.",

    // Generic CRUD
    FETCHED: "Data fetched successfully.",
    CREATED: "Resource created successfully.",
    UPDATED: "Resource updated successfully.",
    DELETED: "Resource deleted successfully.",

    // Admin Management
    ADMIN_CREATED: "Admin created successfully.",
    ADMIN_UPDATED: "Admin updated successfully.",
    ADMIN_DELETED: "Admin removed successfully.",
    PASSWORD_RESET: "Password reset to default successfully.",
    SIGNATURE_RESET: "Record signature recomputed successfully.",

    // Pay Period Management
    PAY_PERIOD_UPLOADED: "Pay period Excel processed successfully.",
    PAY_PERIOD_FETCHED: "Pay period records fetched successfully.",
    PAY_PERIOD_UPDATED: "Pay period record updated successfully.",
    PAY_PERIOD_VERIFIED: "Pay period data verified successfully.",
    PAY_PERIOD_SAVED: "Pay period records saved successfully.",
    PAY_PERIOD_YEARS_FETCHED: "Pay period years fetched successfully.",

    // RFID Management
    RFID_UPLOAD_SUCCESS: "RFID Excel processed successfully.",
    RFID_SAVE_PARTIAL:
        "RFID records partially saved. Some rows failed due to duplicate or database errors — see the failed rows list for details.",
    RFID_SAVE_ALL_FAILED:
        "All RFID rows failed to save. See the failed rows list for details.",
    RFID_LIST_FETCHED: "Employee RFID records fetched successfully.",
    RFID_ARCHIVE_SUCCESS:
        "Employee RFID record archived successfully. The record has been soft-archived and remains in the system for reference.",
    RFID_HISTORY_FETCHED: "Employee archive history fetched successfully.",
    RFID_VERIFY_SUCCESS: "RFID data verified successfully.",
    RFID_EXPORT_SUCCESS: "Employee RFID export data fetched successfully.",
    RFID_ARCHIVED_LIST_FETCHED: "Archived RFID employee records fetched successfully.",
    RFID_RESTORE_SUCCESS:
        "Employee RFID record restored successfully. The record is now active in the masterfile.",
    RFID_DELETE_SUCCESS:
        "Employee record and all related Meal-DB data have been permanently deleted. This action cannot be undone.",

    // Consumption
    CONSUMPTION_SUMMARY_FETCHED: "Consumption summary fetched successfully.",
    CONSUMPTION_HISTORY_FETCHED: "Consumption history fetched successfully.",
    CONSUMPTION_LEDGER_FETCHED: "Consumption ledger fetched successfully.",
    CONSUMPTION_STUBS_FETCHED: "Consumption stubs fetched successfully.",
    CONSUMPTION_STUB_LOGS_FETCHED: "Consumption QR stub logs fetched successfully.",
    CONSUMPTION_EXPORT_QR_FETCHED: "QR stub export data fetched successfully.",
    CONSUMPTION_EXPORT_TAP_FETCHED: "Tap transaction export data fetched successfully.",
    CONSUMPTION_EXPORT_YEARS_FETCHED: "Export year options fetched successfully.",

    // Billing
    BILLING_ADMIN_LIST_FETCHED:   "Admin list fetched successfully.",
    BILLING_CUTOFF_DATES_FETCHED: "Cutoff dates fetched successfully.",
    BILLING_ENTITIES_FETCHED:     "Entities fetched successfully.",
    BILLING_REPORT_FETCHED:       "Billing report fetched successfully.",
    BILLING_EXPORT_SUCCESS:       "Billing export generated successfully.",
    BILLING_REQUEST_SUBMITTED:    "Re-download request submitted successfully.",
    BILLING_REQUESTS_FETCHED:     "Download requests fetched successfully.",
    BILLING_REQUEST_APPROVED:     "Re-download request approved. Download limit increased by 1.",
    BILLING_REQUEST_REJECTED:     "Re-download request rejected.",

    // Subsidy Management
    SUBSIDY_VERIFY_SUCCESS: "Subsidy rows classified successfully.",
    SUBSIDY_SAVE_SUCCESS: "Subsidy records saved successfully.",
    SUBSIDY_LIST_SUCCESS: "Subsidies fetched successfully.",
    SUBSIDY_YEARS_FETCHED: "Subsidy years fetched successfully.",
    SUBSIDY_MONTHS_FETCHED: "Subsidy months fetched successfully.",
    SUBSIDY_DELETE_SUCCESS: "Subsidy record deleted successfully.",
    SUBSIDY_UPDATE_SUCCESS: "Subsidy record updated successfully.",

    // Settlement
    SETTLEMENT_QUEUED:        "Re-settlement queued. Processing in background.",
    SETTLEMENT_STATUS_FETCHED: "Settlement status fetched successfully.",
    PAYROLL_EXPORT_FETCHED:   "Payroll deduction export fetched successfully.",

    // Audit Log
    AUDIT_LOG_LIST_FETCHED:   "Audit log records fetched successfully.",
    AUDIT_LOG_STATS_FETCHED:  "Audit log statistics fetched successfully.",
    AUDIT_LOG_DELETED:        "Audit log records and server log files permanently deleted.",
    AUDIT_LOG_TRACE_FETCHED:  "Request log trace fetched.",

    // Metrics
    METRICS_FETCHED:           "Metrics snapshot retrieved successfully.",
    METRICS_SUMMARY_FETCHED:   "Metrics summary retrieved successfully.",
    METRICS_ALERTS_FETCHED:    "Alert evaluations retrieved successfully.",
    METRICS_FRONTEND_INGESTED: "Frontend metrics received.",

    // Client-side error ingestion (ErrorBoundary → POST /client/errors)
    CLIENT_ERROR_LOGGED: "Error logged successfully.",
};

module.exports = {
    sendSuccess,
    sendError,
    RESPONSE_MESSAGES,
    HTTP_STATUS_TITLES,
    getStatusTitle,
};
