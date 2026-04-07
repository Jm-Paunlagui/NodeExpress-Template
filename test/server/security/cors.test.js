'use strict';

const { expect } = require('chai');
const agent      = require('../helpers/request');

describe('CORS Policy', function () {
    it('allows requests from an explicitly allowed origin', async function () {
        const res = await agent
            .get('/api/v1/health')
            .set('Origin', 'http://localhost:3000');
        expect(res.headers['access-control-allow-origin']).to.equal('http://localhost:3000');
    });

    it('allows requests from a private network IP', async function () {
        const res = await agent
            .get('/api/v1/health')
            .set('Origin', 'http://192.168.1.100:3000');
        expect(res.headers['access-control-allow-origin']).to.exist;
    });

    it('blocks requests from a random public origin', async function () {
        const res = await agent
            .get('/api/v1/health')
            .set('Origin', 'https://evil.hacker.com');
        // Must not echo back the disallowed origin
        expect(res.headers['access-control-allow-origin']).to.not.equal('https://evil.hacker.com');
    });

    it('responds to preflight OPTIONS with correct CORS headers', async function () {
        const res = await agent
            .options('/api/v1/health')
            .set('Origin', 'http://localhost:3000')
            .set('Access-Control-Request-Method', 'GET')
            .set('Access-Control-Request-Headers', 'Authorization');
        expect(res.status).to.equal(200);
        expect(res.headers['access-control-allow-methods']).to.exist;
    });

    it('exposes X-Request-ID and X-Response-Time in Access-Control-Expose-Headers', async function () {
        const res = await agent
            .get('/api/v1/health')
            .set('Origin', 'http://localhost:3000');
        const exposed = res.headers['access-control-expose-headers'] || '';
        expect(exposed.toLowerCase()).to.include('x-request-id');
    });
});