"use strict";

/**
 * @fileoverview Core CRUD + advanced query methods mirroring MongoDB's Collection API.
 * All methods use db.withConnection() or db.withTransaction() — never manual connection management.
 */

const { quoteIdentifier, mergeBinds, rowToDoc } = require("../utils");
const { parseFilter } = require("../parsers/filterParser");
const { parseUpdate } = require("../parsers/updateParser");
const { QueryBuilder } = require("./QueryBuilder");
const {
    oracleMongoWrapperMessages: MSG,
} = require("../../../constants/messages");

class OracleCollection {
    /**
     * @param {string} tableName - Oracle table name
     * @param {Object} db - db interface from createDb
     * @param {Object} [_conn] - Optional raw connection (for transaction/session use)
     */
    constructor(tableName, db, _conn = null) {
        this.tableName = tableName;
        this.db = db;
        this._conn = _conn;
    }

    /**
     * Internal: execute a callback with a managed connection or the session conn.
     * @param {Function} fn - async (conn) => result
     */
    async _execute(fn) {
        if (this._conn) return fn(this._conn);
        return this.db.withConnection(fn);
    }

    // ─── Query / Read ─────────────────────────────────────────────

    /**
     * Returns a QueryBuilder (chainable cursor). SQL is executed on terminal call.
     * @param {Object} filter - MongoDB-style filter
     * @param {Object} [options] - sort, limit, skip, projection, forUpdate, sample, asOf
     * @returns {QueryBuilder}
     */
    find(filter = {}, options = {}) {
        const qb = new QueryBuilder(
            this.tableName,
            filter,
            this.db,
            this._conn,
            options,
        );
        if (options.sort) qb.sort(options.sort);
        if (options.limit != null) qb.limit(options.limit);
        if (options.skip != null) qb.skip(options.skip);
        if (options.projection) qb.project(options.projection);
        if (options.forUpdate) qb.forUpdate(options.forUpdate);
        return qb;
    }

    /**
     * Find a single document matching filter.
     * @param {Object} filter
     * @param {Object} [options]
     * @returns {Promise<Object|null>}
     */
    async findOne(filter, options = {}) {
        return this._execute(async (conn) => {
            const { whereClause, binds } = parseFilter(filter);
            const sql = `SELECT * FROM ${quoteIdentifier(this.tableName)} ${whereClause} FETCH FIRST 1 ROW ONLY`;
            try {
                const result = await conn.execute(sql, binds, {
                    outFormat: this.db.oracledb.OUT_FORMAT_OBJECT,
                    autoCommit: !this._conn,
                });
                return result.rows[0] ?? null;
            } catch (err) {
                throw new Error(
                    MSG.wrapError("OracleCollection.findOne", err, sql, binds),
                );
            }
        });
    }

    /**
     * Find one document, update it, and return before/after.
     * @param {Object} filter
     * @param {Object} update - MongoDB-style update operators
     * @param {Object} [options] - returnDocument ('before'|'after'), upsert
     * @returns {Promise<Object|null>}
     */
    async findOneAndUpdate(filter, update, options = {}) {
        return this._execute(async (conn) => {
            const { whereClause, binds: filterBinds } = parseFilter(filter);

            // Find current doc
            const selectSql = `SELECT * FROM ${quoteIdentifier(this.tableName)} ${whereClause} FETCH FIRST 1 ROW ONLY`;
            const found = await conn.execute(selectSql, filterBinds, {
                outFormat: this.db.oracledb.OUT_FORMAT_OBJECT,
            });

            const beforeDoc = found.rows[0] ?? null;

            if (!beforeDoc && options.upsert) {
                // Upsert: insert
                const fields = {};
                if (update.$set) Object.assign(fields, update.$set);
                // Also include filter as fields for the insert
                for (const [k, v] of Object.entries(filter)) {
                    if (typeof v !== "object") fields[k] = v;
                }
                const cols = Object.keys(fields);
                const vals = cols.map((_, i) => `:v${i}`);
                const insertBinds = {};
                cols.forEach((c, i) => {
                    insertBinds[`v${i}`] = fields[c];
                });
                const insertSql = `INSERT INTO ${quoteIdentifier(this.tableName)} (${cols.map(quoteIdentifier).join(", ")}) VALUES (${vals.join(", ")})`;
                await conn.execute(insertSql, insertBinds, {
                    autoCommit: !this._conn,
                });

                if (options.returnDocument === "after") {
                    const afterResult = await conn.execute(
                        selectSql,
                        filterBinds,
                        {
                            outFormat: this.db.oracledb.OUT_FORMAT_OBJECT,
                        },
                    );
                    return afterResult.rows[0] ?? null;
                }
                return null;
            }

            if (!beforeDoc) return null;

            // Build update
            const { setClause, binds: updateBinds } = parseUpdate(update);
            const allBinds = mergeBinds(filterBinds, updateBinds);
            const updateSql = `UPDATE ${quoteIdentifier(this.tableName)} ${setClause} ${whereClause}`;

            try {
                await conn.execute(updateSql, allBinds, {
                    autoCommit: !this._conn,
                });
            } catch (err) {
                throw new Error(
                    MSG.wrapError(
                        "OracleCollection.findOneAndUpdate",
                        err,
                        updateSql,
                    ),
                );
            }

            if (options.returnDocument === "after") {
                // Re-select after update — use filter or original ID
                const afterFilter =
                    beforeDoc.ID != null ? { ID: beforeDoc.ID } : filter;
                const { whereClause: afterWhere, binds: afterBinds } =
                    parseFilter(afterFilter);
                const afterSql = `SELECT * FROM ${quoteIdentifier(this.tableName)} ${afterWhere} FETCH FIRST 1 ROW ONLY`;
                const afterResult = await conn.execute(afterSql, afterBinds, {
                    outFormat: this.db.oracledb.OUT_FORMAT_OBJECT,
                });
                return afterResult.rows[0] ?? null;
            }

            return beforeDoc;
        });
    }

    /**
     * Find a document, delete it, and return the deleted document.
     * @param {Object} filter
     * @returns {Promise<Object|null>}
     */
    async findOneAndDelete(filter) {
        return this._execute(async (conn) => {
            const { whereClause, binds } = parseFilter(filter);
            const selectSql = `SELECT * FROM ${quoteIdentifier(this.tableName)} ${whereClause} FETCH FIRST 1 ROW ONLY`;

            const found = await conn.execute(selectSql, binds, {
                outFormat: this.db.oracledb.OUT_FORMAT_OBJECT,
            });
            const doc = found.rows[0] ?? null;
            if (!doc) return null;

            const deleteSql = `DELETE FROM ${quoteIdentifier(this.tableName)} WHERE ROWID = (SELECT ROWID FROM ${quoteIdentifier(this.tableName)} ${whereClause} AND ROWNUM = 1)`;
            try {
                await conn.execute(deleteSql, binds, {
                    autoCommit: !this._conn,
                });
            } catch (err) {
                throw new Error(
                    MSG.wrapError(
                        "OracleCollection.findOneAndDelete",
                        err,
                        deleteSql,
                    ),
                );
            }
            return doc;
        });
    }

    /**
     * Find a document, replace it entirely (except PK), and return before/after.
     * @param {Object} filter
     * @param {Object} replacement - Full replacement document
     * @param {Object} [options] - returnDocument
     * @returns {Promise<Object|null>}
     */
    async findOneAndReplace(filter, replacement, options = {}) {
        return this._execute(async (conn) => {
            const { whereClause, binds: filterBinds } = parseFilter(filter);
            const selectSql = `SELECT * FROM ${quoteIdentifier(this.tableName)} ${whereClause} FETCH FIRST 1 ROW ONLY`;

            const found = await conn.execute(selectSql, filterBinds, {
                outFormat: this.db.oracledb.OUT_FORMAT_OBJECT,
            });
            const beforeDoc = found.rows[0] ?? null;
            if (!beforeDoc) return null;

            // Build SET from replacement (exclude ID/primary key)
            const cols = Object.keys(replacement).filter((c) => c !== "ID");
            const setParts = [];
            const replBinds = {};
            cols.forEach((c, i) => {
                const bname = `repl_${i}`;
                replBinds[bname] = replacement[c];
                setParts.push(`${quoteIdentifier(c)} = :${bname}`);
            });

            const allBinds = mergeBinds(filterBinds, replBinds);
            const updateSql = `UPDATE ${quoteIdentifier(this.tableName)} SET ${setParts.join(", ")} ${whereClause}`;

            try {
                await conn.execute(updateSql, allBinds, {
                    autoCommit: !this._conn,
                });
            } catch (err) {
                throw new Error(
                    MSG.wrapError(
                        "OracleCollection.findOneAndReplace",
                        err,
                        updateSql,
                    ),
                );
            }

            if (options.returnDocument === "after") {
                const afterFilter =
                    beforeDoc.ID != null ? { ID: beforeDoc.ID } : filter;
                const { whereClause: aw, binds: ab } = parseFilter(afterFilter);
                const afterSql = `SELECT * FROM ${quoteIdentifier(this.tableName)} ${aw} FETCH FIRST 1 ROW ONLY`;
                const afterResult = await conn.execute(afterSql, ab, {
                    outFormat: this.db.oracledb.OUT_FORMAT_OBJECT,
                });
                return afterResult.rows[0] ?? null;
            }
            return beforeDoc;
        });
    }

    /**
     * Count documents matching filter.
     * @param {Object} filter
     * @returns {Promise<number>}
     */
    async countDocuments(filter = {}) {
        return this._execute(async (conn) => {
            const { whereClause, binds } = parseFilter(filter);
            const sql = `SELECT COUNT(*) AS CNT FROM ${quoteIdentifier(this.tableName)} ${whereClause}`;
            try {
                const result = await conn.execute(sql, binds, {
                    outFormat: this.db.oracledb.OUT_FORMAT_OBJECT,
                    autoCommit: !this._conn,
                });
                return Number(result.rows[0].CNT);
            } catch (err) {
                throw new Error(
                    MSG.wrapError(
                        "OracleCollection.countDocuments",
                        err,
                        sql,
                        binds,
                    ),
                );
            }
        });
    }

    /**
     * Fast estimated count from USER_TABLES metadata.
     * @returns {Promise<number>}
     */
    async estimatedDocumentCount() {
        return this._execute(async (conn) => {
            const sql = `SELECT NUM_ROWS FROM USER_TABLES WHERE TABLE_NAME = UPPER(:name)`;
            try {
                const result = await conn.execute(
                    sql,
                    { name: this.tableName },
                    {
                        outFormat: this.db.oracledb.OUT_FORMAT_OBJECT,
                        autoCommit: !this._conn,
                    },
                );
                return Number(result.rows[0]?.NUM_ROWS ?? 0);
            } catch (err) {
                throw new Error(
                    MSG.wrapError(
                        "OracleCollection.estimatedDocumentCount",
                        err,
                        sql,
                    ),
                );
            }
        });
    }

    /**
     * Get distinct values of a field.
     * @param {string} field - Column name
     * @param {Object} [filter] - Optional filter
     * @returns {Promise<Array>}
     */
    async distinct(field, filter = {}) {
        return this._execute(async (conn) => {
            const { whereClause, binds } = parseFilter(filter);
            const sql = `SELECT DISTINCT ${quoteIdentifier(field)} FROM ${quoteIdentifier(this.tableName)} ${whereClause}`;
            try {
                const result = await conn.execute(sql, binds, {
                    outFormat: this.db.oracledb.OUT_FORMAT_OBJECT,
                    autoCommit: !this._conn,
                });
                return result.rows.map((r) => r[field]);
            } catch (err) {
                throw new Error(
                    MSG.wrapError("OracleCollection.distinct", err, sql, binds),
                );
            }
        });
    }

    // ─── Insert Operations ───────────────────────────────────────

    /**
     * Insert a single document.
     * @param {Object} document
     * @param {Object} [options] - returning: ['col1', 'col2']
     * @returns {Promise<{ acknowledged: boolean, insertedId: *, returning?: Object }>}
     */
    async insertOne(document, options = {}) {
        return this._execute(async (conn) => {
            const cols = Object.keys(document);
            const bindNames = cols.map((_, i) => `:v${i}`);
            const binds = {};
            cols.forEach((c, i) => {
                binds[`v${i}`] = document[c];
            });

            // RETURNING clause
            let returningSql = "";
            const outBinds = {};
            const returningCols = options.returning || [];
            if (returningCols.length > 0) {
                const retCols = returningCols.map(quoteIdentifier).join(", ");
                const retOuts = returningCols
                    .map((c) => `:out_${c}`)
                    .join(", ");
                returningSql = ` RETURNING ${retCols} INTO ${retOuts}`;
                for (const c of returningCols) {
                    outBinds[`out_${c}`] = { dir: this.db.oracledb.BIND_OUT };
                }
            }

            // Always return ID
            const hasIdCol = cols.some((c) => c.toUpperCase() === "ID");
            if (!hasIdCol && !returningCols.includes("ID")) {
                returningSql = returningSql || ` RETURNING "ID" INTO :out_id`;
                if (!returningSql.includes("out_id")) {
                    // ID already covered
                } else {
                    outBinds.out_id = {
                        dir: this.db.oracledb.BIND_OUT,
                        type: this.db.oracledb.NUMBER,
                    };
                }
            }

            const allBinds = { ...binds, ...outBinds };
            const sql = `INSERT INTO ${quoteIdentifier(this.tableName)} (${cols.map(quoteIdentifier).join(", ")}) VALUES (${bindNames.join(", ")})${returningSql}`;

            try {
                const result = await conn.execute(sql, allBinds, {
                    autoCommit: !this._conn,
                });
                const response = { acknowledged: true, insertedId: null };

                // Extract insertedId
                if (result.outBinds) {
                    if (result.outBinds.out_id) {
                        response.insertedId = Array.isArray(
                            result.outBinds.out_id,
                        )
                            ? result.outBinds.out_id[0]
                            : result.outBinds.out_id;
                    }
                    if (returningCols.length > 0) {
                        response.returning = {};
                        for (const c of returningCols) {
                            const val = result.outBinds[`out_${c}`];
                            response.returning[c] = Array.isArray(val)
                                ? val[0]
                                : val;
                            if (
                                c.toUpperCase() === "ID" &&
                                !response.insertedId
                            ) {
                                response.insertedId = response.returning[c];
                            }
                        }
                    }
                }

                return response;
            } catch (err) {
                throw new Error(
                    MSG.wrapError(
                        "OracleCollection.insertOne",
                        err,
                        sql,
                        allBinds,
                    ),
                );
            }
        });
    }

    /**
     * Insert multiple documents atomically using executeMany.
     * @param {Array<Object>} documents
     * @returns {Promise<{ acknowledged: boolean, insertedCount: number, insertedIds: Array }>}
     */
    async insertMany(documents) {
        if (!Array.isArray(documents) || documents.length === 0) {
            throw new Error(MSG.INSERT_MANY_EMPTY);
        }

        return this.db.withTransaction(async (conn) => {
            const cols = Object.keys(documents[0]);
            const placeholders = cols.map((_, i) => `:v${i}`).join(", ");
            const returningSql = ` RETURNING "ID" INTO :out_id`;
            const sql = `INSERT INTO ${quoteIdentifier(this.tableName)} (${cols.map(quoteIdentifier).join(", ")}) VALUES (${placeholders})${returningSql}`;

            // Build bind arrays for executeMany
            const bindDefs = {};
            cols.forEach((c, i) => {
                // Scan all documents for a non-null sample to determine the type
                let sampleVal = null;
                for (const doc of documents) {
                    if (doc[c] != null) {
                        sampleVal = doc[c];
                        break;
                    }
                }
                if (typeof sampleVal === "number") {
                    bindDefs[`v${i}`] = { type: this.db.oracledb.NUMBER };
                } else if (sampleVal instanceof Date) {
                    bindDefs[`v${i}`] = { type: this.db.oracledb.DATE };
                } else {
                    const maxLen = Math.max(
                        ...documents.map((d) => {
                            const v = d[c];
                            return v != null ? String(v).length : 1;
                        }),
                        1,
                    );
                    bindDefs[`v${i}`] = {
                        type: this.db.oracledb.STRING,
                        maxSize: Math.max(maxLen * 2, 100),
                    };
                }
            });
            bindDefs.out_id = {
                type: this.db.oracledb.NUMBER,
                dir: this.db.oracledb.BIND_OUT,
            };

            const bindRows = documents.map((doc) => {
                const row = {};
                cols.forEach((c, i) => {
                    row[`v${i}`] = doc[c] ?? null;
                });
                return row;
            });

            try {
                const result = await conn.executeMany(sql, bindRows, {
                    autoCommit: false,
                    bindDefs,
                });

                const insertedIds = result.outBinds
                    ? result.outBinds.map((ob) => ob.out_id?.[0] ?? null)
                    : [];

                return {
                    acknowledged: true,
                    insertedCount: result.rowsAffected,
                    insertedIds,
                };
            } catch (err) {
                throw new Error(
                    MSG.wrapError("OracleCollection.insertMany", err, sql),
                );
            }
        });
    }

    // ─── Update Operations ───────────────────────────────────────

    /**
     * Update a single document matching filter.
     * @param {Object} filter
     * @param {Object} update
     * @param {Object} [options] - upsert, returning
     * @returns {Promise<{ acknowledged, matchedCount, modifiedCount, returning? }>}
     */
    async updateOne(filter, update, options = {}) {
        return this._execute(async (conn) => {
            const { whereClause, binds: filterBinds } = parseFilter(filter);
            const { setClause, binds: updateBinds } = parseUpdate(update);
            const allBinds = mergeBinds(filterBinds, updateBinds);

            // RETURNING
            let returningSql = "";
            const outBinds = {};
            const returningCols = options.returning || [];
            if (returningCols.length > 0) {
                const retCols = returningCols.map(quoteIdentifier).join(", ");
                const retOuts = returningCols
                    .map((c) => `:out_${c}`)
                    .join(", ");
                returningSql = ` RETURNING ${retCols} INTO ${retOuts}`;
                for (const c of returningCols) {
                    outBinds[`out_${c}`] = { dir: this.db.oracledb.BIND_OUT };
                }
            }

            const finalBinds = { ...allBinds, ...outBinds };
            const sql = `UPDATE ${quoteIdentifier(this.tableName)} ${setClause} WHERE ROWID = (SELECT ROWID FROM ${quoteIdentifier(this.tableName)} ${whereClause} AND ROWNUM = 1)${returningSql}`;

            try {
                const result = await conn.execute(sql, finalBinds, {
                    autoCommit: !this._conn,
                });

                if (result.rowsAffected === 0 && options.upsert) {
                    // Upsert: insert
                    const fields = {};
                    if (update.$set) Object.assign(fields, update.$set);
                    for (const [k, v] of Object.entries(filter)) {
                        if (typeof v !== "object") fields[k] = v;
                    }
                    const cols = Object.keys(fields);
                    const vals = cols.map((_, i) => `:v${i}`);
                    const insertBinds = {};
                    cols.forEach((c, i) => {
                        insertBinds[`v${i}`] = fields[c];
                    });
                    const insertSql = `INSERT INTO ${quoteIdentifier(this.tableName)} (${cols.map(quoteIdentifier).join(", ")}) VALUES (${vals.join(", ")})`;
                    await conn.execute(insertSql, insertBinds, {
                        autoCommit: !this._conn,
                    });
                    return {
                        acknowledged: true,
                        matchedCount: 0,
                        modifiedCount: 0,
                        upsertedCount: 1,
                    };
                }

                const response = {
                    acknowledged: true,
                    matchedCount: result.rowsAffected > 0 ? 1 : 0,
                    modifiedCount: result.rowsAffected,
                };
                if (returningCols.length > 0 && result.outBinds) {
                    response.returning = {};
                    for (const c of returningCols) {
                        const val = result.outBinds[`out_${c}`];
                        response.returning[c] = Array.isArray(val)
                            ? val[0]
                            : val;
                    }
                }
                return response;
            } catch (err) {
                throw new Error(
                    MSG.wrapError(
                        "OracleCollection.updateOne",
                        err,
                        sql,
                        finalBinds,
                    ),
                );
            }
        });
    }

    /**
     * Update all documents matching filter.
     * @param {Object} filter
     * @param {Object} update
     * @param {Object} [options] - returning
     * @returns {Promise<{ acknowledged, matchedCount, modifiedCount }>}
     */
    async updateMany(filter, update, options = {}) {
        return this._execute(async (conn) => {
            const { whereClause, binds: filterBinds } = parseFilter(filter);
            const { setClause, binds: updateBinds } = parseUpdate(update);
            const allBinds = mergeBinds(filterBinds, updateBinds);

            const sql = `UPDATE ${quoteIdentifier(this.tableName)} ${setClause} ${whereClause}`;
            try {
                const result = await conn.execute(sql, allBinds, {
                    autoCommit: !this._conn,
                });
                return {
                    acknowledged: true,
                    matchedCount: result.rowsAffected,
                    modifiedCount: result.rowsAffected,
                };
            } catch (err) {
                throw new Error(
                    MSG.wrapError(
                        "OracleCollection.updateMany",
                        err,
                        sql,
                        allBinds,
                    ),
                );
            }
        });
    }

    /**
     * Replace a single document entirely (except primary key).
     * @param {Object} filter
     * @param {Object} replacement
     * @param {Object} [options]
     * @returns {Promise<{ acknowledged, matchedCount, modifiedCount }>}
     */
    async replaceOne(filter, replacement, options = {}) {
        return this._execute(async (conn) => {
            const { whereClause, binds: filterBinds } = parseFilter(filter);
            const cols = Object.keys(replacement).filter((c) => c !== "ID");
            const setParts = [];
            const replBinds = {};
            cols.forEach((c, i) => {
                const bname = `repl_${i}`;
                replBinds[bname] = replacement[c];
                setParts.push(`${quoteIdentifier(c)} = :${bname}`);
            });

            const allBinds = mergeBinds(filterBinds, replBinds);
            const sql = `UPDATE ${quoteIdentifier(this.tableName)} SET ${setParts.join(", ")} WHERE ROWID = (SELECT ROWID FROM ${quoteIdentifier(this.tableName)} ${whereClause} AND ROWNUM = 1)`;

            try {
                const result = await conn.execute(sql, allBinds, {
                    autoCommit: !this._conn,
                });
                return {
                    acknowledged: true,
                    matchedCount: result.rowsAffected > 0 ? 1 : 0,
                    modifiedCount: result.rowsAffected,
                };
            } catch (err) {
                throw new Error(
                    MSG.wrapError(
                        "OracleCollection.replaceOne",
                        err,
                        sql,
                        allBinds,
                    ),
                );
            }
        });
    }

    /**
     * Execute multiple operations atomically in a single transaction.
     * @param {Array} operations
     * @returns {Promise<{ acknowledged, results }>}
     */
    async bulkWrite(operations) {
        if (!Array.isArray(operations) || operations.length === 0) {
            throw new Error(MSG.BULK_WRITE_EMPTY);
        }

        return this.db.withTransaction(async (conn) => {
            const sessionColl = new OracleCollection(
                this.tableName,
                this.db,
                conn,
            );
            const results = [];

            for (const op of operations) {
                if (op.insertOne) {
                    results.push(
                        await sessionColl.insertOne(op.insertOne.document),
                    );
                } else if (op.updateOne) {
                    results.push(
                        await sessionColl.updateOne(
                            op.updateOne.filter,
                            op.updateOne.update,
                            op.updateOne.options,
                        ),
                    );
                } else if (op.updateMany) {
                    results.push(
                        await sessionColl.updateMany(
                            op.updateMany.filter,
                            op.updateMany.update,
                            op.updateMany.options,
                        ),
                    );
                } else if (op.deleteOne) {
                    results.push(
                        await sessionColl.deleteOne(
                            op.deleteOne.filter,
                            op.deleteOne.options,
                        ),
                    );
                } else if (op.deleteMany) {
                    results.push(
                        await sessionColl.deleteMany(op.deleteMany.filter),
                    );
                } else if (op.replaceOne) {
                    results.push(
                        await sessionColl.replaceOne(
                            op.replaceOne.filter,
                            op.replaceOne.replacement,
                            op.replaceOne.options,
                        ),
                    );
                } else {
                    throw new Error(MSG.BULK_WRITE_UNKNOWN_OP(Object.keys(op)));
                }
            }

            return { acknowledged: true, results };
        });
    }

    // ─── Delete Operations ───────────────────────────────────────

    /**
     * Delete first matching document.
     * @param {Object} filter
     * @param {Object} [options] - returning
     * @returns {Promise<{ acknowledged, deletedCount, returning? }>}
     */
    async deleteOne(filter, options = {}) {
        return this._execute(async (conn) => {
            const { whereClause, binds } = parseFilter(filter);

            let returningSql = "";
            const outBinds = {};
            const returningCols = options.returning || [];
            if (returningCols.length > 0) {
                const retCols = returningCols.map(quoteIdentifier).join(", ");
                const retOuts = returningCols
                    .map((c) => `:out_${c}`)
                    .join(", ");
                returningSql = ` RETURNING ${retCols} INTO ${retOuts}`;
                for (const c of returningCols) {
                    outBinds[`out_${c}`] = { dir: this.db.oracledb.BIND_OUT };
                }
            }

            const allBinds = { ...binds, ...outBinds };
            const sql = `DELETE FROM ${quoteIdentifier(this.tableName)} WHERE ROWID = (SELECT ROWID FROM ${quoteIdentifier(this.tableName)} ${whereClause} AND ROWNUM = 1)${returningSql}`;

            try {
                const result = await conn.execute(sql, allBinds, {
                    autoCommit: !this._conn,
                });
                const response = {
                    acknowledged: true,
                    deletedCount: result.rowsAffected,
                };
                if (returningCols.length > 0 && result.outBinds) {
                    response.returning = {};
                    for (const c of returningCols) {
                        const val = result.outBinds[`out_${c}`];
                        response.returning[c] = Array.isArray(val)
                            ? val[0]
                            : val;
                    }
                }
                return response;
            } catch (err) {
                throw new Error(
                    MSG.wrapError(
                        "OracleCollection.deleteOne",
                        err,
                        sql,
                        allBinds,
                    ),
                );
            }
        });
    }

    /**
     * Delete all documents matching filter.
     * @param {Object} filter
     * @returns {Promise<{ acknowledged, deletedCount }>}
     */
    async deleteMany(filter) {
        return this._execute(async (conn) => {
            const { whereClause, binds } = parseFilter(filter);
            const sql = `DELETE FROM ${quoteIdentifier(this.tableName)} ${whereClause}`;
            try {
                const result = await conn.execute(sql, binds, {
                    autoCommit: !this._conn,
                });
                return {
                    acknowledged: true,
                    deletedCount: result.rowsAffected,
                };
            } catch (err) {
                throw new Error(
                    MSG.wrapError(
                        "OracleCollection.deleteMany",
                        err,
                        sql,
                        binds,
                    ),
                );
            }
        });
    }

    /**
     * Drop this table.
     * @returns {Promise<{ acknowledged }>}
     */
    async drop() {
        return this._execute(async (conn) => {
            const sql = `DROP TABLE ${quoteIdentifier(this.tableName)} CASCADE CONSTRAINTS`;
            try {
                await conn.execute(sql, {}, { autoCommit: !this._conn });
                return { acknowledged: true };
            } catch (err) {
                throw new Error(
                    MSG.wrapError("OracleCollection.drop", err, sql),
                );
            }
        });
    }

    // ─── Aggregation ─────────────────────────────────────────────

    /**
     * Execute a MongoDB-style aggregation pipeline.
     * Returns a thenable Promise augmented with _buildSQL() for lazy consumers
     * like createMaterializedView.
     * @param {Array} pipeline - Array of pipeline stage objects
     * @returns {Promise<Array> & { _buildSQL: Function }}
     */
    aggregate(pipeline) {
        const { buildAggregateSQL } = require("../pipeline/aggregatePipeline");
        const pipelineCopy = JSON.parse(JSON.stringify(pipeline));
        const { sql, binds } = buildAggregateSQL(
            this.tableName,
            pipelineCopy,
            this.db,
        );

        const resultPromise = this._execute(async (conn) => {
            try {
                const result = await conn.execute(sql, binds, {
                    outFormat: this.db.oracledb.OUT_FORMAT_OBJECT,
                    autoCommit: !this._conn,
                });
                return result.rows || [];
            } catch (err) {
                throw new Error(
                    MSG.wrapError(
                        "OracleCollection.aggregate",
                        err,
                        sql,
                        binds,
                    ),
                );
            }
        });

        // Augment the promise so createMaterializedView can extract the SQL
        resultPromise._buildSQL = () => ({ sql, binds });
        return resultPromise;
    }

    // ─── Index Operations ────────────────────────────────────────

    /**
     * Create an index on specified fields.
     * @param {Object} fields - { colName: 1 (ASC) | -1 (DESC) }
     * @param {Object} [options] - unique, name, type ('bitmap')
     * @returns {Promise<{ acknowledged, indexName }>}
     */
    async createIndex(fields, options = {}) {
        return this._execute(async (conn) => {
            const cols = Object.entries(fields)
                .map(
                    ([col, dir]) =>
                        `${quoteIdentifier(col)} ${dir === -1 ? "DESC" : "ASC"}`,
                )
                .join(", ");
            const colNames = Object.keys(fields).join("_");
            const indexName =
                options.name || `IDX_${this.tableName}_${colNames}`;
            const unique = options.unique ? "UNIQUE " : "";
            const bitmap = options.type === "bitmap" ? "BITMAP " : "";
            const sql = `CREATE ${unique}${bitmap}INDEX ${quoteIdentifier(indexName)} ON ${quoteIdentifier(this.tableName)} (${cols})`;

            try {
                await conn.execute(sql, {}, { autoCommit: !this._conn });
                return { acknowledged: true, indexName };
            } catch (err) {
                throw new Error(
                    MSG.wrapError("OracleCollection.createIndex", err, sql),
                );
            }
        });
    }

    /**
     * Create multiple indexes.
     * @param {Array} indexSpecs - [{ fields, options }]
     * @returns {Promise<{ acknowledged, indexNames }>}
     */
    async createIndexes(indexSpecs) {
        const indexNames = [];
        for (const spec of indexSpecs) {
            const result = await this.createIndex(
                spec.fields,
                spec.options || spec,
            );
            indexNames.push(result.indexName);
        }
        return { acknowledged: true, indexNames };
    }

    /**
     * Drop a named index.
     * @param {string} indexName
     * @returns {Promise<{ acknowledged }>}
     */
    async dropIndex(indexName) {
        return this._execute(async (conn) => {
            const sql = `DROP INDEX ${quoteIdentifier(indexName)}`;
            try {
                await conn.execute(sql, {}, { autoCommit: !this._conn });
                return { acknowledged: true };
            } catch (err) {
                throw new Error(
                    MSG.wrapError("OracleCollection.dropIndex", err, sql),
                );
            }
        });
    }

    /**
     * Drop all non-primary-key indexes on this table.
     * @returns {Promise<{ acknowledged, dropped }>}
     */
    async dropIndexes() {
        return this._execute(async (conn) => {
            const sql = `SELECT INDEX_NAME FROM USER_INDEXES WHERE TABLE_NAME = UPPER(:tbl) AND INDEX_TYPE <> 'LOB' AND INDEX_NAME NOT IN (SELECT CONSTRAINT_NAME FROM USER_CONSTRAINTS WHERE TABLE_NAME = UPPER(:tbl2) AND CONSTRAINT_TYPE = 'P')`;
            const result = await conn.execute(
                sql,
                { tbl: this.tableName, tbl2: this.tableName },
                {
                    outFormat: this.db.oracledb.OUT_FORMAT_OBJECT,
                },
            );
            const dropped = [];
            for (const row of result.rows) {
                try {
                    await conn.execute(
                        `DROP INDEX ${quoteIdentifier(row.INDEX_NAME)}`,
                        {},
                        { autoCommit: !this._conn },
                    );
                    dropped.push(row.INDEX_NAME);
                } catch (err) {
                    // Skip errors (e.g. system-generated indexes)
                }
            }
            return { acknowledged: true, dropped };
        });
    }

    /**
     * Get all indexes on this table.
     * @returns {Promise<Array<{ indexName, columns, unique, type }>>}
     */
    async getIndexes() {
        return this._execute(async (conn) => {
            const sql = `SELECT i.INDEX_NAME, i.UNIQUENESS, i.INDEX_TYPE, ic.COLUMN_NAME, ic.COLUMN_POSITION FROM USER_INDEXES i JOIN USER_IND_COLUMNS ic ON i.INDEX_NAME = ic.INDEX_NAME WHERE i.TABLE_NAME = UPPER(:tbl) ORDER BY i.INDEX_NAME, ic.COLUMN_POSITION`;
            const result = await conn.execute(
                sql,
                { tbl: this.tableName },
                {
                    outFormat: this.db.oracledb.OUT_FORMAT_OBJECT,
                },
            );

            const indexMap = {};
            for (const row of result.rows) {
                if (!indexMap[row.INDEX_NAME]) {
                    indexMap[row.INDEX_NAME] = {
                        indexName: row.INDEX_NAME,
                        columns: [],
                        unique: row.UNIQUENESS === "UNIQUE",
                        type: row.INDEX_TYPE,
                    };
                }
                indexMap[row.INDEX_NAME].columns.push(row.COLUMN_NAME);
            }
            return Object.values(indexMap);
        });
    }

    /**
     * Rebuild all indexes on this table.
     * @returns {Promise<{ acknowledged }>}
     */
    async reIndex() {
        return this._execute(async (conn) => {
            const sql = `SELECT INDEX_NAME FROM USER_INDEXES WHERE TABLE_NAME = UPPER(:tbl) AND INDEX_TYPE <> 'LOB'`;
            const result = await conn.execute(
                sql,
                { tbl: this.tableName },
                {
                    outFormat: this.db.oracledb.OUT_FORMAT_OBJECT,
                },
            );
            for (const row of result.rows) {
                try {
                    await conn.execute(
                        `ALTER INDEX ${quoteIdentifier(row.INDEX_NAME)} REBUILD`,
                        {},
                        { autoCommit: !this._conn },
                    );
                } catch (err) {
                    // Skip errors
                }
            }
            return { acknowledged: true };
        });
    }

    // ─── MERGE / UPSERT ─────────────────────────────────────────

    /**
     * Oracle MERGE statement.
     * @param {Object} sourceData - Data to merge
     * @param {Object} matchCondition - { localField, foreignField }
     * @param {Object} options - whenMatched, whenNotMatched, whenMatchedDelete
     * @returns {Promise<{ acknowledged }>}
     */
    async merge(sourceData, matchCondition, options = {}) {
        return this._execute(async (conn) => {
            const cols = Object.keys(sourceData);
            const srcParts = cols.map((c) => {
                const bname = `merge_${c}`;
                return `:${bname} AS ${quoteIdentifier(c)}`;
            });
            const srcBinds = {};
            cols.forEach((c) => {
                srcBinds[`merge_${c}`] = sourceData[c];
            });

            const onClause = `tgt.${quoteIdentifier(matchCondition.localField)} = src.${quoteIdentifier(matchCondition.foreignField)}`;

            let whenMatchedSql = "";
            if (options.whenMatched) {
                const { setClause, binds: upBinds } = parseUpdate(
                    options.whenMatched,
                );
                Object.assign(srcBinds, upBinds);
                // Replace quotes to use tgt. prefix
                whenMatchedSql = `\nWHEN MATCHED THEN UPDATE ${setClause}`;
            }

            let whenMatchedDeleteSql = "";
            if (options.whenMatchedDelete) {
                const { whereClause, binds: delBinds } = parseFilter(
                    options.whenMatchedDelete,
                );
                Object.assign(srcBinds, delBinds);
                const delWhere = whereClause.replace(/^WHERE\s+/i, "");
                whenMatchedDeleteSql = `\n  DELETE ${delWhere ? `WHERE ${delWhere}` : ""}`;
            }

            let whenNotMatchedSql = "";
            if (options.whenNotMatched === "insert") {
                const insertCols = cols.map(quoteIdentifier).join(", ");
                const insertVals = cols
                    .map((c) => `src.${quoteIdentifier(c)}`)
                    .join(", ");
                whenNotMatchedSql = `\nWHEN NOT MATCHED THEN INSERT (${insertCols}) VALUES (${insertVals})`;
            }

            const sql = `MERGE INTO ${quoteIdentifier(this.tableName)} tgt\nUSING (SELECT ${srcParts.join(", ")} FROM DUAL) src\nON (${onClause})${whenMatchedSql}${whenMatchedDeleteSql}${whenNotMatchedSql}`;

            try {
                await conn.execute(sql, srcBinds, { autoCommit: !this._conn });
                return { acknowledged: true };
            } catch (err) {
                throw new Error(
                    MSG.wrapError("OracleCollection.merge", err, sql, srcBinds),
                );
            }
        });
    }

    /**
     * Merge from another table.
     * @param {string} sourceTable
     * @param {Object} matchCondition - { localField, foreignField }
     * @param {Object} options - whenMatched, whenNotMatched
     * @returns {Promise<{ acknowledged }>}
     */
    async mergeFrom(sourceTable, matchCondition, options = {}) {
        return this._execute(async (conn) => {
            const onClause = `tgt.${quoteIdentifier(matchCondition.localField)} = src.${quoteIdentifier(matchCondition.foreignField)}`;
            const binds = {};

            let whenMatchedSql = "";
            if (options.whenMatched) {
                const { $set } = options.whenMatched;
                if ($set) {
                    const parts = Object.entries($set).map(([col, val]) => {
                        if (
                            typeof val === "string" &&
                            val.startsWith("$src.")
                        ) {
                            return `tgt.${quoteIdentifier(col)} = src.${quoteIdentifier(val.replace("$src.", ""))}`;
                        }
                        const bname = `mergeFrom_${col}`;
                        binds[bname] = val;
                        return `tgt.${quoteIdentifier(col)} = :${bname}`;
                    });
                    whenMatchedSql = `\nWHEN MATCHED THEN UPDATE SET ${parts.join(", ")}`;
                }
            }

            const sql = `MERGE INTO ${quoteIdentifier(this.tableName)} tgt\nUSING ${quoteIdentifier(sourceTable)} src\nON (${onClause})${whenMatchedSql}`;

            try {
                await conn.execute(sql, binds, { autoCommit: !this._conn });
                return { acknowledged: true };
            } catch (err) {
                throw new Error(
                    MSG.wrapError(
                        "OracleCollection.mergeFrom",
                        err,
                        sql,
                        binds,
                    ),
                );
            }
        });
    }

    // ─── Oracle Advanced Features ────────────────────────────────

    /**
     * Hierarchical query using CONNECT BY.
     * @param {Object} spec - startWith, connectBy, orderSiblings, maxLevel, includeLevel, includePath
     * @returns {Promise<Array>}
     */
    async connectBy(spec) {
        const { buildConnectBy } = require("../advanced/oracleAdvanced");
        const { sql, binds } = buildConnectBy(this.tableName, spec);

        return this._execute(async (conn) => {
            try {
                const result = await conn.execute(sql, binds, {
                    outFormat: this.db.oracledb.OUT_FORMAT_OBJECT,
                    autoCommit: !this._conn,
                });
                return result.rows || [];
            } catch (err) {
                throw new Error(
                    MSG.wrapError(
                        "OracleCollection.connectBy",
                        err,
                        sql,
                        binds,
                    ),
                );
            }
        });
    }

    /**
     * PIVOT query.
     * @param {Object} spec - value, pivotOn, pivotValues, groupBy
     * @returns {Promise<Array>}
     */
    async pivot(spec) {
        const { buildPivot } = require("../advanced/oracleAdvanced");
        const { sql, binds } = buildPivot(this.tableName, spec);

        return this._execute(async (conn) => {
            try {
                const result = await conn.execute(sql, binds, {
                    outFormat: this.db.oracledb.OUT_FORMAT_OBJECT,
                    autoCommit: !this._conn,
                });
                return result.rows || [];
            } catch (err) {
                throw new Error(
                    MSG.wrapError("OracleCollection.pivot", err, sql, binds),
                );
            }
        });
    }

    /**
     * UNPIVOT query.
     * @param {Object} spec - valueColumn, nameColumn, columns, includeNulls
     * @returns {Promise<Array>}
     */
    async unpivot(spec) {
        const { buildUnpivot } = require("../advanced/oracleAdvanced");
        const { sql, binds } = buildUnpivot(this.tableName, spec);

        return this._execute(async (conn) => {
            try {
                const result = await conn.execute(sql, binds, {
                    outFormat: this.db.oracledb.OUT_FORMAT_OBJECT,
                    autoCommit: !this._conn,
                });
                return result.rows || [];
            } catch (err) {
                throw new Error(
                    MSG.wrapError("OracleCollection.unpivot", err, sql, binds),
                );
            }
        });
    }

    // ─── Set Operations (static) ─────────────────────────────────

    /**
     * UNION / UNION ALL of two QueryBuilder results.
     * @param {QueryBuilder} qb1
     * @param {QueryBuilder} qb2
     * @param {Object} [options] - { all: true } for UNION ALL
     * @returns {SetResultBuilder}
     */
    static union(qb1, qb2, options = {}) {
        const { SetResultBuilder } = require("../joins/setOperations");
        return new SetResultBuilder(
            qb1,
            qb2,
            options.all ? "UNION ALL" : "UNION",
        );
    }

    /**
     * INTERSECT of two QueryBuilder results.
     * @param {QueryBuilder} qb1
     * @param {QueryBuilder} qb2
     * @returns {SetResultBuilder}
     */
    static intersect(qb1, qb2) {
        const { SetResultBuilder } = require("../joins/setOperations");
        return new SetResultBuilder(qb1, qb2, "INTERSECT");
    }

    /**
     * MINUS of two QueryBuilder results.
     * @param {QueryBuilder} qb1
     * @param {QueryBuilder} qb2
     * @returns {SetResultBuilder}
     */
    static minus(qb1, qb2) {
        const { SetResultBuilder } = require("../joins/setOperations");
        return new SetResultBuilder(qb1, qb2, "MINUS");
    }

    // ─── INSERT INTO ... SELECT ──────────────────────────────────

    /**
     * Insert rows from a query into a target table.
     * @param {string} targetTable
     * @param {QueryBuilder} queryBuilder
     * @param {Object} [options] - columns
     * @returns {Promise<{ acknowledged, insertedCount }>}
     */
    async insertFromQuery(targetTable, queryBuilder, options = {}) {
        return this._execute(async (conn) => {
            let { sql: selectSql, binds } = queryBuilder._buildSQL();
            let colList = "";

            if (options.columns && options.columns.length > 0) {
                // Explicit columns provided
                colList = `(${options.columns.map(quoteIdentifier).join(", ")})`;
                const colSelectList = options.columns
                    .map(quoteIdentifier)
                    .join(", ");
                selectSql = selectSql.replace(
                    /SELECT\s+.*?\s+FROM/i,
                    `SELECT ${colSelectList} FROM`,
                );
            } else {
                // No columns specified — exclude identity columns to avoid ORA-32795
                const colResult = await conn.execute(
                    `SELECT COLUMN_NAME FROM USER_TAB_COLUMNS WHERE TABLE_NAME = UPPER(:t) AND (IDENTITY_COLUMN IS NULL OR IDENTITY_COLUMN = 'NO') ORDER BY COLUMN_ID`,
                    { t: targetTable },
                    { outFormat: this.db.oracledb.OUT_FORMAT_OBJECT },
                );
                const cols = colResult.rows.map((r) => r.COLUMN_NAME);
                if (cols.length > 0) {
                    colList = `(${cols.map(quoteIdentifier).join(", ")})`;
                    const colSelectList = cols.map(quoteIdentifier).join(", ");
                    selectSql = selectSql.replace(
                        /SELECT\s+.*?\s+FROM/i,
                        `SELECT ${colSelectList} FROM`,
                    );
                }
            }

            const sql = `INSERT INTO ${quoteIdentifier(targetTable)} ${colList} ${selectSql}`;

            try {
                const result = await conn.execute(sql, binds, {
                    autoCommit: !this._conn,
                });
                return {
                    acknowledged: true,
                    insertedCount: result.rowsAffected,
                };
            } catch (err) {
                throw new Error(
                    MSG.wrapError(
                        "OracleCollection.insertFromQuery",
                        err,
                        sql,
                        binds,
                    ),
                );
            }
        });
    }

    // ─── UPDATE ... JOIN ─────────────────────────────────────────

    /**
     * Update a table using values from a joined table.
     * Falls back to correlated UPDATE subquery if inline view fails.
     * @param {Object} spec - target, join, set, where
     * @returns {Promise<{ acknowledged, modifiedCount }>}
     */
    async updateFromJoin(spec) {
        return this._execute(async (conn) => {
            const { target, join: joinSpec, set, where } = spec;
            const joinType = (joinSpec.type || "inner").toUpperCase();

            // Build correlated UPDATE subquery approach (more reliable in Oracle)
            const setParts = [];
            const binds = {};
            let bindIdx = 0;

            for (const [col, val] of Object.entries(set)) {
                const targetCol = col.includes(".") ? col.split(".")[1] : col;
                if (typeof val === "string" && val.includes(".")) {
                    // Column reference from joined table
                    const srcCol = val.split(".")[1];
                    setParts.push(
                        `${quoteIdentifier(targetCol)} = (SELECT ${quoteIdentifier(srcCol)} FROM ${quoteIdentifier(joinSpec.table)} WHERE ${_buildJoinOn(joinSpec.on, target)} AND ROWNUM = 1)`,
                    );
                } else {
                    const bname = `upd_join_${bindIdx++}`;
                    binds[bname] = val;
                    setParts.push(`${quoteIdentifier(targetCol)} = :${bname}`);
                }
            }

            // WHERE — exists in joined table
            let whereExtra = "";
            if (where) {
                const whereParts = [];
                for (const [col, val] of Object.entries(where)) {
                    const cleanCol = col.includes(".")
                        ? col.split(".")[1]
                        : col;
                    const bname = `upd_where_${bindIdx++}`;
                    binds[bname] = val;
                    whereParts.push(`${quoteIdentifier(cleanCol)} = :${bname}`);
                }
                if (whereParts.length > 0) {
                    whereExtra = ` AND ${whereParts.join(" AND ")}`;
                }
            }

            const existsClause = `EXISTS (SELECT 1 FROM ${quoteIdentifier(joinSpec.table)} WHERE ${_buildJoinOn(joinSpec.on, target)}${whereExtra})`;
            const sql = `UPDATE ${quoteIdentifier(target)} SET ${setParts.join(", ")} WHERE ${existsClause}`;

            try {
                const result = await conn.execute(sql, binds, {
                    autoCommit: !this._conn,
                });
                return {
                    acknowledged: true,
                    modifiedCount: result.rowsAffected,
                };
            } catch (err) {
                throw new Error(
                    MSG.wrapError("OracleCollection.updateFromJoin", err, sql),
                );
            }
        });
    }
}

/**
 * Build a JOIN ON clause from an on-spec object.
 * @param {Object} onSpec - e.g. { 'TABLE1.COL': 'TABLE2.COL' }
 * @param {string} targetTable
 * @returns {string}
 */
function _buildJoinOn(onSpec, targetTable) {
    return Object.entries(onSpec)
        .map(([left, right]) => {
            const leftParts = left.split(".");
            const rightParts = right.split(".");
            const leftCol = leftParts.length > 1 ? leftParts[1] : leftParts[0];
            const rightCol =
                rightParts.length > 1 ? rightParts[1] : rightParts[0];
            return `${quoteIdentifier(targetTable)}.${quoteIdentifier(leftCol)} = ${quoteIdentifier(rightCol)}`;
        })
        .join(" AND ");
}

module.exports = { OracleCollection };
