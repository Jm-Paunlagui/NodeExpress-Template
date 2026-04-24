"use strict";

const { HTTP_STATUS, AppError, AUTH_ERRORS } = require("../constants");
const { sendSuccess, RESPONSE_MESSAGES } = require("../constants/responses");
const { catchAsync } = require("../utils/catchAsync");
const { logger } = require("../utils/logger");
const { authMessages } = require("../constants/messages");
const AuthService = require("../services/auth.service");

class AuthController {
    /**
     * POST /api/v1/auth/login
     * Body: { userId, password }
     */
    static login = catchAsync(async (req, res) => {
        const { userId, password } = req.body;

        const { user, accessToken, refreshToken } = await AuthService.login(
            userId,
            password,
        );

        res.cookie(AuthService.COOKIE_NAMES.ACCESS, accessToken, AuthService.accessCookieOptions());
        res.cookie(AuthService.COOKIE_NAMES.REFRESH, refreshToken, AuthService.refreshCookieOptions());

        res.status(HTTP_STATUS.OK).json(
            sendSuccess(RESPONSE_MESSAGES.LOGIN_SUCCESS, { user }),
        );
    });

    /**
     * POST /api/v1/auth/refresh
     * Reads the refresh token from the signed cookie or Authorization header.
     */
    static refresh = catchAsync(async (req, res) => {
        const refreshToken =
            req.signedCookies?.[AuthService.COOKIE_NAMES.REFRESH] ||
            req.headers["authorization"]?.split(" ")[1];

        if (!refreshToken) {
            throw new AppError(AUTH_ERRORS.USER_NOT_FOUND, HTTP_STATUS.UNAUTHORIZED, {
                type: "AuthenticationError",
                hint: "No refresh token provided.",
            });
        }

        const { user, accessToken, refreshToken: newRefresh } =
            await AuthService.refresh(refreshToken);

        res.cookie(AuthService.COOKIE_NAMES.ACCESS, accessToken, AuthService.accessCookieOptions());
        res.cookie(AuthService.COOKIE_NAMES.REFRESH, newRefresh, AuthService.refreshCookieOptions());

        res.status(HTTP_STATUS.OK).json(
            sendSuccess(RESPONSE_MESSAGES.TOKEN_REFRESHED, { user }),
        );
    });

    /**
     * POST /api/v1/auth/logout
     * Requires: AuthMiddleware.authenticate
     */
    static logout = catchAsync(async (req, res) => {
        const userId = req.user?.userId;

        res.clearCookie(AuthService.COOKIE_NAMES.ACCESS, { path: "/" });
        res.clearCookie(AuthService.COOKIE_NAMES.REFRESH, { path: "/api/v1/auth/refresh" });

        if (userId) logger.info(authMessages.AUTH_LOGOUT(userId));

        res.status(HTTP_STATUS.OK).json(
            sendSuccess(RESPONSE_MESSAGES.LOGOUT_SUCCESS),
        );
    });

    /**
     * GET /api/v1/auth/me
     * Returns the decoded JWT payload (profile from token, no extra DB call).
     * Requires: AuthMiddleware.authenticate
     */
    static me = catchAsync(async (req, res) => {
        res.status(HTTP_STATUS.OK).json(
            sendSuccess(RESPONSE_MESSAGES.FETCHED, req.user),
        );
    });
}

module.exports = AuthController;
