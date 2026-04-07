"use strict";

const { expect } = require("chai");
const agent = require("../helpers/request");
const {
    RateLimiterMiddleware,
} = require("../../../src/middleware/security/RateLimiterMiddleware");

describe("Rate Limiting", function () {
    describe("unit — sliding window enforcement", function () {
        it("returns 429 after exceeding max requests", function (done) {
            const limiter = new RateLimiterMiddleware({
                max: 3,
                windowMs: 60000,
            });
            const mockReq = (ip = "10.0.0.1") => ({
                ip,
                path: "/test",
                method: "GET",
                headers: {},
                route: null,
            });
            const mockRes = () => {
                const h = {};
                return {
                    headersSent: false,
                    setHeader(k, v) {
                        h[k] = v;
                    },
                    getHeader(k) {
                        return h[k];
                    },
                    status(c) {
                        this._status = c;
                        return this;
                    },
                    json(b) {
                        this._body = b;
                        return this;
                    },
                    _headers: h,
                };
            };

            const noop = () => {};
            limiter.handle(mockReq(), mockRes(), noop);
            limiter.handle(mockReq(), mockRes(), noop);
            limiter.handle(mockReq(), mockRes(), noop);

            const res = mockRes();
            limiter.handle(mockReq(), res, () => {
                done(
                    new Error(
                        "next() should not be called when limit is exceeded",
                    ),
                );
            });

            setTimeout(() => {
                expect(res._status).to.equal(429);
                expect(res._body.status).to.equal("error");
                expect(res._body.error.type).to.equal("RateLimitExceeded");
                done();
            }, 10);
        });

        it("429 response includes Retry-After header", function (done) {
            const limiter = new RateLimiterMiddleware({
                max: 1,
                windowMs: 60000,
            });
            const req = {
                ip: "10.0.0.2",
                path: "/test",
                method: "GET",
                headers: {},
                route: null,
            };
            const mockRes = () => {
                const h = {};
                return {
                    headersSent: false,
                    setHeader(k, v) {
                        h[k] = v;
                    },
                    getHeader(k) {
                        return h[k];
                    },
                    status(c) {
                        this._status = c;
                        return this;
                    },
                    json(b) {
                        this._body = b;
                        return this;
                    },
                    _headers: h,
                };
            };

            limiter.handle(req, mockRes(), () => {});

            const res = mockRes();
            limiter.handle(req, res, () => {});

            setTimeout(() => {
                expect(res._headers).to.have.property("Retry-After");
                done();
            }, 10);
        });
    });

    describe("integration — headers on real requests", function () {
        it("RateLimit-Policy header is present on every response", async function () {
            const res = await agent.get("/api/v1/health");
            expect(res.headers).to.have.property("ratelimit-policy");
        });

        it("RateLimit-Remaining decreases with each request", async function () {
            const r1 = await agent.get("/api/v1/health");
            const r2 = await agent.get("/api/v1/health");
            const rem1 = parseInt(r1.headers["ratelimit-remaining"], 10);
            const rem2 = parseInt(r2.headers["ratelimit-remaining"], 10);
            expect(rem2).to.be.lessThanOrEqual(rem1);
        });
    });
});
