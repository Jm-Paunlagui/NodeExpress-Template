"use strict";

/**
 * @fileoverview Translates $lookup stage → Oracle SQL JOIN clauses.
 */

const { quoteIdentifier } = require("../utils");

/**
 * Build a JOIN SQL fragment from a $lookup spec.
 * @param {string} source - Current source table/alias (already quoted)
 * @param {Object} lookup - $lookup stage spec
 * @returns {string} Full SELECT with JOIN
 */
function buildJoinSQL(source, lookup) {
    const {
        from,
        localField,
        foreignField,
        as,
        joinType = "left",
        on,
    } = lookup;
    const joinAlias = as || from;
    const jt = _resolveJoinType(joinType);

    let onClause;
    if (on && Array.isArray(on)) {
        // Multi-condition join
        onClause = on
            .map(
                (cond) =>
                    `${source}.${quoteIdentifier(cond.localField)} = ${quoteIdentifier(joinAlias)}.${quoteIdentifier(cond.foreignField)}`,
            )
            .join(" AND ");
    } else if (joinType === "self") {
        // Self-join
        return `SELECT t1.*, t2.* FROM ${quoteIdentifier(from)} t1 INNER JOIN ${quoteIdentifier(from)} t2 ON t1.${quoteIdentifier(foreignField)} = t2.${quoteIdentifier(localField)}`;
    } else if (joinType === "natural") {
        return `SELECT * FROM ${source} NATURAL JOIN ${quoteIdentifier(from)}`;
    } else if (joinType === "cross") {
        return `SELECT ${source}.*, ${quoteIdentifier(joinAlias)}.* FROM ${source} CROSS JOIN ${quoteIdentifier(from)} ${quoteIdentifier(joinAlias)}`;
    } else {
        onClause = `${source}.${quoteIdentifier(localField)} = ${quoteIdentifier(joinAlias)}.${quoteIdentifier(foreignField)}`;
    }

    return `SELECT ${source}.*, ${quoteIdentifier(joinAlias)}.* FROM ${source} ${jt} ${quoteIdentifier(from)} ${quoteIdentifier(joinAlias)} ON ${onClause}`;
}

function _resolveJoinType(type) {
    switch ((type || "left").toLowerCase()) {
        case "left":
            return "LEFT OUTER JOIN";
        case "right":
            return "RIGHT OUTER JOIN";
        case "full":
            return "FULL OUTER JOIN";
        case "inner":
            return "INNER JOIN";
        case "cross":
            return "CROSS JOIN";
        case "self":
            return "INNER JOIN";
        case "natural":
            return "NATURAL JOIN";
        default:
            return "LEFT OUTER JOIN";
    }
}

module.exports = { buildJoinSQL };
