"use strict";

const { expect } = require("chai");
const request = require("supertest");
const express = require("express");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const cookieSignature = require("cookie-signature");
const AuthMiddleware = require("../../../src/middleware/authentication/AuthMiddleware");
const {
    defaultErrorHandler,
} = require("../../../src/middleware/errorHandling/ErrorHandlerMiddleware");

const TEST_SECRET = "your-jwt-secret-here-change-in-production";
const COOKIE_SECRET = "test-cookie-secret";

function signToken(payload = {}, expiresIn = "1h") {
    return jwt.sign(
        { sub: "test-user", userLevel: 1, ...payload },
        TEST_SECRET,
        { expiresIn },
    );
}

/**
 * Sign a cookie value the same way cookie-parser does (cookie-signature).
 * Result is prefixed with "s:" so cookie-parser recognises it as signed.
 */
function signCookie(value, secret) {
    return "s:" + cookieSignature.sign(value, secret);
}

/**
 * Build a minimal Express app with a protected route for auth testing.
 * Avoids CSRF / rate-limiter / CORS interference — pure auth checks.
 */
function buildAuthTestApp() {
    const app = express();
    app.use(express.json());
    app.use(cookieParser(COOKIE_SECRET));

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

    // Protected file-download route (HTML error responses)
    app.get(
        "/api/v1/report/export/test",
        AuthMiddleware.authenticateForDownload,
        (_req, res) => res.json({ status: "success", data: { file: true } }),
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

        it("returns 401 when Authorization header is malformed", async function () {
            // "NotBearer abc".split(" ")[1] → "abc" is extracted as a token,
            // jwt.verify throws JsonWebTokenError → 401 (malformed, not expired)
            const res = await agent
                .get("/api/v1/protected")
                .set("Authorization", "NotBearer abc");
            expect(res.status).to.equal(401);
        });

        it("returns 401 when token is present in neither header nor cookie", async function () {
            const res = await agent
                .get("/api/v1/protected")
                .unset("Authorization");
            expect(res.status).to.equal(401);
        });
    });

    describe("invalid token", function () {
        it("returns 401 for a token signed with the wrong secret", async function () {
            // Wrong secret → JsonWebTokenError (invalid signature) → 401
            const forged = jwt.sign({ sub: "hacker" }, "wrong-secret");
            const res = await agent
                .get("/api/v1/protected")
                .set("Authorization", `Bearer ${forged}`);
            expect(res.status).to.equal(401);
        });

        it("returns 403 for an expired token", async function () {
            const expired = signToken({ sub: "test" }, "-1s");
            const res = await agent
                .get("/api/v1/protected")
                .set("Authorization", `Bearer ${expired}`);
            expect(res.status).to.equal(403);
        });

        it("returns 401 for a structurally invalid JWT", async function () {
            // Malformed JWT → JsonWebTokenError → 401
            const res = await agent
                .get("/api/v1/protected")
                .set("Authorization", "Bearer not.a.jwt");
            expect(res.status).to.equal(401);
        });

        it("returns 401 for a token with a tampered payload", async function () {
            // Tampered payload → signature mismatch → JsonWebTokenError → 401
            const valid = signToken({ userLevel: 1 });
            const parts = valid.split(".");
            parts[1] = Buffer.from(
                JSON.stringify({ sub: "hacker", userLevel: 99 }),
            ).toString("base64url");
            const tampered = parts.join(".");
            const res = await agent
                .get("/api/v1/protected")
                .set("Authorization", `Bearer ${tampered}`);
            expect(res.status).to.equal(401);
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

    describe("signed cookie authentication", function () {
        it("returns 200 when a valid signed cookie token is provided", async function () {
            const token = signToken({ userLevel: 1 });
            const signed = signCookie(token, COOKIE_SECRET);
            const res = await agent
                .get("/api/v1/protected")
                .set("Cookie", `token=${encodeURIComponent(signed)}`);
            expect(res.status).to.equal(200);
            expect(res.body.status).to.equal("success");
        });

        it("returns 401 when an unsigned (plain) cookie token is provided", async function () {
            // Plain cookies end up in req.cookies, not req.signedCookies
            const token = signToken({ userLevel: 1 });
            const res = await agent
                .get("/api/v1/protected")
                .set("Cookie", `token=${token}`);
            expect(res.status).to.equal(401);
        });

        it("returns 401 when cookie is signed with the wrong secret", async function () {
            const token = signToken({ userLevel: 1 });
            const badSigned = signCookie(token, "wrong-cookie-secret");
            const res = await agent
                .get("/api/v1/protected")
                .set("Cookie", `token=${encodeURIComponent(badSigned)}`);
            expect(res.status).to.equal(401);
        });

        it("prefers Authorization header over signed cookie", async function () {
            const headerToken = signToken({ userLevel: 3 });
            const cookieToken = signToken({ userLevel: 1 });
            const signed = signCookie(cookieToken, COOKIE_SECRET);
            const res = await agent
                .get("/api/v1/admin/dashboard")
                .set("Authorization", `Bearer ${headerToken}`)
                .set("Cookie", `token=${encodeURIComponent(signed)}`);
            // Header token has userLevel 3 → should pass the >= 2 check
            expect(res.status).to.equal(200);
        });
    });

    describe("authenticateForDownload (HTML error responses)", function () {
        it("returns 401 HTML when no token is provided on a download route", async function () {
            const res = await agent.get("/api/v1/report/export/test");
            expect(res.status).to.equal(401);
            expect(res.headers["content-type"]).to.include("text/html");
            expect(res.text).to.include("Authentication Required");
        });

        it("returns 403 HTML when an expired token is provided on a download route", async function () {
            const expired = signToken({ sub: "test" }, "-1s");
            const res = await agent
                .get("/api/v1/report/export/test")
                .set("Authorization", `Bearer ${expired}`);
            expect(res.status).to.equal(403);
            expect(res.headers["content-type"]).to.include("text/html");
            expect(res.text).to.include("Access Denied");
        });

        it("returns 401 HTML when a forged token is provided on a download route", async function () {
            // Wrong secret → JsonWebTokenError → 401 with HTML
            const forged = jwt.sign({ sub: "hacker" }, "wrong-secret");
            const res = await agent
                .get("/api/v1/report/export/test")
                .set("Authorization", `Bearer ${forged}`);
            expect(res.status).to.equal(401);
            expect(res.headers["content-type"]).to.include("text/html");
            expect(res.text).to.include("Authentication Required");
        });

        it("returns 200 JSON when a valid token is provided on a download route", async function () {
            const token = signToken({ userLevel: 1 });
            const res = await agent
                .get("/api/v1/report/export/test")
                .set("Authorization", `Bearer ${token}`);
            expect(res.status).to.equal(200);
            expect(res.body.status).to.equal("success");
        });

        it("returns 200 when a valid signed cookie is used on a download route", async function () {
            const token = signToken({ userLevel: 1 });
            const signed = signCookie(token, COOKIE_SECRET);
            const res = await agent
                .get("/api/v1/report/export/test")
                .set("Cookie", `token=${encodeURIComponent(signed)}`);
            expect(res.status).to.equal(200);
        });
    });
});
