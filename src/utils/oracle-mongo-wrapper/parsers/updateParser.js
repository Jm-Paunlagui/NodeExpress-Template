"use strict";

/**
 * @fileoverview Translates MongoDB-style update operators into Oracle SQL SET clauses
 * with parameterized bind variables (prefixed with `upd_`).
 */

const { quoteIdentifier } = require("../utils");

let _updCounter = 0;

function _bindName(prefix) {
    return `upd_${prefix}_${_updCounter++}`;
}

/**
 * Reset update bind counter.
 */
function resetUpdateCounter() {
    _updCounter = 0;
}

/**
 * Parse a MongoDB-style update object into an Oracle SET clause with bind variables.
 *
 * @param {Object} update - e.g. { $set: { name: 'Ana' }, $inc: { count: 1 } }
 * @returns {{ setClause: string, binds: Object }}
 * @throws {Error} If update object is empty or contains $rename
 */
function parseUpdate(update) {
    if (
        !update ||
        typeof update !== "object" ||
        Object.keys(update).length === 0
    ) {
        throw new Error("[updateParser] Update object must not be empty.");
    }

    const parts = [];
    const binds = {};
    let hasOp = false;

    for (const [op, fields] of Object.entries(update)) {
        if (op === "$set") {
            hasOp = true;
            for (const [field, val] of Object.entries(fields)) {
                const bname = _bindName(field);
                binds[bname] = val;
                parts.push(`${quoteIdentifier(field)} = :${bname}`);
            }
        } else if (op === "$unset") {
            hasOp = true;
            for (const field of Object.keys(fields)) {
                parts.push(`${quoteIdentifier(field)} = NULL`);
            }
        } else if (op === "$inc") {
            hasOp = true;
            for (const [field, val] of Object.entries(fields)) {
                const bname = _bindName(field);
                binds[bname] = val;
                parts.push(
                    `${quoteIdentifier(field)} = ${quoteIdentifier(field)} + :${bname}`,
                );
            }
        } else if (op === "$mul") {
            hasOp = true;
            for (const [field, val] of Object.entries(fields)) {
                const bname = _bindName(field);
                binds[bname] = val;
                parts.push(
                    `${quoteIdentifier(field)} = ${quoteIdentifier(field)} * :${bname}`,
                );
            }
        } else if (op === "$min") {
            hasOp = true;
            for (const [field, val] of Object.entries(fields)) {
                const bname = _bindName(field);
                binds[bname] = val;
                parts.push(
                    `${quoteIdentifier(field)} = LEAST(${quoteIdentifier(field)}, :${bname})`,
                );
            }
        } else if (op === "$max") {
            hasOp = true;
            for (const [field, val] of Object.entries(fields)) {
                const bname = _bindName(field);
                binds[bname] = val;
                parts.push(
                    `${quoteIdentifier(field)} = GREATEST(${quoteIdentifier(field)}, :${bname})`,
                );
            }
        } else if (op === "$currentDate") {
            hasOp = true;
            for (const field of Object.keys(fields)) {
                parts.push(`${quoteIdentifier(field)} = SYSDATE`);
            }
        } else if (op === "$rename") {
            throw new Error(
                "[updateParser] $rename is not supported. Use ALTER TABLE to rename columns.",
            );
        } else {
            throw new Error(
                `[updateParser] Unsupported update operator: ${op}`,
            );
        }
    }

    if (!hasOp) {
        throw new Error(
            "[updateParser] Update object must contain at least one operator ($set, $inc, etc.).",
        );
    }

    return {
        setClause: `SET ${parts.join(", ")}`,
        binds,
    };
}

module.exports = { parseUpdate, resetUpdateCounter };
