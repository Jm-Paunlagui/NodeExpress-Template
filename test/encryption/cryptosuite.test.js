/**
 * CryptoVault — Test Suite (BCryptAdapter, Argon2Adapter, SymmetricCrypto)
 */
"use strict";

const path = require("path");
const dotenv = require("dotenv");
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const crypto = require("crypto");
const {
    Argon2Adapter,
    BCryptAdapter,
    SymmetricCrypto,
} = require("../../src/utils/encryption/CryptoVault");
const { EncryptionAlgorithm, Encryptor, Decryptor, SecurityCryptHelper } =
    SymmetricCrypto;

let passed = 0,
    failed = 0;
function section(t) {
    console.log(`\n${"═".repeat(62)}\n  ${t}\n${"═".repeat(62)}`);
}
async function it(label, fn) {
    try {
        await fn();
        console.log(`  ✔  ${label}`);
        passed++;
    } catch (err) {
        console.log(`  ✘  ${label}\n       → ${err.message}`);
        failed++;
    }
}
function assert(cond, msg) {
    if (!cond) throw new Error(msg || "Assertion failed");
}

(async () => {
    // ════ 1. SymmetricCrypto — Encryptor/Decryptor ═══════════════════════════════
    section("SymmetricCrypto — Manual Encryptor / Decryptor");

    const ALGORITHMS = [
        { name: "DES", id: EncryptionAlgorithm.Des, keySize: 8, ivSize: 8 },
        { name: "RC2", id: EncryptionAlgorithm.Rc2, keySize: 16, ivSize: 8 },
        {
            name: "Rijndael",
            id: EncryptionAlgorithm.Rijndael,
            keySize: 32,
            ivSize: 16,
        },
        {
            name: "TripleDES",
            id: EncryptionAlgorithm.TripleDes,
            keySize: 24,
            ivSize: 8,
        },
    ];
    let skipped = 0;
    for (const alg of ALGORITHMS) {
        await it(`${alg.name} — encrypt → decrypt round-trip`, async () => {
            const pt = "Continental01";
            const key = crypto.randomBytes(alg.keySize);
            const iv = crypto.randomBytes(alg.ivSize);
            try {
                const enc = new Encryptor(alg.id);
                enc.IV = iv;
                const cb = enc.encrypt(Buffer.from(pt, "utf8"), key);
                const dec = new Decryptor(alg.id);
                dec.IV = iv;
                assert(
                    dec.decrypt(cb, key).toString("utf8") === pt,
                    "Round-trip mismatch",
                );
            } catch (e) {
                if (e.message && e.message.includes("unsupported")) {
                    console.log(
                        `       ⚠  SKIPPED — ${alg.name} not supported by OpenSSL 3.x`,
                    );
                    skipped++;
                    passed--; // net-neutral
                    return;
                }
                throw e;
            }
        });
    }

    // ════ 2. SecurityCryptHelper ══════════════════════════════════════════════════
    section("SymmetricCrypto — SecurityCryptHelper (TripleDES)");

    await it("encryptText / decryptText round-trip (multiple samples)", async () => {
        for (const s of ["password123", "P@ssw0rd!", "Continental01"]) {
            const e = SecurityCryptHelper.encryptText(s);
            assert(e !== null, `null for "${s}"`);
            assert(
                SecurityCryptHelper.decryptText(e) === s,
                `Mismatch for "${s}"`,
            );
        }
    });
    await it("deterministic — same input → same ciphertext (fixed key/IV)", async () => {
        assert(
            SecurityCryptHelper.encryptText("hello") ===
                SecurityCryptHelper.encryptText("hello"),
            "Should be deterministic",
        );
    });
    await it("different inputs → different ciphertexts", async () => {
        assert(
            SecurityCryptHelper.encryptText("AAA") !==
                SecurityCryptHelper.encryptText("BBB"),
            "Different plaintexts must differ",
        );
    });
    await it("generateCodeID format: 'TEXT-XXXXXXXX'", async () => {
        const id = SecurityCryptHelper.generateCodeID("USER001");
        assert(id.startsWith("USER001-") && id.length > 8, `Bad format: ${id}`);
    });
    await it("generateCodeID produces unique values", async () => {
        const ids = new Set(
            Array.from({ length: 10 }, () =>
                SecurityCryptHelper.generateCodeID("X"),
            ),
        );
        assert(ids.size === 10, "Should be unique");
    });
    await it("decryptText returns null for garbage input", async () => {
        assert(
            SecurityCryptHelper.decryptText("!@#$%^not-valid!!!!") === null,
            "Expected null",
        );
    });

    // ════ 3. BCryptAdapter ════════════════════════════════════════════════════════
    section("BCryptAdapter");

    await it("hashPassword returns $2b$ prefix", async () => {
        const h = await BCryptAdapter.hashPassword("MyPassword123");
        assert(h.startsWith("$2b$"), `Bad prefix: ${h.substring(0, 6)}`);
    });
    await it("verifyPassword → true for correct password", async () => {
        const h = await BCryptAdapter.hashPassword("CorrectHorse");
        assert(
            (await BCryptAdapter.verifyPassword("CorrectHorse", h)) === true,
        );
    });
    await it("verifyPassword → false for wrong password", async () => {
        const h = await BCryptAdapter.hashPassword("CorrectHorse");
        assert((await BCryptAdapter.verifyPassword("WrongHorse", h)) === false);
    });
    await it("unique salts — same password → different hashes", async () => {
        const h1 = await BCryptAdapter.hashPassword("Same");
        const h2 = await BCryptAdapter.hashPassword("Same");
        assert(h1 !== h2);
    });
    await it("throws TypeError for null input", async () => {
        try {
            await BCryptAdapter.hashPassword(null);
            throw new Error("No throw");
        } catch (e) {
            assert(e instanceof TypeError);
        }
    });
    await it("saltRounds is in valid range [10,31]", () => {
        const r = BCryptAdapter.saltRounds;
        assert(r >= 10 && r <= 31, `Bad saltRounds: ${r}`);
    });

    // ════ 4. Argon2Adapter — core ═════════════════════════════════════════════════
    section("Argon2Adapter — Core hashing (mode: argon2)");

    await it("hashPassword returns $argon2id$ prefix", async () => {
        const h = await Argon2Adapter.hashPassword("SecurePass!");
        assert(h.startsWith("$argon2id$"), `Bad prefix: ${h.substring(0, 12)}`);
    });
    await it("verifyPassword → true for correct password", async () => {
        const h = await Argon2Adapter.hashPassword("SecurePass!");
        assert((await Argon2Adapter.verifyPassword("SecurePass!", h)) === true);
    });
    await it("verifyPassword → false for wrong password", async () => {
        const h = await Argon2Adapter.hashPassword("SecurePass!");
        assert((await Argon2Adapter.verifyPassword("WrongPass!", h)) === false);
    });
    await it("unique salts — same password → different hashes", async () => {
        const h1 = await Argon2Adapter.hashPassword("Same");
        const h2 = await Argon2Adapter.hashPassword("Same");
        assert(h1 !== h2);
    });
    await it("pepper isolation — wrong pepper fails verification", async () => {
        const hash = await Argon2Adapter.hashPassword("SecretWord");
        const argon2 = require("argon2");
        const badPepper = crypto.randomBytes(32).toString("hex");
        const peppered = crypto
            .createHmac("sha256", badPepper)
            .update("SecretWord")
            .digest();
        assert(
            (await argon2.verify(hash, peppered)) === false,
            "Wrong pepper should fail",
        );
    });
    await it("throws RangeError for oversized password (>1024 bytes)", async () => {
        try {
            await Argon2Adapter.hashPassword("A".repeat(2000));
            throw new Error("No throw");
        } catch (e) {
            assert(e instanceof RangeError, `Got ${e.constructor.name}`);
        }
    });
    await it("throws TypeError for non-string input", async () => {
        try {
            await Argon2Adapter.hashPassword(undefined);
            throw new Error("No throw");
        } catch (e) {
            assert(e instanceof TypeError, `Got ${e.constructor.name}`);
        }
    });
    await it("throws TypeError for null hash in verifyPassword", async () => {
        try {
            await Argon2Adapter.verifyPassword("pass", null);
            throw new Error("No throw");
        } catch (e) {
            assert(e instanceof TypeError, `Got ${e.constructor.name}`);
        }
    });

    // ════ 5. needsRehash ══════════════════════════════════════════════════════════
    section("Argon2Adapter — needsRehash");

    await it("needsRehash → false for hash produced with current config", async () => {
        const h = await Argon2Adapter.hashPassword("SomePassword");
        assert(
            Argon2Adapter.needsRehash(h) === false,
            "Fresh hash should not need rehash",
        );
    });

    // ════ 6. bcrypt auto-detection ════════════════════════════════════════════════
    section("Argon2Adapter — bcrypt auto-detection (migration path)");

    await it("verifyPassword handles legacy bcrypt hash transparently", async () => {
        const bh = await BCryptAdapter.hashPassword("LegacyPassword");
        assert(
            (await Argon2Adapter.verifyPassword("LegacyPassword", bh)) === true,
        );
    });
    await it("rejects wrong password against legacy bcrypt hash", async () => {
        const bh = await BCryptAdapter.hashPassword("LegacyPassword");
        assert((await Argon2Adapter.verifyPassword("NotLegacy", bh)) === false);
    });

    // ════ 7. migrateFromBcrypt ════════════════════════════════════════════════════
    section("Argon2Adapter — migrateFromBcrypt");

    await it("matched=true, returns fresh argon2id hash", async () => {
        const bh = await BCryptAdapter.hashPassword("Migrate123");
        const r = await Argon2Adapter.migrateFromBcrypt("Migrate123", bh);
        assert(
            r.matched && r.argon2Hash && r.argon2Hash.startsWith("$argon2id$"),
        );
    });
    await it("migrated argon2 hash verifies correctly", async () => {
        const bh = await BCryptAdapter.hashPassword("Migrate456");
        const { argon2Hash } = await Argon2Adapter.migrateFromBcrypt(
            "Migrate456",
            bh,
        );
        assert(
            (await Argon2Adapter.verifyPassword("Migrate456", argon2Hash)) ===
                true,
        );
    });
    await it("matched=false, argon2Hash=null for wrong password", async () => {
        const bh = await BCryptAdapter.hashPassword("Migrate123");
        const r = await Argon2Adapter.migrateFromBcrypt("WrongPass", bh);
        assert(r.matched === false && r.argon2Hash === null);
    });
    await it("requiresReset=true for password >72 bytes", async () => {
        const bh = await BCryptAdapter.hashPassword("short");
        const r = await Argon2Adapter.migrateFromBcrypt("A".repeat(73), bh);
        assert(r.requiresReset === true);
    });
    await it("throws TypeError for non-bcrypt hash", async () => {
        const ah = await Argon2Adapter.hashPassword("NotBcrypt");
        try {
            await Argon2Adapter.migrateFromBcrypt("NotBcrypt", ah);
            throw new Error("No throw");
        } catch (e) {
            assert(e instanceof TypeError, `Got ${e.constructor.name}`);
        }
    });

    // ════ 8. config snapshot ══════════════════════════════════════════════════════
    section("Argon2Adapter — config snapshot");

    await it("config.mode === 'argon2'", () => {
        assert(Argon2Adapter.config.mode === "argon2");
    });
    await it("config contains all Argon2 tuning fields", () => {
        const c = Argon2Adapter.config;
        for (const k of [
            "memoryCost",
            "timeCost",
            "parallelism",
            "hashLength",
            "maxPasswordBytes",
        ])
            assert(k in c, `Missing: ${k}`);
    });
    await it("config values match .env", () => {
        const c = Argon2Adapter.config;
        assert(
            c.memoryCost === 19456 &&
                c.timeCost === 2 &&
                c.parallelism === 1 &&
                c.hashLength === 32,
            `Mismatch: ${JSON.stringify(c)}`,
        );
    });

    // ════ Summary ══════════════════════════════════════════════════════════════════
    const emoji = failed === 0 ? "✅" : "❌";
    console.log(`\n${"═".repeat(62)}`);
    console.log(
        `  ${emoji}  Results: ${passed} passed, ${failed} failed, ${skipped} skipped  (${passed + failed + skipped} total)`,
    );
    console.log(`${"═".repeat(62)}\n`);
    if (failed > 0) process.exit(1);
})();
