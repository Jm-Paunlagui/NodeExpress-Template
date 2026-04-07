"use strict";

const { expect } = require("chai");
const {
    CorsMiddleware,
} = require("../../../../src/middleware/security/CorsMiddleware");

describe("CorsMiddleware", function () {
    describe("constructor", function () {
        it("creates an instance with default options", function () {
            const cors = new CorsMiddleware();
            expect(cors).to.be.an("object");
            expect(cors.handle).to.be.a("function");
        });

        it("accepts explicit origins", function () {
            const cors = new CorsMiddleware({
                origins: ["https://example.com"],
            });
            expect(cors).to.be.an("object");
        });

        it("accepts custom patterns", function () {
            const cors = new CorsMiddleware({
                patterns: [/^https:\/\/custom\.dev$/],
            });
            expect(cors).to.be.an("object");
        });
    });

    describe("origin handling", function () {
        function mockReq(origin) {
            return {
                method: "GET",
                headers: origin ? { origin } : {},
                get(key) {
                    return this.headers[key.toLowerCase()];
                },
            };
        }

        function mockRes() {
            const headers = {};
            return {
                setHeader(k, v) {
                    headers[k] = v;
                },
                getHeader(k) {
                    return headers[k];
                },
                _headers: headers,
                statusCode: 200,
                end() {},
            };
        }

        it("allows requests with no origin (same-origin)", function (done) {
            const cors = new CorsMiddleware();
            cors.handle(mockReq(null), mockRes(), (err) => {
                expect(err).to.be.undefined;
                done();
            });
        });

        it("allows an explicitly listed origin", function (done) {
            const cors = new CorsMiddleware({
                origins: ["https://myapp.com"],
            });
            const res = mockRes();
            cors.handle(mockReq("https://myapp.com"), res, (err) => {
                expect(err).to.be.undefined;
                done();
            });
        });

        it("allows a private network origin via default patterns", function (done) {
            const cors = new CorsMiddleware();
            const res = mockRes();
            cors.handle(mockReq("http://192.168.1.50:3000"), res, (err) => {
                expect(err).to.be.undefined;
                done();
            });
        });

        it("allows localhost origin via default patterns", function (done) {
            const cors = new CorsMiddleware();
            const res = mockRes();
            cors.handle(mockReq("http://localhost:5173"), res, (err) => {
                expect(err).to.be.undefined;
                done();
            });
        });

        it("blocks a public origin not in the allowlist", function (done) {
            const cors = new CorsMiddleware({ origins: [] });
            const res = mockRes();
            cors.handle(mockReq("https://evil.com"), res, (err) => {
                expect(err).to.be.an("error");
                expect(err.message).to.include("not allowed by CORS");
                done();
            });
        });

        it("allows .local domains via default patterns", function (done) {
            const cors = new CorsMiddleware();
            cors.handle(mockReq("http://mypc.local:8080"), mockRes(), (err) => {
                expect(err).to.be.undefined;
                done();
            });
        });

        it("allows .vpn domains via default patterns", function (done) {
            const cors = new CorsMiddleware();
            cors.handle(
                mockReq("https://host.vpn.company.com"),
                mockRes(),
                (err) => {
                    expect(err).to.be.undefined;
                    done();
                },
            );
        });

        it("allows 10.x.x.x private network via default patterns", function (done) {
            const cors = new CorsMiddleware();
            cors.handle(mockReq("http://10.0.1.100:4000"), mockRes(), (err) => {
                expect(err).to.be.undefined;
                done();
            });
        });

        it("allows 172.16-31.x.x private network via default patterns", function (done) {
            const cors = new CorsMiddleware();
            cors.handle(mockReq("http://172.20.0.5:3001"), mockRes(), (err) => {
                expect(err).to.be.undefined;
                done();
            });
        });
    });
});
