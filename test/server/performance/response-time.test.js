'use strict';

const { expect } = require('chai');
const agent      = require('../helpers/request');

// Warm the pool before running timing assertions
before(async function () {
    this.timeout(15_000);
    await agent.get('/api/v1/health');
});

describe('Response Time Budgets', function () {
    describe('GET /api/v1/health', function () {
        it('p50 (median of 20 runs) is under 50ms', async function () {
            const times = [];
            for (let i = 0; i < 20; i++) {
                const start = process.hrtime.bigint();
                await agent.get('/api/v1/health');
                times.push(Number(process.hrtime.bigint() - start) / 1e6);
            }
            times.sort((a, b) => a - b);
            const p50 = times[Math.floor(times.length * 0.5)];
            expect(p50).to.be.lessThan(50);
        });

        it('p95 (95th percentile of 20 runs) is under 200ms', async function () {
            const times = [];
            for (let i = 0; i < 20; i++) {
                const start = process.hrtime.bigint();
                await agent.get('/api/v1/health');
                times.push(Number(process.hrtime.bigint() - start) / 1e6);
            }
            times.sort((a, b) => a - b);
            const p95 = times[Math.floor(times.length * 0.95)];
            expect(p95).to.be.lessThan(200);
        });

        it('X-Response-Time header is present and numeric', async function () {
            const res = await agent.get('/api/v1/health');
            const rt = res.headers['x-response-time'];
            expect(rt).to.match(/^\d+ms$/);
            expect(parseInt(rt, 10)).to.be.a('number');
        });
    });
});