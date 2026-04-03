'use strict';

const express = require('express');
const {
    csrfTokenHandler,
    csrfRefreshHandler,
    csrfStatusHandler,
} = require('../middleware/csrf');

const router = express.Router();

/**
 * GET /csrf/token
 * Generates (or returns the existing) CSRF token.
 * The HTTP-only secret cookie is set automatically by csrf-csrf.
 */
router.get('/token', csrfTokenHandler);

/**
 * POST /csrf/refresh
 * Forces rotation of the CSRF token and secret cookie.
 * Requires an existing CSRF cookie — call /token first if none exists.
 */
router.post('/refresh', csrfRefreshHandler);

/**
 * GET /csrf/status
 * Returns CSRF protection configuration and cookie presence.
 */
router.get('/status', csrfStatusHandler);

module.exports = router;