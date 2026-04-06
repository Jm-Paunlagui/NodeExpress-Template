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
};

module.exports = { authMessages };
