"use strict";

const { expect } = require("chai");

describe("Graceful Shutdown", function () {
    it("app module exports a valid Express app", function () {
        const app = require("../../../src/app");
        expect(app).to.be.a("function");
        expect(app).to.have.property("use").that.is.a("function");
        expect(app).to.have.property("get").that.is.a("function");
    });

    it.skip("server shuts down cleanly on SIGTERM — requires spawning a child process", function () {});
    it.skip("in-flight requests complete before shutdown — requires spawning a child process", function () {});
    it.skip("pending DB connections are drained on shutdown — requires live Oracle DB connection", function () {});
});
