"use strict";

/**
 * @fileoverview Authentication & Authorization Middleware
 * @description JWT authentication, role-based access control, and request validation.
 * @version 2.0.0
 */

const jwt = require("jsonwebtoken");
const { AUTH_ERRORS } = require("../../constants/errors");
const { logger } = require("../../utils/logger");

// ─── Constants ────────────────────────────────────────────────────────────────

const ROLES = {
    SADMIN: 3,
    ADMIN: 2,
    USER: 1,
};

const AREAS = {
    INV_CON: "INV_CON",
    INV_UNIT_SUP: "INV_UNIT_SUP",
    INV_UNIT: "INV_UNIT",
    INV_PROD: "INV_PROD",
    INV_PPC: "INV_PPC",
};

// ─── Authenticate Token ───────────────────────────────────────────────────────

/**
 * Middleware that authenticates JWT tokens from cookies or Authorization header.
 * Adds decoded user payload to `req.user`.
 */
function authenticateToken(req, res, next) {
    const token =
        req.cookies.token ||
        req.headers["authorization"]?.split(" ")[1] ||
        req.query.token;

    const isFileDownload =
        req.path.includes("/export/") ||
        req.path.includes("/download/") ||
        (req.headers.accept &&
            req.headers.accept.includes("application/vnd.openxmlformats"));

    if (!token) {
        if (isFileDownload) {
            res.setHeader("Content-Type", "text/html; charset=utf-8");
            res.setHeader("Content-Disposition", "inline");
            return res
                .status(401)
                .send(
                    _authHtmlError(
                        "Authentication Required",
                        "You need to be logged in to download this file.",
                        "Please log in and try again.",
                    ),
                );
        }
        return res.status(401).json({
            status: "error",
            code: 401,
            message: AUTH_ERRORS.USER_NOT_FOUND,
            error: {
                type: "AuthenticationError",
                hint: "Provide a valid token.",
            },
        });
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
            if (isFileDownload) {
                res.setHeader("Content-Type", "text/html; charset=utf-8");
                res.setHeader("Content-Disposition", "inline");
                return res
                    .status(403)
                    .send(
                        _authHtmlError(
                            "Access Denied",
                            "Your authentication token is invalid or has expired.",
                            "Please log in again and try downloading the file.",
                        ),
                    );
            }
            return res.status(403).json({
                status: "error",
                code: 403,
                message: AUTH_ERRORS.FORBIDDEN_ACCESS,
                error: {
                    type: "AuthenticationError",
                    hint: "Token invalid or expired.",
                },
            });
        }
        req.user = user;
        next();
    });
}

// ─── Verify Token (Promise) ──────────────────────────────────────────────────

function verifyToken(token) {
    return new Promise((resolve, reject) => {
        jwt.verify(token, process.env.JWT_SECRET, (err, payload) => {
            if (err) return reject(new Error(AUTH_ERRORS.FORBIDDEN_ACCESS));
            resolve(payload);
        });
    });
}

// ─── Require Access ───────────────────────────────────────────────────────────

/**
 * Middleware factory — restricts access by role and/or area.
 * @param {Object} options
 * @param {number|number[]} [options.role] - Required user role(s)
 * @param {string|string[]} [options.area] - Required area(s)
 */
function requireAccess(options = {}) {
    return (req, res, next) => {
        const { role, area } = options;
        const userData = req.user?.user_data;

        if (!userData) {
            return res.status(403).json({
                status: "error",
                code: 403,
                message: AUTH_ERRORS.FORBIDDEN_ACCESS,
            });
        }

        // Role check
        let hasRole = true;
        if (role) {
            const userLevel = parseInt(userData.userLevel);
            hasRole = Array.isArray(role)
                ? role.map((r) => parseInt(r)).includes(userLevel)
                : userLevel === parseInt(role);
        }

        // Area check
        let hasArea = true;
        if (area && userData.area) {
            const userAreas = userData.area.split(",").map((a) => a.trim());
            const required = Array.isArray(area) ? area : [area];
            hasArea = required.some((r) => userAreas.includes(r));
        } else if (area) {
            hasArea = false;
        }

        if (!hasRole || !hasArea) {
            return res.status(403).json({
                status: "error",
                code: 403,
                message: AUTH_ERRORS.FORBIDDEN_ACCESS,
            });
        }

        next();
    };
}

// ─── Validate Required Fields ─────────────────────────────────────────────────

/**
 * Middleware factory — validates required fields in req.body or req.query.
 * @param {string[]} requiredFields
 */
function validateRequiredFields(requiredFields) {
    return (req, res, next) => {
        const source = req.method === "GET" ? req.query : req.body;
        const missing = requiredFields.filter(
            (f) =>
                source[f] === undefined ||
                source[f] === null ||
                source[f] === "",
        );

        if (missing.length > 0) {
            return res.status(400).json({
                status: "error",
                code: 400,
                message: `Missing required fields: ${missing.join(", ")}`,
                error: {
                    type: "ValidationError",
                    details: missing.map((f) => ({
                        field: f,
                        issue: "Required",
                    })),
                },
            });
        }

        // USERID numeric check
        if (requiredFields.includes("USERID") && "USERID" in source) {
            if (!/^\d+$/.test(source.USERID)) {
                return res.status(400).json({
                    status: "error",
                    code: 400,
                    message: "USERID must be a number",
                    error: {
                        type: "ValidationError",
                        details: [
                            { field: "USERID", issue: "Must be numeric" },
                        ],
                    },
                });
            }
        }

        // USERNAME format check
        if (requiredFields.includes("USERNAME") && "USERNAME" in source) {
            if (!/^(?=.*[a-zA-Z])[a-zA-Z0-9._]{3,20}$/.test(source.USERNAME)) {
                return res.status(400).json({
                    status: "error",
                    code: 400,
                    message:
                        "USERNAME must be 3-20 characters, alphanumeric, may include underscores or dots.",
                    error: {
                        type: "ValidationError",
                        details: [
                            { field: "USERNAME", issue: "Invalid format" },
                        ],
                    },
                });
            }
        }

        next();
    };
}

// ─── Private Helpers ──────────────────────────────────────────────────────────

function _authHtmlError(title, line1, line2) {
    return `<!DOCTYPE html>
<html><head><title>${title}</title>
<style>body{font-family:Arial,sans-serif;margin:40px}.error-container{max-width:600px;margin:0 auto}
.error-title{color:#d32f2f;margin-bottom:20px}.error-message{background:#f5f5f5;padding:15px;border-radius:4px}
.login-button{background:#1976d2;color:white;padding:10px 20px;text-decoration:none;border-radius:4px;display:inline-block;margin-top:15px}</style>
</head><body><div class="error-container"><h1 class="error-title">${title}</h1>
<div class="error-message"><p>${line1}</p><p>${line2}</p></div>
<a href="/login" class="login-button">Go to Login</a>
<a href="javascript:history.back()" class="login-button">Go Back</a>
</div></body></html>`;
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
    authenticateToken,
    verifyToken,
    requireAccess,
    validateRequiredFields,
    ROLES,
    AREAS,
};
