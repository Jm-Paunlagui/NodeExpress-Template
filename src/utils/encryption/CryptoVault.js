/**
 * CryptoVault.js
 * Unified password encryption, hashing, and verification module.
 *
 * Consolidates BCryptAdapter, Argon2Adapter, and SymmetricCrypto into a single
 * cohesive gateway. Supports four PASSWORD_HASH_MODE strategies:
 *
 *   • "plain"     — no hashing (dev/test ONLY, forbidden in production)
 *   • "bcrypt"    — bcrypt hashing with configurable salt rounds
 *   • "argon2"    — Argon2id (OWASP #1) with pepper + HMAC pre-hash
 *   • "tripledes" — TripleDES symmetric encryption (legacy C# interop)
 *
 * Also exposes SymmetricCrypto utilities (DES, RC2, AES/Rijndael, TripleDES)
 * for general-purpose symmetric encryption/decryption.
 *
 * Features:
 *   - Automatic hash-type detection during verification (bcrypt ↔ argon2)
 *   - Zero-downtime bcrypt → argon2 migration helper
 *   - Needs-rehash detection for Argon2 parameter upgrades
 *   - Configurable via environment variables
 *   - Comprehensive self-test suite (run: node CryptoVault.js)
 *
 * @author Jm-Paunlagui
 * @version 3.0
 * @license Apache-2.0
 */

"use strict";

const crypto = require("crypto");

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1: SYMMETRIC CRYPTO ENGINE (from SymmetricCrypto.js / C# CoreLib)
// ═══════════════════════════════════════════════════════════════════════════════

const SymmetricCrypto = (() => {
    // ─── Enum: EncryptionAlgorithm ───
    const EncryptionAlgorithm = Object.freeze({
        Des: 1,
        Rc2: 2,
        Rijndael: 3,
        TripleDes: 4,
    });

    // ─── Helper: Map algorithm enum → Node.js cipher name ───
    function getCipherName(algorithmID, keyLength) {
        switch (algorithmID) {
            case EncryptionAlgorithm.Des:
                return "des-cbc";
            case EncryptionAlgorithm.TripleDes:
                return keyLength === 16 ? "des-ede-cbc" : "des-ede3-cbc";
            case EncryptionAlgorithm.Rc2:
                return "rc2-cbc";
            case EncryptionAlgorithm.Rijndael:
                if (keyLength === 16) return "aes-128-cbc";
                if (keyLength === 24) return "aes-192-cbc";
                return "aes-256-cbc";
            default:
                throw new Error(`Algorithm ID '${algorithmID}' not supported.`);
        }
    }

    // ─── Helper: Default key/IV sizes (bytes) ───
    function getDefaultSizes(algorithmID) {
        switch (algorithmID) {
            case EncryptionAlgorithm.Des:
                return { keySize: 8, ivSize: 8 };
            case EncryptionAlgorithm.TripleDes:
                return { keySize: 24, ivSize: 8 };
            case EncryptionAlgorithm.Rc2:
                return { keySize: 16, ivSize: 8 };
            case EncryptionAlgorithm.Rijndael:
                return { keySize: 32, ivSize: 16 };
            default:
                throw new Error(`Algorithm ID '${algorithmID}' not supported.`);
        }
    }

    // ─── EncryptTransformer ───
    class EncryptTransformer {
        constructor(algId) {
            this.algorithmID = algId;
            this._iv = null;
            this._key = null;
        }

        get IV() {
            return this._iv;
        }
        set IV(v) {
            this._iv = v;
        }
        get Key() {
            return this._key;
        }

        getCryptoServiceProvider(bytesKey) {
            const { keySize, ivSize } = getDefaultSizes(this.algorithmID);
            const key = bytesKey
                ? Buffer.from(bytesKey)
                : crypto.randomBytes(keySize);
            this._key = key;
            const iv = this._iv
                ? Buffer.from(this._iv)
                : crypto.randomBytes(ivSize);
            this._iv = iv;
            const cipherName = getCipherName(this.algorithmID, key.length);
            return crypto.createCipheriv(cipherName, key, iv);
        }
    }

    // ─── DecryptTransformer ───
    class DecryptTransformer {
        constructor(algId) {
            this.algorithmID = algId;
            this._iv = null;
        }

        set IV(v) {
            this._iv = v;
        }

        getCryptoServiceProvider(bytesKey) {
            const key = Buffer.from(bytesKey);
            const iv = Buffer.from(this._iv);
            const cipherName = getCipherName(this.algorithmID, key.length);
            return crypto.createDecipheriv(cipherName, key, iv);
        }
    }

    // ─── Encryptor ───
    class Encryptor {
        constructor(algId) {
            this.transformer = new EncryptTransformer(algId);
            this._iv = null;
            this._key = null;
        }

        get IV() {
            return this._iv;
        }
        set IV(v) {
            this._iv = v;
            this.transformer.IV = v;
        }
        get Key() {
            return this._key;
        }

        encrypt(bytesData, bytesKey) {
            try {
                this.transformer.IV = this._iv;
                const cipher =
                    this.transformer.getCryptoServiceProvider(bytesKey);
                const encrypted = Buffer.concat([
                    cipher.update(bytesData),
                    cipher.final(),
                ]);
                this._key = this.transformer.Key;
                this._iv = this.transformer.IV;
                return encrypted;
            } catch (ex) {
                throw new Error(
                    "Error while writing encrypted data to the stream: \n" +
                        ex.message,
                );
            }
        }
    }

    // ─── Decryptor ───
    class Decryptor {
        constructor(algId) {
            this.transformer = new DecryptTransformer(algId);
            this._iv = null;
        }

        set IV(v) {
            this._iv = v;
        }

        decrypt(bytesData, bytesKey) {
            try {
                this.transformer.IV = this._iv;
                const decipher =
                    this.transformer.getCryptoServiceProvider(bytesKey);
                return Buffer.concat([
                    decipher.update(bytesData),
                    decipher.final(),
                ]);
            } catch (ex) {
                throw new Error(
                    "Error while writing decrypted data to the stream: \n" +
                        ex.message,
                );
            }
        }
    }

    // ─── SecurityCryptHelper ───
    class SecurityCryptHelper {
        static encryptText(text) {
            try {
                const initkey = process.env.PASSWORD_KEY;
                const prefix = initkey.padEnd(5, "x").substring(0, 5);
                const keyStr = prefix + "57984354841";
                const ivStr = prefix + "789";
                const key = Buffer.from(keyStr, "ascii");
                const iv = Buffer.from(ivStr, "ascii");
                const plainText = Buffer.from(text, "ascii");

                const enc = new Encryptor(EncryptionAlgorithm.TripleDes);
                enc.IV = iv;
                const cipherText = enc.encrypt(plainText, key);
                return cipherText.toString("base64");
            } catch (ex) {
                return null;
            }
        }

        static decryptText(base64CipherText) {
            try {
                const initkey = process.env.PASSWORD_KEY;
                const prefix = initkey.padEnd(5, "x").substring(0, 5);
                const keyStr = prefix + "57984354841";
                const ivStr = prefix + "789";
                const key = Buffer.from(keyStr, "ascii");
                const iv = Buffer.from(ivStr, "ascii");
                const cipherText = Buffer.from(base64CipherText, "base64");

                const dec = new Decryptor(EncryptionAlgorithm.TripleDes);
                dec.IV = iv;
                const plainText = dec.decrypt(cipherText, key);
                return plainText.toString("ascii");
            } catch (ex) {
                return null;
            }
        }

        static generateCodeID(text) {
            const randomBytes = crypto
                .randomBytes(6)
                .toString("base64")
                .substring(0, 8);
            return `${text}-${randomBytes}`;
        }
    }

    return {
        EncryptionAlgorithm,
        EncryptTransformer,
        DecryptTransformer,
        Encryptor,
        Decryptor,
        SecurityCryptHelper,
    };
})();

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2: ENVIRONMENT & CONFIG RESOLUTION
// ═══════════════════════════════════════════════════════════════════════════════

const VALID_MODES = ["plain", "bcrypt", "argon2", "tripledes"];

const resolveMode = () => {
    const mode = (process.env.PASSWORD_HASH_MODE || "argon2")
        .toLowerCase()
        .trim();

    if (!VALID_MODES.includes(mode)) {
        throw new Error(
            `[CryptoVault] Invalid PASSWORD_HASH_MODE: "${mode}". ` +
                `Accepted: ${VALID_MODES.join(" | ")}`,
        );
    }

    if (mode === "plain" && process.env.NODE_ENV === "production") {
        throw new Error(
            "[CryptoVault] PASSWORD_HASH_MODE=plain is forbidden in production.",
        );
    }

    return mode;
};

const parseEnvInt = (key, fallback, min, max) => {
    const raw = process.env[key];
    if (!raw) return fallback;
    const val = parseInt(raw, 10);
    if (isNaN(val) || val < min || val > max) {
        throw new RangeError(
            `[CryptoVault] ${key} must be between ${min} and ${max}. Got: "${raw}"`,
        );
    }
    return val;
};

// ─── BCrypt Config ───
const BCRYPT_DEFAULTS = { minRounds: 10, maxRounds: 31, defaultRounds: 12 };

const resolveBcryptRounds = () => {
    const raw = process.env.BCRYPT_SALT_ROUNDS;
    const parsed = parseInt(raw, 10);
    if (raw === undefined) return BCRYPT_DEFAULTS.defaultRounds;
    if (
        isNaN(parsed) ||
        parsed < BCRYPT_DEFAULTS.minRounds ||
        parsed > BCRYPT_DEFAULTS.maxRounds
    ) {
        throw new RangeError(
            `[CryptoVault] BCRYPT_SALT_ROUNDS must be between ${BCRYPT_DEFAULTS.minRounds} and ${BCRYPT_DEFAULTS.maxRounds}. Got: "${raw}"`,
        );
    }
    return parsed;
};

// ─── Argon2 Config ───
const ARGON2_DEFAULTS = {
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
    hashLength: 32,
};

const resolveArgon2Config = () => ({
    memoryCost: parseEnvInt(
        "ARGON2_MEMORY_COST",
        ARGON2_DEFAULTS.memoryCost,
        8192,
        4194304,
    ),
    timeCost: parseEnvInt("ARGON2_TIME_COST", ARGON2_DEFAULTS.timeCost, 1, 999),
    parallelism: parseEnvInt(
        "ARGON2_PARALLELISM",
        ARGON2_DEFAULTS.parallelism,
        1,
        64,
    ),
    hashLength: parseEnvInt(
        "ARGON2_HASH_LENGTH",
        ARGON2_DEFAULTS.hashLength,
        16,
        128,
    ),
});

const resolveArgon2Pepper = () => {
    const pepper = process.env.ARGON2_PEPPER;
    if (!pepper || pepper.trim().length < 32) {
        throw new Error(
            "[CryptoVault] ARGON2_PEPPER must be set and at least 32 characters.\n" +
                "  Generate: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
        );
    }
    return pepper.trim();
};

// ─── Lazy-init singletons (resolved on first use, not at import time) ───
let _mode = null;
let _bcryptRounds = null;
let _argon2Config = null;
let _argon2Pepper = null;

const getMode = () => {
    if (!_mode) _mode = resolveMode();
    return _mode;
};
const getBcryptRounds = () => {
    if (!_bcryptRounds) _bcryptRounds = resolveBcryptRounds();
    return _bcryptRounds;
};
const getArgon2Config = () => {
    if (!_argon2Config) _argon2Config = resolveArgon2Config();
    return _argon2Config;
};
const getArgon2Pepper = () => {
    if (!_argon2Pepper) _argon2Pepper = resolveArgon2Pepper();
    return _argon2Pepper;
};

const MAX_PASSWORD_BYTES = parseEnvInt(
    "ARGON2_MAX_PASSWORD_BYTES",
    1024,
    64,
    4096,
);

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3: INTERNAL HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

const applyPepper = (password) =>
    crypto.createHmac("sha256", getArgon2Pepper()).update(password).digest();

const validatePassword = (value, label = "Password") => {
    if (!value || typeof value !== "string") {
        throw new TypeError(
            `[CryptoVault] ${label} must be a non-empty string.`,
        );
    }
    if (Buffer.byteLength(value, "utf8") > MAX_PASSWORD_BYTES) {
        throw new RangeError(
            `[CryptoVault] ${label} exceeds the maximum allowed size (${MAX_PASSWORD_BYTES} bytes).`,
        );
    }
};

// ─── Logger fallback (uses your project logger if available, else console) ───
let _logger;
try {
    _logger = require("../logger").logger;
} catch {
    _logger = {
        error: (...args) => console.error("[CryptoVault]", ...args),
        warn: (...args) => console.warn("[CryptoVault]", ...args),
        info: (...args) => console.info("[CryptoVault]", ...args),
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 4: CryptoVault — UNIFIED GATEWAY CLASS
// ═══════════════════════════════════════════════════════════════════════════════

class CryptoVault {
    // ───────────────────────────────────────────────────────────────────────
    // hashPassword — strategy-driven hashing
    // ───────────────────────────────────────────────────────────────────────

    /**
     * Hashes a plaintext password using the active PASSWORD_HASH_MODE strategy.
     *
     * @param {string} password - The plaintext password to hash/encrypt.
     * @returns {Promise<string>} - The hashed or encrypted password.
     * @throws {TypeError|RangeError|Error}
     */
    static async hashPassword(password) {
        validatePassword(password);
        const mode = getMode();

        // ── plain (dev/test only) ──
        if (mode === "plain") return password;

        // ── tripledes (legacy C# interop) ──
        if (mode === "tripledes") {
            const result =
                SymmetricCrypto.SecurityCryptHelper.encryptText(password);
            if (result === null)
                throw new Error("[CryptoVault] TripleDES encryption failed.");
            return result;
        }

        // ── bcrypt ──
        if (mode === "bcrypt") {
            const bcrypt = require("bcryptjs");
            try {
                return await bcrypt.hash(password, getBcryptRounds());
            } catch (err) {
                _logger.error("[CryptoVault] bcrypt hashing error:", err);
                throw new Error("Password hashing failed.");
            }
        }

        // ── argon2 (default / recommended) ──
        const argon2 = require("argon2");
        const cfg = getArgon2Config();
        try {
            return await argon2.hash(applyPepper(password), {
                type: argon2.argon2id,
                memoryCost: cfg.memoryCost,
                timeCost: cfg.timeCost,
                parallelism: cfg.parallelism,
                hashLength: cfg.hashLength,
            });
        } catch (err) {
            _logger.error("[CryptoVault] Argon2 hashing error:", err);
            throw new Error("Password hashing failed.");
        }
    }

    // ───────────────────────────────────────────────────────────────────────
    // verifyPassword — auto-detects hash type for seamless migration
    // ───────────────────────────────────────────────────────────────────────

    /**
     * Verifies a plaintext password against a stored hash/ciphertext.
     * Auto-detects bcrypt hashes ($2b$/$2a$ prefix) even in argon2 mode,
     * enabling zero-downtime migration.
     *
     * @param {string} password
     * @param {string} hashedPassword
     * @returns {Promise<boolean>}
     */
    static async verifyPassword(password, hashedPassword) {
        validatePassword(password);

        if (!hashedPassword || typeof hashedPassword !== "string") {
            throw new TypeError(
                "[CryptoVault] Hashed password must be a non-empty string.",
            );
        }

        const mode = getMode();

        // ── plain ──
        if (mode === "plain") return password === hashedPassword;

        // ── tripledes ──
        if (mode === "tripledes") {
            const decrypted =
                SymmetricCrypto.SecurityCryptHelper.decryptText(hashedPassword);
            return decrypted === password;
        }

        // ── Auto-detect bcrypt hash (migration support) ──
        const isBcryptHash =
            hashedPassword.startsWith("$2b$") ||
            hashedPassword.startsWith("$2a$");

        if (isBcryptHash) {
            const bcrypt = require("bcryptjs");
            try {
                return await bcrypt.compare(password, hashedPassword);
            } catch (err) {
                _logger.error("[CryptoVault] bcrypt verification error:", err);
                throw new Error("Password verification failed.");
            }
        }

        // ── Argon2 hash ──
        const argon2 = require("argon2");
        try {
            return await argon2.verify(hashedPassword, applyPepper(password));
        } catch (err) {
            _logger.error("[CryptoVault] Argon2 verification error:", err);
            throw new Error("Password verification failed.");
        }
    }

    // ───────────────────────────────────────────────────────────────────────
    // needsRehash — Argon2 parameter upgrade detection
    // ───────────────────────────────────────────────────────────────────────

    /**
     * Returns true if the stored Argon2 hash was produced with weaker params
     * than the current config. Re-hash on next successful login when true.
     *
     * @param {string} hashedPassword
     * @returns {boolean}
     */
    static needsRehash(hashedPassword) {
        if (getMode() !== "argon2") return false;
        const argon2 = require("argon2");
        const cfg = getArgon2Config();
        return argon2.needsRehash(hashedPassword, {
            memoryCost: cfg.memoryCost,
            timeCost: cfg.timeCost,
            parallelism: cfg.parallelism,
        });
    }

    // ───────────────────────────────────────────────────────────────────────
    // migrateFromBcrypt — zero-downtime bcrypt → argon2 migration
    // ───────────────────────────────────────────────────────────────────────

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
                "[CryptoVault] Provided hash does not appear to be a bcrypt hash.",
            );
        }

        if (Buffer.byteLength(password, "utf8") > 72) {
            return { matched: false, argon2Hash: null, requiresReset: true };
        }

        const bcrypt = require("bcryptjs");
        const matched = await bcrypt.compare(password, bcryptHash);
        if (!matched) return { matched: false, argon2Hash: null };

        const argon2Hash = await CryptoVault.hashPassword(password);
        return { matched: true, argon2Hash };
    }

    // ───────────────────────────────────────────────────────────────────────
    // Config snapshot — auditing & tests
    // ───────────────────────────────────────────────────────────────────────

    /**
     * Returns the active mode and configuration snapshot.
     * @returns {object}
     */
    static get config() {
        const mode = getMode();
        const base = { mode };

        if (mode === "bcrypt") {
            return { ...base, saltRounds: getBcryptRounds() };
        }

        if (mode === "argon2") {
            return {
                ...base,
                ...getArgon2Config(),
                maxPasswordBytes: MAX_PASSWORD_BYTES,
            };
        }

        return base;
    }

    /**
     * Exposes the embedded SymmetricCrypto engine for direct use.
     * @returns {object}
     */
    static get symmetric() {
        return SymmetricCrypto;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 5: BCryptAdapter — STANDALONE BCRYPT ADAPTER
// Standalone bcrypt adapter for legacy use or explicit bcrypt hashing needs.
// Prefer CryptoVault (which routes via PASSWORD_HASH_MODE) for new code.
// ═══════════════════════════════════════════════════════════════════════════════

class BCryptAdapter {
    static #MIN_ROUNDS = BCRYPT_DEFAULTS.minRounds;
    static #MAX_ROUNDS = BCRYPT_DEFAULTS.maxRounds;
    static #DEFAULT_ROUNDS = BCRYPT_DEFAULTS.defaultRounds;

    static #SALT_ROUNDS = (() => {
        const raw = process.env.BCRYPT_SALT_ROUNDS;
        const parsed = parseInt(raw, 10);
        if (!raw) return BCryptAdapter.#DEFAULT_ROUNDS;
        if (
            isNaN(parsed) ||
            parsed < BCryptAdapter.#MIN_ROUNDS ||
            parsed > BCryptAdapter.#MAX_ROUNDS
        ) {
            throw new RangeError(
                `[BCryptAdapter] BCRYPT_SALT_ROUNDS must be ${BCryptAdapter.#MIN_ROUNDS}–${BCryptAdapter.#MAX_ROUNDS}. Got: "${raw}"`,
            );
        }
        return parsed;
    })();

    /**
     * Hashes a plaintext password with bcrypt.
     * @param {string} password
     * @returns {Promise<string>}
     */
    static async hashPassword(password) {
        if (!password || typeof password !== "string")
            throw new TypeError(
                "[BCryptAdapter] Password must be a non-empty string.",
            );
        const bcrypt = require("bcryptjs");
        try {
            return await bcrypt.hash(password, BCryptAdapter.#SALT_ROUNDS);
        } catch (err) {
            _logger.error("[BCryptAdapter] Hashing error:", err);
            throw new Error("Password hashing failed.");
        }
    }

    /**
     * Verifies a plaintext password against a bcrypt hash.
     * @param {string} password
     * @param {string} hashedPassword
     * @returns {Promise<boolean>}
     */
    static async verifyPassword(password, hashedPassword) {
        if (!password || typeof password !== "string")
            throw new TypeError(
                "[BCryptAdapter] Password must be a non-empty string.",
            );
        if (!hashedPassword || typeof hashedPassword !== "string")
            throw new TypeError(
                "[BCryptAdapter] Hashed password must be a non-empty string.",
            );
        const bcrypt = require("bcryptjs");
        try {
            return await bcrypt.compare(password, hashedPassword);
        } catch (err) {
            _logger.error("[BCryptAdapter] Verification error:", err);
            throw new Error("Password verification failed.");
        }
    }

    /** Active salt rounds — useful for auditing and tests. */
    static get saltRounds() {
        return BCryptAdapter.#SALT_ROUNDS;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 6: Argon2Adapter — STANDALONE ARGON2 ADAPTER
// Primary password hashing engine. Routes to argon2 | bcrypt | plain | tripledes
// based on PASSWORD_HASH_MODE env var. Argon2id is strongly recommended.
// Delegates to CryptoVault internally for consistent behavior.
// ═══════════════════════════════════════════════════════════════════════════════

class Argon2Adapter {
    /**
     * Hashes a password using the strategy set by PASSWORD_HASH_MODE.
     *
     * | Mode       | Algorithm                  | Notes                       |
     * |------------|----------------------------|-----------------------------|
     * | argon2     | Argon2id + pepper (HMAC)   | Recommended for production  |
     * | bcrypt     | bcrypt                     | Legacy migration only       |
     * | tripledes  | TripleDES (field-encrypt)  | Legacy — NOT for passwords  |
     * | plain      | No hashing                 | Dev / unit tests only       |
     *
     * @param {string} password
     * @returns {Promise<string>}
     */
    static async hashPassword(password) {
        return CryptoVault.hashPassword(password);
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
        return CryptoVault.verifyPassword(password, hashedPassword);
    }

    /**
     * Returns true when the stored hash was produced with weaker params than
     * the current config. Re-hash on the next successful login.
     * Only meaningful in argon2 mode.
     *
     * @param {string} hashedPassword
     * @returns {boolean}
     */
    static needsRehash(hashedPassword) {
        return CryptoVault.needsRehash(hashedPassword);
    }

    /**
     * Zero-downtime bcrypt → Argon2id migration helper.
     * Verifies the bcrypt hash; on match issues a fresh Argon2id hash.
     * Only meaningful when PASSWORD_HASH_MODE=argon2.
     *
     * @param {string} password
     * @param {string} bcryptHash
     * @returns {Promise<{ matched: boolean, argon2Hash: string|null, requiresReset?: boolean }>}
     */
    static async migrateFromBcrypt(password, bcryptHash) {
        return CryptoVault.migrateFromBcrypt(password, bcryptHash);
    }

    /** Active mode and Argon2 configuration snapshot — for auditing and tests. */
    static get config() {
        return CryptoVault.config;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 7: EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = { CryptoVault, Argon2Adapter, BCryptAdapter, SymmetricCrypto };

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 8: SELF-TEST SUITE (run: node CryptoVault.js)
// ═══════════════════════════════════════════════════════════════════════════════

if (require.main === module) {
    const TEST_PASSWORD = "Continental01";

    const hr = () => console.log("─".repeat(65));
    const pass = (label) => console.log(`  ✅  ${label}`);
    const fail = (label, err) =>
        console.error(`  ❌  ${label}:`, err.message || err);

    const runTests = async () => {
        console.log(
            "\n╔═══════════════════════════════════════════════════════════════╗",
        );
        console.log(
            "║              CryptoVault v3.0 — Self-Test Suite              ║",
        );
        console.log(
            "╚═══════════════════════════════════════════════════════════════╝\n",
        );

        // ── TEST GROUP 1: SymmetricCrypto (TripleDES) ──
        console.log("▸ SymmetricCrypto — TripleDES Encrypt/Decrypt");
        hr();
        try {
            // Set a temp key for testing if not present
            if (!process.env.PASSWORD_KEY) process.env.PASSWORD_KEY = "HRIS";

            const {
                SecurityCryptHelper,
                EncryptionAlgorithm,
                Encryptor,
                Decryptor,
            } = SymmetricCrypto;

            const encrypted = SecurityCryptHelper.encryptText(TEST_PASSWORD);
            const decrypted = SecurityCryptHelper.decryptText(encrypted);
            console.log(`    Plain     : ${TEST_PASSWORD}`);
            console.log(`    Encrypted : ${encrypted}`);
            console.log(`    Decrypted : ${decrypted}`);
            if (decrypted === TEST_PASSWORD) pass("TripleDES round-trip");
            else fail("TripleDES round-trip", { message: "Mismatch!" });

            // Manual Encryptor/Decryptor
            const key = Buffer.from("TestK57984354841", "ascii"); // 16 bytes
            const iv = Buffer.from("TestK789", "ascii"); // 8 bytes
            const enc = new Encryptor(EncryptionAlgorithm.TripleDes);
            enc.IV = iv;
            const cipherBytes = enc.encrypt(
                Buffer.from("HelloWorld", "ascii"),
                key,
            );
            const dec = new Decryptor(EncryptionAlgorithm.TripleDes);
            dec.IV = iv;
            const plainBytes = dec.decrypt(cipherBytes, key);
            if (plainBytes.toString("ascii") === "HelloWorld")
                pass("Manual Encryptor/Decryptor round-trip");
            else
                fail("Manual Encryptor/Decryptor round-trip", {
                    message: "Mismatch!",
                });

            // GenerateCodeID
            const codeId = SecurityCryptHelper.generateCodeID("USER001");
            console.log(`    CodeID    : ${codeId}`);
            if (codeId.startsWith("USER001-") && codeId.length > 9)
                pass("GenerateCodeID format");
            else fail("GenerateCodeID format", { message: codeId });
        } catch (err) {
            fail("SymmetricCrypto tests", err);
        }

        // ── TEST GROUP 2: CryptoVault — TripleDES mode ──
        console.log("\n▸ CryptoVault — PASSWORD_HASH_MODE=tripledes");
        hr();
        try {
            // Force tripledes mode for this test
            _mode = null;
            process.env.PASSWORD_HASH_MODE = "tripledes";
            if (!process.env.PASSWORD_KEY) process.env.PASSWORD_KEY = "HRIS";
            _mode = null; // reset cache

            const hash = await CryptoVault.hashPassword(TEST_PASSWORD);
            const verified = await CryptoVault.verifyPassword(
                TEST_PASSWORD,
                hash,
            );
            const wrongVerify = await CryptoVault.verifyPassword(
                "WrongPassword",
                hash,
            );
            console.log(`    Hash      : ${hash}`);
            console.log(`    Config    :`, CryptoVault.config);
            if (verified) pass("TripleDES hash → verify (correct password)");
            else fail("TripleDES verify", { message: "Should be true" });
            if (!wrongVerify)
                pass("TripleDES verify (wrong password rejected)");
            else fail("TripleDES wrong-pass", { message: "Should be false" });
        } catch (err) {
            fail("CryptoVault tripledes tests", err);
        }

        // ── TEST GROUP 3: CryptoVault — BCrypt mode ──
        console.log("\n▸ CryptoVault — PASSWORD_HASH_MODE=bcrypt");
        hr();
        try {
            _mode = null;
            process.env.PASSWORD_HASH_MODE = "bcrypt";
            _mode = null;

            const hash = await CryptoVault.hashPassword(TEST_PASSWORD);
            const verified = await CryptoVault.verifyPassword(
                TEST_PASSWORD,
                hash,
            );
            const wrongVerify = await CryptoVault.verifyPassword(
                "WrongPassword",
                hash,
            );
            console.log(`    Hash      : ${hash}`);
            console.log(`    Config    :`, CryptoVault.config);
            if (verified) pass("BCrypt hash → verify (correct password)");
            else fail("BCrypt verify", { message: "Should be true" });
            if (!wrongVerify) pass("BCrypt verify (wrong password rejected)");
            else fail("BCrypt wrong-pass", { message: "Should be false" });
        } catch (err) {
            fail("CryptoVault bcrypt tests", err);
        }

        // ── TEST GROUP 4: CryptoVault — Argon2 mode ──
        console.log("\n▸ CryptoVault — PASSWORD_HASH_MODE=argon2");
        hr();
        try {
            _mode = null;
            _argon2Config = null;
            _argon2Pepper = null;
            process.env.PASSWORD_HASH_MODE = "argon2";
            // Generate a test pepper if not set
            if (
                !process.env.ARGON2_PEPPER ||
                process.env.ARGON2_PEPPER.length < 32
            ) {
                process.env.ARGON2_PEPPER = crypto
                    .randomBytes(32)
                    .toString("hex");
            }
            _mode = null;

            const hash = await CryptoVault.hashPassword(TEST_PASSWORD);
            const verified = await CryptoVault.verifyPassword(
                TEST_PASSWORD,
                hash,
            );
            const wrongVerify = await CryptoVault.verifyPassword(
                "WrongPassword",
                hash,
            );
            console.log(`    Hash      : ${hash}`);
            console.log(`    Config    :`, CryptoVault.config);
            if (verified) pass("Argon2 hash → verify (correct password)");
            else fail("Argon2 verify", { message: "Should be true" });
            if (!wrongVerify) pass("Argon2 verify (wrong password rejected)");
            else fail("Argon2 wrong-pass", { message: "Should be false" });

            // needsRehash
            const rehash = CryptoVault.needsRehash(hash);
            pass(`needsRehash = ${rehash} (expected false for fresh hash)`);
        } catch (err) {
            fail("CryptoVault argon2 tests", err);
        }

        // ── TEST GROUP 5: CryptoVault — Argon2 ↔ BCrypt migration ──
        console.log("\n▸ CryptoVault — BCrypt → Argon2 Migration");
        hr();
        try {
            // Hash with bcrypt first
            _mode = null;
            process.env.PASSWORD_HASH_MODE = "bcrypt";
            _mode = null;
            const bcryptHash = await CryptoVault.hashPassword(TEST_PASSWORD);

            // Switch to argon2 and migrate
            _mode = null;
            _argon2Config = null;
            _argon2Pepper = null;
            process.env.PASSWORD_HASH_MODE = "argon2";
            _mode = null;

            // verifyPassword should auto-detect bcrypt
            const verified = await CryptoVault.verifyPassword(
                TEST_PASSWORD,
                bcryptHash,
            );
            if (verified) pass("Auto-detect bcrypt hash in argon2 mode");
            else fail("Auto-detect bcrypt", { message: "Should be true" });

            // migrateFromBcrypt
            const migration = await CryptoVault.migrateFromBcrypt(
                TEST_PASSWORD,
                bcryptHash,
            );
            if (migration.matched && migration.argon2Hash) {
                pass("migrateFromBcrypt produced argon2 hash");
                const verifyMigrated = await CryptoVault.verifyPassword(
                    TEST_PASSWORD,
                    migration.argon2Hash,
                );
                if (verifyMigrated)
                    pass("Migrated argon2 hash verifies correctly");
                else
                    fail("Migrated hash verify", { message: "Should be true" });
            } else {
                fail("migrateFromBcrypt", { message: "Migration failed" });
            }
        } catch (err) {
            fail("CryptoVault migration tests", err);
        }

        // ── TEST GROUP 6: CryptoVault — Plain mode ──
        console.log("\n▸ CryptoVault — PASSWORD_HASH_MODE=plain");
        hr();
        try {
            _mode = null;
            delete process.env.NODE_ENV; // Ensure not production
            process.env.PASSWORD_HASH_MODE = "plain";
            _mode = null;

            const hash = await CryptoVault.hashPassword(TEST_PASSWORD);
            const verified = await CryptoVault.verifyPassword(
                TEST_PASSWORD,
                hash,
            );
            if (hash === TEST_PASSWORD) pass("Plain mode returns raw password");
            else fail("Plain mode hash", { message: "Should equal input" });
            if (verified) pass("Plain mode verify");
            else fail("Plain mode verify", { message: "Should be true" });
        } catch (err) {
            fail("CryptoVault plain tests", err);
        }

        // ── TEST GROUP 7: Input validation ──
        console.log("\n▸ CryptoVault — Input Validation");
        hr();
        try {
            await CryptoVault.hashPassword("");
            fail("Empty password", { message: "Should throw" });
        } catch {
            pass("Rejects empty password");
        }
        try {
            await CryptoVault.hashPassword(12345);
            fail("Non-string password", { message: "Should throw" });
        } catch {
            pass("Rejects non-string password");
        }
        try {
            await CryptoVault.verifyPassword("pass", "");
            fail("Empty hash", { message: "Should throw" });
        } catch {
            pass("Rejects empty hash in verifyPassword");
        }

        console.log(
            "\n╔═══════════════════════════════════════════════════════════════╗",
        );
        console.log(
            "║                    All tests completed!                       ║",
        );
        console.log(
            "╚═══════════════════════════════════════════════════════════════╝\n",
        );
    };

    runTests().catch((err) => {
        console.error("\n💥 Unhandled test error:", err);
        process.exit(1);
    });
}
