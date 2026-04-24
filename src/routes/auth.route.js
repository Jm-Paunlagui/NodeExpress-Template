"use strict";

const express = require("express");
const router = express.Router();

const AuthController = require("../controllers/auth.controllers");
const AuthMiddleware = require("../middleware/authentication/AuthMiddleware");
const {
    authRateLimiter,
} = require("../middleware/security/RateLimiterMiddleware");

// ── Public endpoints (no auth required) ──────────────────────────────────────

router.post(
    "/login",
    authRateLimiter.handle,
    AuthMiddleware.validateRequiredFields(["userId", "password"]),
    AuthController.login,
);

router.post("/refresh", authRateLimiter.handle, AuthController.refresh);

// ── Protected endpoints ───────────────────────────────────────────────────────

router.post("/logout", AuthMiddleware.authenticate, AuthController.logout);

router.get("/me", AuthMiddleware.authenticate, AuthController.me);

module.exports = router;
