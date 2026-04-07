"use strict";

const { expect } = require("chai");
const {
    SecurityFilterMiddleware,
} = require("../../../../src/middleware/security/SecurityFilterMiddleware");

function mockReq(options = {}) {
    return {
        ip: options.ip || "127.0.0.1",
        path: options.path || "/test",
        method: options.method || "GET",
        connection: { remoteAddress: options.ip || "127.0.0.1" },
    };
}

function mockRes() {
    let _status, _body;
    return {
        get _status() {
            return _status;
        },
        get _body() {
            return _body;
        },
        status(c) {
            _status = c;
            return this;
        },
        json(b) {
            _body = b;
            return this;
        },
    };
}

describe("SecurityFilterMiddleware (unit)", function () {
    describe("whitelisted paths", function () {
        it("allows root path /", function (done) {
            const filter = new SecurityFilterMiddleware();
            filter.handle(mockReq({ path: "/" }), mockRes(), done);
        });

        it("allows /health", function (done) {
            const filter = new SecurityFilterMiddleware();
            filter.handle(mockReq({ path: "/health" }), mockRes(), done);
        });

        it("allows /api/ prefixed paths", function (done) {
            const filter = new SecurityFilterMiddleware();
            filter.handle(mockReq({ path: "/api/v1/users" }), mockRes(), done);
        });

        it("allows /api-docs paths", function (done) {
            const filter = new SecurityFilterMiddleware();
            filter.handle(
                mockReq({ path: "/api-docs/swagger" }),
                mockRes(),
                done,
            );
        });
    });

    describe("blocked HTTP methods", function () {
        it("blocks TRACE with 405", function () {
            const filter = new SecurityFilterMiddleware();
            const res = mockRes();
            filter.handle(
                mockReq({ method: "TRACE", path: "/something" }),
                res,
                () => {
                    throw new Error("should not call next");
                },
            );
            expect(res._status).to.equal(405);
            expect(res._body.error.type).to.equal("MethodNotAllowed");
        });

        it("blocks PROPFIND with 405", function () {
            const filter = new SecurityFilterMiddleware();
            const res = mockRes();
            filter.handle(
                mockReq({ method: "PROPFIND", path: "/something" }),
                res,
                () => {
                    throw new Error("should not call next");
                },
            );
            expect(res._status).to.equal(405);
        });

        it("blocks SEARCH with 405", function () {
            const filter = new SecurityFilterMiddleware();
            const res = mockRes();
            filter.handle(
                mockReq({ method: "SEARCH", path: "/something" }),
                res,
                () => {
                    throw new Error("should not call next");
                },
            );
            expect(res._status).to.equal(405);
        });
    });

    describe("malicious patterns", function () {
        const MALICIOUS_PATHS = [
            "/robots.txt",
            "/wp-admin/admin.php",
            "/../etc/passwd",
            "/weblogic/login",
            "/_layouts/15/error.aspx",
            "/login.php",
            "/test.jsp",
            "/script.cgi",
            "/page.asp",
        ];

        MALICIOUS_PATHS.forEach((path) => {
            it(`blocks ${path} with 404`, function () {
                const filter = new SecurityFilterMiddleware();
                const res = mockRes();
                filter.handle(mockReq({ path }), res, () => {
                    throw new Error("should not call next");
                });
                expect(res._status).to.equal(404);
                expect(res._body.error.type).to.equal("NotFound");
            });
        });

        it("blocks script injection in path", function () {
            const filter = new SecurityFilterMiddleware();
            const res = mockRes();
            filter.handle(
                mockReq({ path: "/<script>alert(1)</script>" }),
                res,
                () => {
                    throw new Error("should not call next");
                },
            );
            expect(res._status).to.equal(404);
        });

        it("blocks path traversal with ..", function () {
            const filter = new SecurityFilterMiddleware();
            const res = mockRes();
            filter.handle(
                mockReq({ path: "/foo/../../../etc/shadow" }),
                res,
                () => {
                    throw new Error("should not call next");
                },
            );
            expect(res._status).to.equal(404);
        });
    });

    describe("IP auto-blocking", function () {
        it("blocks an IP after exceeding the suspicious threshold", function () {
            const filter = new SecurityFilterMiddleware({
                suspiciousThreshold: 3,
                blockDurationMs: 60000,
            });

            const ip = "10.99.99.99";
            // Generate enough suspicious activity to trigger auto-block
            for (let i = 0; i < 3; i++) {
                const res = mockRes();
                filter.handle(
                    mockReq({ ip, method: "TRACE", path: "/x" }),
                    res,
                    () => {},
                );
            }

            // Next request from same IP (even to non-malicious path) should be 403
            const res = mockRes();
            filter.handle(mockReq({ ip, path: "/normal" }), res, () => {
                throw new Error("should be blocked");
            });
            expect(res._status).to.equal(403);
            expect(res._body.error.type).to.equal("Forbidden");
        });
    });

    describe("getStats()", function () {
        it("returns stats object with required properties", function () {
            const filter = new SecurityFilterMiddleware();
            const stats = filter.getStats();
            expect(stats).to.have.property("totalTracked");
            expect(stats).to.have.property("blocked");
            expect(stats).to.have.property("suspicious");
            expect(stats).to.have.property("blockedIPs").that.is.an("array");
            expect(stats).to.have.property("suspiciousIPs").that.is.an("array");
        });

        it("tracks suspicious IPs after malicious requests", function () {
            const filter = new SecurityFilterMiddleware();
            const res = mockRes();
            filter.handle(
                mockReq({ ip: "5.5.5.5", path: "/robots.txt" }),
                res,
                () => {},
            );
            const stats = filter.getStats();
            expect(stats.totalTracked).to.be.greaterThan(0);
        });
    });

    describe("clean paths pass through", function () {
        it("allows normal non-whitelisted, non-malicious paths", function (done) {
            const filter = new SecurityFilterMiddleware();
            filter.handle(
                mockReq({ path: "/some/custom/endpoint" }),
                mockRes(),
                done,
            );
        });
    });
});
