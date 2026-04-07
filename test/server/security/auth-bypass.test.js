"use strict";

const { expect } = require("chai");
const request = require("supertest");
const express = require("express");
const jwt = require("jsonwebtoken");
const AuthMiddleware = require("../../../src/middleware/authentication/AuthMiddleware");
const {
    defaultErrorHandler,
} = require("../../../src/middleware/errorHandling/ErrorHandlerMiddleware");

const TEST_SECRET = "test-jwt-secret-for-auth-bypass";

function signToken(payload = {}, expiresIn = "1h") {
    return jwt.sign(
        { sub: "test-user", userLevel: 1, ...payload },
        TEST_SECRET,
        { expiresIn },
    );
}

/**
 * Build a minimal Express app with a protected route for auth testing.
 * Avoids CSRF / rate-limiter / CORS interference — pure auth checks.
 */
function buildAuthTestApp() {
    const app = express();
    app.use(express.json());

    // Protected route — requires authentication
    app.get("/api/v1/protected", AuthMiddleware.authenticate, (_req, res) =>
        res.json({ status: "success", data: { ok: true } }),
    );

    // Protected route — requires userLevel >= 2
    app.get(
        "/api/v1/admin/dashboard",
        AuthMiddleware.authenticate,
        AuthMiddleware.requireAccess((user) => user.userLevel >= 2),
        (_req, res) => res.json({ status: "success", data: { admin: true } }),
    );

    app.use(defaultErrorHandler.handle.bind(defaultErrorHandler));
    return app;
}

describe("Auth Security", function () {
    let agent;

    before(function () {
        process.env.JWT_SECRET = TEST_SECRET;
        agent = request(buildAuthTestApp());
    });

    after(function () {
        delete process.env.JWT_SECRET;
    });

    describe("missing token", function () {
        it("returns 401 when no Authorization header is provided", async function () {
            const res = await agent.get("/api/v1/protected");
            expect(res.status).to.equal(401);
            expect(res.body.error.type).to.equal("AuthenticationError");
        });

        it("returns 403 when Authorization header is malformed", async function () {
            // "NotBearer abc".split(" ")[1] → "abc" is extracted as a token,
            // jwt.verify fails on it → 403 (invalid token, not missing token)
            const res = await agent
                .get("/api/v1/protected")
                .set("Authorization", "NotBearer abc");
            expect(res.status).to.equal(403);
        });

        it("returns 401 when token is present in neither header nor cookie", async function () {
            const res = await agent
                .get("/api/v1/protected")
                .unset("Authorization");
            expect(res.status).to.equal(401);
        });
    });

    describe("invalid token", function () {
        it("returns 403 for a token signed with the wrong secret", async function () {
            const forged = jwt.sign({ sub: "hacker" }, "wrong-secret");
            const res = await agent
                .get("/api/v1/protected")
                .set("Authorization", `Bearer ${forged}`);
            expect(res.status).to.equal(403);
        });

        it("returns 403 for an expired token", async function () {
            const expired = signToken({ sub: "test" }, "-1s");
            const res = await agent
                .get("/api/v1/protected")
                .set("Authorization", `Bearer ${expired}`);
            expect(res.status).to.equal(403);
        });

        it("returns 403 for a structurally invalid JWT", async function () {
            const res = await agent
                .get("/api/v1/protected")
                .set("Authorization", "Bearer not.a.jwt");
            expect(res.status).to.equal(403);
        });

        it("returns 403 for a token with a tampered payload", async function () {
            const valid = signToken({ userLevel: 1 });
            const parts = valid.split(".");
            parts[1] = Buffer.from(
                JSON.stringify({ sub: "hacker", userLevel: 99 }),
            ).toString("base64url");
            const tampered = parts.join(".");
            const res = await agent
                .get("/api/v1/protected")
                .set("Authorization", `Bearer ${tampered}`);
            expect(res.status).to.equal(403);
        });
    });

    describe("authorization (permission level)", function () {
        it("returns 403 when user level is below route requirement", async function () {
            const token = signToken({ userLevel: 1 });
            const res = await agent
                .get("/api/v1/admin/dashboard")
                .set("Authorization", `Bearer ${token}`);
            expect(res.status).to.equal(403);
            expect(res.body.error.type).to.equal("AuthorizationError");
        });

        it("returns 200 when user level meets route requirement", async function () {
            const token = signToken({ userLevel: 3 });
            const res = await agent
                .get("/api/v1/admin/dashboard")
                .set("Authorization", `Bearer ${token}`);
            expect(res.status).to.equal(200);
            expect(res.body.status).to.equal("success");
        });
    });
});
