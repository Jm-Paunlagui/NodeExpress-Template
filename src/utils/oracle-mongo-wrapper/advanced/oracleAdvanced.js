"use strict";

/**
 * @fileoverview Oracle-specific advanced features: CONNECT BY, PIVOT, UNPIVOT,
 * FOR UPDATE, RETURNING, AS OF, LATERAL JOIN, TABLESAMPLE.
 */

const { quoteIdentifier } = require("../utils");
const { parseFilter } = require("../parsers/filterParser");

/**
 * Build a CONNECT BY hierarchical query.
 * @param {string} tableName
 * @param {Object} spec - startWith, connectBy, orderSiblings, maxLevel, includeLevel, includePath
 * @returns {{ sql: string, binds: Object }}
 */
function buildConnectBy(tableName, spec) {
    const {
        startWith,
        connectBy,
        orderSiblings,
        maxLevel,
        includeLevel,
        includePath,
    } = spec;
    const binds = {};

    // SELECT clause
    const selectParts = [];
    if (includeLevel) selectParts.push("LEVEL");
    if (includePath) {
        // Try to find the first field from connectBy keys for SYS_CONNECT_BY_PATH
        const pathCol = Object.keys(connectBy || {})[0] || "NAME";
        selectParts.push(
            `SYS_CONNECT_BY_PATH(${quoteIdentifier(_getNameColumn(spec))}, '/') AS "PATH"`,
        );
    }
    selectParts.push(`${quoteIdentifier(tableName)}.*`);

    // START WITH
    let startWithClause = "";
    if (startWith) {
        const { whereClause: sw, binds: swBinds } = parseFilter(startWith);
        Object.assign(binds, swBinds);
        startWithClause = `START WITH ${sw.replace(/^WHERE\s+/i, "")}`;
    }

    // CONNECT BY
    let connectByClause = "";
    if (connectBy) {
        const parts = [];
        for (const [childCol, priorRef] of Object.entries(connectBy)) {
            if (typeof priorRef === "string" && priorRef.includes("$PRIOR")) {
                const parentCol = priorRef
                    .replace("$PRIOR ", "")
                    .replace("$PRIOR", "");
                parts.push(
                    `PRIOR ${quoteIdentifier(parentCol)} = ${quoteIdentifier(childCol)}`,
                );
            } else {
                parts.push(
                    `${quoteIdentifier(childCol)} = ${quoteIdentifier(priorRef)}`,
                );
            }
        }
        connectByClause = `CONNECT BY NOCYCLE ${parts.join(" AND ")}`;
        if (maxLevel) {
            connectByClause += ` AND LEVEL <= ${Number(maxLevel)}`;
        }
    }

    // ORDER SIBLINGS BY
    let orderSiblingsClause = "";
    if (orderSiblings) {
        const parts = Object.entries(orderSiblings).map(
            ([col, dir]) =>
                `${quoteIdentifier(col)} ${dir === -1 ? "DESC" : "ASC"}`,
        );
        orderSiblingsClause = `ORDER SIBLINGS BY ${parts.join(", ")}`;
    }

    const sql =
        `SELECT ${selectParts.join(", ")} FROM ${quoteIdentifier(tableName)} ${startWithClause} ${connectByClause} ${orderSiblingsClause}`
            .replace(/\s+/g, " ")
            .trim();

    return { sql, binds };
}

/**
 * Build a PIVOT query.
 * @param {string} tableName
 * @param {Object} spec - value, pivotOn, pivotValues, groupBy
 * @returns {{ sql: string, binds: Object }}
 */
function buildPivot(tableName, spec) {
    const { value, pivotOn, pivotValues, groupBy } = spec;
    const binds = {};

    // Determine aggregate function and field
    const [aggOp, aggField] = Object.entries(value)[0];
    const aggFn = aggOp.replace("$", "").toUpperCase();
    const field = aggField.startsWith("$") ? aggField.substring(1) : aggField;

    // Build inner SELECT — only the columns needed for pivot
    const innerCols = [groupBy, pivotOn, field]
        .filter(Boolean)
        .map(quoteIdentifier)
        .join(", ");

    // Build pivot IN clause — sanitize values (PIVOT IN cannot use bind variables)
    const pivotIn = pivotValues
        .map((v) => {
            const safe = String(v).replace(/'/g, "''");
            return `'${safe}' AS ${quoteIdentifier(v)}`;
        })
        .join(", ");

    const sql = `SELECT * FROM (SELECT ${innerCols} FROM ${quoteIdentifier(tableName)}) PIVOT (${aggFn}(${quoteIdentifier(field)}) FOR ${quoteIdentifier(pivotOn)} IN (${pivotIn}))`;

    return { sql, binds };
}

/**
 * Build an UNPIVOT query.
 * @param {string} tableName
 * @param {Object} spec - valueColumn, nameColumn, columns, includeNulls
 * @returns {{ sql: string, binds: Object }}
 */
function buildUnpivot(tableName, spec) {
    const { valueColumn, nameColumn, columns, includeNulls = false } = spec;
    const nullHandling = includeNulls ? "INCLUDE NULLS" : "EXCLUDE NULLS";
    const colList = columns.map(quoteIdentifier).join(", ");

    const sql = `SELECT * FROM ${quoteIdentifier(tableName)} UNPIVOT ${nullHandling} (${quoteIdentifier(valueColumn)} FOR ${quoteIdentifier(nameColumn)} IN (${colList}))`;

    return { sql, binds: {} };
}

/**
 * Try to determine a name column from spec for SYS_CONNECT_BY_PATH.
 */
function _getNameColumn(spec) {
    if (spec.connectBy) {
        const keys = Object.keys(spec.connectBy);
        // Use a heuristic: first key that looks like 'name'
        const nameCol = keys.find((k) => k.toLowerCase().includes("name"));
        if (nameCol) return nameCol;
    }
    return "NAME";
}

module.exports = { buildConnectBy, buildPivot, buildUnpivot };
