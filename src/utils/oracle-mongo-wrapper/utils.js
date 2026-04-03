"use strict";

/**
 * @fileoverview Shared helpers for the oracle-mongo-wrapper library.
 */

/**
 * Wrap an identifier in double quotes to handle Oracle reserved words and case sensitivity.
 * @param {string} name - Column or table name
 * @returns {string} Quoted identifier, e.g. `"STATUS"`
 */
function quoteIdentifier(name) {
    return `"${name}"`;
}

/**
 * Coerce Oracle number strings back to JavaScript numbers.
 * Leaves non-numeric strings untouched.
 * @param {Object} row - A row object from Oracle
 * @returns {Object} Row with numeric strings converted to numbers
 */
function convertTypes(row) {
    if (!row || typeof row !== "object") return row;
    const out = {};
    for (const [key, val] of Object.entries(row)) {
        if (
            typeof val === "string" &&
            val !== "" &&
            !isNaN(val) &&
            val.trim() !== ""
        ) {
            const n = Number(val);
            out[key] = isFinite(n) ? n : val;
        } else {
            out[key] = val;
        }
    }
    return out;
}

/**
 * Convert an Oracle row object through convertTypes (alias for clarity).
 * @param {Object} row - Oracle row
 * @returns {Object} Cleaned document
 */
function rowToDoc(row) {
    return convertTypes(row);
}

/**
 * Merge two bind objects, throwing on key collisions.
 * @param {Object} a - First bind object
 * @param {Object} b - Second bind object
 * @returns {Object} Merged binds
 */
function mergeBinds(a, b) {
    const merged = { ...a };
    for (const [k, v] of Object.entries(b)) {
        if (k in merged) {
            throw new Error(
                `Bind key collision: "${k}" exists in both bind objects.`,
            );
        }
        merged[k] = v;
    }
    return merged;
}

/**
 * Build the ORDER BY clause from a sort spec object.
 * @param {Object} sortSpec - e.g. { NAME: 1, AGE: -1 }
 * @returns {string} e.g. `ORDER BY "NAME" ASC, "AGE" DESC`
 */
function buildOrderBy(sortSpec) {
    if (
        !sortSpec ||
        typeof sortSpec !== "object" ||
        Object.keys(sortSpec).length === 0
    ) {
        return "";
    }
    const parts = Object.entries(sortSpec).map(([col, dir]) => {
        return `${quoteIdentifier(col)} ${dir === -1 ? "DESC" : "ASC"}`;
    });
    return `ORDER BY ${parts.join(", ")}`;
}

/**
 * Build SELECT column list from a projection spec.
 * @param {Object} projection - e.g. { NAME: 1, EMAIL: 1 } or { STATUS: 0 }
 * @param {string} tableName - Table name for exclude mode
 * @param {Object} db - db interface for column introspection
 * @returns {{ columns: string, isExclusion: boolean, excludedCols: string[] }}
 */
function buildProjection(projection) {
    if (
        !projection ||
        typeof projection !== "object" ||
        Object.keys(projection).length === 0
    ) {
        return { columns: "*", isExclusion: false, excludedCols: [] };
    }

    const entries = Object.entries(projection);
    const isExclusion = entries.some(([, v]) => v === 0);

    if (isExclusion) {
        const excludedCols = entries.filter(([, v]) => v === 0).map(([k]) => k);
        return { columns: "*", isExclusion: true, excludedCols };
    }

    // Inclusion mode — only include listed columns
    const cols = entries
        .filter(([, v]) => v === 1 || typeof v === "object")
        .map(([k]) => quoteIdentifier(k));

    return {
        columns: cols.length > 0 ? cols.join(", ") : "*",
        isExclusion: false,
        excludedCols: [],
    };
}

module.exports = {
    quoteIdentifier,
    convertTypes,
    rowToDoc,
    mergeBinds,
    buildOrderBy,
    buildProjection,
};
