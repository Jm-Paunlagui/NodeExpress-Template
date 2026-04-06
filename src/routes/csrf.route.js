"use strict";

const express = require("express");
const { defaultCsrf } = require("../middleware/security/CsrfMiddleware");

const router = express.Router();

/**
 * GET /csrf/token
 * Generates (or returns the existing) CSRF token.
 * The HTTP-only secret cookie is set automatically by csrf-csrf.
 */
router.get("/token", defaultCsrf.tokenHandler);

/**
 * POST /csrf/refresh
 * Forces rotation of the CSRF token and secret cookie.
 * Requires an existing CSRF cookie — call /token first if none exists.
 */
router.post("/refresh", defaultCsrf.refreshHandler);

/**
 * GET /csrf/status
 * Returns CSRF protection configuration and cookie presence.
 */
router.get("/status", defaultCsrf.statusHandler);

module.exports = router;
