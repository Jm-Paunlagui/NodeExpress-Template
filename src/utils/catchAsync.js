"use strict";

/**
 * Wraps an async controller function so rejected promises
 * are forwarded to Express's error-handling middleware.
 *
 * Usage:
 *   const { catchAsync } = require('../utils/catchAsync');
 *
 *   exports.getUser = catchAsync(async (req, res) => {
 *       const user = await userService.getById(req.params.id);
 *       res.json(sendSuccess('User fetched', user));
 *   });
 *
 * @param {Function} fn - Async (req, res, next) => Promise
 * @returns {Function}  Express middleware
 */
function catchAsync(fn) {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}

module.exports = { catchAsync };
