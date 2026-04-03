"use strict";

/**
 * @fileoverview Translates $window expressions → Oracle analytic function SQL.
 */

const { quoteIdentifier } = require("../utils");

/**
 * Build a window/analytic function expression.
 * @param {Object} spec - { fn, field, partitionBy, orderBy, offset, n, frame }
 * @returns {string} SQL analytic expression
 */
function buildWindowExpr(spec) {
    const { fn, field, partitionBy, orderBy, offset, n, frame } = spec;

    // Build OVER clause
    const overParts = [];
    if (partitionBy) {
        const partCols = Array.isArray(partitionBy)
            ? partitionBy.map(quoteIdentifier).join(", ")
            : quoteIdentifier(partitionBy);
        overParts.push(`PARTITION BY ${partCols}`);
    }
    if (orderBy) {
        const orderCols = Object.entries(orderBy)
            .map(
                ([col, dir]) =>
                    `${quoteIdentifier(col)} ${dir === -1 ? "DESC" : "ASC"}`,
            )
            .join(", ");
        overParts.push(`ORDER BY ${orderCols}`);
    }
    if (frame) {
        overParts.push(frame);
    }

    const overClause =
        overParts.length > 0 ? `OVER (${overParts.join(" ")})` : "OVER ()";

    // Build function call
    const fnUpper = fn.toUpperCase();
    switch (fnUpper) {
        case "ROW_NUMBER":
            return `ROW_NUMBER() ${overClause}`;
        case "RANK":
            return `RANK() ${overClause}`;
        case "DENSE_RANK":
            return `DENSE_RANK() ${overClause}`;
        case "NTILE":
            return `NTILE(${n || 4}) ${overClause}`;
        case "LAG":
            return `LAG(${quoteIdentifier(field)}, ${offset || 1}) ${overClause}`;
        case "LEAD":
            return `LEAD(${quoteIdentifier(field)}, ${offset || 1}) ${overClause}`;
        case "FIRST_VALUE":
            return `FIRST_VALUE(${quoteIdentifier(field)}) ${overClause}`;
        case "LAST_VALUE":
            return `LAST_VALUE(${quoteIdentifier(field)}) ${overClause}`;
        case "NTH_VALUE":
            return `NTH_VALUE(${quoteIdentifier(field)}, ${n || 1}) ${overClause}`;
        case "SUM":
            return `SUM(${field === "*" ? "*" : quoteIdentifier(field)}) ${overClause}`;
        case "AVG":
            return `AVG(${field === "*" ? "*" : quoteIdentifier(field)}) ${overClause}`;
        case "COUNT":
            return `COUNT(${field === "*" ? "*" : quoteIdentifier(field)}) ${overClause}`;
        case "MIN":
            return `MIN(${quoteIdentifier(field)}) ${overClause}`;
        case "MAX":
            return `MAX(${quoteIdentifier(field)}) ${overClause}`;
        default:
            return `${fnUpper}(${field ? quoteIdentifier(field) : ""}) ${overClause}`;
    }
}

module.exports = { buildWindowExpr };
