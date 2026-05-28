"use strict";

/**
 * @fileoverview Routes for the /api/v1/client resource.
 *
 * Route map:
 *   POST /api/v1/client/errors   Client-side error report  (auth: any authenticated user)
 *
 * The endpoint is auth-gated so anonymous traffic cannot pollute the server
 * log stream. Render errors that occur pre-auth (login page, etc.) are
 * intentionally not forwarded — the dev-only `console.error` in
 * `clientLogger.js` still surfaces them locally.
 */

const express = require("express");
const router = express.Router();

const AuthMiddleware = require("../middleware/authentication/AuthMiddleware");
const ClientController = require("../controllers/ClientController");

// Any authenticated user may report their own ErrorBoundary triggers.
router.post(
    "/errors",
    AuthMiddleware.authenticate,
    ClientController.logError,
);

module.exports = router;
