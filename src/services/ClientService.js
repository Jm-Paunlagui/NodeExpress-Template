"use strict";

/**
 * @fileoverview Service for the /api/v1/client resource.
 *
 * Currently exposes a single capability: receive a structured error report
 * from the frontend ErrorBoundary (via `clientLogger`) and surface it in the
 * server log stream so render-time crashes are visible to operators alongside
 * server-side events.
 *
 * Notes:
 *   - This service never throws — the controller already wraps it in catchAsync,
 *     and an exception here would mask the original client-side error.
 *   - The payload is structured (message, stack, componentStack, url, userAgent,
 *     timestamp). The full object is passed as logger meta so the log pipeline
 *     can index every field.
 */

const { logger } = require("../utils/logger");
const { clientMessages } = require("../constants/messages");

class ClientService {
    /**
     * Logs a client-side ErrorBoundary report to the central log stream.
     *
     * @param {object} payload
     * @param {string} payload.message        - Error message text.
     * @param {string} [payload.stack]        - JS stack trace (when available).
     * @param {string} [payload.componentStack] - React component stack.
     * @param {string} [payload.url]          - URL where the error occurred.
     * @param {string} [payload.userAgent]    - Reporter's user agent string.
     * @param {string} [payload.timestamp]    - ISO-8601 timestamp from the client.
     * @param {object} [user]                 - Authenticated user (req.user); may be undefined.
     * @returns {Promise<void>}
     */
    static async logError(payload, user) {
        const { message, stack, componentStack, url, userAgent, timestamp } =
            payload ?? {};

        logger.error(
            clientMessages.CLIENT_ERROR(user?.userId ?? "unknown"),
            {
                message,
                stack,
                componentStack,
                url,
                userAgent,
                timestamp,
            },
        );
    }
}

module.exports = ClientService;
