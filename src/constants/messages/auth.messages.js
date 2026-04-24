"use strict";

/**
 * @fileoverview Authentication / authorization log messages.
 * Used ONLY in logger calls — never thrown or sent to clients.
 */

const authMessages = {
    JWT_VERIFY_FAILED: (err) => `JWT verification failed: ${err}`,
    JWT_EXPIRED: "JWT token has expired.",
    JWT_MALFORMED: "JWT token is malformed.",
    PERMISSION_DENIED: (userId, resource) =>
        `Permission denied for user ${userId} on resource ${resource}.`,
    AUTH_SUCCESS: (userId) => `User ${userId} authenticated successfully.`,
    AUTH_LOGOUT: (userId) => `User ${userId} logged out.`,
    TOKEN_REFRESHED: (userId) => `Token refreshed for user ${userId}.`,
    SYS_SIGNATURE_TAMPERED_BLOCKED: (empId) =>
        `SYSSIGNATURE mismatch for EMP_ID ${empId} — record may have been tampered with. Login blocked.`,
    SYS_SIGNATURE_TAMPERED_ROLE_FALLBACK: (empId) =>
        `SYSSIGNATURE mismatch for EMP_ID ${empId} — record may have been tampered with. Defaulting to User role.`,
    AUTH_FALLBACK_MEAL: (userId) =>
        `User ${userId} not found in userAccount DB — falling back to T_EMP_MGMT_ADMIN authentication.`,
    AUTH_UA_PRIMARY: (userId) =>
        `Authenticating user ${userId} via userAccount (U_USERS).`,
    LOGIN_ATTEMPT_FAILED: (userId, failCount, currentMax) =>
        `Failed login attempt for ${userId} (${failCount}/${currentMax}).`,
    LOGIN_LOCKOUT_ENGAGED: (userId, durationMs, cycles) =>
        `User ${userId} locked out for ${durationMs}ms (cycle ${cycles}).`,
    LOGIN_LOCKOUT_CLEARED: (userId) =>
        `Lockout cleared for user ${userId} after successful login.`,
    LOGIN_LOCKOUT_PERMANENT: (userId) =>
        `User ${userId} permanently locked after exhausting all retry cycles. HR reset required.`,
};

module.exports = { authMessages };
