"use strict";

/**
 * @fileoverview Translates MongoDB-style update operators into Oracle SQL SET clauses
 * with parameterized bind variables (prefixed with `upd_`).
 */

const { quoteIdentifier } = require("../utils");
const {
    oracleMongoWrapperMessages: MSG,
} = require("../../../constants/messages");

/**
 * Create a per-call counter for unique bind variable names.
 * @returns {{ next: (prefix: string) => string }}
 */
function _createCounter() {
    let c = 0;
    return {
        next(prefix) {
            return `upd_${prefix}_${c++}`;
        },
    };
}

/**
 * Reset update bind counter (no-op — retained for backward compatibility).
 */
function resetUpdateCounter() {}

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
        throw new Error(MSG.UPDATE_EMPTY);
    }

    const counter = _createCounter();
    const parts = [];
    const binds = {};
    let hasOp = false;

    for (const [op, fields] of Object.entries(update)) {
        if (op === "$set") {
            hasOp = true;
            for (const [field, val] of Object.entries(fields)) {
                const bname = counter.next(field);
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
                const bname = counter.next(field);
                binds[bname] = val;
                parts.push(
                    `${quoteIdentifier(field)} = ${quoteIdentifier(field)} + :${bname}`,
                );
            }
        } else if (op === "$mul") {
            hasOp = true;
            for (const [field, val] of Object.entries(fields)) {
                const bname = counter.next(field);
                binds[bname] = val;
                parts.push(
                    `${quoteIdentifier(field)} = ${quoteIdentifier(field)} * :${bname}`,
                );
            }
        } else if (op === "$min") {
            hasOp = true;
            for (const [field, val] of Object.entries(fields)) {
                const bname = counter.next(field);
                binds[bname] = val;
                parts.push(
                    `${quoteIdentifier(field)} = LEAST(${quoteIdentifier(field)}, :${bname})`,
                );
            }
        } else if (op === "$max") {
            hasOp = true;
            for (const [field, val] of Object.entries(fields)) {
                const bname = counter.next(field);
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
            throw new Error(MSG.UPDATE_RENAME_NOT_SUPPORTED);
        } else {
            throw new Error(MSG.UPDATE_UNSUPPORTED_OPERATOR(op));
        }
    }

    if (!hasOp) {
        throw new Error(MSG.UPDATE_NO_OPERATOR);
    }

    return {
        setClause: `SET ${parts.join(", ")}`,
        binds,
    };
}

module.exports = { parseUpdate, resetUpdateCounter };
