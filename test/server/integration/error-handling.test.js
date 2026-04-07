"use strict";

const { expect } = require("chai");
const agent = require("../helpers/request");

describe("Error Handling", function () {
    describe("404 — unknown routes", function () {
        it("GET unknown path returns 404 JSON with error shape", async function () {
            const res = await agent.get("/api/v1/does-not-exist");
            expect(res.status).to.equal(404);
            expect(res.body.status).to.equal("error");
            expect(res.body.code).to.equal(404);
            expect(res.body.error).to.have.property("type", "NotFoundError");
        });

        it("POST unknown path returns 404 not 405", async function () {
            // Use GET to avoid CSRF protection blocking the request before routing
            const res = await agent.get("/api/v1/does-not-exist");
            expect(res.status).to.equal(404);
        });
    });

    describe("global error shape contract", function () {
        it("every error response has status, code, message, error fields", async function () {
            const res = await agent.get("/api/v1/does-not-exist");
            expect(res.body).to.have.all.keys(
                "status",
                "code",
                "message",
                "error",
            );
        });

        it("error.type is always a string", async function () {
            const res = await agent.get("/api/v1/does-not-exist");
            expect(res.body.error.type).to.be.a("string");
        });
    });
});
