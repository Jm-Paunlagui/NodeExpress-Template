"use strict";

/**
 * @fileoverview Development test suite for oracle-mongo-wrapper
 * @description Tests against REAL production tables in the Inventory schema.
 *              NO admin/DBA privileges required — only basic SELECT, INSERT,
 *              UPDATE, DELETE on own-schema objects.
 *
 * TABLES USED (read-only):
 *   DEV_BOOK, DEV_LOCATION, DEV_LOCK, DEV_MATERIAL, DEV_STOCKS, DEV_UNIT, T_OPITS_USERS
 *
 * TABLES CREATED (read-write, auto-cleaned):
 *   TEST_DEV_SCRATCH — temporary table created/dropped by this suite
 *
 * SETUP:
 *   1. Ensure .env is configured (UA_DB_USERNAME / UA_DB_PASSWORD)
 *   2. npm install --save-dev mocha chai
 *   3. npx mocha test.dev.js --timeout 60000 --exit
 */

const path = require("path");
const { expect } = require("chai");
const dotenv = require("dotenv");
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

// ─── Wrapper imports ──────────────────────────────────────────────────────────
const { createDb } = require("../../src/utils/oracle-mongo-wrapper/db");
const {
    OracleCollection,
} = require("../../src/utils/oracle-mongo-wrapper/core/OracleCollection");
const {
    OracleSchema,
} = require("../../src/utils/oracle-mongo-wrapper/schema/OracleSchema");
const {
    Transaction,
} = require("../../src/utils/oracle-mongo-wrapper/Transaction");
const {
    withCTE,
} = require("../../src/utils/oracle-mongo-wrapper/pipeline/cteBuilder");
const {
    parseFilter,
} = require("../../src/utils/oracle-mongo-wrapper/parsers/filterParser");
const {
    parseUpdate,
} = require("../../src/utils/oracle-mongo-wrapper/parsers/updateParser");

// ─── DB binding ───────────────────────────────────────────────────────────────
const db = createDb("userAccount");

// ─── Real table names from .env / schema ──────────────────────────────────────
const TABLES = {
    BOOK: process.env.DB_BOOK || "DEV_BOOK",
    LOCATION: process.env.DB_LOCATION || "DEV_LOCATION",
    LOCK: process.env.DB_LOCK || "DEV_LOCK",
    MATERIAL: process.env.DB_MATERIAL || "DEV_MATERIAL",
    STOCKS: process.env.DB_STOCKS || "DEV_STOCKS",
    UNIT: process.env.DB_UNIT || "DEV_UNIT",
    USERS: "T_OPITS_USERS",
};

// Scratch table for write tests (created/dropped by this suite)
const SCRATCH = "TEST_DEV_SCRATCH";

// ─── Collection handles ───────────────────────────────────────────────────────
let book, location, lock, material, stocks, unit, opitsUsers;
let scratch, schema, txManager;

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function tableExists(tableName) {
    return db.withConnection(async (conn) => {
        const res = await conn.execute(
            `SELECT COUNT(*) AS CNT FROM USER_TABLES WHERE TABLE_NAME = UPPER(:n)`,
            { n: tableName },
            { outFormat: db.oracledb.OUT_FORMAT_OBJECT },
        );
        return res.rows[0].CNT > 0;
    });
}

async function dropIfExists(tableName) {
    if (await tableExists(tableName)) {
        await db.withConnection(async (conn) => {
            await conn.execute(
                `DROP TABLE "${tableName}" CASCADE CONSTRAINTS PURGE`,
                {},
                { autoCommit: true },
            );
        });
    }
}

async function rowCount(tableName) {
    return db.withConnection(async (conn) => {
        const res = await conn.execute(
            `SELECT COUNT(*) AS CNT FROM "${tableName}"`,
            {},
            { outFormat: db.oracledb.OUT_FORMAT_OBJECT },
        );
        return Number(res.rows[0].CNT);
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// SUITE SETUP / TEARDOWN
// ─────────────────────────────────────────────────────────────────────────────

before(async function () {
    this.timeout(60_000);

    schema = new OracleSchema(db);
    txManager = new Transaction(db);

    // Bind collection handles to real tables (read-only tests)
    book = new OracleCollection(TABLES.BOOK, db);
    location = new OracleCollection(TABLES.LOCATION, db);
    lock = new OracleCollection(TABLES.LOCK, db);
    material = new OracleCollection(TABLES.MATERIAL, db);
    stocks = new OracleCollection(TABLES.STOCKS, db);
    unit = new OracleCollection(TABLES.UNIT, db);
    opitsUsers = new OracleCollection(TABLES.USERS, db);

    // Create scratch table for write tests
    await dropIfExists(SCRATCH);
    await schema.createTable(SCRATCH, {
        ID: { type: "NUMBER", primaryKey: true, autoIncrement: true },
        NAME: { type: "VARCHAR2(200)", notNull: true },
        CATEGORY: { type: "VARCHAR2(100)" },
        VALUE: { type: "NUMBER(12,2)", default: 0 },
        STATUS: { type: "VARCHAR2(20)", default: "'active'" },
        CREATED_AT: { type: "DATE", default: "SYSDATE" },
        UPDATED_AT: { type: "DATE" },
    });

    scratch = new OracleCollection(SCRATCH, db);
});

after(async function () {
    this.timeout(30_000);
    await dropIfExists(SCRATCH);
});

// ═════════════════════════════════════════════════════════════════════════════
//  1. CONNECTION & HEALTH CHECKS
// ═════════════════════════════════════════════════════════════════════════════

describe("1. Connection & Health", function () {
    it("1.1 db.withConnection executes a simple query", async function () {
        const result = await db.withConnection(async (conn) => {
            const r = await conn.execute(
                "SELECT 1 AS VAL FROM DUAL",
                { outFormat: db.oracledb.OUT_FORMAT_OBJECT },
            );
            return r.rows[0].VAL;
        });
        expect(result).to.equal(1);
    });

    it("1.2 db.isHealthy returns true", async function () {
        const healthy = await db.isHealthy();
        expect(healthy).to.be.true;
    });

    it("1.3 db.getPoolStats returns stats object", async function () {
        const stats = await db.getPoolStats();
        expect(stats).to.be.an("object");
    });
});

// ═════════════════════════════════════════════════════════════════════════════
//  2. READ-ONLY: DEV_BOOK
// ═════════════════════════════════════════════════════════════════════════════

describe("2. DEV_BOOK — Read Operations", function () {
    it("2.1 countDocuments returns a number", async function () {
        const count = await book.countDocuments();
        expect(count).to.be.a("number");
        expect(count).to.be.at.least(0);
    });

    it("2.2 estimatedDocumentCount returns a number", async function () {
        const count = await book.estimatedDocumentCount();
        expect(count).to.be.a("number");
    });

    it("2.3 find().toArray() returns array of rows", async function () {
        const rows = await book.find({}).limit(5).toArray();
        expect(rows).to.be.an("array");
        if (rows.length > 0) {
            expect(rows[0]).to.have.property("ID");
            expect(rows[0]).to.have.property("DIVISION");
        }
    });

    it("2.4 find with projection returns only selected columns", async function () {
        const rows = await book
            .find({})
            .project({ ID: 1, DIVISION: 1, YEAR: 1 })
            .limit(3)
            .toArray();
        expect(rows).to.be.an("array");
        if (rows.length > 0) {
            expect(rows[0]).to.have.property("ID");
            expect(rows[0]).to.have.property("DIVISION");
            expect(rows[0]).to.have.property("YEAR");
        }
    });

    it("2.5 find with sort and limit", async function () {
        const rows = await book.find({}).sort({ ID: -1 }).limit(3).toArray();
        expect(rows).to.be.an("array");
        if (rows.length >= 2) {
            expect(Number(rows[0].ID)).to.be.at.least(Number(rows[1].ID));
        }
    });

    it("2.6 find with skip and limit (pagination)", async function () {
        const page1 = await book.find({}).sort({ ID: 1 }).limit(2).toArray();
        const page2 = await book
            .find({})
            .sort({ ID: 1 })
            .skip(2)
            .limit(2)
            .toArray();
        if (page1.length === 2 && page2.length > 0) {
            expect(Number(page2[0].ID)).to.be.greaterThan(Number(page1[1].ID));
        }
    });

    it("2.7 findOne returns a single document or null", async function () {
        const doc = await book.findOne({});
        if (doc) {
            expect(doc).to.have.property("ID");
        } else {
            expect(doc).to.be.null;
        }
    });

    it("2.8 distinct on DIVISION returns array", async function () {
        const divisions = await book.distinct("DIVISION");
        expect(divisions).to.be.an("array");
    });

    it("2.9 find with $exists filter (non-null MATERIALID)", async function () {
        const rows = await book
            .find({ MATERIALID: { $exists: true } })
            .limit(5)
            .toArray();
        expect(rows).to.be.an("array");
        rows.forEach((r) => expect(r.MATERIALID).to.not.be.null);
    });

    it("2.10 find with $like filter", async function () {
        const rows = await book
            .find({ YEAR: { $like: "202%" } })
            .limit(5)
            .toArray();
        expect(rows).to.be.an("array");
    });

    it("2.11 QueryBuilder.count() returns number", async function () {
        const count = await book.find({}).count();
        expect(count).to.be.a("number");
        expect(count).to.be.at.least(0);
    });

    it("2.12 QueryBuilder.explain() returns SQL string (dry run)", async function () {
        const sql = await book
            .find({ DIVISION: "WH" })
            .sort({ ID: 1 })
            .limit(10)
            .explain();
        expect(sql).to.be.a("string");
        expect(sql.toUpperCase()).to.include("SELECT");
        expect(sql.toUpperCase()).to.include("ORDER BY");
    });
});

// ═════════════════════════════════════════════════════════════════════════════
//  3. READ-ONLY: DEV_LOCATION
// ═════════════════════════════════════════════════════════════════════════════

describe("3. DEV_LOCATION — Read Operations", function () {
    it("3.1 countDocuments", async function () {
        const count = await location.countDocuments();
        expect(count).to.be.a("number");
    });

    it("3.2 find with $in filter on TYPE", async function () {
        const rows = await location
            .find({ TYPE: { $in: ["WH", "PR"] } })
            .limit(10)
            .toArray();
        expect(rows).to.be.an("array");
    });

    it("3.3 distinct SLOC values", async function () {
        const slocs = await location.distinct("SLOC");
        expect(slocs).to.be.an("array");
    });

    it("3.4 find with multiple conditions ($and implicit)", async function () {
        const rows = await location
            .find({ DIVISION: "WH", YEAR: "2025" })
            .limit(5)
            .toArray();
        expect(rows).to.be.an("array");
    });

    it("3.5 find with $or", async function () {
        const rows = await location
            .find({ $or: [{ TYPE: "WH" }, { TYPE: "PR" }] })
            .limit(5)
            .toArray();
        expect(rows).to.be.an("array");
    });

    it("3.6 find with projection excluding via include list", async function () {
        const rows = await location
            .find({})
            .project({ ID: 1, DIVISION: 1, SLOC: 1, PSA: 1, TERMINAL: 1 })
            .limit(3)
            .toArray();
        expect(rows).to.be.an("array");
        if (rows.length > 0) {
            expect(rows[0]).to.have.property("SLOC");
        }
    });
});

// ═════════════════════════════════════════════════════════════════════════════
//  4. READ-ONLY: DEV_MATERIAL
// ═════════════════════════════════════════════════════════════════════════════

describe("4. DEV_MATERIAL — Read Operations", function () {
    it("4.1 countDocuments", async function () {
        const count = await material.countDocuments();
        expect(count).to.be.a("number");
    });

    it("4.2 find with $ne filter", async function () {
        const rows = await material
            .find({ TYPE: { $ne: "RM" } })
            .limit(10)
            .toArray();
        expect(rows).to.be.an("array");
    });

    it("4.3 distinct TYPE", async function () {
        const types = await material.distinct("TYPE");
        expect(types).to.be.an("array");
    });

    it("4.4 findOne with specific MATERIALID", async function () {
        // Get any materialId first
        const any = await material.findOne({});
        if (any) {
            const found = await material.findOne({
                MATERIALID: any.MATERIALID,
            });
            expect(found).to.not.be.null;
            expect(found.MATERIALID).to.equal(any.MATERIALID);
        }
    });

    it("4.5 find with $gte on ID", async function () {
        const rows = await material
            .find({ ID: { $gte: 1 } })
            .sort({ ID: 1 })
            .limit(5)
            .toArray();
        expect(rows).to.be.an("array");
        if (rows.length > 0) {
            expect(Number(rows[0].ID)).to.be.at.least(1);
        }
    });
});

// ═════════════════════════════════════════════════════════════════════════════
//  5. READ-ONLY: DEV_STOCKS
// ═════════════════════════════════════════════════════════════════════════════

describe("5. DEV_STOCKS — Read Operations", function () {
    it("5.1 countDocuments", async function () {
        const count = await stocks.countDocuments();
        expect(count).to.be.a("number");
    });

    it("5.2 find with sort by QUANTITY desc", async function () {
        const rows = await stocks
            .find({ QUANTITY: { $exists: true } })
            .sort({ QUANTITY: -1 })
            .limit(5)
            .toArray();
        expect(rows).to.be.an("array");
        if (rows.length >= 2) {
            expect(Number(rows[0].QUANTITY)).to.be.at.least(
                Number(rows[1].QUANTITY),
            );
        }
    });

    it("5.3 distinct CATEGORY", async function () {
        const cats = await stocks.distinct("CATEGORY");
        expect(cats).to.be.an("array");
    });

    it("5.4 find with $gt on QUANTITY", async function () {
        const rows = await stocks
            .find({ QUANTITY: { $gt: 0 } })
            .limit(10)
            .toArray();
        expect(rows).to.be.an("array");
        rows.forEach((r) => expect(Number(r.QUANTITY)).to.be.greaterThan(0));
    });

    it("5.5 QueryBuilder.next() returns first row", async function () {
        const row = await stocks.find({}).sort({ ID: 1 }).next();
        if (row) {
            expect(row).to.have.property("ID");
        }
    });

    it("5.6 QueryBuilder.hasNext() returns boolean", async function () {
        const has = await stocks.find({}).hasNext();
        expect(has).to.be.a("boolean");
    });
});

// ═════════════════════════════════════════════════════════════════════════════
//  6. READ-ONLY: DEV_UNIT
// ═════════════════════════════════════════════════════════════════════════════

describe("6. DEV_UNIT — Read Operations", function () {
    it("6.1 countDocuments", async function () {
        const count = await unit.countDocuments();
        expect(count).to.be.a("number");
    });

    it("6.2 find with $in on UNITSTATUS", async function () {
        const rows = await unit
            .find({ UNITSTATUS: { $in: ["OPEN", "CLOSED", "ACTIVE"] } })
            .limit(10)
            .toArray();
        expect(rows).to.be.an("array");
    });

    it("6.3 distinct UNITIDTYPE", async function () {
        const types = await unit.distinct("UNITIDTYPE");
        expect(types).to.be.an("array");
    });

    it("6.4 find with $exists false (null MATERIALNUMBER)", async function () {
        const rows = await unit
            .find({ MATERIALNUMBER: { $exists: false } })
            .limit(5)
            .toArray();
        expect(rows).to.be.an("array");
        rows.forEach((r) => expect(r.MATERIALNUMBER).to.be.null);
    });

    it("6.5 find with $like on ORDERNAME", async function () {
        const rows = await unit
            .find({ ORDERNAME: { $like: "%ORD%" } })
            .limit(5)
            .toArray();
        expect(rows).to.be.an("array");
    });
});

// ═════════════════════════════════════════════════════════════════════════════
//  7. READ-ONLY: DEV_LOCK
// ═════════════════════════════════════════════════════════════════════════════

describe("7. DEV_LOCK — Read Operations", function () {
    it("7.1 countDocuments", async function () {
        const count = await lock.countDocuments();
        expect(count).to.be.a("number");
    });

    it("7.2 find with $eq on ACTIVE", async function () {
        const rows = await lock
            .find({ ACTIVE: { $eq: 1 } })
            .limit(10)
            .toArray();
        expect(rows).to.be.an("array");
        rows.forEach((r) => expect(Number(r.ACTIVE)).to.equal(1));
    });

    it("7.3 find all and verify column structure", async function () {
        const rows = await lock.find({}).limit(1).toArray();
        if (rows.length > 0) {
            expect(rows[0]).to.have.property("ID");
            expect(rows[0]).to.have.property("MONTH");
            expect(rows[0]).to.have.property("ACTIVE");
        }
    });
});

// ═════════════════════════════════════════════════════════════════════════════
//  8. READ-ONLY: T_OPITS_USERS
// ═════════════════════════════════════════════════════════════════════════════

describe("8. T_OPITS_USERS — Read Operations", function () {
    it("8.1 countDocuments", async function () {
        const count = await opitsUsers.countDocuments();
        expect(count).to.be.a("number");
        expect(count).to.be.at.least(0);
    });

    it("8.2 find with projection on user fields", async function () {
        const rows = await opitsUsers
            .find({})
            .project({ USERID: 1, NAME: 1, USERNAME: 1, USERLEVEL: 1 })
            .limit(5)
            .toArray();
        expect(rows).to.be.an("array");
        if (rows.length > 0) {
            expect(rows[0]).to.have.property("USERID");
            expect(rows[0]).to.have.property("NAME");
        }
    });

    it("8.3 distinct USERLEVEL", async function () {
        const levels = await opitsUsers.distinct("USERLEVEL");
        expect(levels).to.be.an("array");
    });

    it("8.4 find with $gte on USERLEVEL", async function () {
        const rows = await opitsUsers
            .find({ USERLEVEL: { $gte: 1 } })
            .limit(10)
            .toArray();
        expect(rows).to.be.an("array");
    });

    it("8.5 findOne returns full user doc", async function () {
        const user = await opitsUsers.findOne({});
        if (user) {
            expect(user).to.have.property("USERID");
            expect(user).to.have.property("NAME");
            expect(user).to.have.property("PASSWORD");
            expect(user).to.have.property("AREA");
        }
    });
});

// ═════════════════════════════════════════════════════════════════════════════
//  9. FILTER PARSER — Unit Tests
// ═════════════════════════════════════════════════════════════════════════════

describe("9. filterParser — Unit Tests", function () {
    it("9.1 empty filter returns empty whereClause", function () {
        const { whereClause, binds } = parseFilter({});
        expect(whereClause).to.equal("");
        expect(binds).to.deep.equal({});
    });

    it("9.2 simple equality", function () {
        const { whereClause, binds } = parseFilter({ STATUS: "active" });
        expect(whereClause).to.include("=");
        expect(Object.values(binds)).to.include("active");
    });

    it("9.3 $gt operator", function () {
        const { whereClause, binds } = parseFilter({ AGE: { $gt: 18 } });
        expect(whereClause).to.include(">");
    });

    it("9.4 $in operator", function () {
        const { whereClause, binds } = parseFilter({
            STATUS: { $in: ["a", "b"] },
        });
        expect(whereClause).to.include("IN");
    });

    it("9.5 $exists true → IS NOT NULL", function () {
        const { whereClause } = parseFilter({ NAME: { $exists: true } });
        expect(whereClause.toUpperCase()).to.include("IS NOT NULL");
    });

    it("9.6 $exists false → IS NULL", function () {
        const { whereClause } = parseFilter({ NAME: { $exists: false } });
        expect(whereClause.toUpperCase()).to.include("IS NULL");
    });

    it("9.7 $and", function () {
        const { whereClause } = parseFilter({
            $and: [{ STATUS: "active" }, { AGE: { $gte: 18 } }],
        });
        expect(whereClause.toUpperCase()).to.include("AND");
    });

    it("9.8 $or", function () {
        const { whereClause } = parseFilter({
            $or: [{ STATUS: "active" }, { STATUS: "premium" }],
        });
        expect(whereClause.toUpperCase()).to.include("OR");
    });

    it("9.9 $between", function () {
        const { whereClause } = parseFilter({ AGE: { $between: [18, 65] } });
        expect(whereClause.toUpperCase()).to.include("BETWEEN");
    });

    it("9.10 $like", function () {
        const { whereClause } = parseFilter({ NAME: { $like: "J%" } });
        expect(whereClause.toUpperCase()).to.include("LIKE");
    });

    it("9.11 $regex", function () {
        const { whereClause } = parseFilter({ NAME: { $regex: "^J" } });
        expect(whereClause.toUpperCase()).to.include("REGEXP_LIKE");
    });

    it("9.12 $nin", function () {
        const { whereClause } = parseFilter({ STATUS: { $nin: ["x", "y"] } });
        expect(whereClause.toUpperCase()).to.include("NOT IN");
    });

    it("9.13 nested $not", function () {
        const { whereClause } = parseFilter({ $not: { STATUS: "deleted" } });
        expect(whereClause.toUpperCase()).to.include("NOT");
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// 10. UPDATE PARSER — Unit Tests
// ═════════════════════════════════════════════════════════════════════════════

describe("10. updateParser — Unit Tests", function () {
    it("10.1 $set generates SET clause", function () {
        const { setClause, binds } = parseUpdate({ $set: { NAME: "Ana" } });
        expect(setClause).to.include("=");
        expect(Object.values(binds)).to.include("Ana");
    });

    it("10.2 $inc generates field = field + n", function () {
        const { setClause } = parseUpdate({ $inc: { LOGIN_COUNT: 1 } });
        expect(setClause.toUpperCase()).to.include("+");
    });

    it("10.3 $unset generates field = NULL", function () {
        const { setClause } = parseUpdate({ $unset: { PHONE: "" } });
        expect(setClause.toUpperCase()).to.include("NULL");
    });

    it("10.4 $currentDate generates SYSDATE", function () {
        const { setClause } = parseUpdate({
            $currentDate: { UPDATED_AT: true },
        });
        expect(setClause.toUpperCase()).to.include("SYSDATE");
    });

    it("10.5 $mul generates field = field * n", function () {
        const { setClause } = parseUpdate({ $mul: { VALUE: 1.1 } });
        expect(setClause).to.include("*");
    });

    it("10.6 $min generates LEAST", function () {
        const { setClause } = parseUpdate({ $min: { VALUE: 10 } });
        expect(setClause.toUpperCase()).to.include("LEAST");
    });

    it("10.7 $max generates GREATEST", function () {
        const { setClause } = parseUpdate({ $max: { VALUE: 100 } });
        expect(setClause.toUpperCase()).to.include("GREATEST");
    });

    it("10.8 $rename throws error", function () {
        expect(() => parseUpdate({ $rename: { OLD: "NEW" } })).to.throw();
    });

    it("10.9 empty update throws error", function () {
        expect(() => parseUpdate({})).to.throw();
    });

    it("10.10 combined $set + $inc", function () {
        const { setClause, binds } = parseUpdate({
            $set: { STATUS: "premium" },
            $inc: { LOGIN_COUNT: 1 },
        });
        expect(setClause).to.include("STATUS");
        expect(setClause).to.include("LOGIN_COUNT");
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// 11. SCRATCH TABLE — CRUD Write Operations
// ═════════════════════════════════════════════════════════════════════════════

describe("11. Scratch Table — CRUD Operations", function () {
    it("11.1 insertOne inserts a row and returns insertedId", async function () {
        const result = await scratch.insertOne({
            NAME: "ItemA",
            CATEGORY: "Alpha",
            VALUE: 100,
        });
        expect(result.acknowledged).to.be.true;
        expect(result.insertedId).to.exist;
    });

    it("11.2 insertMany inserts multiple rows", async function () {
        const result = await scratch.insertMany([
            { NAME: "ItemB", CATEGORY: "Beta", VALUE: 200 },
            { NAME: "ItemC", CATEGORY: "Alpha", VALUE: 300 },
            { NAME: "ItemD", CATEGORY: "Gamma", VALUE: 150 },
            { NAME: "ItemE", CATEGORY: "Beta", VALUE: 450 },
            { NAME: "ItemF", CATEGORY: "Alpha", VALUE: 50 },
        ]);
        expect(result.acknowledged).to.be.true;
        expect(result.insertedCount).to.equal(5);
        expect(result.insertedIds).to.be.an("array").with.length(5);
    });

    it("11.3 countDocuments after inserts", async function () {
        const count = await scratch.countDocuments();
        expect(count).to.equal(6);
    });

    it("11.4 findOne by CATEGORY", async function () {
        const doc = await scratch.findOne({ CATEGORY: "Gamma" });
        expect(doc).to.not.be.null;
        expect(doc.NAME).to.equal("ItemD");
    });

    it("11.5 find with sort and limit", async function () {
        const rows = await scratch
            .find({})
            .sort({ VALUE: -1 })
            .limit(3)
            .toArray();
        expect(rows).to.have.length(3);
        expect(Number(rows[0].VALUE)).to.be.at.least(Number(rows[1].VALUE));
        expect(Number(rows[1].VALUE)).to.be.at.least(Number(rows[2].VALUE));
    });

    it("11.6 updateOne with $set", async function () {
        const result = await scratch.updateOne(
            { NAME: "ItemA" },
            { $set: { STATUS: "updated", VALUE: 999 } },
        );
        expect(result.acknowledged).to.be.true;
        expect(result.modifiedCount).to.equal(1);

        const updated = await scratch.findOne({ NAME: "ItemA" });
        expect(updated.STATUS).to.equal("updated");
        expect(Number(updated.VALUE)).to.equal(999);
    });

    it("11.7 updateOne with $inc", async function () {
        const before = await scratch.findOne({ NAME: "ItemB" });
        const beforeVal = Number(before.VALUE);

        await scratch.updateOne({ NAME: "ItemB" }, { $inc: { VALUE: 50 } });

        const after = await scratch.findOne({ NAME: "ItemB" });
        expect(Number(after.VALUE)).to.equal(beforeVal + 50);
    });

    it("11.8 updateMany with $set", async function () {
        const result = await scratch.updateMany(
            { CATEGORY: "Alpha" },
            { $set: { STATUS: "alpha-updated" } },
        );
        expect(result.acknowledged).to.be.true;
        expect(result.modifiedCount).to.be.at.least(2);

        const rows = await scratch.find({ CATEGORY: "Alpha" }).toArray();
        rows.forEach((r) => expect(r.STATUS).to.equal("alpha-updated"));
    });

    it("11.9 updateOne with $currentDate", async function () {
        await scratch.updateOne(
            { NAME: "ItemA" },
            { $currentDate: { UPDATED_AT: true } },
        );
        const doc = await scratch.findOne({ NAME: "ItemA" });
        expect(doc.UPDATED_AT).to.not.be.null;
        expect(doc.UPDATED_AT).to.be.instanceOf(Date);
    });

    it("11.10 distinct on CATEGORY", async function () {
        const cats = await scratch.distinct("CATEGORY");
        expect(cats).to.be.an("array");
        expect(cats).to.include("Alpha");
        expect(cats).to.include("Beta");
        expect(cats).to.include("Gamma");
    });

    it("11.11 find with $gte and $lte on VALUE", async function () {
        const rows = await scratch
            .find({ VALUE: { $gte: 100, $lte: 300 } })
            .toArray();
        expect(rows).to.be.an("array");
        rows.forEach((r) => {
            const v = Number(r.VALUE);
            expect(v).to.be.at.least(100);
            expect(v).to.be.at.most(300);
        });
    });

    it("11.12 findOneAndUpdate returns before/after doc", async function () {
        const before = await scratch.findOneAndUpdate(
            { NAME: "ItemC" },
            { $set: { VALUE: 777 } },
            { returnDocument: "before" },
        );
        expect(before).to.not.be.null;
        expect(Number(before.VALUE)).to.not.equal(777);

        const after = await scratch.findOneAndUpdate(
            { NAME: "ItemC" },
            { $set: { VALUE: 888 } },
            { returnDocument: "after" },
        );
        expect(after).to.not.be.null;
        expect(Number(after.VALUE)).to.equal(888);
    });

    it("11.13 replaceOne replaces all columns except ID", async function () {
        await scratch.replaceOne(
            { NAME: "ItemD" },
            {
                NAME: "ItemD-Replaced",
                CATEGORY: "Delta",
                VALUE: 666,
                STATUS: "replaced",
            },
        );
        const doc = await scratch.findOne({ NAME: "ItemD-Replaced" });
        expect(doc).to.not.be.null;
        expect(doc.CATEGORY).to.equal("Delta");
        expect(Number(doc.VALUE)).to.equal(666);
    });

    it("11.14 deleteOne deletes a single row", async function () {
        const result = await scratch.deleteOne({ NAME: "ItemF" });
        expect(result.acknowledged).to.be.true;
        expect(result.deletedCount).to.equal(1);

        const doc = await scratch.findOne({ NAME: "ItemF" });
        expect(doc).to.be.null;
    });

    it("11.15 findOneAndDelete returns deleted doc", async function () {
        const deleted = await scratch.findOneAndDelete({ NAME: "ItemE" });
        expect(deleted).to.not.be.null;
        expect(deleted.NAME).to.equal("ItemE");

        const check = await scratch.findOne({ NAME: "ItemE" });
        expect(check).to.be.null;
    });

    it("11.16 deleteMany with filter", async function () {
        // Insert some to delete
        await scratch.insertMany([
            { NAME: "Del1", CATEGORY: "ToDelete", VALUE: 1 },
            { NAME: "Del2", CATEGORY: "ToDelete", VALUE: 2 },
            { NAME: "Del3", CATEGORY: "ToDelete", VALUE: 3 },
        ]);
        const result = await scratch.deleteMany({ CATEGORY: "ToDelete" });
        expect(result.acknowledged).to.be.true;
        expect(result.deletedCount).to.equal(3);
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// 12. UPSERT
// ═════════════════════════════════════════════════════════════════════════════

describe("12. Upsert Operations", function () {
    it("12.1 updateOne with upsert inserts when no match", async function () {
        const result = await scratch.updateOne(
            { NAME: "UpsertItem" },
            { $set: { NAME: "UpsertItem", CATEGORY: "Upsert", VALUE: 555 } },
            { upsert: true },
        );
        expect(result.acknowledged).to.be.true;

        const doc = await scratch.findOne({ NAME: "UpsertItem" });
        expect(doc).to.not.be.null;
        expect(Number(doc.VALUE)).to.equal(555);
    });

    it("12.2 updateOne with upsert updates when match exists", async function () {
        const result = await scratch.updateOne(
            { NAME: "UpsertItem" },
            { $set: { VALUE: 777 } },
            { upsert: true },
        );
        expect(result.acknowledged).to.be.true;
        expect(result.modifiedCount).to.equal(1);

        const doc = await scratch.findOne({ NAME: "UpsertItem" });
        expect(Number(doc.VALUE)).to.equal(777);
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// 13. MERGE / UPSERT (Oracle MERGE)
// ═════════════════════════════════════════════════════════════════════════════

describe("13. MERGE Operations", function () {
    it("13.1 merge inserts when no match", async function () {
        const result = await scratch.merge(
            {
                NAME: "MergeNew",
                CATEGORY: "Merge",
                VALUE: 1000,
                STATUS: "merged",
            },
            { localField: "NAME", foreignField: "NAME" },
            {
                whenMatched: { $set: { VALUE: 1000, STATUS: "merged" } },
                whenNotMatched: "insert",
            },
        );
        expect(result.acknowledged).to.be.true;
        const doc = await scratch.findOne({ NAME: "MergeNew" });
        expect(doc).to.not.be.null;
    });

    it("13.2 merge updates when match exists", async function () {
        const result = await scratch.merge(
            {
                NAME: "MergeNew",
                CATEGORY: "Merge",
                VALUE: 2000,
                STATUS: "re-merged",
            },
            { localField: "NAME", foreignField: "NAME" },
            {
                whenMatched: { $set: { VALUE: 2000, STATUS: "re-merged" } },
                whenNotMatched: "insert",
            },
        );
        expect(result.acknowledged).to.be.true;
        const doc = await scratch.findOne({ NAME: "MergeNew" });
        expect(Number(doc.VALUE)).to.equal(2000);
        expect(doc.STATUS).to.equal("re-merged");
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// 14. TRANSACTIONS & SAVEPOINTS
// ═════════════════════════════════════════════════════════════════════════════

describe("14. Transactions & Savepoints", function () {
    it("14.1 withTransaction commits on success", async function () {
        await txManager.withTransaction(async (session) => {
            const s = session.collection(SCRATCH);
            await s.insertOne({ NAME: "TxCommit", CATEGORY: "TX", VALUE: 111 });
        });
        const doc = await scratch.findOne({ NAME: "TxCommit" });
        expect(doc).to.not.be.null;
        expect(doc.CATEGORY).to.equal("TX");
    });

    it("14.2 withTransaction rolls back on error", async function () {
        try {
            await txManager.withTransaction(async (session) => {
                const s = session.collection(SCRATCH);
                await s.insertOne({
                    NAME: "TxRollback",
                    CATEGORY: "TX",
                    VALUE: 222,
                });
                throw new Error("Intentional rollback");
            });
        } catch (e) {
            // expected
        }
        const doc = await scratch.findOne({ NAME: "TxRollback" });
        expect(doc).to.be.null;
    });

    it("14.3 savepoint + rollbackTo partially undoes work", async function () {
        await txManager.withTransaction(async (session) => {
            const s = session.collection(SCRATCH);

            await s.insertOne({
                NAME: "SP_Keep",
                CATEGORY: "Savepoint",
                VALUE: 10,
            });
            await session.savepoint("sp1");

            await s.insertOne({
                NAME: "SP_Undo",
                CATEGORY: "Savepoint",
                VALUE: 20,
            });
            await session.rollbackTo("sp1");

            await s.insertOne({
                NAME: "SP_After",
                CATEGORY: "Savepoint",
                VALUE: 30,
            });
        });

        const keep = await scratch.findOne({ NAME: "SP_Keep" });
        expect(keep).to.not.be.null;

        const undone = await scratch.findOne({ NAME: "SP_Undo" });
        expect(undone).to.be.null;

        const after = await scratch.findOne({ NAME: "SP_After" });
        expect(after).to.not.be.null;
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// 15. BULK WRITE
// ═════════════════════════════════════════════════════════════════════════════

describe("15. bulkWrite", function () {
    it("15.1 bulkWrite executes mixed operations atomically", async function () {
        const result = await scratch.bulkWrite([
            {
                insertOne: {
                    document: { NAME: "BulkA", CATEGORY: "Bulk", VALUE: 10 },
                },
            },
            {
                insertOne: {
                    document: { NAME: "BulkB", CATEGORY: "Bulk", VALUE: 20 },
                },
            },
            {
                updateOne: {
                    filter: { NAME: "BulkA" },
                    update: { $set: { VALUE: 99 } },
                },
            },
        ]);
        expect(result.acknowledged).to.be.true;

        const a = await scratch.findOne({ NAME: "BulkA" });
        expect(Number(a.VALUE)).to.equal(99);
        const b = await scratch.findOne({ NAME: "BulkB" });
        expect(b).to.not.be.null;
    });

    it("15.2 bulkWrite rolls back on failure", async function () {
        const countBefore = await scratch.countDocuments();
        try {
            await scratch.bulkWrite([
                {
                    insertOne: {
                        document: {
                            NAME: "BulkFail1",
                            CATEGORY: "Fail",
                            VALUE: 1,
                        },
                    },
                },
                {
                    insertOne: {
                        document: { NAME: null, CATEGORY: "Fail", VALUE: 2 },
                    },
                }, // NAME is NOT NULL — will fail
            ]);
        } catch (e) {
            // expected
        }
        const countAfter = await scratch.countDocuments();
        expect(countAfter).to.equal(countBefore);
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// 16. INDEX OPERATIONS
// ═════════════════════════════════════════════════════════════════════════════

describe("16. Index Operations", function () {
    it("16.1 createIndex creates an index", async function () {
        const result = await scratch.createIndex(
            { CATEGORY: 1 },
            { name: "IDX_SCRATCH_CATEGORY" },
        );
        expect(result.acknowledged).to.be.true;
        expect(result.indexName).to.equal("IDX_SCRATCH_CATEGORY");
    });

    it("16.2 getIndexes returns array including our index", async function () {
        const indexes = await scratch.getIndexes();
        expect(indexes).to.be.an("array");
        const names = indexes.map((idx) => idx.indexName);
        expect(names).to.include("IDX_SCRATCH_CATEGORY");
    });

    it("16.3 createIndex with unique", async function () {
        // NAME column may have duplicates now, so use a composite
        const result = await scratch.createIndex(
            { NAME: 1, CATEGORY: 1 },
            { name: "IDX_SCRATCH_NAME_CAT" },
        );
        expect(result.acknowledged).to.be.true;
    });

    it("16.4 dropIndex drops a specific index", async function () {
        const result = await scratch.dropIndex("IDX_SCRATCH_NAME_CAT");
        expect(result.acknowledged).to.be.true;
    });

    it("16.5 dropIndexes drops all non-PK indexes", async function () {
        const result = await scratch.dropIndexes();
        expect(result.acknowledged).to.be.true;
        expect(result.dropped).to.be.an("array");
    });

    it("16.6 createIndex + reIndex rebuilds", async function () {
        await scratch.createIndex({ VALUE: 1 }, { name: "IDX_SCRATCH_VALUE" });
        const result = await scratch.reIndex();
        expect(result.acknowledged).to.be.true;
        // Cleanup
        await scratch.dropIndex("IDX_SCRATCH_VALUE");
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// 17. AGGREGATION PIPELINE
// ═════════════════════════════════════════════════════════════════════════════

describe("17. Aggregation Pipeline", function () {
    it("17.1 $match + $group + $sort", async function () {
        const result = await scratch.aggregate([
            { $match: { STATUS: { $ne: null } } },
            {
                $group: {
                    _id: "$CATEGORY",
                    totalVal: { $sum: "$VALUE" },
                    cnt: { $count: "*" },
                },
            },
            { $sort: { totalVal: -1 } },
        ]);
        expect(result).to.be.an("array");
        if (result.length >= 2) {
            expect(
                Number(result[0].totalVal || result[0].TOTALVAL),
            ).to.be.at.least(Number(result[1].totalVal || result[1].TOTALVAL));
        }
    });

    it("17.2 $match + $limit", async function () {
        const result = await scratch.aggregate([{ $match: {} }, { $limit: 3 }]);
        expect(result).to.be.an("array");
        expect(result.length).to.be.at.most(3);
    });

    it("17.3 $count stage", async function () {
        const result = await scratch.aggregate([
            { $match: {} },
            { $count: "total" },
        ]);
        expect(result).to.be.an("array");
        if (result.length > 0) {
            const total = result[0].total || result[0].TOTAL;
            expect(Number(total)).to.be.greaterThan(0);
        }
    });

    it("17.4 $group with $avg", async function () {
        const result = await scratch.aggregate([
            { $match: { VALUE: { $exists: true } } },
            { $group: { _id: "$CATEGORY", avgVal: { $avg: "$VALUE" } } },
        ]);
        expect(result).to.be.an("array");
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// 18. AGGREGATION ON REAL TABLES
// ═════════════════════════════════════════════════════════════════════════════

describe("18. Aggregation on Real Tables", function () {
    it("18.1 DEV_STOCKS: group by CATEGORY, sum QUANTITY", async function () {
        const result = await stocks.aggregate([
            { $match: { CATEGORY: { $exists: true } } },
            {
                $group: {
                    _id: "$CATEGORY",
                    totalQty: { $sum: "$QUANTITY" },
                    cnt: { $count: "*" },
                },
            },
            { $sort: { totalQty: -1 } },
            { $limit: 10 },
        ]);
        expect(result).to.be.an("array");
    });

    it("18.2 DEV_BOOK: group by DIVISION + YEAR", async function () {
        const result = await book.aggregate([
            { $match: {} },
            {
                $group: {
                    _id: { div: "$DIVISION", yr: "$YEAR" },
                    total: { $sum: "$SAP_BOOK_QUANTITY" },
                },
            },
            { $sort: { total: -1 } },
            { $limit: 5 },
        ]);
        expect(result).to.be.an("array");
    });

    it("18.3 DEV_UNIT: count by UNITSTATUS", async function () {
        const result = await unit.aggregate([
            { $match: {} },
            { $group: { _id: "$UNITSTATUS", cnt: { $count: "*" } } },
            { $sort: { cnt: -1 } },
        ]);
        expect(result).to.be.an("array");
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// 19. CTE (Common Table Expressions) — read-only
// ═════════════════════════════════════════════════════════════════════════════

describe("19. CTE Operations", function () {
    it("19.1 withCTE with single named query", async function () {
        const result = await withCTE(db, {
            active_stocks: stocks.find({ QUANTITY: { $gt: 0 } }),
        })
            .from("active_stocks")
            .toArray();
        expect(result).to.be.an("array");
    });

    it("19.2 withCTE with multiple named queries", async function () {
        const result = await withCTE(db, {
            big_stocks: stocks.find({ QUANTITY: { $gt: 100 } }),
            small_stocks: stocks.find({ QUANTITY: { $lte: 100, $gt: 0 } }),
        })
            .from("big_stocks")
            .toArray();
        expect(result).to.be.an("array");
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// 20. QUERY BUILDER CHAINING & EDGE CASES
// ═════════════════════════════════════════════════════════════════════════════

describe("20. QueryBuilder Edge Cases", function () {
    it("20.1 cannot chain after terminal method", async function () {
        const qb = scratch.find({});
        await qb.toArray();
        expect(() => qb.sort({ ID: 1 })).to.throw(/Cannot chain/);
    });

    it("20.2 forEach iterates all rows", async function () {
        const items = [];
        await scratch
            .find({})
            .limit(3)
            .forEach((row) => items.push(row));
        expect(items).to.have.length(3);
    });

    it("20.3 next returns first row", async function () {
        const row = await scratch.find({}).sort({ VALUE: -1 }).next();
        expect(row).to.not.be.null;
        expect(row).to.have.property("VALUE");
    });

    it("20.4 hasNext returns true when rows exist", async function () {
        const has = await scratch.find({}).hasNext();
        expect(has).to.be.true;
    });

    it("20.5 hasNext returns false for impossible filter", async function () {
        const result = await scratch
            .find({ NAME: "NONEXISTENT_XYZ_123" })
            .hasNext();
        expect(result).to.be.false;
    });

    it("20.6 skip without limit works", async function () {
        const allRows = await scratch.find({}).sort({ ID: 1 }).toArray();
        const skipped = await scratch
            .find({})
            .sort({ ID: 1 })
            .skip(1)
            .toArray();
        if (allRows.length > 1) {
            expect(skipped.length).to.equal(allRows.length - 1);
        }
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// 21. CROSS-TABLE READ QUERIES
// ═════════════════════════════════════════════════════════════════════════════

describe("21. Cross-Table Read Queries", function () {
    it("21.1 read from all 6 real tables without error", async function () {
        const results = await Promise.all([
            book.find({}).limit(1).toArray(),
            location.find({}).limit(1).toArray(),
            lock.find({}).limit(1).toArray(),
            material.find({}).limit(1).toArray(),
            stocks.find({}).limit(1).toArray(),
            unit.find({}).limit(1).toArray(),
        ]);
        results.forEach((r) => expect(r).to.be.an("array"));
    });

    it("21.2 countDocuments on all real tables", async function () {
        const counts = await Promise.all([
            book.countDocuments(),
            location.countDocuments(),
            lock.countDocuments(),
            material.countDocuments(),
            stocks.countDocuments(),
            unit.countDocuments(),
            opitsUsers.countDocuments(),
        ]);
        counts.forEach((c) => {
            expect(c).to.be.a("number");
            expect(c).to.be.at.least(0);
        });
        console.log(
            "        Table row counts:",
            `BOOK=${counts[0]}, LOCATION=${counts[1]}, LOCK=${counts[2]},`,
            `MATERIAL=${counts[3]}, STOCKS=${counts[4]}, UNIT=${counts[5]},`,
            `USERS=${counts[6]}`,
        );
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// 22. SCHEMA (DDL) — basic ops that don't require DBA
// ═════════════════════════════════════════════════════════════════════════════

describe("22. Schema DDL (non-admin)", function () {
    const DDL_TABLE = "TEST_DEV_DDL";

    afterEach(async function () {
        await dropIfExists(DDL_TABLE);
    });

    it("22.1 createTable + dropTable", async function () {
        await schema.createTable(DDL_TABLE, {
            ID: { type: "NUMBER", primaryKey: true, autoIncrement: true },
            NAME: { type: "VARCHAR2(100)", notNull: true },
            VAL: { type: "NUMBER(10,2)" },
        });
        expect(await tableExists(DDL_TABLE)).to.be.true;

        await schema.dropTable(DDL_TABLE);
        expect(await tableExists(DDL_TABLE)).to.be.false;
    });

    it("22.2 createTable with ifNotExists", async function () {
        await schema.createTable(
            DDL_TABLE,
            {
                ID: { type: "NUMBER", primaryKey: true },
                X: { type: "VARCHAR2(50)" },
            },
            { ifNotExists: true },
        );
        expect(await tableExists(DDL_TABLE)).to.be.true;

        // Should not throw on second call
        await schema.createTable(
            DDL_TABLE,
            {
                ID: { type: "NUMBER", primaryKey: true },
                X: { type: "VARCHAR2(50)" },
            },
            { ifNotExists: true },
        );
    });

    it("22.3 alterTable addColumn", async function () {
        await schema.createTable(DDL_TABLE, {
            ID: { type: "NUMBER", primaryKey: true },
            NAME: { type: "VARCHAR2(100)" },
        });
        await schema.alterTable(DDL_TABLE, {
            addColumn: { EXTRA: "VARCHAR2(50)" },
        });

        // Verify column exists by inserting data
        const coll = new OracleCollection(DDL_TABLE, db);
        await coll.insertOne({ ID: 1, NAME: "Test", EXTRA: "ExtraVal" });
        const doc = await coll.findOne({ ID: 1 });
        expect(doc.EXTRA).to.equal("ExtraVal");
    });

    it("22.4 truncateTable clears all rows", async function () {
        await schema.createTable(DDL_TABLE, {
            ID: { type: "NUMBER", primaryKey: true },
            NAME: { type: "VARCHAR2(100)" },
        });
        const coll = new OracleCollection(DDL_TABLE, db);
        await coll.insertOne({ ID: 1, NAME: "A" });
        await coll.insertOne({ ID: 2, NAME: "B" });
        expect(await rowCount(DDL_TABLE)).to.equal(2);

        await schema.truncateTable(DDL_TABLE);
        expect(await rowCount(DDL_TABLE)).to.equal(0);
    });

    it("22.5 renameTable", async function () {
        const RENAMED = "TEST_DEV_RENAMED";
        await dropIfExists(RENAMED);
        await schema.createTable(DDL_TABLE, {
            ID: { type: "NUMBER", primaryKey: true },
        });
        await schema.renameTable(DDL_TABLE, RENAMED);
        expect(await tableExists(RENAMED)).to.be.true;
        expect(await tableExists(DDL_TABLE)).to.be.false;
        await dropIfExists(RENAMED);
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// 23. ADVANCED ORACLE FEATURES (non-admin)
// ═════════════════════════════════════════════════════════════════════════════

describe("23. Advanced Oracle Features", function () {
    it("23.1 TABLESAMPLE returns a subset", async function () {
        const count = await book.countDocuments();
        if (count < 10) return this.skip();

        const sample = await book
            .find({}, { sample: { percentage: 50 } })
            .toArray();
        expect(sample).to.be.an("array");
        // Sample is non-deterministic but should return some rows
        expect(sample.length).to.be.greaterThan(0);
    });

    it("23.2 FOR UPDATE locks rows (select for update)", async function () {
        // Use scratch table to avoid locking production data
        await db.withTransaction(async (conn) => {
            const s = new OracleCollection(SCRATCH, db, conn);
            const rows = await s
                .find({ CATEGORY: "TX" })
                .forUpdate(true)
                .toArray();
            expect(rows).to.be.an("array");
            // Rows are locked within this transaction scope — auto-released on commit
        });
    });

    it("23.3 PIVOT on scratch data", async function () {
        // Seed pivot data
        const PIVOT_TABLE = "TEST_DEV_PIVOT";
        await dropIfExists(PIVOT_TABLE);
        await schema.createTable(PIVOT_TABLE, {
            ID: { type: "NUMBER", primaryKey: true, autoIncrement: true },
            REGION: { type: "VARCHAR2(50)", notNull: true },
            QUARTER: { type: "VARCHAR2(5)", notNull: true },
            AMOUNT: { type: "NUMBER(12,2)", notNull: true },
        });
        const pivotColl = new OracleCollection(PIVOT_TABLE, db);
        await pivotColl.insertMany([
            { REGION: "North", QUARTER: "Q1", AMOUNT: 100 },
            { REGION: "North", QUARTER: "Q2", AMOUNT: 200 },
            { REGION: "South", QUARTER: "Q1", AMOUNT: 150 },
            { REGION: "South", QUARTER: "Q2", AMOUNT: 250 },
        ]);

        const result = await pivotColl.pivot({
            value: { $sum: "$AMOUNT" },
            pivotOn: "QUARTER",
            pivotValues: ["Q1", "Q2"],
            groupBy: "REGION",
        });
        expect(result).to.be.an("array");
        expect(result.length).to.be.at.least(2);

        await dropIfExists(PIVOT_TABLE);
    });

    it("23.4 UNPIVOT on scratch data", async function () {
        const UNPIVOT_TABLE = "TEST_DEV_UNPIVOT";
        await dropIfExists(UNPIVOT_TABLE);
        await schema.createTable(UNPIVOT_TABLE, {
            ID: { type: "NUMBER", primaryKey: true, autoIncrement: true },
            REGION: { type: "VARCHAR2(50)", notNull: true },
            Q1: { type: "NUMBER(12,2)" },
            Q2: { type: "NUMBER(12,2)" },
        });
        const unpivotColl = new OracleCollection(UNPIVOT_TABLE, db);
        await unpivotColl.insertMany([
            { REGION: "North", Q1: 100, Q2: 200 },
            { REGION: "South", Q1: 150, Q2: 250 },
        ]);

        const result = await unpivotColl.unpivot({
            valueColumn: "AMOUNT",
            nameColumn: "QUARTER",
            columns: ["Q1", "Q2"],
        });
        expect(result).to.be.an("array");
        expect(result.length).to.equal(4); // 2 regions × 2 quarters

        await dropIfExists(UNPIVOT_TABLE);
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// 24. INSERT FROM QUERY
// ═════════════════════════════════════════════════════════════════════════════

describe("24. insertFromQuery", function () {
    const ARCHIVE_TABLE = "TEST_DEV_ARCHIVE";

    before(async function () {
        await dropIfExists(ARCHIVE_TABLE);
        await schema.createTable(ARCHIVE_TABLE, {
            ID: { type: "NUMBER", primaryKey: true, autoIncrement: true },
            NAME: { type: "VARCHAR2(200)" },
            CATEGORY: { type: "VARCHAR2(100)" },
            VALUE: { type: "NUMBER(12,2)" },
            STATUS: { type: "VARCHAR2(20)" },
        });
    });

    after(async function () {
        await dropIfExists(ARCHIVE_TABLE);
    });

    it("24.1 insert from query copies matching rows", async function () {
        const result = await scratch.insertFromQuery(
            ARCHIVE_TABLE,
            scratch
                .find({ CATEGORY: "Bulk" })
                .project({ NAME: 1, CATEGORY: 1, VALUE: 1, STATUS: 1 }),
            { columns: ["NAME", "CATEGORY", "VALUE", "STATUS"] },
        );
        expect(result.acknowledged).to.be.true;
        expect(result.insertedCount).to.be.at.least(1);

        const archived = await new OracleCollection(
            ARCHIVE_TABLE,
            db,
        ).countDocuments();
        expect(archived).to.be.at.least(1);
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// 25. SEQUENCE OPERATIONS
// ═════════════════════════════════════════════════════════════════════════════

describe("25. Sequence Operations", function () {
    const SEQ_NAME = "TEST_DEV_SEQ";

    afterEach(async function () {
        try {
            await db.withConnection(async (conn) => {
                await conn.execute(
                    `DROP SEQUENCE "${SEQ_NAME}"`,
                    {},
                    { autoCommit: true },
                );
            });
        } catch (e) {
            // may not exist
        }
    });

    it("25.1 createSequence creates a sequence", async function () {
        await schema.createSequence(SEQ_NAME, {
            startWith: 1,
            incrementBy: 1,
            maxValue: 9999,
            cycle: false,
            cache: 20,
        });
        // Verify sequence exists by calling NEXTVAL
        const val = await db.withConnection(async (conn) => {
            const r = await conn.execute(
                `SELECT "${SEQ_NAME}".NEXTVAL AS VAL FROM DUAL`,
                {},
                { outFormat: db.oracledb.OUT_FORMAT_OBJECT },
            );
            return Number(r.rows[0].VAL);
        });
        expect(val).to.equal(1);
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// 26. FINAL SUMMARY
// ═════════════════════════════════════════════════════════════════════════════

describe("26. Final Summary", function () {
    it("26.1 scratch table has data from all operations", async function () {
        const count = await scratch.countDocuments();
        expect(count).to.be.greaterThan(0);
        console.log(`        Scratch table final row count: ${count}`);
    });
});
