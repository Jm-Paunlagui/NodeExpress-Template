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
  authRateLimiter.handle.bind(authRateLimiter),
  AuthMiddleware.validateRequiredFields(["userId", "password"]),
  AuthController.login,
);

router.post("/refresh", authRateLimiter.handle.bind(authRateLimiter), AuthController.refresh);

// ── Protected endpoints ───────────────────────────────────────────────────────

router.post("/logout", AuthMiddleware.authenticate, AuthController.logout);

router.get("/me", AuthMiddleware.authenticate, AuthController.me);

// Change password (authenticated — user knows their current password).
// Uses authRateLimiter to throttle brute-force attempts against the
// current-password verification step.
router.patch(
  "/change-password",
  authRateLimiter.handle.bind(authRateLimiter),
  AuthMiddleware.authenticate,
  AuthMiddleware.validateRequiredFields(["currentPassword", "newPassword"]),
  AuthController.changePassword,
);

module.exports = router;
