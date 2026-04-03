"use strict";

/**
 * @fileoverview Translates MongoDB-style filter objects into Oracle SQL WHERE clauses
 * with parameterized bind variables.
 */

const { quoteIdentifier } = require("../utils");
const {
    oracleMongoWrapperMessages: MSG,
} = require("../../../constants/messages");

/**
 * Per-call bind counter to avoid global mutable state (thread-safe under concurrency).
 * @returns {{ next: (prefix: string) => string }}
 */
function _createCounter() {
    let _count = 0;
    return {
        next(prefix) {
            return `${prefix}_${_count++}`;
        },
    };
}

/**
 * Reset bind counter (no-op — counters are now per-call; kept for API compat).
 */
function resetBindCounter() {
    // no-op: counters are scoped per parseFilter call
}

const COMPARISON_OPS = {
    $eq: "=",
    $ne: "<>",
    $gt: ">",
    $gte: ">=",
    $lt: "<",
    $lte: "<=",
};

/**
 * Parse a single field's operator expression into SQL fragments.
 * @param {string} field - Column name
 * @param {*} expr - Operator expression or scalar value
 * @param {Object} binds - Accumulator for bind variables
 * @param {string} outerAlias - Optional table alias for correlated subqueries
 * @param {Object} counter - Per-call bind counter
 * @returns {string} SQL condition fragment
 */
function _parseFieldExpr(field, expr, binds, outerAlias, counter) {
    const qField = quoteIdentifier(field);

    // Simple equality: { field: value }
    if (
        expr === null ||
        expr === undefined ||
        typeof expr !== "object" ||
        expr instanceof Date
    ) {
        if (expr === null || expr === undefined) {
            return `${qField} IS NULL`;
        }
        // Handle $outer. correlated reference (for LATERAL JOIN)
        if (typeof expr === "string" && expr.startsWith("$outer.")) {
            const outerCol = expr.slice(7);
            return `${qField} = ${quoteIdentifier(outerCol)}`;
        }
        const bname = counter.next(`where_${field}`);
        binds[bname] = expr;
        return `${qField} = :${bname}`;
    }

    // Operator object: { field: { $gt: 5, $lt: 10 } }
    const conditions = [];

    for (const [op, val] of Object.entries(expr)) {
        if (COMPARISON_OPS[op]) {
            // Check if val is a correlated $subquery object
            if (
                val &&
                typeof val === "object" &&
                !Array.isArray(val) &&
                !(val instanceof Date) &&
                val.$subquery
            ) {
                const subExpr = _buildCorrelatedSubquery(
                    field,
                    val.$subquery,
                    binds,
                    outerAlias,
                    counter,
                );
                conditions.push(`${qField} ${COMPARISON_OPS[op]} ${subExpr}`);
            } else {
                const bname = counter.next(`where_${field}`);
                binds[bname] = val;
                conditions.push(`${qField} ${COMPARISON_OPS[op]} :${bname}`);
            }
        } else if (op === "$in") {
            if (!Array.isArray(val) || val.length === 0) {
                conditions.push("1=0"); // empty IN → always false
            } else {
                const placeholders = val.map((v) => {
                    const bname = counter.next(`where_${field}`);
                    binds[bname] = v;
                    return `:${bname}`;
                });
                conditions.push(`${qField} IN (${placeholders.join(", ")})`);
            }
        } else if (op === "$nin") {
            if (!Array.isArray(val) || val.length === 0) {
                conditions.push("1=1");
            } else {
                const placeholders = val.map((v) => {
                    const bname = counter.next(`where_${field}`);
                    binds[bname] = v;
                    return `:${bname}`;
                });
                conditions.push(
                    `${qField} NOT IN (${placeholders.join(", ")})`,
                );
            }
        } else if (op === "$between") {
            const bmin = counter.next(`where_${field}_min`);
            const bmax = counter.next(`where_${field}_max`);
            binds[bmin] = val[0];
            binds[bmax] = val[1];
            conditions.push(`${qField} BETWEEN :${bmin} AND :${bmax}`);
        } else if (op === "$notBetween") {
            const bmin = counter.next(`where_${field}_min`);
            const bmax = counter.next(`where_${field}_max`);
            binds[bmin] = val[0];
            binds[bmax] = val[1];
            conditions.push(`${qField} NOT BETWEEN :${bmin} AND :${bmax}`);
        } else if (op === "$exists") {
            conditions.push(
                val ? `${qField} IS NOT NULL` : `${qField} IS NULL`,
            );
        } else if (op === "$regex") {
            const bname = counter.next(`where_${field}`);
            binds[bname] = val;
            conditions.push(`REGEXP_LIKE(${qField}, :${bname})`);
        } else if (op === "$like") {
            const bname = counter.next(`where_${field}`);
            binds[bname] = val;
            conditions.push(`${qField} LIKE :${bname}`);
        } else if (op === "$any") {
            const placeholders = val.map((v) => {
                const bname = counter.next(`where_${field}`);
                binds[bname] = v;
                return `:${bname}`;
            });
            conditions.push(`${qField} = ANY(${placeholders.join(", ")})`);
        } else if (op === "$all") {
            const placeholders = val.map((v) => {
                const bname = counter.next(`where_${field}`);
                binds[bname] = v;
                return `:${bname}`;
            });
            conditions.push(`${qField} = ALL(${placeholders.join(", ")})`);
        } else if (op === "$case") {
            // { $case: [{when, then}], $else: v }
            const whenParts = val.map((c) => {
                const { whereClause: wWhen, binds: wBinds } = parseFilter(
                    c.when,
                    null,
                    counter,
                );
                Object.assign(binds, wBinds);
                const bThen = counter.next(`where_${field}_then`);
                binds[bThen] = c.then;
                const condStr = wWhen.replace(/^WHERE\s+/i, "");
                return `WHEN ${condStr} THEN :${bThen}`;
            });
            const elseVal = expr.$else;
            let elseStr = "";
            if (elseVal !== undefined) {
                const bElse = counter.next(`where_${field}_else`);
                binds[bElse] = elseVal;
                elseStr = ` ELSE :${bElse}`;
            }
            conditions.push(`CASE ${whenParts.join(" ")}${elseStr} END`);
        } else if (op === "$else") {
            // Handled inside $case
        } else if (op === "$coalesce") {
            const parts = val.map((v) => {
                if (typeof v === "string" && !v.startsWith("$")) {
                    const bname = counter.next(`where_${field}`);
                    binds[bname] = v;
                    return `:${bname}`;
                }
                // Column reference
                return quoteIdentifier(
                    typeof v === "string" && v.startsWith("$") ? v.slice(1) : v,
                );
            });
            conditions.push(`COALESCE(${parts.join(", ")})`);
        } else if (op === "$nullif") {
            const left = quoteIdentifier(val[0]);
            const bname = counter.next(`where_${field}`);
            binds[bname] = val[1];
            conditions.push(`NULLIF(${left}, :${bname})`);
        } else if (op === "$subquery") {
            // Correlated subquery for WHERE comparisons
            conditions.push(
                _buildCorrelatedSubquery(
                    field,
                    val,
                    binds,
                    outerAlias,
                    counter,
                ),
            );
        } else if (op === "$inSelect") {
            // val can be a QueryBuilder, a resolved Array, or raw SQL string
            if (Array.isArray(val)) {
                // Already resolved (e.g. from await distinct()) — treat like $in
                if (val.length === 0) {
                    conditions.push("1=0");
                } else {
                    const placeholders = val.map((v) => {
                        const bname = counter.next(`where_${field}`);
                        binds[bname] = v;
                        return `:${bname}`;
                    });
                    conditions.push(
                        `${qField} IN (${placeholders.join(", ")})`,
                    );
                }
            } else if (val && val._buildSQL) {
                // QueryBuilder — get its SQL
                const subSql = val._buildSQL();
                const subBinds = val._getBinds ? val._getBinds() : {};
                Object.assign(binds, subBinds);
                conditions.push(`${qField} IN (${subSql.sql || subSql})`);
            } else {
                conditions.push(`${qField} IN (${val})`);
            }
        } else if (
            op === "$gtAny" ||
            op === "$ltAny" ||
            op === "$gteAny" ||
            op === "$lteAny"
        ) {
            const cmpOp = op.replace("Any", "").replace("$", "");
            const cmpMap = { gt: ">", lt: "<", gte: ">=", lte: "<=" };
            const subCollection = quoteIdentifier(val.collection);
            const subField = quoteIdentifier(val.field);
            conditions.push(
                `${qField} ${cmpMap[cmpOp]} ANY (SELECT ${subField} FROM ${subCollection})`,
            );
        } else if (
            op === "$gtAll" ||
            op === "$ltAll" ||
            op === "$gteAll" ||
            op === "$lteAll"
        ) {
            const cmpOp = op.replace("All", "").replace("$", "");
            const cmpMap = { gt: ">", lt: "<", gte: ">=", lte: "<=" };
            const subCollection = quoteIdentifier(val.collection);
            const subField = quoteIdentifier(val.field);
            conditions.push(
                `${qField} ${cmpMap[cmpOp]} ALL (SELECT ${subField} FROM ${subCollection})`,
            );
        } else {
            throw new Error(MSG.FILTER_UNSUPPORTED_OPERATOR(op));
        }
    }

    return conditions.length > 1
        ? `(${conditions.join(" AND ")})`
        : conditions[0];
}

/**
 * Build a correlated scalar subquery for use in WHERE comparisons.
 */
function _buildCorrelatedSubquery(field, spec, binds, outerAlias, counter) {
    const collection = quoteIdentifier(spec.collection);
    const aggFn = spec.aggregate
        ? spec.aggregate.replace("$", "").toUpperCase()
        : null;
    const subField = spec.field ? quoteIdentifier(spec.field) : "*";

    let selectExpr = subField;
    if (aggFn) {
        selectExpr = `${aggFn}(${subField})`;
    }

    let whereStr = "";
    if (spec.where && Object.keys(spec.where).length > 0) {
        const subconditions = [];
        for (const [k, v] of Object.entries(spec.where)) {
            if (typeof v === "string" && v.startsWith("$outer.")) {
                const outerCol = v.replace("$outer.", "");
                const alias = outerAlias || "t0";
                subconditions.push(
                    `${quoteIdentifier(k)} = ${alias}.${quoteIdentifier(outerCol)}`,
                );
            } else {
                const bname = counter.next(`where_sub_${k}`);
                binds[bname] = v;
                subconditions.push(`${quoteIdentifier(k)} = :${bname}`);
            }
        }
        whereStr = ` WHERE ${subconditions.join(" AND ")}`;
    }

    return `(SELECT ${selectExpr} FROM ${collection}${whereStr})`;
}

/**
 * Parse a MongoDB-style filter object into an Oracle WHERE clause with bind variables.
 *
 * @param {Object} filter - MongoDB-style filter, e.g. { status: 'active', age: { $gte: 18 } }
 * @param {string} [tableAlias] - Optional alias for the main table (for correlated subqueries)
 * @param {Object} [_counter] - Internal: shared counter for recursive calls (do not pass externally)
 * @returns {{ whereClause: string, binds: Object }}
 */
function parseFilter(filter, tableAlias, _counter) {
    if (
        !filter ||
        typeof filter !== "object" ||
        Object.keys(filter).length === 0
    ) {
        return { whereClause: "", binds: {} };
    }

    // Create counter once at the top-level call; reuse for recursive calls
    const counter = _counter || _createCounter();

    const binds = {};
    const conditions = [];

    for (const [key, value] of Object.entries(filter)) {
        if (key === "$and") {
            const parts = value.map((sub) => {
                const { whereClause: wc, binds: wb } = parseFilter(
                    sub,
                    tableAlias,
                    counter,
                );
                Object.assign(binds, wb);
                return wc.replace(/^WHERE\s+/i, "");
            });
            conditions.push(`(${parts.join(" AND ")})`);
        } else if (key === "$or") {
            const parts = value.map((sub) => {
                const { whereClause: wc, binds: wb } = parseFilter(
                    sub,
                    tableAlias,
                    counter,
                );
                Object.assign(binds, wb);
                return wc.replace(/^WHERE\s+/i, "");
            });
            conditions.push(`(${parts.join(" OR ")})`);
        } else if (key === "$nor") {
            const parts = value.map((sub) => {
                const { whereClause: wc, binds: wb } = parseFilter(
                    sub,
                    tableAlias,
                    counter,
                );
                Object.assign(binds, wb);
                return wc.replace(/^WHERE\s+/i, "");
            });
            conditions.push(`NOT (${parts.join(" OR ")})`);
        } else if (key === "$not") {
            const { whereClause: wc, binds: wb } = parseFilter(
                value,
                tableAlias,
                counter,
            );
            Object.assign(binds, wb);
            conditions.push(`NOT (${wc.replace(/^WHERE\s+/i, "")})`);
        } else if (key === "$exists") {
            // EXISTS subquery: { $exists: { collection, match } }
            const subColl = quoteIdentifier(value.collection);
            const matchParts = [];
            for (const [mk, mv] of Object.entries(value.match || {})) {
                if (typeof mv === "string" && mv.startsWith("$")) {
                    const outerCol = mv.slice(1);
                    const alias = tableAlias || "t0";
                    matchParts.push(
                        `${quoteIdentifier(mk)} = ${alias}.${quoteIdentifier(outerCol)}`,
                    );
                } else {
                    const bname = counter.next(`where_exists_${mk}`);
                    binds[bname] = mv;
                    matchParts.push(`${quoteIdentifier(mk)} = :${bname}`);
                }
            }
            const matchWhere =
                matchParts.length > 0
                    ? ` WHERE ${matchParts.join(" AND ")}`
                    : "";
            conditions.push(`EXISTS (SELECT 1 FROM ${subColl}${matchWhere})`);
        } else if (key === "$notExists") {
            const subColl = quoteIdentifier(value.collection);
            const matchParts = [];
            for (const [mk, mv] of Object.entries(value.match || {})) {
                if (typeof mv === "string" && mv.startsWith("$")) {
                    const outerCol = mv.slice(1);
                    const alias = tableAlias || "t0";
                    matchParts.push(
                        `${quoteIdentifier(mk)} = ${alias}.${quoteIdentifier(outerCol)}`,
                    );
                } else {
                    const bname = counter.next(`where_notexists_${mk}`);
                    binds[bname] = mv;
                    matchParts.push(`${quoteIdentifier(mk)} = :${bname}`);
                }
            }
            const matchWhere =
                matchParts.length > 0
                    ? ` WHERE ${matchParts.join(" AND ")}`
                    : "";
            conditions.push(
                `NOT EXISTS (SELECT 1 FROM ${subColl}${matchWhere})`,
            );
        } else {
            conditions.push(
                _parseFieldExpr(key, value, binds, tableAlias, counter),
            );
        }
    }

    const whereClause =
        conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    return { whereClause, binds };
}

module.exports = { parseFilter, resetBindCounter };
