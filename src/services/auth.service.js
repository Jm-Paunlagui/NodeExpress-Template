"use strict";

const jwt = require("jsonwebtoken");
const { AppError, AUTH_ERRORS } = require("../constants/errors");
const { HTTP_STATUS } = require("../constants");
const { logger } = require("../utils/logger");
const { authMessages } = require("../constants/messages");
const {
    CryptoVault,
    SymmetricCrypto,
} = require("../utils/encryption/CryptoVault");
const HrisUaModel = require("../models/hris.ua.model");
const MealAdmModel = require("../models/meal.adm.model");
const { loginLockout } = require("../middleware/authentication/LoginLockoutMiddleware");

class AuthService {
    // ─── Cookie name constants (single source of truth) ───────────────────────
    static COOKIE_NAMES = {
        ACCESS: "meal.access-token",
        REFRESH: "meal.refresh-token",
    };

    // ─── Public API ───────────────────────────────────────────────────────────

    /**
     * Authenticates a user.
     *
     * Primary path  : U_USERS (userAccount DB) — TripleDES-encrypted password.
     * Fallback path : T_EMP_MGMT_ADMIN (Meal DB) — hashed password (bcrypt or argon2).
     *
     * @param {string} userId
     * @param {string} password  - Plaintext password supplied by the user
     * @returns {Promise<{ user: object, accessToken: string, refreshToken: string }>}
     */
    static async login(userId, password) {
        // ── Lockout gate ──────────────────────────────────────────────────────
        const lockState = loginLockout.check(userId);

        if (lockState.hrReset) {
            throw new AppError(AUTH_ERRORS.ACCOUNT_LOCKED_PERMANENTLY, 423, {
                type: "AccountLockedError",
            });
        }

        if (lockState.locked) {
            throw new AppError(AUTH_ERRORS.ACCOUNT_LOCKED, 429, {
                type: "AccountLockedError",
                details: [{ field: "retryAfter", issue: `${lockState.retryAfter}` }],
            });
        }

        // ── Credential check ──────────────────────────────────────────────────
        const uaUser = await HrisUaModel.findByUserId(userId);

        if (uaUser) {
            logger.info(authMessages.AUTH_UA_PRIMARY(userId));
            return AuthService._loginViaUa(uaUser, userId, password);
        }

        logger.info(authMessages.AUTH_FALLBACK_MEAL(userId));
        return AuthService._loginViaMeal(userId, password);
    }

    /**
     * Issues a fresh access + refresh token pair using the stored refresh token.
     * Re-fetches user data so the new token reflects any role changes.
     *
     * @param {string} refreshToken
     * @returns {Promise<{ user: object, accessToken: string, refreshToken: string }>}
     */
    static async refresh(refreshToken) {
        let decoded;
        try {
            decoded = jwt.verify(refreshToken, process.env.JWT_SECRET);
        } catch {
            throw new AppError(AUTH_ERRORS.TOKEN_INVALID, 403, {
                type: "AuthenticationError",
                hint: "Refresh token is invalid or expired. Please log in again.",
            });
        }

        if (decoded.type !== "refresh") {
            throw new AppError(AUTH_ERRORS.TOKEN_INVALID, 403, {
                type: "AuthenticationError",
            });
        }

        const userId = decoded.sub;
        const uaUser = await HrisUaModel.findByUserId(userId);

        if (uaUser) {
            const empAdmin = await MealAdmModel.findByEmpId(userId);
            const role = await AuthService._resolveRole(empAdmin);
            logger.info(authMessages.TOKEN_REFRESHED(userId));
            return AuthService._issueTokens({
                userId,
                firstName: uaUser.FIRSTNAME,
                lastName: uaUser.LASTNAME,
                segmentCode: uaUser.SEGMENT_CODE,
                segmentDesc: uaUser.SEGMENT_DESC,
                email: uaUser.EMAILADDRESS ?? null,
                role,
                loginSource: "ua",
            });
        }

        // Fallback: meal-only account
        const empAdmin = await MealAdmModel.findByEmpId(userId);
        if (!empAdmin) {
            throw new AppError(AUTH_ERRORS.USER_NOT_FOUND, 401, {
                type: "AuthenticationError",
            });
        }

        const sigValid = await CryptoVault.verifyRecord(
            "T_EMP_MGMT_ADMIN",
            { EMP_ID: empAdmin.EMP_ID, EMP_PW: empAdmin.EMP_PW, EMP_ROLE: empAdmin.EMP_ROLE },
            empAdmin.SYSSIGNATURE,
        );
        if (!sigValid) {
            logger.warn(authMessages.SYS_SIGNATURE_TAMPERED_BLOCKED(userId));
            throw new AppError(AUTH_ERRORS.FORBIDDEN_ACCESS, 403, {
                type: "AuthorizationError",
            });
        }

        logger.info(authMessages.TOKEN_REFRESHED(userId));
        return AuthService._issueTokens({
            userId: empAdmin.EMP_ID,
            firstName: null,
            lastName: null,
            segmentCode: null,
            segmentDesc: null,
            email: null,
            role: empAdmin.EMP_ROLE,
            loginSource: "meal",
        });
    }

    // ─── Cookie option helpers (used by the controller) ───────────────────────

    static accessCookieOptions() {
        return {
            httpOnly: true,
            secure: process.env.USE_HTTPS === "true",
            sameSite: "strict",
            signed: true,
            maxAge: AuthService._parseDuration(process.env.JWT_EXPIRES_IN || "30m"),
        };
    }

    /**
     * Converts a JWT-style duration string to milliseconds.
     * Supports s (seconds), m (minutes), h (hours), d (days).
     *
     * @param {string} str - e.g. '30m', '8h', '7d', '60s'
     * @returns {number} Duration in milliseconds
     * @throws {Error} When the format is unrecognised
     *
     * @example
     * AuthService._parseDuration('30m')  // 1_800_000
     * AuthService._parseDuration('8h')   // 28_800_000
     * AuthService._parseDuration('7d')   // 604_800_000
     */
    static _parseDuration(str) {
        const match = /^(\d+)([smhd])$/.exec(String(str).trim());
        if (!match) {
            throw new Error(`Unrecognised duration format: "${str}". Expected e.g. "30m", "8h", "7d".`);
        }
        const value = parseInt(match[1], 10);
        const unit = match[2];
        const multipliers = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };
        return value * multipliers[unit];
    }

    static refreshCookieOptions() {
        return {
            httpOnly: true,
            secure: process.env.USE_HTTPS === "true",
            sameSite: "strict",
            signed: true,
            path: "/api/v1/auth/refresh",
            maxAge: 7 * 24 * 60 * 60 * 1000, // 7 d
        };
    }

    // ─── Private helpers ──────────────────────────────────────────────────────

    static async _loginViaUa(uaUser, userId, password) {
        const decrypted = SymmetricCrypto.SecurityCryptHelper.decryptText(
            uaUser.PASSWORD,
        );

        if (!decrypted || decrypted !== password) {
            loginLockout.recordFailure(userId);
            throw new AppError(AUTH_ERRORS.INVALID_CREDENTIALS, 401, {
                type: "AuthenticationError",
            });
        }

        const empAdmin = await MealAdmModel.findByEmpId(userId);
        const role = await AuthService._resolveRole(empAdmin);
        logger.info(authMessages.AUTH_SUCCESS(userId));

        const tokens = AuthService._issueTokens({
            userId,
            firstName: uaUser.FIRSTNAME,
            lastName: uaUser.LASTNAME,
            segmentCode: uaUser.SEGMENT_CODE,
            segmentDesc: uaUser.SEGMENT_DESC,
            email: uaUser.EMAILADDRESS ?? null,
            role,
            loginSource: "ua",
        });

        loginLockout.recordSuccess(userId);
        return tokens;
    }

    static async _loginViaMeal(userId, password) {
        const empAdmin = await MealAdmModel.findByEmpId(userId);

        if (!empAdmin) {
            // Intentionally vague — don't reveal which DB was checked
            loginLockout.recordFailure(userId);
            throw new AppError(AUTH_ERRORS.INVALID_CREDENTIALS, 401, {
                type: "AuthenticationError",
            });
        }

        // Integrity check: reject records with broken signatures before
        // attempting password comparison (prevents timing oracle on tampered rows)
        const sigValid = await CryptoVault.verifyRecord(
            "T_EMP_MGMT_ADMIN",
            { EMP_ID: empAdmin.EMP_ID, EMP_PW: empAdmin.EMP_PW, EMP_ROLE: empAdmin.EMP_ROLE },
            empAdmin.SYSSIGNATURE,
        );
        if (!sigValid) {
            logger.warn(authMessages.SYS_SIGNATURE_TAMPERED_BLOCKED(userId));
            throw new AppError(
                AUTH_ERRORS.ACCOUNT_INTEGRITY_FAILED,
                HTTP_STATUS.UNPROCESSABLE,
                { type: "DataIntegrityError" },
            );
        }

        const pwMatch = await CryptoVault.verifyPassword(
            password,
            empAdmin.EMP_PW,
        );
        if (!pwMatch) {
            loginLockout.recordFailure(userId);
            throw new AppError(AUTH_ERRORS.INVALID_CREDENTIALS, 401, {
                type: "AuthenticationError",
            });
        }

        logger.info(authMessages.AUTH_SUCCESS(userId));

        const tokens = AuthService._issueTokens({
            userId: empAdmin.EMP_ID,
            firstName: null,
            lastName: null,
            segmentCode: null,
            segmentDesc: null,
            email: null,
            role: empAdmin.EMP_ROLE,
            loginSource: "meal",
        });

        loginLockout.recordSuccess(userId);
        return tokens;
    }

    /**
     * Resolves the role from a T_EMP_MGMT_ADMIN record.
     * Falls back to "User" if the record is missing or its signature is broken.
     * @param {object|null} empAdmin
     * @returns {Promise<string>}
     */
    static async _resolveRole(empAdmin) {
        if (!empAdmin) return "User";

        const sigValid = await CryptoVault.verifyRecord(
            "T_EMP_MGMT_ADMIN",
            { EMP_ID: empAdmin.EMP_ID, EMP_PW: empAdmin.EMP_PW, EMP_ROLE: empAdmin.EMP_ROLE },
            empAdmin.SYSSIGNATURE,
        );

        if (!sigValid) {
            logger.warn(authMessages.SYS_SIGNATURE_TAMPERED_ROLE_FALLBACK(empAdmin.EMP_ID));
            return "User";
        }

        return empAdmin.EMP_ROLE;
    }

    /**
     * Builds and signs both JWT tokens.
     * The access token carries the full user profile.
     * The refresh token carries only sub + type (minimal surface area).
     */
    static _issueTokens({
        userId,
        firstName,
        lastName,
        segmentCode,
        segmentDesc,
        email,
        role,
        loginSource,
    }) {
        const userPayload = {
            sub: String(userId),
            userId: String(userId),
            firstName,
            lastName,
            segmentCode,
            segmentDesc,
            email,
            role,
            loginSource,
        };

        const accessToken = jwt.sign(userPayload, process.env.JWT_SECRET, {
            expiresIn: process.env.JWT_EXPIRES_IN || "8h",
        });

        const refreshToken = jwt.sign(
            { sub: String(userId), type: "refresh" },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "7d" },
        );

        return { user: userPayload, accessToken, refreshToken };
    }
}

module.exports = AuthService;
