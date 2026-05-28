"use strict";

const express = require("express");
const { defaultCsrf } = require("../middleware/security/CsrfMiddleware");
const AuthMiddleware = require("../middleware/authentication/AuthMiddleware");

const router = express.Router();

/**
 * GET /csrf/token
 * Generates (or returns the existing) CSRF token.
 * The HTTP-only secret cookie is set automatically by csrf-csrf.
 * Public — no auth required. The client must be able to obtain a token
 * before it can authenticate (bootstrapping concern).
 */
router.get("/token", defaultCsrf.tokenHandler);

/**
 * POST /csrf/refresh
 * Forces rotation of the CSRF token and secret cookie.
 * Requires an existing CSRF cookie — call /token first if none exists.
 *
 * Positional rationale: AuthMiddleware.authenticate runs first so that
 * req.user is populated before the refresh handler executes. This ensures
 * the handler logs and audits the real user identity rather than
 * "anonymous@unknown", and limits token rotation to authenticated sessions.
 */
router.post(
  "/refresh",
  AuthMiddleware.authenticate,
  defaultCsrf.refreshHandler,
);

/**
 * GET /csrf/status
 * Returns CSRF protection configuration and cookie presence.
 * Public — safe method, no state change, no sensitive data.
 */
router.get("/status", defaultCsrf.statusHandler);

module.exports = router;
