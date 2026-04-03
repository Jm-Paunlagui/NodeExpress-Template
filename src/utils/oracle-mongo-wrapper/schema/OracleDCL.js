"use strict";

/**
 * @fileoverview DCL operations: GRANT and REVOKE.
 */

const { quoteIdentifier } = require("../utils");

class OracleDCL {
    /**
     * @param {Object} db - db interface from createDb
     */
    constructor(db) {
        this.db = db;
    }

    /**
     * Grant privileges on an object to a user/role.
     * @param {string[]} privileges - e.g. ['SELECT', 'INSERT', 'UPDATE']
     * @param {string} on - Table/object name
     * @param {string} to - User or role
     * @returns {Promise<{ acknowledged: boolean }>}
     */
    async grant(privileges, on, to) {
        return this.db.withConnection(async (conn) => {
            const privList = privileges.join(", ");
            const sql = `GRANT ${privList} ON ${quoteIdentifier(on)} TO ${quoteIdentifier(to)}`;

            try {
                await conn.execute(sql, {}, { autoCommit: true });
                return { acknowledged: true };
            } catch (err) {
                throw new Error(
                    `[OracleDCL.grant] ${err.message}\nSQL: ${sql}`,
                );
            }
        });
    }

    /**
     * Revoke privileges on an object from a user/role.
     * @param {string[]} privileges - e.g. ['DELETE', 'UPDATE']
     * @param {string} on - Table/object name
     * @param {string} from - User or role
     * @returns {Promise<{ acknowledged: boolean }>}
     */
    async revoke(privileges, on, from) {
        return this.db.withConnection(async (conn) => {
            const privList = privileges.join(", ");
            const sql = `REVOKE ${privList} ON ${quoteIdentifier(on)} FROM ${quoteIdentifier(from)}`;

            try {
                await conn.execute(sql, {}, { autoCommit: true });
                return { acknowledged: true };
            } catch (err) {
                throw new Error(
                    `[OracleDCL.revoke] ${err.message}\nSQL: ${sql}`,
                );
            }
        });
    }
}

module.exports = { OracleDCL };
