"use strict";

/**
 * @fileoverview DDL operations: createTable, alterTable, dropTable, createView, etc.
 */

const { quoteIdentifier } = require("../utils");
const {
    oracleMongoWrapperMessages: MSG,
} = require("../../../constants/messages");

class OracleSchema {
    /**
     * @param {Object} db - db interface from createDb
     */
    constructor(db) {
        this.db = db;
    }

    /**
     * Create a table with column definitions.
     * @param {string} tableName
     * @param {Object} columns - { colName: { type, primaryKey, autoIncrement, notNull, default, check, references } }
     * @param {Object} [options] - ifNotExists
     * @returns {Promise<{ acknowledged: boolean }>}
     */
    async createTable(tableName, columns, options = {}) {
        return this.db.withConnection(async (conn) => {
            const colDefs = [];
            const constraints = [];

            for (const [colName, spec] of Object.entries(columns)) {
                const parts = [quoteIdentifier(colName), spec.type];

                if (spec.autoIncrement) {
                    parts.push("GENERATED ALWAYS AS IDENTITY");
                }
                if (spec.primaryKey) {
                    parts.push("PRIMARY KEY");
                }
                if (spec.notNull) {
                    parts.push("NOT NULL");
                }
                if (spec.default != null) {
                    parts.push(`DEFAULT ${spec.default}`);
                }
                if (spec.check) {
                    parts.push(`CHECK (${spec.check})`);
                }
                if (spec.references) {
                    parts.push(
                        `REFERENCES ${quoteIdentifier(spec.references.table)}(${quoteIdentifier(spec.references.column)})`,
                    );
                }

                colDefs.push(parts.join(" "));
            }

            const allDefs = [...colDefs, ...constraints].join(", ");
            let sql = `CREATE TABLE ${quoteIdentifier(tableName)} (${allDefs})`;

            if (options.ifNotExists) {
                // Wrap in PL/SQL block to check existence
                sql = `BEGIN EXECUTE IMMEDIATE '${sql.replace(/'/g, "''")}'; EXCEPTION WHEN OTHERS THEN IF SQLCODE = -955 THEN NULL; ELSE RAISE; END IF; END;`;
            }

            try {
                await conn.execute(sql, {}, { autoCommit: true });
                return { acknowledged: true };
            } catch (err) {
                throw new Error(
                    MSG.wrapError("OracleSchema.createTable", err, sql),
                );
            }
        });
    }

    /**
     * Alter a table.
     * @param {string} tableName
     * @param {Object} operation - addColumn, dropColumn, modifyColumn, renameColumn, addConstraint, dropConstraint
     * @returns {Promise<{ acknowledged: boolean }>}
     */
    async alterTable(tableName, operation) {
        return this.db.withConnection(async (conn) => {
            let sql;

            if (operation.addColumn) {
                const entries = Object.entries(operation.addColumn);
                const colDefs = entries
                    .map(([col, type]) => `${quoteIdentifier(col)} ${type}`)
                    .join(", ");
                sql = `ALTER TABLE ${quoteIdentifier(tableName)} ADD (${colDefs})`;
            } else if (operation.dropColumn) {
                const col =
                    typeof operation.dropColumn === "string"
                        ? operation.dropColumn
                        : operation.dropColumn;
                sql = `ALTER TABLE ${quoteIdentifier(tableName)} DROP COLUMN ${quoteIdentifier(col)}`;
            } else if (operation.modifyColumn) {
                const entries = Object.entries(operation.modifyColumn);
                const colDefs = entries
                    .map(([col, type]) => `${quoteIdentifier(col)} ${type}`)
                    .join(", ");
                sql = `ALTER TABLE ${quoteIdentifier(tableName)} MODIFY (${colDefs})`;
            } else if (operation.renameColumn) {
                const { from, to } = operation.renameColumn;
                sql = `ALTER TABLE ${quoteIdentifier(tableName)} RENAME COLUMN ${quoteIdentifier(from)} TO ${quoteIdentifier(to)}`;
            } else if (operation.addConstraint) {
                const { type, columns, name } = operation.addConstraint;
                const constraintName =
                    name || `${type}_${tableName}_${columns.join("_")}`;
                const colList = columns.map(quoteIdentifier).join(", ");
                sql = `ALTER TABLE ${quoteIdentifier(tableName)} ADD CONSTRAINT ${quoteIdentifier(constraintName)} ${type} (${colList})`;
            } else if (operation.dropConstraint) {
                sql = `ALTER TABLE ${quoteIdentifier(tableName)} DROP CONSTRAINT ${quoteIdentifier(operation.dropConstraint)}`;
            } else {
                throw new Error(MSG.SCHEMA_ALTER_TABLE_UNKNOWN_OP);
            }

            try {
                await conn.execute(sql, {}, { autoCommit: true });
                return { acknowledged: true };
            } catch (err) {
                throw new Error(
                    MSG.wrapError("OracleSchema.alterTable", err, sql),
                );
            }
        });
    }

    /**
     * Drop a table.
     * @param {string} tableName
     * @param {Object} [options] - cascade, ifExists
     * @returns {Promise<{ acknowledged: boolean }>}
     */
    async dropTable(tableName, options = {}) {
        return this.db.withConnection(async (conn) => {
            let suffix = "";
            if (options.cascade) suffix = " CASCADE CONSTRAINTS PURGE";

            let sql = `DROP TABLE ${quoteIdentifier(tableName)}${suffix}`;

            if (options.ifExists) {
                sql = `BEGIN EXECUTE IMMEDIATE '${sql.replace(/'/g, "''")}'; EXCEPTION WHEN OTHERS THEN IF SQLCODE = -942 THEN NULL; ELSE RAISE; END IF; END;`;
            }

            try {
                await conn.execute(sql, {}, { autoCommit: true });
                return { acknowledged: true };
            } catch (err) {
                throw new Error(
                    MSG.wrapError("OracleSchema.dropTable", err, sql),
                );
            }
        });
    }

    /**
     * Truncate a table.
     * @param {string} tableName
     * @returns {Promise<{ acknowledged: boolean }>}
     */
    async truncateTable(tableName) {
        return this.db.withConnection(async (conn) => {
            const sql = `TRUNCATE TABLE ${quoteIdentifier(tableName)}`;
            try {
                await conn.execute(sql, {}, { autoCommit: true });
                return { acknowledged: true };
            } catch (err) {
                throw new Error(
                    MSG.wrapError("OracleSchema.truncateTable", err, sql),
                );
            }
        });
    }

    /**
     * Rename a table.
     * @param {string} oldName
     * @param {string} newName
     * @returns {Promise<{ acknowledged: boolean }>}
     */
    async renameTable(oldName, newName) {
        return this.db.withConnection(async (conn) => {
            const sql = `RENAME ${quoteIdentifier(oldName)} TO ${quoteIdentifier(newName)}`;
            try {
                await conn.execute(sql, {}, { autoCommit: true });
                return { acknowledged: true };
            } catch (err) {
                throw new Error(
                    MSG.wrapError("OracleSchema.renameTable", err, sql),
                );
            }
        });
    }

    /**
     * Create a view.
     * @param {string} viewName
     * @param {QueryBuilder|string} queryBuilderOrSQL
     * @param {Object} [options] - orReplace, force
     * @returns {Promise<{ acknowledged: boolean }>}
     */
    async createView(viewName, queryBuilderOrSQL, options = {}) {
        return this.db.withConnection(async (conn) => {
            let selectSql;
            let binds = {};

            if (typeof queryBuilderOrSQL === "string") {
                selectSql = queryBuilderOrSQL;
            } else if (
                queryBuilderOrSQL &&
                typeof queryBuilderOrSQL._buildSQL === "function"
            ) {
                const built = queryBuilderOrSQL._buildSQL();
                selectSql = built.sql;
                binds = built.binds;
            } else {
                throw new Error(MSG.SCHEMA_CREATE_VIEW_INVALID_INPUT);
            }

            let prefix = "CREATE";
            if (options.orReplace) prefix = "CREATE OR REPLACE";
            if (options.force) prefix += " FORCE";

            const sql = `${prefix} VIEW ${quoteIdentifier(viewName)} AS ${selectSql}`;

            try {
                await conn.execute(sql, binds, { autoCommit: true });
                return { acknowledged: true };
            } catch (err) {
                throw new Error(
                    MSG.wrapError("OracleSchema.createView", err, sql),
                );
            }
        });
    }

    /**
     * Drop a view.
     * @param {string} viewName
     * @param {Object} [options] - ifExists
     * @returns {Promise<{ acknowledged: boolean }>}
     */
    async dropView(viewName, options = {}) {
        return this.db.withConnection(async (conn) => {
            let sql = `DROP VIEW ${quoteIdentifier(viewName)}`;

            if (options.ifExists) {
                sql = `BEGIN EXECUTE IMMEDIATE '${sql.replace(/'/g, "''")}'; EXCEPTION WHEN OTHERS THEN IF SQLCODE = -942 THEN NULL; ELSE RAISE; END IF; END;`;
            }

            try {
                await conn.execute(sql, {}, { autoCommit: true });
                return { acknowledged: true };
            } catch (err) {
                throw new Error(
                    MSG.wrapError("OracleSchema.dropView", err, sql),
                );
            }
        });
    }

    /**
     * Create a sequence.
     * @param {string} name
     * @param {Object} [options] - startWith, incrementBy, maxValue, cycle, cache
     * @returns {Promise<{ acknowledged: boolean }>}
     */
    async createSequence(name, options = {}) {
        return this.db.withConnection(async (conn) => {
            const parts = [`CREATE SEQUENCE ${quoteIdentifier(name)}`];

            if (options.startWith != null)
                parts.push(`START WITH ${options.startWith}`);
            if (options.incrementBy != null)
                parts.push(`INCREMENT BY ${options.incrementBy}`);
            if (options.maxValue != null)
                parts.push(`MAXVALUE ${options.maxValue}`);
            if (options.minValue != null)
                parts.push(`MINVALUE ${options.minValue}`);
            parts.push(options.cycle ? "CYCLE" : "NOCYCLE");
            if (options.cache != null) parts.push(`CACHE ${options.cache}`);

            const sql = parts.join(" ");

            try {
                await conn.execute(sql, {}, { autoCommit: true });
                return { acknowledged: true };
            } catch (err) {
                throw new Error(
                    MSG.wrapError("OracleSchema.createSequence", err, sql),
                );
            }
        });
    }

    /**
     * Create a schema authorization.
     * @param {string} schemaName
     * @returns {Promise<{ acknowledged: boolean }>}
     */
    async createSchema(schemaName) {
        return this.db.withConnection(async (conn) => {
            const sql = `CREATE SCHEMA AUTHORIZATION ${quoteIdentifier(schemaName)}`;
            try {
                await conn.execute(sql, {}, { autoCommit: true });
                return { acknowledged: true };
            } catch (err) {
                throw new Error(
                    MSG.wrapError("OracleSchema.createSchema", err, sql),
                );
            }
        });
    }
}

module.exports = { OracleSchema };
