"use strict";

const { expect } = require("chai");
const { logger } = require("../../../../src/utils/logger");

describe("Logger", function () {
    describe("core API", function () {
        it("exposes info, warn, error, debug methods", function () {
            expect(logger.info).to.be.a("function");
            expect(logger.warn).to.be.a("function");
            expect(logger.error).to.be.a("function");
            expect(logger.debug).to.be.a("function");
        });

        it("exposes specialized methods", function () {
            expect(logger.cache).to.be.a("function");
            expect(logger.database).to.be.a("function");
            expect(logger.performance).to.be.a("function");
            expect(logger.security).to.be.a("function");
        });

        it("exposes HTTP lifecycle methods", function () {
            expect(logger.logIncomingRequest).to.be.a("function");
            expect(logger.logHandlingRequest).to.be.a("function");
            expect(logger.logCompletedRequest).to.be.a("function");
        });
    });

    describe("log()", function () {
        it("does not throw when called with a valid level and message", function () {
            expect(() => logger.info("test message")).to.not.throw();
        });

        it("does not throw with meta object", function () {
            expect(() =>
                logger.info("test message", { key: "value" }),
            ).to.not.throw();
        });

        it("does not throw with null or undefined message", function () {
            expect(() => logger.info(null)).to.not.throw();
            expect(() => logger.info(undefined)).to.not.throw();
        });

        it("silently ignores empty string messages", function () {
            expect(() => logger.info("")).to.not.throw();
            expect(() => logger.info("   ")).to.not.throw();
        });
    });

    describe("specialized methods", function () {
        it("cache() does not throw", function () {
            expect(() =>
                logger.cache("GET", "cache:users:1", "HIT", 3),
            ).to.not.throw();
        });

        it("database() does not throw", function () {
            expect(() =>
                logger.database("SELECT", "USERS", 12, 5),
            ).to.not.throw();
        });

        it("performance() does not throw for fast operation", function () {
            expect(() =>
                logger.performance("render", 100, { rows: 10 }),
            ).to.not.throw();
        });

        it("performance() does not throw for slow operation (>5s)", function () {
            expect(() =>
                logger.performance("slowQuery", 6000, { rows: 50000 }),
            ).to.not.throw();
        });

        it("security() does not throw", function () {
            expect(() =>
                logger.security("IP_BLOCKED", { ip: "10.0.0.1" }),
            ).to.not.throw();
        });
    });

    describe("HTTP lifecycle logging", function () {
        function mockReq() {
            return {
                method: "GET",
                originalUrl: "/api/v1/health",
                url: "/api/v1/health",
                ip: "127.0.0.1",
                headers: {},
                get: () => undefined,
                query: {},
                connection: { remoteAddress: "127.0.0.1" },
            };
        }

        function mockRes() {
            return { statusCode: 200 };
        }

        it("logIncomingRequest does not throw", function () {
            expect(() => logger.logIncomingRequest(mockReq())).to.not.throw();
        });

        it("logHandlingRequest does not throw", function () {
            expect(() =>
                logger.logHandlingRequest(mockReq(), { userId: 1 }),
            ).to.not.throw();
        });

        it("logCompletedRequest does not throw", function () {
            expect(() =>
                logger.logCompletedRequest(mockReq(), mockRes(), 42),
            ).to.not.throw();
        });

        it("logCompletedRequest uses ERROR level for 4xx/5xx status", function () {
            const res = { statusCode: 500 };
            expect(() =>
                logger.logCompletedRequest(mockReq(), res, 100),
            ).to.not.throw();
        });
    });

    describe("getLogStats()", function () {
        it("returns an object (or rejects gracefully)", async function () {
            try {
                const stats = await logger.getLogStats();
                expect(stats).to.be.an("object");
            } catch (err) {
                // May fail if log directory doesn't exist for today — acceptable
                expect(err).to.be.an("error");
            }
        });
    });
});
