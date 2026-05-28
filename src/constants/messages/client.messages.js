"use strict";

/**
 * @fileoverview Log message templates for client-side error reports.
 * Used ONLY in logger.* calls — never thrown or sent to clients.
 *
 * Rule: all logger.info/logger.warning/logger.error strings for the
 * `/client/errors` ingestion endpoint must reference a named template
 * from this file.
 */

const clientMessages = {
    /**
     * Logged when an authenticated client posts an ErrorBoundary report.
     * @param {string|number} userId - The reporting user's identifier (JWT userId).
     * @returns {string}
     */
    CLIENT_ERROR: (userId) =>
        `Client-side render error reported by user ${userId}`,
};

module.exports = { clientMessages };
