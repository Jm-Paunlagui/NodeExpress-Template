"use strict";

/**
 * @fileoverview Authentication & Authorization Middleware
 * JWT authentication with dynamic, predicate-based access control.
 *
 * No hardcoded ROLES or AREAS — each project defines its own permission
 * logic inline at the route level via requireAccess(predicate).
 */

const jwt = require("jsonwebtoken");
const { AppError, AUTH_ERRORS } = require("../../constants/errors");
const { logger } = require("../../utils/logger");

class AuthMiddleware {
    /**
     * Middleware that authenticates JWT tokens from cookies or Authorization header.
     * Attaches decoded user payload to `req.user`.
     */
    static authenticate(req, res, next) {
        AuthMiddleware._doAuthenticate(req, res, next, false);
    }

    /**
     * Same as authenticate but returns user-friendly HTML errors instead of JSON.
     * Use this on routes that serve file downloads (export, download endpoints).
     *
     * The file-download flag is server-controlled (chosen at route definition),
     * not derived from user-supplied paths or headers (CWE-807).
     *
     * @example
     * router.get('/report/export/:id',
     *     AuthMiddleware.authenticateForDownload,
     *     ReportController.export,
     * );
     */
    static authenticateForDownload(req, res, next) {
        AuthMiddleware._doAuthenticate(req, res, next, true);
    }

    /**
     * Shared authentication logic.
     * @param {boolean} isFileDownload - Server-controlled flag; never derived from user input.
     * @private
     */
    static _doAuthenticate(req, res, next, isFileDownload) {
        const token =
            req.cookies?.token || req.headers["authorization"]?.split(" ")[1];

        if (!token) {
            if (isFileDownload) {
                res.setHeader("Content-Type", "text/html; charset=utf-8");
                res.setHeader("Content-Disposition", "inline");
                return res
                    .status(401)
                    .send(
                        AuthMiddleware._authHtmlError(
                            "Authentication Required",
                            "You need to be logged in to download this file.",
                            "Please log in and try again.",
                        ),
                    );
            }
            return next(
                new AppError(AUTH_ERRORS.USER_NOT_FOUND, 401, {
                    type: "AuthenticationError",
                    hint: "Provide a valid token.",
                }),
            );
        }

        jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
            if (err) {
                if (isFileDownload) {
                    res.setHeader("Content-Type", "text/html; charset=utf-8");
                    res.setHeader("Content-Disposition", "inline");
                    return res
                        .status(403)
                        .send(
                            AuthMiddleware._authHtmlError(
                                "Access Denied",
                                "Your authentication token is invalid or has expired.",
                                "Please log in again and try downloading the file.",
                            ),
                        );
                }
                return next(
                    new AppError(AUTH_ERRORS.FORBIDDEN_ACCESS, 403, {
                        type: "AuthenticationError",
                        hint: "Token invalid or expired.",
                    }),
                );
            }
            req.user = user;
            next();
        });
    }

    /**
     * Promise-based token verification.
     * @param {string} token
     * @returns {Promise<object>} decoded payload
     */
    static verifyToken(token) {
        return new Promise((resolve, reject) => {
            jwt.verify(token, process.env.JWT_SECRET, (err, payload) => {
                if (err)
                    return reject(
                        new AppError(AUTH_ERRORS.FORBIDDEN_ACCESS, 403),
                    );
                resolve(payload);
            });
        });
    }

    /**
     * Factory: returns middleware that checks a predicate against req.user.
     * Each project defines its own access rules inline.
     *
     * @param {(user: object) => boolean} predicate
     * @param {object} [options]
     * @param {string} [options.message] - Custom error message
     * @returns {import('express').RequestHandler}
     *
     * @example
     * // Role-based only
     * AuthMiddleware.requireAccess(user => user.userLevel >= 2)
     *
     * @example
     * // Area-based
     * AuthMiddleware.requireAccess(user => {
     *     const areas = (user.area ?? '').split(',').map(a => a.trim());
     *     return areas.includes('INV_CON');
     * })
     *
     * @example
     * // Combined
     * AuthMiddleware.requireAccess(user =>
     *     user.userLevel >= 3 && user.permissions?.includes('DELETE_USERS')
     * )
     */
    static requireAccess(predicate, options = {}) {
        return (req, res, next) => {
            if (!req.user) {
                return next(
                    new AppError(AUTH_ERRORS.USER_NOT_FOUND, 401, {
                        type: "AuthenticationError",
                    }),
                );
            }

            if (!predicate(req.user)) {
                return next(
                    new AppError(
                        options.message || AUTH_ERRORS.FORBIDDEN_ACCESS,
                        403,
                        {
                            type: "AuthorizationError",
                            hint: "You do not have the required permission for this resource.",
                        },
                    ),
                );
            }

            next();
        };
    }

    /**
     * Middleware factory — validates required fields in req.body or req.query.
     * @param {string[]} requiredFields
     */
    static validateRequiredFields(requiredFields) {
        return (req, res, next) => {
            const source = req.method === "GET" ? req.query : req.body;
            const missing = requiredFields.filter(
                (f) =>
                    source[f] === undefined ||
                    source[f] === null ||
                    source[f] === "",
            );

            if (missing.length > 0) {
                return next(
                    new AppError(
                        `Missing required fields: ${missing.join(", ")}`,
                        400,
                        {
                            type: "ValidationError",
                            details: missing.map((f) => ({
                                field: f,
                                issue: "Required",
                            })),
                        },
                    ),
                );
            }

            next();
        };
    }

    static _escapeHtml(str) {
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    static _authHtmlError(title, line1, line2) {
        const t = AuthMiddleware._escapeHtml(title);
        const l1 = AuthMiddleware._escapeHtml(line1);
        const l2 = AuthMiddleware._escapeHtml(line2);
        return `<!DOCTYPE html>
<html><head><title>${t}</title>
<style>body{font-family:Arial,sans-serif;margin:40px}.error-container{max-width:600px;margin:0 auto}
.error-title{color:#d32f2f;margin-bottom:20px}.error-message{background:#f5f5f5;padding:15px;border-radius:4px}
.login-button{background:#1976d2;color:white;padding:10px 20px;text-decoration:none;border-radius:4px;display:inline-block;margin-top:15px}</style>
</head><body><div class="error-container"><h1 class="error-title">${t}</h1>
<div class="error-message"><p>${l1}</p><p>${l2}</p></div>
<a href="/login" class="login-button">Go to Login</a>
<a href="javascript:history.back()" class="login-button">Go Back</a>
</div></body></html>`;
    }
}

module.exports = AuthMiddleware;
