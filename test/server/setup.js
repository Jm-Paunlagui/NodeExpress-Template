"use strict";

/**
 * @fileoverview Global test setup.
 * Flushes the shared rate limiter before each test so that integration,
 * security, and performance suites never hit 429 because of accumulated
 * hits from earlier test files.
 *
 * Suppresses application console logs so Mocha reporter output is clean.
 */

// Suppress app logger console output during tests
process.env.ENABLE_CONSOLE_LOGS = "false";
process.env.NODE_ENV = process.env.NODE_ENV || "test";

const {
    defaultRateLimiter,
} = require("../../src/middleware/security/RateLimiterMiddleware");

beforeEach(function () {
    defaultRateLimiter.flushAll();
});
