"use strict";

/**
 * @fileoverview Chainable cursor returned by OracleCollection.find().
 * SQL is only executed when a terminal method is called.
 */

const {
    quoteIdentifier,
    buildOrderBy,
    buildProjection,
    rowToDoc,
} = require("../utils");
const { parseFilter } = require("../parsers/filterParser");

class QueryBuilder {
    /**
     * @param {string} tableName
     * @param {Object} filter - MongoDB-style filter
     * @param {Object} db - db interface from createDb
     * @param {Object} [conn] - Optional raw connection (for session/transaction use)
     * @param {Object} [options] - Initial options (projection, sample, asOf, etc.)
     */
    constructor(tableName, filter, db, conn = null, options = {}) {
        this.tableName = tableName;
        this.filter = filter || {};
        this.db = db;
        this._conn = conn;
        this._sort = options.sort || null;
        this._limit = options.limit || null;
        this._skip = options.skip || null;
        this._projection = options.projection || null;
        this._forUpdate = options.forUpdate || null;
        this._sample = options.sample || null;
        this._asOf = options.asOf || null;
        this._terminated = false;
    }

    _checkTerminated() {
        if (this._terminated) {
            throw new Error(
                "Cannot chain after terminal method has been called.",
            );
        }
    }

    /** @returns {QueryBuilder} */
    sort(sortSpec) {
        this._checkTerminated();
        this._sort = sortSpec;
        return this;
    }

    /** @returns {QueryBuilder} */
    limit(n) {
        this._checkTerminated();
        this._limit = n;
        return this;
    }

    /** @returns {QueryBuilder} */
    skip(n) {
        this._checkTerminated();
        this._skip = n;
        return this;
    }

    /** @returns {QueryBuilder} */
    project(projectionSpec) {
        this._checkTerminated();
        this._projection = projectionSpec;
        return this;
    }

    /** @returns {QueryBuilder} */
    forUpdate(mode) {
        this._checkTerminated();
        this._forUpdate = mode === true ? true : mode;
        return this;
    }

    /**
     * Build the SQL query string and binds without executing.
     * @returns {{ sql: string, binds: Object }}
     */
    _buildSQL() {
        const { whereClause, binds } = parseFilter(this.filter, "t0");

        // Projection
        const proj = buildProjection(this._projection);
        let selectCols = proj.columns;

        // Handle subquery projections
        if (this._projection && typeof this._projection === "object") {
            const subParts = [];
            const regularParts = [];
            for (const [key, val] of Object.entries(this._projection)) {
                if (typeof val === "object" && val !== null && val.$subquery) {
                    const sub = val.$subquery;
                    const subColl = quoteIdentifier(sub.collection);
                    const fnMap = {
                        count: "COUNT(*)",
                        sum: "SUM",
                        avg: "AVG",
                        min: "MIN",
                        max: "MAX",
                    };
                    const fnExpr = fnMap[sub.fn] || "COUNT(*)";

                    // Build correlated WHERE
                    const subWhere = [];
                    if (sub.filter) {
                        for (const [fk, fv] of Object.entries(sub.filter)) {
                            if (typeof fv === "string" && fv.startsWith("$")) {
                                const outerCol = fv.slice(1);
                                subWhere.push(
                                    `${quoteIdentifier(fk)} = t0.${quoteIdentifier(outerCol)}`,
                                );
                            } else {
                                const bname = `sub_${key}_${fk}_${Object.keys(binds).length}`;
                                binds[bname] = fv;
                                subWhere.push(
                                    `${quoteIdentifier(fk)} = :${bname}`,
                                );
                            }
                        }
                    }
                    const subWhereStr =
                        subWhere.length > 0
                            ? ` WHERE ${subWhere.join(" AND ")}`
                            : "";
                    subParts.push(
                        `(SELECT ${fnExpr} FROM ${subColl}${subWhereStr}) AS ${quoteIdentifier(key)}`,
                    );
                } else if (val === 1) {
                    regularParts.push(`t0.${quoteIdentifier(key)}`);
                }
            }

            if (subParts.length > 0) {
                const allParts = [...regularParts, ...subParts];
                selectCols = allParts.join(", ");
            }
        }

        // Handle exclusion projection
        if (proj.isExclusion && proj.excludedCols.length > 0) {
            // We need to query all columns except the excluded ones
            // This requires knowing all columns — use a dynamic approach
            selectCols = "*";
            // We'll post-process exclusions after query, or use approach below
        }

        // Table reference
        let tableRef = `${quoteIdentifier(this.tableName)} t0`;

        // AS OF (flashback)
        if (this._asOf) {
            if (this._asOf.scn) {
                tableRef = `${quoteIdentifier(this.tableName)} AS OF SCN ${Number(this._asOf.scn)} t0`;
            } else if (this._asOf.timestamp) {
                const bname = `asof_ts_${Object.keys(binds).length}`;
                binds[bname] = this._asOf.timestamp;
                tableRef = `${quoteIdentifier(this.tableName)} AS OF TIMESTAMP TO_TIMESTAMP(:${bname}, 'YYYY-MM-DD HH24:MI:SS') t0`;
            }
        }

        // SAMPLE
        if (this._sample) {
            const pct = Number(this._sample.percentage);
            const seedStr =
                this._sample.seed !== undefined
                    ? ` SEED(${Number(this._sample.seed)})`
                    : "";
            tableRef = `${quoteIdentifier(this.tableName)} SAMPLE(${pct})${seedStr} t0`;
        }

        let sql = `SELECT ${selectCols} FROM ${tableRef}`;

        if (whereClause) sql += ` ${whereClause}`;

        // ORDER BY
        if (this._sort) {
            sql += ` ${buildOrderBy(this._sort)}`;
        }

        // OFFSET
        if (this._skip != null) {
            sql += ` OFFSET ${Number(this._skip)} ROWS`;
        }

        // LIMIT
        if (this._limit != null) {
            sql += ` FETCH FIRST ${Number(this._limit)} ROWS ONLY`;
        }

        // FOR UPDATE
        if (this._forUpdate) {
            if (this._forUpdate === "nowait") {
                sql += " FOR UPDATE NOWAIT";
            } else if (this._forUpdate === "skip locked") {
                sql += " FOR UPDATE SKIP LOCKED";
            } else {
                sql += " FOR UPDATE";
            }
        }

        return { sql, binds };
    }

    /**
     * Internal: get just the binds
     */
    _getBinds() {
        return this._buildSQL().binds;
    }

    /**
     * Resolve any Promise values in the filter tree before building SQL.
     * Needed for cases like $inSelect receiving an async distinct() result.
     */
    async _resolveFilterPromises() {
        const resolve = async (obj) => {
            if (obj && typeof obj.then === "function") return await obj;
            if (Array.isArray(obj)) return Promise.all(obj.map(resolve));
            if (obj && typeof obj === "object" && !(obj instanceof Date)) {
                const result = {};
                for (const [k, v] of Object.entries(obj)) {
                    result[k] = await resolve(v);
                }
                return result;
            }
            return obj;
        };
        this.filter = await resolve(this.filter);
    }

    /**
     * Make QueryBuilder thenable so `await find(...)` returns rows directly.
     */
    then(resolve, reject) {
        return this.toArray().then(resolve, reject);
    }

    /**
     * Execute the query.
     * @returns {Promise<Array>}
     */
    async _execute() {
        await this._resolveFilterPromises();
        const { sql, binds } = this._buildSQL();
        const self = this;

        const fn = async (conn) => {
            try {
                const result = await conn.execute(sql, binds, {
                    outFormat: self.db.oracledb.OUT_FORMAT_OBJECT,
                    autoCommit: true,
                });
                let rows = result.rows || [];

                // Handle exclusion projection post-processing
                const proj = buildProjection(self._projection);
                if (proj.isExclusion && proj.excludedCols.length > 0) {
                    rows = rows.map((row) => {
                        const doc = { ...row };
                        for (const col of proj.excludedCols) {
                            delete doc[col];
                        }
                        return doc;
                    });
                }

                return rows;
            } catch (err) {
                throw new Error(
                    `[QueryBuilder._execute] ${err.message}\nSQL: ${sql}`,
                );
            }
        };

        if (this._conn) {
            return fn(this._conn);
        }
        return this.db.withConnection(fn);
    }

    // ─── Terminal Methods ─────────────────────────────────────────

    /**
     * Execute and return all rows as an array.
     * @returns {Promise<Array<Object>>}
     */
    async toArray() {
        this._terminated = true;
        return this._execute();
    }

    /**
     * Execute and call fn for each row.
     * @param {Function} fn
     * @returns {Promise<void>}
     */
    async forEach(fn) {
        this._terminated = true;
        const rows = await this._execute();
        for (const row of rows) fn(row);
    }

    /**
     * Execute and return the first row.
     * @returns {Promise<Object|null>}
     */
    async next() {
        this._terminated = true;
        const original = this._limit;
        this._limit = 1;
        const rows = await this._execute();
        this._limit = original;
        return rows[0] ?? null;
    }

    /**
     * Execute and return whether any row matches.
     * @returns {Promise<boolean>}
     */
    async hasNext() {
        this._terminated = true;
        const original = this._limit;
        this._limit = 1;
        const rows = await this._execute();
        this._limit = original;
        return rows.length > 0;
    }

    /**
     * Execute a COUNT(*) query and return the number.
     * @returns {Promise<number>}
     */
    async count() {
        this._terminated = true;
        const { whereClause, binds } = parseFilter(this.filter, "t0");
        const sql = `SELECT COUNT(*) AS CNT FROM ${quoteIdentifier(this.tableName)} t0 ${whereClause}`;

        const fn = async (conn) => {
            try {
                const result = await conn.execute(sql, binds, {
                    outFormat: this.db.oracledb.OUT_FORMAT_OBJECT,
                    autoCommit: true,
                });
                return Number(result.rows[0].CNT);
            } catch (err) {
                throw new Error(
                    `[QueryBuilder.count] ${err.message}\nSQL: ${sql}`,
                );
            }
        };

        if (this._conn) return fn(this._conn);
        return this.db.withConnection(fn);
    }

    /**
     * Return the SQL string without executing (dry run).
     * @returns {Promise<string>}
     */
    async explain() {
        this._terminated = true;
        const { sql } = this._buildSQL();
        return sql;
    }
}

module.exports = { QueryBuilder };
