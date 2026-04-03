"use strict";

/**
 * @fileoverview Transaction manager with MongoDB-style session API and Oracle savepoints.
 */

const { OracleCollection } = require("./core/OracleCollection");

/**
 * Session class — holds a reference to the raw conn passed by db.withTransaction().
 * Exposes collection(tableName) to return bound OracleCollection instances.
 */
class Session {
    /**
     * @param {Object} conn - Raw Oracle connection
     * @param {Object} db - db interface from createDb
     */
    constructor(conn, db) {
        this._conn = conn;
        this.db = db;
    }

    /**
     * Get an OracleCollection bound to this session's connection.
     * All operations reuse the same conn — no new connections acquired.
     * @param {string} tableName
     * @returns {OracleCollection}
     */
    collection(tableName) {
        return new OracleCollection(tableName, this.db, this._conn);
    }

    /**
     * Create a savepoint.
     * @param {string} name - Savepoint name
     */
    async savepoint(name) {
        await this._conn.execute(`SAVEPOINT ${name}`);
    }

    /**
     * Rollback to a named savepoint.
     * @param {string} name - Savepoint name
     */
    async rollbackTo(name) {
        await this._conn.execute(`ROLLBACK TO SAVEPOINT ${name}`);
    }

    /**
     * Release a savepoint (no-op in Oracle — not natively supported).
     * @param {string} name - Savepoint name
     */
    async releaseSavepoint(name) {
        // Oracle does not support RELEASE SAVEPOINT — no-op
    }
}

/**
 * Transaction manager wrapping db.withTransaction().
 */
class Transaction {
    /**
     * @param {Object} db - db interface from createDb
     */
    constructor(db) {
        this.db = db;
    }

    /**
     * Execute fn inside a transaction. The session provides access to
     * collection() for scoped operations, and savepoint/rollbackTo.
     *
     * @param {Function} fn - async (session) => result
     * @returns {Promise<*>}
     */
    async withTransaction(fn) {
        return this.db.withTransaction(async (conn) => {
            const session = new Session(conn, this.db);
            return fn(session);
        });
    }
}

module.exports = { Transaction, Session };
