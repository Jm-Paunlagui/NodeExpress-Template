/**
 * SymmetricCrypto.js
 * JavaScript equivalent of CoreLib C# class for symmetric encryption (DES, TripleDES, RC2, Rijndael/AES).
 * Provides Encryptor and Decryptor classes that mirror the C# ICryptoTransform-based design.
 * Also includes SecurityCryptHelper with static methods for text encryption/decryption and code ID generation.
 * Note: This implementation focuses on TripleDES for the SecurityCryptHelper methods, as per the original C# code.
 * Requires Node.js built-in 'crypto' module (no external dependencies)
 */
const crypto = require("crypto");

const SymmetricCrypto = (() => {
    // ─────────────────────────────────────────────
    // Enum: EncryptionAlgorithm
    // ─────────────────────────────────────────────
    const EncryptionAlgorithm = Object.freeze({
        Des: 1,
        Rc2: 2,
        Rijndael: 3,
        TripleDes: 4,
    });

    // ─────────────────────────────────────────────
    // Helper: Map algorithm enum to Node.js cipher name
    // ─────────────────────────────────────────────
    function getCipherName(algorithmID, keyLength) {
        switch (algorithmID) {
            case EncryptionAlgorithm.Des:
                return "des-cbc";
            case EncryptionAlgorithm.TripleDes:
                // C# accepts 16-byte (2-key 3DES = des-ede-cbc)
                // or 24-byte (3-key 3DES = des-ede3-cbc) keys
                return keyLength === 16 ? "des-ede-cbc" : "des-ede3-cbc";
            case EncryptionAlgorithm.Rc2:
                return "rc2-cbc";
            case EncryptionAlgorithm.Rijndael:
                // Rijndael/AES — key size determines variant
                if (keyLength === 16) return "aes-128-cbc";
                if (keyLength === 24) return "aes-192-cbc";
                return "aes-256-cbc";
            default:
                throw new Error(`Algorithm ID '${algorithmID}' not supported.`);
        }
    }

    // ─────────────────────────────────────────────
    // Helper: Get default key/IV sizes (in bytes)
    // ─────────────────────────────────────────────
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

    // ─────────────────────────────────────────────
    // Class: EncryptTransformer
    // ─────────────────────────────────────────────
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

        /**
         * Returns a configured Node.js Cipher object (equivalent to ICryptoTransform).
         * @param {Buffer|null} bytesKey
         * @returns {{ cipher: crypto.Cipher, key: Buffer, iv: Buffer }}
         */
        getCryptoServiceProvider(bytesKey) {
            const { keySize, ivSize } = getDefaultSizes(this.algorithmID);

            // Key: use provided or generate random
            const key = bytesKey
                ? Buffer.from(bytesKey)
                : crypto.randomBytes(keySize);
            this._key = key;

            // IV: use provided or generate random
            const iv = this._iv
                ? Buffer.from(this._iv)
                : crypto.randomBytes(ivSize);
            this._iv = iv;

            const cipherName = getCipherName(this.algorithmID, key.length);
            const cipher = crypto.createCipheriv(cipherName, key, iv);
            return cipher;
        }
    }

    // ─────────────────────────────────────────────
    // Class: DecryptTransformer
    // ─────────────────────────────────────────────
    class DecryptTransformer {
        constructor(algId) {
            this.algorithmID = algId;
            this._iv = null;
        }

        set IV(v) {
            this._iv = v;
        }

        /**
         * Returns a configured Node.js Decipher object.
         * @param {Buffer} bytesKey
         * @returns {crypto.Decipher}
         */
        getCryptoServiceProvider(bytesKey) {
            const key = Buffer.from(bytesKey);
            const iv = Buffer.from(this._iv);
            const cipherName = getCipherName(this.algorithmID, key.length);
            return crypto.createDecipheriv(cipherName, key, iv);
        }
    }

    // ─────────────────────────────────────────────
    // Class: Encryptor
    // ─────────────────────────────────────────────
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

        /**
         * Encrypts the given data buffer with the given key.
         * @param {Buffer} bytesData - Plaintext bytes
         * @param {Buffer|null} bytesKey - Encryption key (or null to auto-generate)
         * @returns {Buffer} Encrypted (cipher) bytes
         */
        encrypt(bytesData, bytesKey) {
            try {
                this.transformer.IV = this._iv;
                const cipher =
                    this.transformer.getCryptoServiceProvider(bytesKey);

                const encrypted = Buffer.concat([
                    cipher.update(bytesData),
                    cipher.final(),
                ]);

                // Retrieve the key and IV used (mirrors C#: encKey = transformer.Key, initVec = transformer.IV)
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

    // ─────────────────────────────────────────────
    // Class: Decryptor
    // ─────────────────────────────────────────────
    class Decryptor {
        constructor(algId) {
            this.transformer = new DecryptTransformer(algId);
            this._iv = null;
        }

        set IV(v) {
            this._iv = v;
        }

        /**
         * Decrypts the given cipher data buffer with the given key.
         * @param {Buffer} bytesData - Ciphertext bytes
         * @param {Buffer} bytesKey  - Decryption key
         * @returns {Buffer} Decrypted (plain) bytes
         */
        decrypt(bytesData, bytesKey) {
            try {
                this.transformer.IV = this._iv;
                const decipher =
                    this.transformer.getCryptoServiceProvider(bytesKey);

                const decrypted = Buffer.concat([
                    decipher.update(bytesData),
                    decipher.final(),
                ]);

                return decrypted;
            } catch (ex) {
                throw new Error(
                    "Error while writing decrypted data to the stream: \n" +
                        ex.message,
                );
            }
        }
    }

    // ─────────────────────────────────────────────
    // Class: SecurityCryptHelper
    // ─────────────────────────────────────────────
    class SecurityCryptHelper {
        /**
         * Encrypts a plain-text string using TripleDES CBC.
         * Mirrors C#: SecurityCryptHelper.EncryptText(string text)
         * @param {string} text - Plain text to encrypt
         * @returns {string|null} Base64-encoded ciphertext, or null on error
         */
        static encryptText(text) {
            try {
                const initkey = process.env.PASSWORD_KEY;

                // Pad prefix to exactly 5 chars so key=16 bytes and IV=8 bytes
                // C# uses PadRight(5, 'x') — must match exactly
                const prefix = initkey.padEnd(5, "x").substring(0, 5);
                const keyStr = prefix + "57984354841"; // 5 + 11 = 16 bytes
                const ivStr = prefix + "789"; // 5 + 3  = 8 bytes

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

        /**
         * Decrypts a Base64-encoded TripleDES CBC ciphertext.
         * Mirrors the DecryptText counterpart from the original C# code.
         * @param {string} base64CipherText - Base64-encoded ciphertext
         * @returns {string|null} Decrypted plain text, or null on error
         */
        static decryptText(base64CipherText) {
            try {
                const initkey = process.env.PASSWORD_KEY

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

        /**
         * Generates a short code ID combining the given text and a random suffix.
         * Mirrors C#: SecurityCryptHelper.GenerateCodeID(string text)
         * @param {string} text
         * @returns {string} e.g. "USER001-aB3xKp2m"
         */
        static generateCodeID(text) {
            const randomBytes = crypto
                .randomBytes(6)
                .toString("base64")
                .substring(0, 8);
            return `${text}-${randomBytes}`;
        }
    }

    // ─────────────────────────────────────────────
    // Public API (mirrors C# CoreLib structure)
    // ─────────────────────────────────────────────
    return {
        EncryptionAlgorithm,
        EncryptTransformer,
        DecryptTransformer,
        Encryptor,
        Decryptor,
        SecurityCryptHelper,
    };
})();

module.exports = SymmetricCrypto;

// ─────────────────────────────────────────────
// Quick test (mirrors the C# debug console logs)
// ─────────────────────────────────────────────
if (require.main === module) {
    const { SecurityCryptHelper, EncryptionAlgorithm, Encryptor, Decryptor } =
        SymmetricCrypto;

    const password = "MySecretPassword123";
    const encrypted = SecurityCryptHelper.encryptText(password);
    const decrypted = SecurityCryptHelper.decryptText(encrypted);

    console.log("=== SecurityCryptHelper ===");
    console.log("Plain text  :", password);
    console.log("Cipher text :", encrypted);
    console.log("Decrypted   :", decrypted);
    console.log("Match       :", password === decrypted);

    console.log("\n=== GenerateCodeID ===");
    console.log(SecurityCryptHelper.generateCodeID("USER001"));

    console.log("\n=== Manual Encryptor/Decryptor (TripleDES) ===");
    const key = Buffer.from("Jm-Pa57984354841", "ascii");
    const iv = Buffer.from("Jm-Pa789", "ascii");
    const text = "HelloWorld";

    const enc = new Encryptor(EncryptionAlgorithm.TripleDes);
    enc.IV = iv;
    const cipherBytes = enc.encrypt(Buffer.from(text, "ascii"), key);
    console.log("Encrypted (base64):", cipherBytes.toString("base64"));

    const dec = new Decryptor(EncryptionAlgorithm.TripleDes);
    dec.IV = iv;
    const plainBytes = dec.decrypt(cipherBytes, key);
    console.log("Decrypted          :", plainBytes.toString("ascii"));
}
