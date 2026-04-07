'use strict';

const { expect } = require('chai');
const agent      = require('../helpers/request');

describe('GET /api/v1/health', function () {
    it('returns 200 with status "success"', async function () {
        const res = await agent.get('/api/v1/health');
        expect(res.status).to.equal(200);
        expect(res.body.status).to.equal('success');
    });

    it('response body includes uptime, timestamp, environment, and host', async function () {
        const res = await agent.get('/api/v1/health');
        const { data } = res.body;
        expect(data).to.have.property('uptime').that.is.a('number');
        expect(data).to.have.property('timestamp');
        expect(data).to.have.property('environment');
        expect(data).to.have.property('host');
    });

    it('responds in under 500ms', async function () {
        const start = Date.now();
        await agent.get('/api/v1/health');
        expect(Date.now() - start).to.be.lessThan(500);
    });

    it('sets X-Request-ID header on every response', async function () {
        const res = await agent.get('/api/v1/health');
        expect(res.headers).to.have.property('x-request-id');
        expect(res.headers['x-request-id']).to.match(/^req_/);
    });
});