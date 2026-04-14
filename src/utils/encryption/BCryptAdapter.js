/**
 * BCryptAdapter.js
 * Provides password hashing and verification using bcrypt.
 *
 * This module abstracts away the hashing algorithm, allowing for easy switching
 * between different hashing strategies if needed.
    * Security: bcrypt is a well-established password hashing function that incorporates
    * salting and multiple rounds of hashing, making it resistant to brute-force attacks.
 *
 * @author Jm-Paunlagui
 * @version 1.0
 * @license Apache-2.0
 */

"use strict";

const bcrypt = require("bcrypt");

// --- Constants ---
const MIN_SALT_ROUNDS = 10;
const MAX_SALT_ROUNDS = 31;
const DEFAULT_SALT_ROUNDS = 12; // Bumped from 10 — better security baseline

// --- Resolve salt rounds once at module load ---
const resolveSaltRounds = () => {
    const raw = process.env.BCRYPT_SALT_ROUNDS;
    const parsed = parseInt(raw, 10);

    if (raw === undefined) {
        return DEFAULT_SALT_ROUNDS;
    }

    if (isNaN(parsed) || parsed < MIN_SALT_ROUNDS || parsed > MAX_SALT_ROUNDS) {
        throw new RangeError(
            `BCRYPT_SALT_ROUNDS must be between ${MIN_SALT_ROUNDS} and ${MAX_SALT_ROUNDS}. Got: "${raw}"`
        );
    }

    return parsed;
};

const SALT_ROUNDS = resolveSaltRounds();

class BCryptAdapter {
    /**
     * Hashes a plaintext password using bcrypt.
     *
     * @param {string} password - The plaintext password to hash.
     * @returns {Promise<string>} - A promise that resolves to the hashed password.
     * @throws {TypeError} - If the input is not a non-empty string.
     * @throws {Error} - If hashing fails due to an internal error.
     */
    static async hashPassword(password) {
        if (!password || typeof password !== "string") {
            throw new TypeError("Password must be a non-empty string.");
        }

        try {
            return await bcrypt.hash(password, SALT_ROUNDS);
        } catch (err) {
            console.error("[BCryptAdapter] Hashing error:", err);
            throw new Error("Password hashing failed.");
        }
    }

    /**
     * Compares a plaintext password with a hashed password.
     *
     * @param {string} password - The plaintext password to verify.
     * @param {string} hashedPassword - The hashed password to compare against.
     * @returns {Promise<boolean>} - Resolves to true if matched, false otherwise.
     * @throws {TypeError} - If either input is not a non-empty string.
     * @throws {Error} - If comparison fails due to an internal error.
     */
    static async verifyPassword(password, hashedPassword) {
        if (!password || typeof password !== "string") {
            throw new TypeError("Password must be a non-empty string.");
        }

        if (!hashedPassword || typeof hashedPassword !== "string") {
            throw new TypeError("Hashed password must be a non-empty string.");
        }

        try {
            return await bcrypt.compare(password, hashedPassword);
        } catch (err) {
            console.error("[BCryptAdapter] Verification error:", err);
            throw new Error("Password verification failed.");
        }
    }

    /**
     * Exposes the active salt rounds value (useful for testing/auditing).
     *
     * @returns {number}
     */
    static get saltRounds() {
        return SALT_ROUNDS;
    }
}

module.exports = BCryptAdapter;