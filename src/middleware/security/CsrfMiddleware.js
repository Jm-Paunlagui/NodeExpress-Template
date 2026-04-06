"use strict";

/**
 * @fileoverview CSRF protection middleware using double-submit cookie pattern.
 * Uses csrf-csrf library with HTTP-only cookies,
 * forced token rotation, and multiple token sources.
 */

const { doubleCsrf } = require("csrf-csrf");
const { logger } = require("../../utils/logger");

const TOKEN_TTL_MS = 5 * 60 * 1000;
const TOKEN_SIZE = 64;

class CsrfMiddleware {
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
        this.handle = this._protect.bind(this);
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

const defaultCsrf = new CsrfMiddleware();
module.exports = { CsrfMiddleware, defaultCsrf };
