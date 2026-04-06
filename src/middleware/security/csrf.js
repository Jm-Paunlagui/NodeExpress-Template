/**
 * @fileoverview CSRF (Cross-Site Request Forgery) Protection Middleware
 * @description Comprehensive CSRF protection system for backend API using csrf-csrf library
 * @author Jm-Paunlagui
 * @version 3.0.0
 * @updated March 2026
 *
 * This module provides robust CSRF protection using the Double Submit Cookie pattern
 * via the csrf-csrf library, encapsulated in a class for clean lifecycle management
 * and testability.
 *
 * Security Features:
 * - Double Submit Cookie pattern (industry standard)
 * - HTTP-only cookies prevent XSS attacks from stealing secrets
 * - Secure flag ensures cookies only sent over HTTPS
 * - SameSite=Strict prevents cross-site cookie sending
 * - Cryptographically secure token generation
 * - Forced token rotation on refresh via { overwrite: true }
 * - Multiple token source support (headers, body)
 *
 * Environment Variables:
 * - CSRF_SECRET : Secret key for CSRF token generation (required in production)
 * - NODE_ENV    : Environment mode (affects cookie security settings)
 * - USE_HTTPS   : Set to 'true' in production to enable __Host- cookie prefix and Secure flag
 *
 * @requires csrf-csrf
 * @requires ../../utils/logger
 */

"use strict";

const { doubleCsrf } = require("csrf-csrf");
const { logger } = require("../../utils/logger");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TOKEN_TTL_MS = 5 * 60 * 1000; // 5 mins
const TOKEN_SIZE = 64; // bytes — larger = more secure

// ---------------------------------------------------------------------------
// CsrfProtection class
// ---------------------------------------------------------------------------

/**
 * Encapsulates all CSRF protection logic for a single Express application.
 *
 * Usage:
 *   const csrf = new CsrfProtection();
 *   router.get('/token',   csrf.tokenHandler);
 *   router.post('/refresh', csrf.refreshHandler);
 *   router.get('/status',  csrf.statusHandler);
 *   router.use(csrf.protect);          // validate on state-changing routes
 */
class CsrfProtection {
    /**
     * @param {object} [options]
     * @param {string} [options.secret]           - Override CSRF_SECRET env var (useful in tests)
     * @param {boolean} [options.forceSecure]     - Override the HTTPS / secure-cookie detection
     */
    constructor(options = {}) {
        this._isSecure =
            options.forceSecure ??
            (process.env.NODE_ENV === "production" &&
                process.env.USE_HTTPS === "true");

        this._secret =
            options.secret ??
            process.env.CSRF_SECRET ??
            "your-csrf-secret-key-here-change-in-production";

        const { generateCsrfToken, doubleCsrfProtection } = doubleCsrf({
            getSecret: () => this._secret,
            getSessionIdentifier: (req) =>
                req.ip ?? req.connection?.remoteAddress ?? "anonymous",
            cookieName: this._cookieName,
            cookieOptions: {
                httpOnly: true,
                secure: this._isSecure,
                sameSite: "strict",
                path: "/",
                maxAge: TOKEN_TTL_MS,
            },
            size: TOKEN_SIZE,
            getTokenFromRequest: (req) =>
                req.headers["x-csrf-token"] ??
                req.body?._csrf ??
                req.body?.csrfToken,
        });

        this._generateCsrfToken = generateCsrfToken;
        this._doubleCsrfProtection = doubleCsrfProtection;

        this.tokenHandler = this._tokenHandler.bind(this);
        this.refreshHandler = this._refreshHandler.bind(this);
        this.statusHandler = this._statusHandler.bind(this);
        this.protect = this._protect.bind(this);
    }

    get _cookieName() {
        return this._isSecure
            ? "__Host-psifi.x-csrf-token"
            : "psifi.x-csrf-token";
    }

    get generateToken() {
        return this._generateCsrfToken;
    }

    get doubleCsrfProtection() {
        return this._doubleCsrfProtection;
    }

    _buildTokenResponse(res, token) {
        const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();
        res.json({
            success: true,
            token,
            cookieName: this._cookieName,
            headerName: "x-csrf-token",
            expiresIn: TOKEN_TTL_MS,
            expiresAt,
        });
    }

    _sendError(res, statusCode, message, error) {
        res.status(statusCode).json({
            success: false,
            message,
            error:
                process.env.NODE_ENV === "development"
                    ? (error?.message ?? String(error))
                    : undefined,
        });
    }

    _tokenHandler(req, res) {
        try {
            const token = this._generateCsrfToken(req, res);
            if (!token)
                throw new Error("Token generation returned an empty value");

            logger.info("CSRF token generated", {
                ip: req.ip,
                userAgent: req.get("user-agent"),
                endpoint: req.originalUrl,
                cookieName: this._cookieName,
                tokenLength: token.length,
                operation: "CSRF_TOKEN_GENERATE",
            });

            this._buildTokenResponse(res, token);
        } catch (error) {
            logger.error("Failed to generate CSRF token", {
                error: error.message ?? String(error),
                errorName: error.name,
                stack: error.stack,
                ip: req.ip,
                operation: "CSRF_TOKEN_GENERATE_FAILURE",
            });

            this._sendError(res, 500, "Failed to generate CSRF token", error);
        }
    }

    _refreshHandler(req, res) {
        try {
            const cookieName = this._cookieName;

            if (!req.cookies?.[cookieName]) {
                logger.warn(
                    "CSRF refresh attempted without an existing cookie",
                    {
                        ip: req.ip,
                        userAgent: req.get("user-agent"),
                        operation: "CSRF_TOKEN_REFRESH_NO_SESSION",
                    },
                );

                return res.status(400).json({
                    success: false,
                    message:
                        "Cannot refresh without an existing CSRF session. " +
                        "Obtain a token via GET /csrf/token first.",
                    code: "NO_CSRF_SESSION",
                });
            }

            const token = this._generateCsrfToken(req, res, {
                overwrite: true,
            });
            if (!token)
                throw new Error("Token refresh returned an empty value");

            logger.info("CSRF token refreshed", {
                ip: req.ip,
                userAgent: req.get("user-agent"),
                endpoint: req.originalUrl,
                cookieName,
                tokenLength: token.length,
                operation: "CSRF_TOKEN_REFRESH",
            });

            res.json({
                success: true,
                token,
                cookieName,
                headerName: "x-csrf-token",
                message: "CSRF token refreshed successfully",
                expiresIn: TOKEN_TTL_MS,
                expiresAt: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
            });
        } catch (error) {
            logger.error("Failed to refresh CSRF token", {
                error: error.message ?? String(error),
                stack: error.stack,
                ip: req.ip,
                operation: "CSRF_TOKEN_REFRESH_FAILURE",
            });

            this._sendError(res, 500, "Failed to refresh CSRF token", error);
        }
    }

    _statusHandler(req, res) {
        try {
            const cookieName = this._cookieName;
            const hasCookie = !!req.cookies?.[cookieName];

            res.json({
                success: true,
                status: {
                    enabled: true,
                    hasSecret: hasCookie,
                    cookieName,
                    headerName: "x-csrf-token",
                    methods: {
                        protected: ["POST", "PUT", "DELETE", "PATCH"],
                        safe: ["GET", "HEAD", "OPTIONS"],
                    },
                    tokenSources: [
                        "header:x-csrf-token",
                        "body:_csrf",
                        "body:csrfToken",
                    ],
                    cookieOptions: {
                        httpOnly: true,
                        secure: this._isSecure,
                        sameSite: "strict",
                        maxAge: TOKEN_TTL_MS,
                    },
                },
                message: hasCookie
                    ? "CSRF protection is active with a valid secret cookie"
                    : "CSRF protection is active (no secret cookie found on this request)",
            });
        } catch (error) {
            logger.error("Failed to return CSRF status", {
                error: error.message ?? String(error),
                stack: error.stack,
                ip: req.ip,
                operation: "CSRF_STATUS_FAILURE",
            });

            this._sendError(res, 500, "Failed to retrieve CSRF status", error);
        }
    }

    _protect(req, res, next) {
        this._doubleCsrfProtection(req, res, (err) => {
            if (err) {
                logger.warn("CSRF validation failed", {
                    ip: req.ip,
                    userAgent: req.get("user-agent"),
                    url: req.originalUrl,
                    method: req.method,
                    error: err.message,
                    hasToken: !!(
                        req.headers["x-csrf-token"] ??
                        req.body?._csrf ??
                        req.body?.csrfToken
                    ),
                    hasCookie: !!req.cookies?.[this._cookieName],
                    operation: "CSRF_TOKEN_INVALID",
                });

                return res.status(403).json({
                    success: false,
                    message: "CSRF validation failed",
                    code: "CSRF_TOKEN_INVALID",
                    error:
                        process.env.NODE_ENV === "development"
                            ? err.message
                            : "Invalid or missing CSRF token",
                });
            }

            logger.debug("CSRF validation passed", {
                ip: req.ip,
                url: req.originalUrl,
                method: req.method,
                operation: "CSRF_TOKEN_VALID",
            });

            next();
        });
    }
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------
const defaultInstance = new CsrfProtection();

module.exports = {
    csrfProtect: defaultInstance.protect,
    csrfTokenHandler: defaultInstance.tokenHandler,
    csrfRefreshHandler: defaultInstance.refreshHandler,
    csrfStatusHandler: defaultInstance.statusHandler,
    generateCsrfToken: defaultInstance.generateToken,
    doubleCsrfProtection: defaultInstance.doubleCsrfProtection,
    CsrfProtection,
};
