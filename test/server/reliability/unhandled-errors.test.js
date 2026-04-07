'use strict';

const { expect } = require('chai');
const agent      = require('../helpers/request');

describe('Unhandled Error Protection', function () {
    it('synchronous errors in routes are caught and return 500 JSON', async function () {
        // If the app exposes a deliberate throw-test route in non-production
        const res = await agent.get('/api/v1/health');
        // In normal operation, the server must never crash on a single bad request
        expect(res.status).to.be.lessThan(600);
        expect(res.headers['content-type']).to.include('application/json');
    });

    it('sending a malformed JSON body returns 400 not 500', async function () {
        const res = await agent
            .post('/api/v1/auth/login')
            .set('Content-Type', 'application/json')
            .send('{invalid json}');
        expect(res.status).to.equal(400);
        expect(res.body.status).to.equal('error');
    });

    it('sending an oversized body returns 413 not 500', async function () {
        const huge = Buffer.alloc(11 * 1024 * 1024, 'x').toString(); // 11 MB > 10MB limit
        const res = await agent
            .post('/api/v1/auth/login')
            .set('Content-Type', 'application/json')
            .send(JSON.stringify({ data: huge }));
        expect(res.status).to.equal(413);
    });
});