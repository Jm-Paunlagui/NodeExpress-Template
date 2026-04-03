"use strict";

/**
 * @fileoverview Subquery builders: scalar, inline view, correlated, EXISTS, IN (SELECT), ANY/ALL.
 * Most subquery logic is integrated into filterParser.js and QueryBuilder.js.
 * This file provides helper utilities for complex subquery construction.
 */

const { quoteIdentifier } = require("../utils");
const { parseFilter } = require("../parsers/filterParser");

/**
 * Build a scalar subquery for use in SELECT projection.
 * @param {Object} spec - { collection, fn, filter, field }
 * @param {string} outerAlias - Alias of the outer table
 * @returns {string} SQL subquery string
 */
function buildScalarSubquery(spec, outerAlias = "t0") {
    const { collection, fn, filter = {}, field } = spec;
    const fnUpper = (fn || "count").toUpperCase();

    // Build WHERE clause, replacing $-refs with outer alias
    const whereParts = [];
    for (const [col, val] of Object.entries(filter)) {
        if (typeof val === "string" && val.startsWith("$")) {
            const outerCol = val.substring(1);
            whereParts.push(
                `${quoteIdentifier(col)} = ${outerAlias}.${quoteIdentifier(outerCol)}`,
            );
        }
    }
    const whereClause =
        whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";

    let aggExpr;
    switch (fnUpper) {
        case "COUNT":
            aggExpr = "COUNT(*)";
            break;
        case "SUM":
            aggExpr = `SUM(${quoteIdentifier(field || col)})`;
            break;
        case "AVG":
            aggExpr = `AVG(${quoteIdentifier(field || col)})`;
            break;
        case "MIN":
            aggExpr = `MIN(${quoteIdentifier(field || col)})`;
            break;
        case "MAX":
            aggExpr = `MAX(${quoteIdentifier(field || col)})`;
            break;
        default:
            aggExpr = "COUNT(*)";
    }

    return `(SELECT ${aggExpr} FROM ${quoteIdentifier(collection)} ${whereClause})`;
}

/**
 * Build an EXISTS subquery.
 * @param {Object} spec - { collection, match }
 * @param {string} outerAlias
 * @returns {string}
 */
function buildExistsSubquery(spec, outerAlias = "t0") {
    const { collection, match } = spec;
    const whereParts = [];
    for (const [col, val] of Object.entries(match)) {
        if (typeof val === "string" && val.startsWith("$")) {
            const outerCol = val.substring(1);
            whereParts.push(
                `${quoteIdentifier(col)} = ${outerAlias}.${quoteIdentifier(outerCol)}`,
            );
        }
    }
    const whereClause =
        whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";
    return `EXISTS (SELECT 1 FROM ${quoteIdentifier(collection)} ${whereClause})`;
}

/**
 * Build a NOT EXISTS subquery.
 * @param {Object} spec - { collection, match }
 * @param {string} outerAlias
 * @returns {string}
 */
function buildNotExistsSubquery(spec, outerAlias = "t0") {
    const inner = buildExistsSubquery(spec, outerAlias);
    return `NOT ${inner}`;
}

/**
 * Build a correlated subquery for comparison operators.
 * @param {Object} spec - { collection, field, aggregate, where }
 * @param {string} outerAlias
 * @returns {string}
 */
function buildCorrelatedSubquery(spec, outerAlias = "t0") {
    const { collection, field, aggregate, where = {} } = spec;
    const aggFn = (aggregate || "$avg").replace("$", "").toUpperCase();
    const aggExpr = `${aggFn}(${quoteIdentifier(field)})`;

    const whereParts = [];
    for (const [col, val] of Object.entries(where)) {
        if (typeof val === "string" && val.startsWith("$outer.")) {
            const outerCol = val.replace("$outer.", "");
            whereParts.push(
                `${quoteIdentifier(col)} = ${outerAlias}.${quoteIdentifier(outerCol)}`,
            );
        }
    }
    const whereClause =
        whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";

    return `(SELECT ${aggExpr} FROM ${quoteIdentifier(collection)} ${whereClause})`;
}

/**
 * Build an IN (SELECT ...) subquery.
 * @param {QueryBuilder} queryBuilder
 * @returns {string}
 */
function buildInSelectSubquery(queryBuilder) {
    const { sql } = queryBuilder._buildSQL();
    return `IN (${sql})`;
}

/**
 * Build an ANY/ALL subquery.
 * @param {Object} spec - { collection, field }
 * @param {string} comparison - 'ANY' | 'ALL'
 * @returns {string}
 */
function buildAnyAllSubquery(spec, comparison = "ANY") {
    const { collection, field } = spec;
    return `${comparison} (SELECT ${quoteIdentifier(field)} FROM ${quoteIdentifier(collection)})`;
}

module.exports = {
    buildScalarSubquery,
    buildExistsSubquery,
    buildNotExistsSubquery,
    buildCorrelatedSubquery,
    buildInSelectSubquery,
    buildAnyAllSubquery,
};
