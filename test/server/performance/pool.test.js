"use strict";

const { expect } = require("chai");
const sinon = require("sinon");
const config = require("../../../src/config");
const { connections } = require("../../../src/config/database");

/**
 * Pool performance tests.
 *
 * Each test registers a unique temporary connection name in database.js
 * so it gets a fresh, uncached pool from the module-level poolRegistry
 * inside oracle.js. oracledb.createPool is stubbed to return fake pools.
 *
 * _createPool validates every new pool by calling pool.getConnection() →
 * conn.ping() → conn.close() before returning. This "validation conn"
 * is _allConns[0]; the conn used by the actual test is _allConns[1+].
 */
describe("DB Pool Performance", function () {
    let poolCounter = 0;

    function testPoolName() {
        return `perf_test_${++poolCounter}_${Date.now()}`;
    }

    function fakeConn(delayMs = 0) {
        return {
            execute: sinon.stub().callsFake(async () => {
                if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
                return { rows: [{ RESULT: 1 }] };
            }),
            ping: sinon.stub().resolves(),
            commit: sinon.stub().resolves(),
            rollback: sinon.stub().resolves(),
            close: sinon.stub().resolves(),
        };
    }

    function fakePool(opts = {}) {
        const allConns = [];
        const pool = {
            poolMin: opts.poolMin ?? 2,
            poolMax: opts.poolMax ?? 5,
            connectionsOpen: 0,
            connectionsInUse: 0,
            queueLength: 0,
            getConnection: sinon.stub().callsFake(async () => {
                const c = fakeConn(opts.connDelay ?? 0);
                pool.connectionsOpen++;
                pool.connectionsInUse++;
                const origClose = c.close;
                c.close = sinon.stub().callsFake(async () => {
                    pool.connectionsInUse--;
                    return origClose();
                });
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

    // ── Tests ──────────────────────────────────────────────────────────────

    it("withConnection acquires and releases within a reasonable time", async function () {
        const pool = fakePool();
        createPoolStub.resolves(pool);

        const start = process.hrtime.bigint();
        const result = await config.withConnection(
            this.poolName,
            async (conn) => {
                return conn.execute("SELECT 1 FROM DUAL");
            },
        );
        const elapsed = Number(process.hrtime.bigint() - start) / 1e6;

        expect(result).to.deep.equal({ rows: [{ RESULT: 1 }] });
        expect(elapsed).to.be.lessThan(500);
        // _allConns[0] = validation conn, [1] = user conn
        const userConn = pool._allConns[1];
        expect(userConn.close.calledOnce).to.be.true;
    });

    it("withConnection handles concurrent acquisitions correctly", async function () {
        const pool = fakePool({ connDelay: 5 });
        createPoolStub.resolves(pool);

        const CONCURRENT = 10;
        const start = process.hrtime.bigint();
        const results = await Promise.all(
            Array.from({ length: CONCURRENT }, (_, i) =>
                config.withConnection(this.poolName, async (conn) => {
                    return conn.execute(`SELECT ${i} FROM DUAL`);
                }),
            ),
        );
        const elapsed = Number(process.hrtime.bigint() - start) / 1e6;

        expect(results).to.have.length(CONCURRENT);
        results.forEach((r) => expect(r.rows).to.have.length(1));
        // 1 validation conn + 10 user conns = 11 total
        const userConns = pool._allConns.slice(1);
        expect(userConns).to.have.length(CONCURRENT);
        userConns.forEach((c) => expect(c.close.calledOnce).to.be.true);
        expect(elapsed).to.be.lessThan(3000);
    });

    it("withBatchConnection runs multiple ops on a single connection", async function () {
        const pool = fakePool();
        createPoolStub.resolves(pool);

        const operations = [
            async (conn) => conn.execute("SELECT 1 FROM DUAL"),
            async (conn) => conn.execute("SELECT 2 FROM DUAL"),
            async (conn) => conn.execute("SELECT 3 FROM DUAL"),
        ];

        const results = await config.withBatchConnection(
            this.poolName,
            operations,
        );

        expect(results).to.have.length(3);
        results.forEach((r, i) => {
            expect(r.success).to.be.true;
            expect(r.index).to.equal(i);
        });
        // 1 validation + 1 batch = 2 total; batch shares one connection
        expect(pool.getConnection.callCount).to.equal(2);
    });

    it("withTransaction commits on success", async function () {
        const pool = fakePool();
        createPoolStub.resolves(pool);

        const result = await config.withTransaction(
            this.poolName,
            async (conn) => {
                await conn.execute("INSERT INTO T VALUES (1)");
                return "committed";
            },
        );

        expect(result).to.equal("committed");
        const txnConn = pool._allConns[1];
        expect(txnConn.commit.calledOnce).to.be.true;
        expect(txnConn.rollback.called).to.be.false;
    });

    it("withTransaction rolls back on failure", async function () {
        const pool = fakePool();
        createPoolStub.resolves(pool);

        try {
            await config.withTransaction(this.poolName, async () => {
                throw new Error("deliberate failure");
            });
            expect.fail("should have thrown");
        } catch (err) {
            expect(err.message).to.include("deliberate failure");
        }

        const txnConn = pool._allConns[1];
        expect(txnConn.rollback.calledOnce).to.be.true;
        expect(txnConn.commit.called).to.be.false;
    });

    it("getPoolStats returns pool metrics after a connection is used", async function () {
        const pool = fakePool({ poolMin: 5, poolMax: 20 });
        createPoolStub.resolves(pool);

        await config.withConnection(this.poolName, async (conn) => {
            return conn.execute("SELECT 1 FROM DUAL");
        });

        const stats = await config.getPoolStats();
        expect(stats).to.have.property("timestamp").that.is.a("string");
        expect(stats).to.have.property("healthMetrics").that.is.an("object");
        expect(stats).to.have.property("pools").that.is.an("object");
        expect(stats.pools[this.poolName]).to.have.property("poolMin");
        expect(stats.pools[this.poolName]).to.have.property("poolMax");
        expect(stats.pools[this.poolName]).to.have.property("connectionsOpen");
    });
});
