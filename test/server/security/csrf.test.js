"use strict";

const { expect } = require("chai");
const request = require("supertest");
const app = require("../../../src/app");

describe("CSRF Protection", function () {
    let agent;

    beforeEach(function () {
        // Use a persistent agent so cookies are retained between requests
        agent = request.agent(app);
    });

    it("GET /api/v1/csrf/token returns a token and sets cookie", async function () {
        const res = await agent.get("/api/v1/csrf/token");
        expect(res.status).to.equal(200);
        expect(res.body).to.have.property("token").that.is.a("string");
        // Cookie must be set
        const cookies = res.headers["set-cookie"] || [];
        expect(cookies.some((c) => c.includes("csrf"))).to.be.true;
    });

    it("POST without CSRF token returns 403", async function () {
        // First get a session so CSRF cookie is set, then attempt mutation without token
        await agent.get("/api/v1/csrf/token");
        const res = await agent
            .post("/api/v1/auth/login")
            .send({ username: "test", password: "test" });
        expect(res.status).to.equal(403);
        expect(res.body.code).to.equal("CSRF_TOKEN_INVALID");
    });

    it("POST with valid CSRF token is accepted (not blocked by CSRF)", async function () {
        const tokenRes = await agent.get("/api/v1/csrf/token");
        const csrfToken = tokenRes.body.token;

        const res = await agent
            .post("/api/v1/auth/login")
            .set("x-csrf-token", csrfToken)
            .send({ username: "nonexistent", password: "wrong" });

        // May be 400/401 due to bad credentials — but must NOT be 403 CSRF error
        expect(res.status).to.not.equal(403);
    });

    it("POST with a forged CSRF token returns 403", async function () {
        await agent.get("/api/v1/csrf/token");
        const res = await agent
            .post("/api/v1/auth/login")
            .set("x-csrf-token", "forged-token-abc123")
            .send({ username: "test", password: "test" });
        expect(res.status).to.equal(403);
    });

    it("GET /csrf/status describes protection configuration", async function () {
        const res = await agent.get("/api/v1/csrf/status");
        expect(res.status).to.equal(200);
        expect(res.body.status.enabled).to.be.true;
        expect(res.body.status.methods.protected).to.include("POST");
        expect(res.body.status.methods.safe).to.include("GET");
    });
});
