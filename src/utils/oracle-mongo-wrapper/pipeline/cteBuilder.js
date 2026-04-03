"use strict";

/**
 * @fileoverview CTE builders: withCTE (regular) and withRecursiveCTE (recursive/hierarchical).
 * Exposed as standalone functions accepting a db instance.
 */

const { quoteIdentifier } = require("../utils");

/**
 * Build a regular CTE from named QueryBuilder instances.
 * Returns a chainable CTE result with .from(), .join(), .toArray().
 *
 * @param {Object} db - db interface from createDb
 * @param {Object} cteDefs - { name: QueryBuilder, ... }
 * @returns {CTEResult}
 */
function withCTE(db, cteDefs) {
    return new CTEResult(db, cteDefs);
}

/**
 * Build a recursive CTE for hierarchical data.
 *
 * @param {Object} db
 * @param {string} cteName
 * @param {Object} def - { anchor: QueryBuilder, recursive: { collection, joinOn } }
 * @returns {RecursiveCTEResult}
 */
function withRecursiveCTE(db, cteName, def) {
    return new RecursiveCTEResult(db, cteName, def);
}

/**
 * Chainable result for regular CTEs.
 */
class CTEResult {
    constructor(db, cteDefs) {
        this._db = db;
        this._cteDefs = cteDefs;
        this._from = null;
        this._join = null;
        this._sort = null;
        this._limitVal = null;
        this._skipVal = null;
    }

    from(cteName) {
        this._from = cteName;
        return this;
    }

    join(joinSpec) {
        this._join = joinSpec;
        return this;
    }

    sort(sortSpec) {
        this._sort = sortSpec;
        return this;
    }

    limit(n) {
        this._limitVal = n;
        return this;
    }

    skip(n) {
        this._skipVal = n;
        return this;
    }

    _buildSQL() {
        const withParts = [];
        const allBinds = {};

        for (const [name, qb] of Object.entries(this._cteDefs)) {
            const { sql, binds } = qb._buildSQL();
            Object.assign(allBinds, binds);
            withParts.push(`${quoteIdentifier(name)} AS (${sql})`);
        }

        const fromSource = this._from
            ? quoteIdentifier(this._from)
            : Object.keys(this._cteDefs)[0];

        let selectSql = `SELECT * FROM ${fromSource}`;

        if (this._join) {
            const {
                from: joinFrom,
                localField,
                foreignField,
                joinType = "inner",
            } = this._join;
            const jt = _resolveJoinType(joinType);
            selectSql = `SELECT ${fromSource}.*, ${quoteIdentifier(joinFrom)}.* FROM ${fromSource} ${jt} ${quoteIdentifier(joinFrom)} ON ${fromSource}.${quoteIdentifier(localField)} = ${quoteIdentifier(joinFrom)}.${quoteIdentifier(foreignField)}`;
        }

        if (this._sort) {
            const orderBy = Object.entries(this._sort)
                .map(
                    ([col, dir]) =>
                        `${quoteIdentifier(col)} ${dir === -1 ? "DESC" : "ASC"}`,
                )
                .join(", ");
            selectSql += ` ORDER BY ${orderBy}`;
        }

        if (this._skipVal != null) {
            selectSql += ` OFFSET ${this._skipVal} ROWS`;
        }
        if (this._limitVal != null) {
            selectSql += ` FETCH FIRST ${this._limitVal} ROWS ONLY`;
        }

        const sql = `WITH ${withParts.join(",\n     ")}\n${selectSql}`;
        return { sql, binds: allBinds };
    }

    async toArray() {
        const { sql, binds } = this._buildSQL();
        return this._db.withConnection(async (conn) => {
            try {
                const result = await conn.execute(sql, binds, {
                    outFormat: this._db.oracledb.OUT_FORMAT_OBJECT,
                    autoCommit: true,
                });
                return result.rows || [];
            } catch (err) {
                throw new Error(
                    `[CTEResult.toArray] ${err.message}\nSQL: ${sql}`,
                );
            }
        });
    }
}

/**
 * Chainable result for recursive CTEs.
 */
class RecursiveCTEResult {
    constructor(db, cteName, def) {
        this._db = db;
        this._cteName = cteName;
        this._def = def;
        this._sort = null;
        this._limitVal = null;
        this._skipVal = null;
    }

    sort(sortSpec) {
        this._sort = sortSpec;
        return this;
    }

    limit(n) {
        this._limitVal = n;
        return this;
    }

    skip(n) {
        this._skipVal = n;
        return this;
    }

    _buildSQL(colNames = []) {
        const { anchor, recursive } = this._def;
        const allBinds = {};

        // Anchor query
        const { sql: anchorSql, binds: anchorBinds } = anchor._buildSQL();
        Object.assign(allBinds, anchorBinds);

        // Recursive part
        const recTable = recursive.collection;
        const joinParts = Object.entries(recursive.joinOn)
            .map(([childCol, parentRef]) => {
                const parentCol = parentRef.replace(`$${this._cteName}.`, "");
                return `e.${quoteIdentifier(childCol)} = o.${quoteIdentifier(parentCol)}`;
            })
            .join(" AND ");

        // Use explicit column names to avoid ORA-01789 column count mismatches
        let anchorWrapped;
        let recursiveSql;

        if (colNames.length > 0) {
            // Explicit column references — more reliable than wildcards in recursive CTEs
            const anchorCols = colNames
                .map((c) => `t0.${quoteIdentifier(c)}`)
                .join(", ");
            const recCols = colNames
                .map((c) => `e.${quoteIdentifier(c)}`)
                .join(", ");

            // Replace SELECT clause in anchor to use explicit columns + LVL
            anchorWrapped = anchorSql.replace(
                /SELECT\s+(?:\S+\.\*)?\*?\s+FROM/i,
                `SELECT ${anchorCols}, 1 AS "LVL" FROM`,
            );

            recursiveSql = `SELECT ${recCols}, o."LVL" + 1 AS "LVL" FROM ${quoteIdentifier(recTable)} e JOIN ${quoteIdentifier(this._cteName)} o ON ${joinParts}`;
        } else {
            // Fallback: use wildcard approach
            anchorWrapped = anchorSql;
            if (/SELECT\s+\*\s+FROM/i.test(anchorWrapped)) {
                anchorWrapped = anchorWrapped.replace(
                    /SELECT\s+\*\s+FROM/i,
                    'SELECT t0.*, 1 AS "LVL" FROM',
                );
            } else if (/SELECT\s+\S+\.\*\s+FROM/i.test(anchorWrapped)) {
                anchorWrapped = anchorWrapped.replace(
                    /SELECT\s+(\S+\.\*)\s+FROM/i,
                    'SELECT $1, 1 AS "LVL" FROM',
                );
            } else {
                anchorWrapped = anchorWrapped
                    .replace(/^SELECT\s+/i, "SELECT ")
                    .replace(/FROM/i, ', 1 AS "LVL" FROM');
            }
            recursiveSql = `SELECT e.*, o."LVL" + 1 AS "LVL" FROM ${quoteIdentifier(recTable)} e JOIN ${quoteIdentifier(this._cteName)} o ON ${joinParts}`;
        }

        let selectSql = `SELECT * FROM ${quoteIdentifier(this._cteName)}`;

        if (this._sort) {
            const orderBy = Object.entries(this._sort)
                .map(
                    ([col, dir]) =>
                        `${quoteIdentifier(col)} ${dir === -1 ? "DESC" : "ASC"}`,
                )
                .join(", ");
            selectSql += ` ORDER BY ${orderBy}`;
        }
        if (this._skipVal != null) {
            selectSql += ` OFFSET ${this._skipVal} ROWS`;
        }
        if (this._limitVal != null) {
            selectSql += ` FETCH FIRST ${this._limitVal} ROWS ONLY`;
        }

        // Oracle requires a column alias list for recursive CTEs
        const cteColList =
            colNames.length > 0
                ? ` (${colNames.map((c) => quoteIdentifier(c)).join(", ")}, "LVL")`
                : "";

        const sql = `WITH ${quoteIdentifier(this._cteName)}${cteColList} AS (\n  ${anchorWrapped}\n  UNION ALL\n  ${recursiveSql}\n)\n${selectSql}`;

        return { sql, binds: allBinds };
    }

    async toArray() {
        // Fetch column names from anchor table to build CTE column alias list
        const anchorTableName = this._def.anchor.tableName;
        const colNames = await this._db.withConnection(async (conn) => {
            const result = await conn.execute(
                `SELECT COLUMN_NAME FROM USER_TAB_COLUMNS WHERE TABLE_NAME = UPPER(:t) ORDER BY COLUMN_ID`,
                { t: anchorTableName },
                { outFormat: this._db.oracledb.OUT_FORMAT_OBJECT },
            );
            return result.rows.map((r) => r.COLUMN_NAME);
        });

        const { sql, binds } = this._buildSQL(colNames);
        return this._db.withConnection(async (conn) => {
            try {
                const result = await conn.execute(sql, binds, {
                    outFormat: this._db.oracledb.OUT_FORMAT_OBJECT,
                    autoCommit: true,
                });
                return result.rows || [];
            } catch (err) {
                throw new Error(
                    `[RecursiveCTEResult.toArray] ${err.message}\nSQL: ${sql}`,
                );
            }
        });
    }
}

function _resolveJoinType(type) {
    switch ((type || "inner").toLowerCase()) {
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
        default:
            return "INNER JOIN";
    }
}

module.exports = { withCTE, withRecursiveCTE };
