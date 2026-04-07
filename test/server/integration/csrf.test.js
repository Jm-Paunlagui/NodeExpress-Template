"use strict";

const { expect } = require("chai");
const request = require("supertest");
const app = require("../../../src/app");

describe("CSRF Integration", function () {
    let agent;

    beforeEach(function () {
        agent = request.agent(app);
    });

    describe("GET /api/v1/csrf/token", function () {
        it("returns a token with success: true", async function () {
            const res = await agent.get("/api/v1/csrf/token");
            expect(res.status).to.equal(200);
            expect(res.body.success).to.be.true;
            expect(res.body.token).to.be.a("string").with.length.greaterThan(0);
        });

        it("returns cookieName, headerName, expiresIn, expiresAt", async function () {
            const res = await agent.get("/api/v1/csrf/token");
            expect(res.body).to.have.property("cookieName").that.is.a("string");
            expect(res.body).to.have.property("headerName", "x-csrf-token");
            expect(res.body).to.have.property("expiresIn").that.is.a("number");
            expect(res.body).to.have.property("expiresAt").that.is.a("string");
        });

        it("sets a CSRF cookie in the response", async function () {
            const res = await agent.get("/api/v1/csrf/token");
            const cookies = res.headers["set-cookie"] || [];
            expect(cookies.some((c) => c.includes("csrf"))).to.be.true;
        });
    });

    describe("GET /api/v1/csrf/status", function () {
        it("returns status with enabled: true", async function () {
            const res = await agent.get("/api/v1/csrf/status");
            expect(res.status).to.equal(200);
            expect(res.body.success).to.be.true;
            expect(res.body.status.enabled).to.be.true;
        });

        it("reports protected and safe methods", async function () {
            const res = await agent.get("/api/v1/csrf/status");
            expect(res.body.status.methods.protected).to.include("POST");
            expect(res.body.status.methods.safe).to.include("GET");
        });

        it("reports token sources", async function () {
            const res = await agent.get("/api/v1/csrf/status");
            expect(res.body.status.tokenSources).to.be.an("array");
            expect(res.body.status.tokenSources).to.include(
                "header:x-csrf-token",
            );
        });
    });

    describe("POST /api/v1/csrf/refresh", function () {
        it("returns 403 when no CSRF session exists (CSRF protection blocks first)", async function () {
            const res = await agent.post("/api/v1/csrf/refresh");
            // POST without CSRF cookie/token is rejected by the CSRF protection
            // middleware before reaching the refresh handler
            expect(res.status).to.equal(403);
        });

        it("refreshes token when a CSRF session exists", async function () {
            // First obtain a token (sets the cookie)
            const tokenRes = await agent.get("/api/v1/csrf/token");
            const originalToken = tokenRes.body.token;

            // Now refresh — agent retains cookie automatically
            const refreshRes = await agent
                .post("/api/v1/csrf/refresh")
                .set("x-csrf-token", originalToken);

            expect(refreshRes.status).to.equal(200);
            expect(refreshRes.body.success).to.be.true;
            expect(refreshRes.body.token).to.be.a("string");
            expect(refreshRes.body.message).to.include("refreshed");
        });
    });
});
