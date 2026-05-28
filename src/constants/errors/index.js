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

// ─── Pay Period error messages ────────────────────────────────────────────────

const PAY_PERIOD_ERRORS = {
    NOT_FOUND:
        "Pay period record not found. Verify the CUTOFF_ID and try again.",
    INVALID_FILE:
        "Invalid or missing file. Only .xlsx files with the required headers are accepted.",
    VERIFY_EMPTY_FILE:
        "The uploaded file contains no data rows to verify.",
    SAVE_NO_ROWS:
        "No actionable rows to save. Only Create or Update rows (non-excluded) can be saved.",
    INVALID_YEAR:
        "Invalid year parameter. Provide a valid four-digit calendar year.",
};

// ─── RFID Management error messages ──────────────────────────────────────────

const RFID_ERRORS = {
    INVALID_HEADERS:
        "Excel file has invalid or missing headers. Required headers: EMP_ID, EMP_NAME, ENTITY, GID, CARD_NUMBER.",
    EMPTY_FILE: "The uploaded Excel file contains no data rows.",
    DUPLICATE_ROWS_IN_UPLOAD:
        "The uploaded file contains duplicate GID + CARD_NUMBER combinations. Download the attached report, fix the duplicates, and re-upload.",
    NO_FILE_PROVIDED: "No file was uploaded. Please attach an .xlsx file.",
    INVALID_FILE_TYPE: "Only .xlsx files are accepted.",
    FILE_TOO_LARGE: "File exceeds the 5 MB size limit.",
    EMPLOYEE_NOT_FOUND:
        "Employee record not found. The GID and CARD_NUMBER combination does not exist.",
    INVALID_KEY_PARAMS:
        "Invalid parameters. GID and CARD_NUMBER must be valid numbers.",
    ALREADY_ARCHIVED:
        "This employee record is already archived. It cannot be archived again.",
    NOT_ARCHIVED:
        "This employee record is not archived. Only archived records can be restored.",
    DELETE_CONFIRMATION_REQUIRED:
        "Delete confirmation is required. Provide the employee ID and full name to confirm this irreversible action.",
    DELETE_CONFIRMATION_MISMATCH:
        "Confirmation values do not match the employee record. Please re-enter the employee ID and full name exactly as shown.",
    DELETE_AUDIT_FAILED:
        "Failed to write the audit log entry. The delete operation has been aborted to preserve the audit trail.",
};

// ─── Consumption error messages ──────────────────────────────────────────────

const CONSUMPTION_ERRORS = {
    CUTOFF_NOT_ACTIVE:
        "No active cutoff period found. The current date does not fall within any defined consumption window.",
    CONSUMPTION_NOT_FOUND:
        "No consumption data found for the current period.",
    INVALID_CUTOFF_ID:
        "Invalid cutoff ID. Provide a valid numeric cutoff period identifier.",
    INVALID_EXPORT_YEAR:
        "Invalid year parameter. Provide a four-digit calendar year between 2000 and 2100.",
    INVALID_EXPORT_STATUS:
        "Invalid status parameter. Accepted values are: all, active, expired.",
};

// ─── Settlement error messages ───────────────────────────────────────────────

const SETTLEMENT_ERRORS = {
    REASON_REQUIRED:
        "A reason is required for re-settlement. Provide a non-empty reason string.",
    COOLDOWN_ACTIVE:
        "Re-settlement cooldown is active. Wait before triggering another re-settlement for this period.",
    IN_PROGRESS:
        "A settlement is already in progress for this period. Wait for it to complete before triggering another.",
    MAX_VERSIONS_REACHED:
        "Maximum re-settlement attempts reached for this period. Contact system administration.",
    WINDOW_STILL_OPEN:
        "The consumption window for this period is still open. Settlement export is not available until the window closes.",
    NOT_SETTLED:
        "Settlement has not been completed for this period. Payroll export is blocked until settlement is finished.",
    CUTOFF_NOT_FOUND:
        "Cutoff period not found. Verify the period ID and try again.",
    NO_SETTLEMENTS_FOUND:
        "No settlement records found for this period. Run settlement first.",
};

// ─── Billing error messages ──────────────────────────────────────────────────

const BILLING_ERRORS = {
    CUTOFF_NOT_FOUND:       "Cutoff period not found.",
    DOWNLOAD_LIMIT_REACHED: "Download limit reached. Submit a re-download request.",
    REQUEST_NOT_FOUND:      "Download request not found.",
    REQUEST_NOT_PENDING:    "This request is no longer pending and cannot be processed.",
    REQUEST_ALREADY_PENDING: "A re-download request for this consumption period is already pending. Wait for the current request to be approved or rejected before submitting a new one.",
    INVALID_ADMIN_PASSWORD: "Incorrect password.",
    HMAC_SECRET_MISSING:    "BILLING_HMAC_SECRET env var is required.",
    SHEET_PASSWORD_MISSING: "BILLING_SHEET_PASSWORD env var is required.",
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
};

// ─── Subsidy Management error messages ───────────────────────────────────────

const SUBSIDY_ERRORS = {
    INVALID_HEADERS:
        "Excel file has invalid or missing headers. Required headers: GID, Name, PayGroup, JobClass, TotalMealSubsidy, Prev_Balance, Earned_Date, Remarks.",
    EMPTY_FILE: "The uploaded Excel file contains no data rows.",
    NO_ROWS_TO_SAVE:
        "No valid rows to save. All rows are either duplicates, blocked, or excluded.",
    NO_FILE_PROVIDED: "No file was uploaded. Please attach an .xlsx file.",
    INVALID_FILE_TYPE: "Only .xlsx files are accepted.",
    FILE_TOO_LARGE: "File exceeds the 5 MB size limit.",
    CUTOFF_NOT_FOUND:
        "Earned date does not fall within any pay period cutoff range.",
    RECORD_NOT_FOUND:
        "Subsidy record not found.",
    INVALID_YEAR:
        "Invalid year parameter. Provide a valid four-digit calendar year.",
    INVALID_MONTH:
        "Invalid month parameter. Provide a month number between 1 and 12.",
    MISSING_YEAR_MONTH:
        "Both year and month query parameters are required to fetch subsidy records.",
    DELETE_NOT_SUPPORTED:
        "T_SUBSIDY_UPLOAD records are immutable and cannot be deleted.",
    INVALID_ID:
        "Invalid ID format. Provide a positive numeric identifier.",
};

module.exports = {
    AppError,
    AUTH_ERRORS,
    VALIDATION_ERRORS,
    GENERAL_ERRORS,
    ADMIN_ERRORS,
    RFID_ERRORS,
    PAY_PERIOD_ERRORS,
    BILLING_ERRORS,
    SUBSIDY_ERRORS,
    CONSUMPTION_ERRORS,
    SETTLEMENT_ERRORS,
    AUDIT_LOG_ERRORS,
    METRICS_ERRORS,
};
