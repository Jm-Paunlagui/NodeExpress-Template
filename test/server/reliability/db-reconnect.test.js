"use strict";

const { expect } = require("chai");
const sinon = require("sinon");
const config = require("../../../src/config");
const { connections } = require("../../../src/config/database");

/**
 * DB reconnection & resilience tests.
 *
 * Each test registers a unique temporary connection name so it gets an
 * uncached pool. oracledb.createPool is stubbed to control pool behaviour.
 *
 * _createPool validates new pools via getConnection → ping → close before
 * returning, so stubs must account for this validation call (call index 0).
 */
describe("DB Reconnection & Resilience", function () {
    let poolCounter = 0;

    function testPoolName() {
        return `reconn_test_${++poolCounter}_${Date.now()}`;
    }

    function fakeConn() {
        return {
            execute: sinon.stub().resolves({ rows: [{ RESULT: 1 }] }),
            ping: sinon.stub().resolves(),
            commit: sinon.stub().resolves(),
            rollback: sinon.stub().resolves(),
            close: sinon.stub().resolves(),
        };
    }

    function fakePool() {
        const allConns = [];
        const pool = {
            poolMin: 2,
            poolMax: 10,
            connectionsOpen: 0,
            connectionsInUse: 0,
            queueLength: 0,
            getConnection: sinon.stub().callsFake(async () => {
                const c = fakeConn();
                allConns.push(c);
                return c;
            }),
            close: sinon.stub().resolves(),
            _allConns: allConns,
        };
        return pool;
    }

    let createPoolStub;

    beforeEach(function () {
        createPoolStub = sinon.stub(config.oracledb, "createPool");
        this.poolName = testPoolName();
        connections[this.poolName] = {
            user: "test_user",
            password: "test_pass",
            connectString: "localhost:1521/testdb",
        };
    });

    afterEach(function () {
        if (this.poolName) delete connections[this.poolName];
        sinon.restore();
    });

    // ── Error wrapping ────────────────────────────────────────────────────

    it("withConnection wraps errors with connectionName and duration metadata", async function () {
        // Pool validation (call 0) must succeed; user call (call 1) fails
        let callCount = 0;
        const pool = fakePool();
        pool.getConnection = sinon.stub().callsFake(async () => {
            callCount++;
            if (callCount === 1) return fakeConn(); // validation
            throw new Error("ORA-12541: TNS:no listener");
        });
        createPoolStub.resolves(pool);

        try {
            await config.withConnection(this.poolName, async (conn) => {
                return conn.execute("SELECT 1 FROM DUAL");
            });
            expect.fail("should have thrown");
        } catch (err) {
            expect(err.message).to.include(this.poolName);
            expect(err).to.have.property("connectionName", this.poolName);
            expect(err).to.have.property("durationMs").that.is.a("number");
            expect(err).to.have.property("originalError");
            expect(err.originalError.message).to.include("ORA-12541");
        }
    });

    it("withConnection releases connection even when callback throws", async function () {
        const pool = fakePool();
        createPoolStub.resolves(pool);

        try {
            await config.withConnection(this.poolName, async (conn) => {
                throw new Error("ORA-00942: table does not exist");
            });
        } catch {
            // expected
        }

        // _allConns[0] = validation, [1] = user conn — must be closed
        const userConn = pool._allConns[1];
        expect(userConn.close.calledOnce).to.be.true;
    });

    it("withTransaction rolls back and releases connection on callback failure", async function () {
        const pool = fakePool();
        createPoolStub.resolves(pool);

        try {
            await config.withTransaction(this.poolName, async (conn) => {
                await conn.execute("INSERT bad data");
                throw new Error("constraint violation");
            });
        } catch {
            // expected
        }

        const txnConn = pool._allConns[1];
        expect(txnConn.rollback.calledOnce).to.be.true;
        expect(txnConn.commit.called).to.be.false;
        expect(txnConn.close.calledOnce).to.be.true;
    });

    // ── Batch resilience ──────────────────────────────────────────────────

    it("withBatchConnection continues after non-fatal errors in individual ops", async function () {
        const pool = fakePool();
        createPoolStub.resolves(pool);

        const operations = [
            async (c) => c.execute("SELECT 1 FROM DUAL"),
            async () => {
                throw new Error("op 1 failed");
            },
            async (c) => c.execute("SELECT 3 FROM DUAL"),
        ];

        const results = await config.withBatchConnection(
            this.poolName,
            operations,
        );

        expect(results).to.have.length(3);
        expect(results[0].success).to.be.true;
        expect(results[1].success).to.be.false;
        expect(results[1].error).to.include("op 1 failed");
        expect(results[2].success).to.be.true;
    });

    it("withBatchConnection reports non-function entries as failures", async function () {
        const pool = fakePool();
        createPoolStub.resolves(pool);

        const operations = [
            async (c) => c.execute("SELECT 1 FROM DUAL"),
            "not a function",
            async (c) => c.execute("SELECT 3 FROM DUAL"),
        ];

        const results = await config.withBatchConnection(
            this.poolName,
            operations,
        );

        expect(results).to.have.length(3);
        expect(results[0].success).to.be.true;
        expect(results[1].success).to.be.false;
        expect(results[1].error).to.include("not a function");
        expect(results[2].success).to.be.true;
    });

    // ── Health monitoring ─────────────────────────────────────────────────

    it("isPoolHealthy returns true for a pool that has not been checked", function () {
        const healthy = config.isPoolHealthy(this.poolName);
        expect(healthy).to.be.true;
    });

    it("getHealthMetrics returns an object", function () {
        const metrics = config.getHealthMetrics();
        expect(metrics).to.be.an("object");
    });

    // ── Validation ────────────────────────────────────────────────────────

    it("withConnection rejects with TypeError when callback is not a function", async function () {
        try {
            await config.withConnection(this.poolName, "not a function");
            expect.fail("should have thrown");
        } catch (err) {
            expect(err).to.be.instanceOf(TypeError);
            expect(err.message).to.include("callback must be a function");
        }
    });

    it("withBatchConnection rejects with TypeError when operations is empty", async function () {
        try {
            await config.withBatchConnection(this.poolName, []);
            expect.fail("should have thrown");
        } catch (err) {
            expect(err).to.be.instanceOf(TypeError);
            expect(err.message).to.include("non-empty array");
        }
    });

    // ── oracle-mongo-wrapper integration ──────────────────────────────────

    it("createDb produces a db interface bound to the correct pool", function () {
        const { createDb } = require("../../../src/utils/oracle-mongo-wrapper");
        const db = createDb(this.poolName);

        expect(db).to.have.property("connectionName", this.poolName);
        expect(db.withConnection).to.be.a("function");
        expect(db.withTransaction).to.be.a("function");
        expect(db.withBatchConnection).to.be.a("function");
        expect(db.closePool).to.be.a("function");
        expect(db.getPoolStats).to.be.a("function");
        expect(db.isHealthy).to.be.a("function");
        expect(db.oracledb).to.equal(config.oracledb);
    });

    it("createDb withConnection delegates to the adapter correctly", async function () {
        const { createDb } = require("../../../src/utils/oracle-mongo-wrapper");
        const pool = fakePool();
        createPoolStub.resolves(pool);

        const db = createDb(this.poolName);
        const result = await db.withConnection(async (conn) => {
            return conn.execute("SELECT 1 FROM DUAL");
        });

        expect(result).to.deep.equal({ rows: [{ RESULT: 1 }] });
    });

    it("createDb throws TypeError for invalid connection name", function () {
        const { createDb } = require("../../../src/utils/oracle-mongo-wrapper");
        expect(() => createDb("")).to.throw(TypeError);
        expect(() => createDb(null)).to.throw(TypeError);
    });
});
