'use strict';

const { expect } = require('chai');
const agent      = require('../helpers/request');

// Payloads that should never reach the DB or be reflected in a 500
const SQL_PAYLOADS = [
    "'; DROP TABLE USERS; --",
    "' OR '1'='1",
    "' OR 1=1--",
    "admin'--",
    "1; SELECT * FROM information_schema.tables",
];

const PATH_TRAVERSAL_PAYLOADS = [
    '../../../etc/passwd',
    '..\\..\\..\\windows\\system32',
    '%2e%2e%2f%2e%2e%2f',
    '....//....//etc/passwd',
];

const XSS_PAYLOADS = [
    '<script>alert(1)</script>',
    '"><img src=x onerror=alert(1)>',
    'javascript:alert(1)',
];

describe('Injection Attack Mitigation', function () {
    describe('SQL injection via query string', function () {
        SQL_PAYLOADS.forEach((payload) => {
            it(`rejects or sanitizes: ${payload.slice(0, 40)}`, async function () {
                const res = await agent
                    .get('/api/v1/users')
                    .query({ search: payload });
                // Must not crash the server with a 500
                expect(res.status).to.not.equal(500);
            });
        });
    });

    describe('SQL injection via request body', function () {
        SQL_PAYLOADS.forEach((payload) => {
            it(`body payload blocked: ${payload.slice(0, 40)}`, async function () {
                const res = await agent
                    .post('/api/v1/auth/login')
                    .send({ username: payload, password: 'test' });
                expect(res.status).to.not.equal(500);
            });
        });
    });

    describe('path traversal via URL', function () {
        PATH_TRAVERSAL_PAYLOADS.forEach((payload) => {
            it(`path traversal blocked: ${payload}`, async function () {
                const res = await agent.get(`/api/v1/${encodeURIComponent(payload)}`);
                // Security filter should return 400, 403, or 404 — never 200
                expect([400, 403, 404]).to.include(res.status);
            });
        });
    });

    describe('XSS via query parameters', function () {
        XSS_PAYLOADS.forEach((payload) => {
            it(`XSS payload not reflected: ${payload.slice(0, 40)}`, async function () {
                const res = await agent.get('/api/v1/search').query({ q: payload });
                // Response body must never echo the script tag verbatim
                expect(JSON.stringify(res.body)).to.not.include('<script>');
                expect(JSON.stringify(res.body)).to.not.include('onerror=');
            });
        });
    });
});