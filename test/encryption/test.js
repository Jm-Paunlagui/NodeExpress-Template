const path = require("path");
const dotenv = require("dotenv");
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
const crypto = require("crypto");
const SymmetricCrypto = require("../../src/utils/encryption/SymmetricCrypto");


const { EncryptionAlgorithm, Encryptor, Decryptor, SecurityCryptHelper } =
    SymmetricCrypto;

const plaintext = "Continental01";

// ── Algorithm configs: { name, id, keySize, ivSize } ──
const algorithms = [
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

console.log(`Plaintext: "${plaintext}"\n`);

for (const alg of algorithms) {
    const key = crypto.randomBytes(alg.keySize);
    const iv = crypto.randomBytes(alg.ivSize);

    try {
        const enc = new Encryptor(alg.id);
        enc.IV = iv;
        const cipherBytes = enc.encrypt(Buffer.from(plaintext, "utf8"), key);

        const dec = new Decryptor(alg.id);
        dec.IV = iv;
        const plainBytes = dec.decrypt(cipherBytes, key);
        const decrypted = plainBytes.toString("utf8");

        const match = plaintext === decrypted;
        console.log(`[${alg.name}]`);
        console.log(`  Key (hex)        : ${key.toString("hex")}`);
        console.log(`  IV  (hex)        : ${iv.toString("hex")}`);
        console.log(`  Encrypted (b64)  : ${cipherBytes.toString("base64")}`);
        console.log(`  Decrypted        : ${decrypted}`);
        console.log(`  Match            : ${match ? "✔ PASS" : "✘ FAIL"}\n`);
    } catch (err) {
        const unsupported = err.message.includes("unsupported");
        console.log(`[${alg.name}]`);
        console.log(
            `  ${unsupported ? "⚠ SKIPPED — legacy algorithm not supported by OpenSSL 3.x" : "✘ FAIL — " + err.message}\n`,
        );
    }
}

// ── SecurityCryptHelper (TripleDES with hardcoded key) ──
console.log("[SecurityCryptHelper]");
const encrypted = SecurityCryptHelper.encryptText(plaintext);
const decrypted = SecurityCryptHelper.decryptText(encrypted);
console.log(`  Encrypted (b64)  : ${encrypted}`);
console.log(`  Decrypted        : ${decrypted}`);
console.log(
    `  Match            : ${plaintext === decrypted ? "✔ PASS" : "✘ FAIL"}`,
);
