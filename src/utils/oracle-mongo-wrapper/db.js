"use strict";

/**
 * @fileoverview Thin adapter factory — binds a named connection to the wrapper API.
 * Delegates entirely to src/config. Does NOT manage pools.
 */

const config = require("../../config");
const { oracleMongoWrapperMessages: MSG } = require("../../constants/messages");

/**
 * Creates a db interface bound to a named connection from database.js.
 * Pass this instance to OracleCollection, OracleSchema, OracleDCL, etc.
 *
 * @param {string} connectionName - Key from src/config/database.js registry
 * @returns {DbInterface}
 */
function createDb(connectionName = "userAccount") {
    if (!connectionName || typeof connectionName !== "string") {
        throw new TypeError(MSG.CREATEDB_INVALID_CONNECTION_NAME);
    }

    return {
        connectionName,

        /** @param {Function} callback - async (conn) => result */
        withConnection: (callback) =>
            config.withConnection(connectionName, callback),

        /** @param {Function} callback - async (conn) => result */
        withTransaction: (callback) =>
            config.withTransaction(connectionName, callback),

        /** @param {Function[]} operations */
        withBatchConnection: (operations) =>
            config.withBatchConnection(connectionName, operations),

        /** Graceful shutdown of ALL pools. */
        closePool: () => config.closeAll(),

        /** Pool stats snapshot. */
        getPoolStats: () => config.getPoolStats(),

        /** Health check for this connection's pool. */
        isHealthy: () => config.isPoolHealthy(connectionName),

        /** Raw oracledb driver. */
        oracledb: config.oracledb,
    };
}

module.exports = { createDb };
