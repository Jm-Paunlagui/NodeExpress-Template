"use strict";

/**
 * @fileoverview Performance utilities: EXPLAIN PLAN, ANALYZE, materialized views.
 * Exposed as createPerformance(db) factory.
 */

const { quoteIdentifier } = require("../utils");

/**
 * Create a performance utility instance bound to a db interface.
 * @param {Object} db - db interface from createDb
 * @returns {Object} performance utilities
 */
function createPerformance(db) {
    return {
        /**
         * Get the execution plan for a query.
         * @param {QueryBuilder|string} queryBuilderOrSQL
         * @returns {Promise<Array>}
         */
        async explainPlan(queryBuilderOrSQL) {
            return db.withConnection(async (conn) => {
                let sql;
                let binds = {};

                if (typeof queryBuilderOrSQL === "string") {
                    sql = queryBuilderOrSQL;
                } else if (
                    queryBuilderOrSQL &&
                    typeof queryBuilderOrSQL._buildSQL === "function"
                ) {
                    const built = queryBuilderOrSQL._buildSQL();
                    sql = built.sql;
                    binds = built.binds;
                } else {
                    throw new Error(
                        "[performance.explainPlan] Expected a QueryBuilder or SQL string.",
                    );
                }

                // EXPLAIN PLAN FOR ...
                const explainSql = `EXPLAIN PLAN FOR ${sql}`;
                try {
                    await conn.execute(explainSql, binds, { autoCommit: true });

                    // Retrieve the plan
                    const planResult = await conn.execute(
                        `SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY('PLAN_TABLE', NULL, 'ALL'))`,
                        {},
                        {
                            outFormat: db.oracledb.OUT_FORMAT_OBJECT,
                            autoCommit: true,
                        },
                    );
                    return planResult.rows || [];
                } catch (err) {
                    throw new Error(
                        `[performance.explainPlan] ${err.message}\nSQL: ${explainSql}`,
                    );
                }
            });
        },

        /**
         * Gather table statistics.
         * @param {string} tableName
         * @returns {Promise<void>}
         */
        async analyze(tableName) {
            return db.withConnection(async (conn) => {
                const sql = `BEGIN DBMS_STATS.GATHER_TABLE_STATS(USER, UPPER(:tbl), CASCADE => TRUE); END;`;
                try {
                    await conn.execute(
                        sql,
                        { tbl: tableName },
                        { autoCommit: true },
                    );
                } catch (err) {
                    throw new Error(
                        `[performance.analyze] ${err.message}\nSQL: ${sql}`,
                    );
                }
            });
        },

        /**
         * Create a materialized view.
         * @param {string} name
         * @param {QueryBuilder|string} queryBuilderOrSQL
         * @param {Object} [options] - refreshMode, refreshOn, buildMode, orReplace
         * @returns {Promise<{ acknowledged: boolean }>}
         */
        async createMaterializedView(name, queryBuilderOrSQL, options = {}) {
            return db.withConnection(async (conn) => {
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
                    throw new Error(
                        "[performance.createMaterializedView] Expected a QueryBuilder or SQL string.",
                    );
                }

                const {
                    refreshMode = "force",
                    refreshOn = "demand",
                    buildMode = "immediate",
                    orReplace = false,
                } = options;

                const refreshModeClause =
                    {
                        fast: "FAST",
                        complete: "COMPLETE",
                        force: "FORCE",
                    }[refreshMode] || "FORCE";

                const refreshOnClause =
                    {
                        commit: "ON COMMIT",
                        demand: "ON DEMAND",
                    }[refreshOn] || "ON DEMAND";

                const buildModeClause =
                    {
                        immediate: "BUILD IMMEDIATE",
                        deferred: "BUILD DEFERRED",
                    }[buildMode] || "BUILD IMMEDIATE";

                // Oracle does not support CREATE OR REPLACE for materialized views.
                // If orReplace, drop existing MV first (ignore error if not exists).
                if (orReplace) {
                    try {
                        await conn.execute(
                            `DROP MATERIALIZED VIEW ${quoteIdentifier(name)}`,
                            [],
                            { autoCommit: true },
                        );
                    } catch (_) {
                        // Ignore — MV may not exist
                    }
                }

                const sql = `CREATE MATERIALIZED VIEW ${quoteIdentifier(name)} ${buildModeClause} REFRESH ${refreshModeClause} ${refreshOnClause} AS ${selectSql}`;

                try {
                    await conn.execute(sql, binds, { autoCommit: true });
                    return { acknowledged: true };
                } catch (err) {
                    throw new Error(
                        `[performance.createMaterializedView] ${err.message}\nSQL: ${sql}`,
                    );
                }
            });
        },

        /**
         * Refresh a materialized view.
         * @param {string} name
         * @param {string} [mode='complete'] - 'fast' | 'complete' | 'force'
         * @returns {Promise<void>}
         */
        async refreshMaterializedView(name, mode = "complete") {
            return db.withConnection(async (conn) => {
                const modeChar =
                    { fast: "F", complete: "C", force: "?" }[mode] || "C";
                const sql = `BEGIN DBMS_MVIEW.REFRESH(:mvName, :mvMode); END;`;
                try {
                    await conn.execute(
                        sql,
                        { mvName: name.toUpperCase(), mvMode: modeChar },
                        { autoCommit: true },
                    );
                } catch (err) {
                    throw new Error(
                        `[performance.refreshMaterializedView] ${err.message}\nSQL: ${sql}`,
                    );
                }
            });
        },

        /**
         * Drop a materialized view.
         * @param {string} name
         * @returns {Promise<{ acknowledged: boolean }>}
         */
        async dropMaterializedView(name) {
            return db.withConnection(async (conn) => {
                const sql = `DROP MATERIALIZED VIEW ${quoteIdentifier(name)}`;
                try {
                    await conn.execute(sql, {}, { autoCommit: true });
                    return { acknowledged: true };
                } catch (err) {
                    throw new Error(
                        `[performance.dropMaterializedView] ${err.message}\nSQL: ${sql}`,
                    );
                }
            });
        },
    };
}

module.exports = { createPerformance };
