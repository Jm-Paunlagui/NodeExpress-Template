'use strict';

const { expect } = require('chai');
const agent      = require('../helpers/request');

describe('Security Headers (Helmet)', function () {
    let headers;

    before(async function () {
        const res = await agent.get('/api/v1/health');
        headers = res.headers;
    });

    it('sets X-Content-Type-Options: nosniff', function () {
        expect(headers['x-content-type-options']).to.equal('nosniff');
    });

    it('sets X-Frame-Options to deny framing', function () {
        expect(headers['x-frame-options']).to.equal('DENY');
    });

    it('sets Strict-Transport-Security', function () {
        expect(headers['strict-transport-security']).to.exist;
        expect(headers['strict-transport-security']).to.include('max-age=');
    });

    it('sets Content-Security-Policy', function () {
        expect(headers['content-security-policy']).to.exist;
        expect(headers['content-security-policy']).to.include("default-src 'self'");
    });

    it('does not expose X-Powered-By', function () {
        expect(headers).to.not.have.property('x-powered-by');
    });

    it('sets Referrer-Policy', function () {
        expect(headers['referrer-policy']).to.exist;
    });

    it('sets Cross-Origin-Opener-Policy', function () {
        expect(headers['cross-origin-opener-policy']).to.exist;
    });
});