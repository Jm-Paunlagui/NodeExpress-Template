"use strict";

/**
 * @fileoverview Oracle-Mongo-Wrapper parser/schema validation messages.
 * Used ONLY in logger calls — never thrown or sent to clients.
 */

const oracleMongoWrapperMessages = {
    // ── Error formatter ──────────────────────────────────────────────────────
    wrapError: (scope, err, sql, binds) =>
        `[${scope}] ${err.message}\nSQL: ${sql}${binds !== undefined ? `\nBinds: ${JSON.stringify(binds)}` : ""}`,

    // ── Privilege / DCL ──────────────────────────────────────────────────────
    INSUFFICIENT_PRIVILEGES: (scope, requiredPrivilege, err, sql) =>
        `[${scope}] Insufficient privileges. ${requiredPrivilege}\nOriginal: ${err.message}\nSQL: ${sql}`,
    DCL_GRANT_INSUFFICIENT: (err, sql) =>
        `[OracleDCL.grant] Insufficient privileges to GRANT. Requires GRANT OPTION or DBA role.\nOriginal: ${err.message}\nSQL: ${sql}`,
    DCL_REVOKE_INSUFFICIENT: (err, sql) =>
        `[OracleDCL.revoke] Insufficient privileges to REVOKE. Requires GRANT OPTION or DBA role.\nOriginal: ${err.message}\nSQL: ${sql}`,

    // ── Privilege requirement descriptions ───────────────────────────────────
    PRIV_PLAN_TABLE: "Requires SELECT on PLAN_TABLE and EXECUTE on DBMS_XPLAN.",
    PRIV_DBMS_STATS:
        "Requires EXECUTE on DBMS_STATS (typically granted via DBA role or explicit GRANT).",
    PRIV_CREATE_MVIEW: "Requires CREATE MATERIALIZED VIEW privilege.",
    PRIV_REFRESH_MVIEW: "Requires EXECUTE on DBMS_MVIEW.",
    PRIV_DROP_MVIEW: "Requires DROP MATERIALIZED VIEW privilege.",

    // ── Validation messages ──────────────────────────────────────────────────
    CREATEDB_INVALID_CONNECTION_NAME:
        "createDb: connectionName must be a non-empty string",
    MERGE_BINDS_KEY_COLLISION: (key) =>
        `Bind key collision: "${key}" exists in both bind objects.`,
    FILTER_UNSUPPORTED_OPERATOR: (op) =>
        `[filterParser] Unsupported operator: ${op}`,
    UPDATE_EMPTY: "[updateParser] Update object must not be empty.",
    UPDATE_RENAME_NOT_SUPPORTED:
        "[updateParser] $rename is not supported. Use ALTER TABLE to rename columns.",
    UPDATE_UNSUPPORTED_OPERATOR: (op) =>
        `[updateParser] Unsupported update operator: ${op}`,
    UPDATE_NO_OPERATOR:
        "[updateParser] Update object must contain at least one operator ($set, $inc, etc.).",
    QUERY_BUILDER_CHAIN_AFTER_TERMINAL:
        "Cannot chain after terminal method has been called.",
    INSERT_MANY_EMPTY:
        "[OracleCollection.insertMany] Documents array must not be empty.",
    BULK_WRITE_EMPTY:
        "[OracleCollection.bulkWrite] Operations must be a non-empty array.",
    BULK_WRITE_UNKNOWN_OP: (keys) =>
        `[OracleCollection.bulkWrite] Unknown operation type: ${JSON.stringify(keys)}`,
    SCHEMA_ALTER_TABLE_UNKNOWN_OP:
        "[OracleSchema.alterTable] Unknown operation.",
    SCHEMA_CREATE_VIEW_INVALID_INPUT:
        "[OracleSchema.createView] Expected a QueryBuilder or SQL string.",
    PERF_EXPLAIN_PLAN_INVALID_INPUT:
        "[performance.explainPlan] Expected a QueryBuilder or SQL string.",
    PERF_CREATE_MVIEW_INVALID_INPUT:
        "[performance.createMaterializedView] Expected a QueryBuilder or SQL string.",
    SET_OP_COLUMN_COUNT_MISMATCH:
        "[SetResultBuilder] Column counts differ between queries",
};

module.exports = { oracleMongoWrapperMessages };
