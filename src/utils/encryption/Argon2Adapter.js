/**
 * Argon2Adapter.js
 * Password hashing and verification using Argon2id — OWASP's #1 recommended
 * algorithm. Includes pepper support, needs-rehash detection, and a bcrypt
 * migration helper for zero-downtime algorithm upgrades.
 *
 * Argon2id is memory-hard and side-channel resistant, making it highly
 * resilient against GPU/ASIC brute-force and timing attacks.
 *
 * @author Jm-Paunlagui
 * @version 2.0
 * @license Apache-2.0
 */

"use strict";

const argon2 = require("argon2");
const crypto = require("crypto");
const { logger } = require("../logger");

// ---------------------------------------------------------------------------
// Mode resolution — driven by PASSWORD_HASH_MODE in .env
// ---------------------------------------------------------------------------
const VALID_MODES = ["plain", "bcrypt", "argon2", "tripledes"];

const resolveMode = () => {
    const mode = (process.env.PASSWORD_HASH_MODE || "argon2")
        .toLowerCase()
        .trim();

    if (!VALID_MODES.includes(mode)) {
        throw new Error(
            `[Argon2Adapter] Invalid PASSWORD_HASH_MODE: "${mode}". ` +
                `Accepted: ${VALID_MODES.join(" | ")}`,
        );
    }

    if (mode === "plain" && process.env.NODE_ENV === "production") {
        throw new Error(
            "[Argon2Adapter] PASSWORD_HASH_MODE=plain is forbidden in production.",
        );
    }

    return mode;
};

const MODE = resolveMode();

// ---------------------------------------------------------------------------
// Argon2 config — only resolved when MODE === "argon2"
// ---------------------------------------------------------------------------
const DEFAULTS = {
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
    hashLength: 32,
};

const parseEnvInt = (key, fallback, min, max) => {
    const raw = process.env[key];
    if (!raw) return fallback;
    const val = parseInt(raw, 10);
    if (isNaN(val) || val < min || val > max) {
        throw new RangeError(
            `[Argon2Adapter] ${key} must be between ${min} and ${max}. Got: "${raw}"`,
        );
    }
    return val;
};

const resolveConfig = () => ({
    memoryCost: parseEnvInt(
        "ARGON2_MEMORY_COST",
        DEFAULTS.memoryCost,
        8192,
        4194304,
    ),
    timeCost: parseEnvInt("ARGON2_TIME_COST", DEFAULTS.timeCost, 1, 999),
    parallelism: parseEnvInt("ARGON2_PARALLELISM", DEFAULTS.parallelism, 1, 64),
    hashLength: parseEnvInt("ARGON2_HASH_LENGTH", DEFAULTS.hashLength, 16, 128),
});

const resolvePepper = () => {
    const pepper = process.env.ARGON2_PEPPER;
    if (!pepper || pepper.trim().length < 32) {
        throw new Error(
            "[Argon2Adapter] ARGON2_PEPPER must be set and at least 32 characters.\n" +
                "  Generate: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
        );
    }
    return pepper.trim();
};

// Only resolve Argon2 config when it's actually needed
const CONFIG = MODE === "argon2" ? resolveConfig() : null;
const PEPPER = MODE === "argon2" ? resolvePepper() : null;
const MAX_PASSWORD_BYTES = parseEnvInt(
    "ARGON2_MAX_PASSWORD_BYTES",
    1024,
    64,
    4096,
);

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const applyPepper = (password) =>
    crypto.createHmac("sha256", PEPPER).update(password).digest();

const validatePassword = (value, label = "Password") => {
    if (!value || typeof value !== "string") {
        throw new TypeError(
            `[Argon2Adapter] ${label} must be a non-empty string.`,
        );
    }
    if (Buffer.byteLength(value, "utf8") > MAX_PASSWORD_BYTES) {
        throw new RangeError(
            `[Argon2Adapter] ${label} exceeds the maximum allowed size (${MAX_PASSWORD_BYTES} bytes).`,
        );
    }
};

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

class Argon2Adapter {
    /**
     * Hashes a password using the strategy set by PASSWORD_HASH_MODE.
     *
     * @param {string} password
     * @returns {Promise<string>}
     */
    static async hashPassword(password) {
        validatePassword(password);

        // plain — dev/test only, no hashing
        if (MODE === "plain") return password;

        // bcrypt — legacy, use only during migration
        if (MODE === "bcrypt") {
            const bcrypt = require("bcrypt");
            const rounds = parseEnvInt("BCRYPT_SALT_ROUNDS", 12, 10, 31);
            try {
                return await bcrypt.hash(password, rounds);
            } catch (err) {
                logger.error("[Argon2Adapter] bcrypt hashing error:", err);
                throw new Error("Password hashing failed.");
            }
        }

        // argon2 — recommended path
        try {
            return await argon2.hash(applyPepper(password), {
                type: argon2.argon2id,
                memoryCost: CONFIG.memoryCost,
                timeCost: CONFIG.timeCost,
                parallelism: CONFIG.parallelism,
                hashLength: CONFIG.hashLength,
            });
        } catch (err) {
            logger.error("[Argon2Adapter] Hashing error:", err);
            throw new Error("Password hashing failed.");
        }
    }

    /**
     * Verifies a password against a stored hash.
     * Auto-detects the hash type from its prefix — safe to call during migration.
     *
     * @param {string} password
     * @param {string} hashedPassword
     * @returns {Promise<boolean>}
     */
    static async verifyPassword(password, hashedPassword) {
        validatePassword(password);

        if (!hashedPassword || typeof hashedPassword !== "string") {
            throw new TypeError(
                "[Argon2Adapter] Hashed password must be a non-empty string.",
            );
        }

        // plain mode — direct compare
        if (MODE === "plain") return password === hashedPassword;

        // Auto-detect: bcrypt hash in an argon2-mode system (migration in progress)
        const isBcryptHash =
            hashedPassword.startsWith("$2b$") ||
            hashedPassword.startsWith("$2a$");

        if (isBcryptHash) {
            const bcrypt = require("bcrypt");
            try {
                return await bcrypt.compare(password, hashedPassword);
            } catch (err) {
                logger.error("[Argon2Adapter] bcrypt verification error:", err);
                throw new Error("Password verification failed.");
            }
        }

        // Argon2 hash
        try {
            return await argon2.verify(hashedPassword, applyPepper(password));
        } catch (err) {
            logger.error("[Argon2Adapter] Verification error:", err);
            throw new Error("Password verification failed.");
        }
    }

    /**
     * Returns true if the stored hash was produced with weaker params than
     * the current CONFIG. Re-hash on next successful login when this is true.
     *
     * @param {string} hashedPassword
     * @returns {boolean}
     */
    static needsRehash(hashedPassword) {
        if (MODE !== "argon2") return false;
        return argon2.needsRehash(hashedPassword, {
            memoryCost: CONFIG.memoryCost,
            timeCost: CONFIG.timeCost,
            parallelism: CONFIG.parallelism,
        });
    }

    /**
     * Verifies a legacy bcrypt hash and issues a fresh Argon2id hash on match.
     * Only meaningful when PASSWORD_HASH_MODE=argon2.
     *
     * @param {string} password
     * @param {string} bcryptHash
     * @returns {Promise<{ matched: boolean, argon2Hash: string|null, requiresReset?: boolean }>}
     */
    static async migrateFromBcrypt(password, bcryptHash) {
        validatePassword(password);

        if (!bcryptHash.startsWith("$2b$") && !bcryptHash.startsWith("$2a$")) {
            throw new TypeError(
                "[Argon2Adapter] Provided hash does not appear to be a bcrypt hash.",
            );
        }

        if (Buffer.byteLength(password, "utf8") > 72) {
            return { matched: false, argon2Hash: null, requiresReset: true };
        }

        const bcrypt = require("bcrypt");
        const matched = await bcrypt.compare(password, bcryptHash);
        if (!matched) return { matched: false, argon2Hash: null };

        const argon2Hash = await Argon2Adapter.hashPassword(password);
        return { matched: true, argon2Hash };
    }

    /** Active mode and configuration snapshot — useful for auditing and tests. */
    static get config() {
        return {
            mode: MODE,
            ...(MODE === "argon2"
                ? { ...CONFIG, maxPasswordBytes: MAX_PASSWORD_BYTES }
                : {}),
        };
    }
}

module.exports = Argon2Adapter;
