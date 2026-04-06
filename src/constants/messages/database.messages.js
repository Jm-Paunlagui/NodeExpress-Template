"use strict";

/**
 * @fileoverview General database operation log messages.
 * Used ONLY in logger calls — never thrown or sent to clients.
 */

const databaseMessages = {
    DB_OP_FAILED: (operation, table, err) =>
        `Database operation failed: ${operation} on ${table} — ${err}`,
    CONNECTION_TIMEOUT: (name, ms) =>
        `Connection timeout on "${name}" after ${ms}ms.`,
    CONNECTION_ACQUIRED: (name, ms) =>
        `Connection acquired on "${name}" in ${ms}ms.`,
    TRANSACTION_STARTED: (name) => `Transaction started on "${name}".`,
    TRANSACTION_COMMITTED: (name, ms) =>
        `Transaction committed on "${name}" in ${ms}ms.`,
    TRANSACTION_ROLLED_BACK: (name, reason) =>
        `Transaction rolled back on "${name}": ${reason}`,
};

module.exports = { databaseMessages };
