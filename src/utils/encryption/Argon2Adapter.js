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

// ---------------------------------------------------------------------------
// OWASP-recommended Argon2id minimums (as of 2024):
//   memoryCost : 19456 KiB (19 MiB)
//   timeCost   : 2 iterations
//   parallelism: 1
// Raise these over time as hardware gets cheaper — needsRehash() handles it.
// ---------------------------------------------------------------------------
const DEFAULTS = {
    memoryCost: 19456, // KiB — primary GPU/ASIC deterrent
    timeCost:   2,     // iterations
    parallelism: 1,    // threads
    hashLength:  32,   // output bytes
};

// ---------------------------------------------------------------------------
// Pepper: a secret mixed in BEFORE hashing, stored outside the database.
// Even if your DB leaks, hashes are useless without the pepper.
// Set ARGON2_PEPPER as a long random hex string in your environment/vault.
// ---------------------------------------------------------------------------
const resolvePepper = () => {
    const pepper = process.env.ARGON2_PEPPER;
    if (!pepper || pepper.length < 32) {
        throw new Error(
            "ARGON2_PEPPER must be set and at least 32 characters. " +
            "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
        );
    }
    return pepper;
};

// ---------------------------------------------------------------------------
// Config resolution — pull from env with safe fallbacks
// ---------------------------------------------------------------------------
const resolveConfig = () => {
    const parseEnvInt = (key, fallback, min, max) => {
        const raw = process.env[key];
        if (raw === undefined) return fallback;
        const val = parseInt(raw, 10);
        if (isNaN(val) || val < min || val > max) {
            throw new RangeError(`${key} must be between ${min} and ${max}. Got: "${raw}"`);
        }
        return val;
    };

    return {
        memoryCost:  parseEnvInt("ARGON2_MEMORY_COST",  DEFAULTS.memoryCost,  8192,  4194304),
        timeCost:    parseEnvInt("ARGON2_TIME_COST",     DEFAULTS.timeCost,    1,     999),
        parallelism: parseEnvInt("ARGON2_PARALLELISM",   DEFAULTS.parallelism, 1,     64),
        hashLength:  parseEnvInt("ARGON2_HASH_LENGTH",   DEFAULTS.hashLength,  16,    128),
    };
};

const CONFIG = resolveConfig();
const PEPPER = resolvePepper();

// Max password byte length — prevents DoS via enormous inputs.
// Argon2 has no truncation issue, but unbounded input is still dangerous.
const MAX_PASSWORD_BYTES = 1024;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Applies the pepper via HMAC-SHA256 before hashing.
 * This binds the hash to your server secret without storing the pepper in the DB.
 *
 * @param {string} password
 * @returns {Buffer}
 */
const applyPepper = (password) =>
    crypto.createHmac("sha256", PEPPER).update(password).digest();

/**
 * Validates a password input. Throws on any violation.
 *
 * @param {string} password
 * @param {string} [label="Password"]
 */
const validatePassword = (password, label = "Password") => {
    if (!password || typeof password !== "string") {
        throw new TypeError(`${label} must be a non-empty string.`);
    }
    const byteLength = Buffer.byteLength(password, "utf8");
    if (byteLength > MAX_PASSWORD_BYTES) {
        throw new RangeError(
            `${label} exceeds maximum allowed length (${MAX_PASSWORD_BYTES} bytes).`
        );
    }
};

// ---------------------------------------------------------------------------
// Main adapter
// ---------------------------------------------------------------------------

class Argon2Adapter {
    /**
     * Hashes a plaintext password using Argon2id.
     *
     * @param {string} password - Plaintext password.
     * @returns {Promise<string>} - Encoded Argon2 hash string (includes algo, params, salt).
     * @throws {TypeError|RangeError} - On invalid input.
     * @throws {Error} - On internal hashing failure.
     */
    static async hashPassword(password) {
        validatePassword(password);

        try {
            return await argon2.hash(applyPepper(password), {
                type:        argon2.argon2id, // Hybrid: best all-around security
                memoryCost:  CONFIG.memoryCost,
                timeCost:    CONFIG.timeCost,
                parallelism: CONFIG.parallelism,
                hashLength:  CONFIG.hashLength,
            });
        } catch (err) {
            console.error("[Argon2Adapter] Hashing error:", err);
            throw new Error("Password hashing failed.");
        }
    }

    /**
     * Verifies a plaintext password against an Argon2 hash.
     *
     * @param {string} password - Plaintext password.
     * @param {string} hashedPassword - Previously hashed value.
     * @returns {Promise<boolean>} - True if the password matches.
     */
    static async verifyPassword(password, hashedPassword) {
        validatePassword(password);

        if (!hashedPassword || typeof hashedPassword !== "string") {
            throw new TypeError("Hashed password must be a non-empty string.");
        }

        try {
            return await argon2.verify(hashedPassword, applyPepper(password));
        } catch (err) {
            // argon2.verify throws on malformed hashes — don't leak internals
            console.error("[Argon2Adapter] Verification error:", err);
            throw new Error("Password verification failed.");
        }
    }

    /**
     * Checks whether a stored hash was created with outdated parameters.
     * Call this after a successful login — if true, re-hash and update the DB.
     *
     * This enables zero-downtime parameter upgrades: bump CONFIG values and
     * hashes silently rotate as users log in.
     *
     * @param {string} hashedPassword - The stored hash to inspect.
     * @returns {boolean}
     */
    static needsRehash(hashedPassword) {
        return argon2.needsRehash(hashedPassword, {
            memoryCost:  CONFIG.memoryCost,
            timeCost:    CONFIG.timeCost,
            parallelism: CONFIG.parallelism,
        });
    }

    /**
     * Migration helper: verifies against a LEGACY bcrypt hash and, on success,
     * returns a fresh Argon2id hash for you to persist.
     *
     * Usage: call this at login if you detect the stored hash is a bcrypt hash
     * (starts with "$2b$" or "$2a$"). On match, save the returned argon2Hash.
     *
     * @param {string} password         - Plaintext password from the user.
     * @param {string} bcryptHash       - The legacy bcrypt hash from your DB.
     * @returns {Promise<{matched: boolean, argon2Hash: string|null}>}
     */
    static async migrateFromBcrypt(password, bcryptHash) {
        validatePassword(password);

        const bcrypt = require("bcrypt");

        // Guard: ensure we're actually handling a bcrypt hash
        if (!bcryptHash.startsWith("$2b$") && !bcryptHash.startsWith("$2a$")) {
            throw new TypeError("Provided hash does not appear to be a bcrypt hash.");
        }

        // bcrypt has the 72-byte truncation issue — validate before comparing
        const byteLength = Buffer.byteLength(password, "utf8");
        if (byteLength > 72) {
            // Can't safely verify — force a password reset for this user
            return { matched: false, argon2Hash: null, requiresReset: true };
        }

        const matched = await bcrypt.compare(password, bcryptHash);
        if (!matched) return { matched: false, argon2Hash: null };

        const argon2Hash = await Argon2Adapter.hashPassword(password);
        return { matched: true, argon2Hash };
    }

    /**
     * Exposes the active Argon2 configuration (useful for testing/auditing).
     * @returns {{ memoryCost: number, timeCost: number, parallelism: number, hashLength: number }}
     */
    static get config() {
        return { ...CONFIG };
    }
}

module.exports = Argon2Adapter;