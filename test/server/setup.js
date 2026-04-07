"use strict";

/**
 * @fileoverview Global test setup.
 * Flushes the shared rate limiter before each test so that integration,
 * security, and performance suites never hit 429 because of accumulated
 * hits from earlier test files.
 */

const {
    defaultRateLimiter,
} = require("../../src/middleware/security/RateLimiterMiddleware");

beforeEach(function () {
    defaultRateLimiter.flushAll();
});
