"use strict";

/**
 * ChangelogModel
 *
 * Persists changelog entries in an AES-256-GCM encrypted JSON file.
 *
 * File location : <projectRoot>/data/changelog.enc
 * File format   : JSON { iv, authTag, ciphertext } — all hex-encoded
 * Key source    : process.env.CHANGELOG_ENCRYPTION_KEY (64-char hex → 32 bytes)
 *                 Falls back to first 32 bytes of DATA_SIGNING_SECRET when key absent.
 *
 * Entry shape:
 *   id          string   crypto.randomUUID()
 *   displayDate string   YYYY-MM-DD (adjusted: Sat→Fri, Sun→Mon)
 *   version     string   semver-style label (e.g. "1.15.0")
 *   title       string
 *   message     string   short headline summary (1–2 sentences, user-friendly)
 *   whatChanged object[] structured bullet list: { text: string, items?: string[] }
 *   type        string   feat|fix|patch|perf|refactor|security|docs|chore
 *   authors     string[]
 *   coAuthors   string[]
 *   createdAt   string   ISO 8601
 *   updatedAt   string   ISO 8601
 *
 * To populate or reset the store run:
 *   node scripts/seed-changelog.js
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { logger } = require("../utils/logger");
const {
    changelogMessages,
} = require("../constants/messages/changelog.messages");
const { AppError, CHANGELOG_ERRORS } = require("../constants/errors");

const DATA_DIR = path.resolve(__dirname, "../../data");
const STORE_PATH = path.join(DATA_DIR, "changelog.enc");
const ALG = "aes-256-gcm";
const IV_BYTES = 12;

// ── Key resolution ────────────────────────────────────────────────────────────

function resolveKey() {
    const raw = process.env.CHANGELOG_ENCRYPTION_KEY;
    if (raw && raw.length === 64) return Buffer.from(raw, "hex");

    const fallback = process.env.DATA_SIGNING_SECRET;
    if (fallback && fallback.length >= 32) {
        return crypto.createHash("sha256").update(fallback).digest();
    }
    throw new Error(
        "[ChangelogModel] Set CHANGELOG_ENCRYPTION_KEY (64-char hex) or DATA_SIGNING_SECRET (≥32 chars).",
    );
}

// ── Encrypt / Decrypt ─────────────────────────────────────────────────────────

function encrypt(plaintext) {
    const key = resolveKey();
    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv(ALG, key, iv);
    const enc = Buffer.concat([
        cipher.update(plaintext, "utf8"),
        cipher.final(),
    ]);
    return JSON.stringify({
        iv: iv.toString("hex"),
        authTag: cipher.getAuthTag().toString("hex"),
        ciphertext: enc.toString("hex"),
    });
}

function decrypt(raw) {
    const key = resolveKey();
    const { iv, authTag, ciphertext } = JSON.parse(raw);
    const decipher = crypto.createDecipheriv(ALG, key, Buffer.from(iv, "hex"));
    decipher.setAuthTag(Buffer.from(authTag, "hex"));
    return Buffer.concat([
        decipher.update(Buffer.from(ciphertext, "hex")),
        decipher.final(),
    ]).toString("utf8");
}

// ── File I/O ──────────────────────────────────────────────────────────────────

function ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * Migrates a single entry from the old schema (summary string) to the new schema
 * (message string + whatChanged array). Safe to run repeatedly — idempotent.
 * @param {object} entry
 * @returns {object}
 */
function migrateEntry(entry) {
    // Old entries had `summary` instead of `message` + `whatChanged`
    if (!entry.message && entry.summary) {
        const { summary, ...rest } = entry;
        return { ...rest, message: summary, whatChanged: [] };
    }
    if (!entry.whatChanged) {
        return { ...entry, whatChanged: [] };
    }
    return entry;
}

/**
 * Reads all entries from the encrypted store.
 * Initialises the file with an empty store on first run.
 * Run `node scripts/seed-changelog.js` to populate with entries.
 * Migrates legacy entries (summary → message) on read.
 * @returns {{ entries: object[] }}
 */
function readStore() {
    ensureDataDir();

    if (!fs.existsSync(STORE_PATH)) {
        const initial = { entries: [] };
        writeStore(initial);
        logger.notice(changelogMessages.STORE_INITIALIZED());
        return initial;
    }

    try {
        const raw = fs.readFileSync(STORE_PATH, "utf8");
        const plaintext = decrypt(raw);
        const store = JSON.parse(plaintext);

        let needsWrite = false;
        store.entries = store.entries.map((entry) => {
            const migrated = migrateEntry(entry);
            if (migrated !== entry) needsWrite = true;
            return migrated;
        });

        if (needsWrite) writeStore(store);

        logger.debug(changelogMessages.STORE_READ(store.entries?.length ?? 0));
        return store;
    } catch (err) {
        logger.error(changelogMessages.STORE_DECRYPT_FAILED(err.message));
        throw new AppError(CHANGELOG_ERRORS.STORE_UNAVAILABLE, 503);
    }
}

/**
 * Encrypts and writes the store to disk.
 * @param {{ entries: object[] }} store
 */
function writeStore(store) {
    ensureDataDir();
    try {
        const ciphertext = encrypt(JSON.stringify(store));
        fs.writeFileSync(STORE_PATH, ciphertext, "utf8");
        logger.debug(
            changelogMessages.STORE_WRITTEN(store.entries?.length ?? 0),
        );
    } catch (err) {
        logger.error(changelogMessages.STORE_ENCRYPT_FAILED(err.message));
        throw new AppError(CHANGELOG_ERRORS.STORE_UNAVAILABLE, 503);
    }
}

// ── ChangelogModel ────────────────────────────────────────────────────────────

class ChangelogModel {
    /**
     * Returns all entries sorted newest displayDate first.
     * @returns {object[]}
     */
    static listAll() {
        const { entries } = readStore();
        return [...entries].sort((a, b) => {
            if (b.displayDate !== a.displayDate)
                return b.displayDate.localeCompare(a.displayDate);
            return b.createdAt.localeCompare(a.createdAt);
        });
    }

    /**
     * Finds one entry by ID.
     * @param {string} id
     * @returns {object}
     */
    static findById(id) {
        const { entries } = readStore();
        const entry = entries.find((e) => e.id === id);
        if (!entry) throw new AppError(CHANGELOG_ERRORS.ENTRY_NOT_FOUND, 404);
        return entry;
    }

    /**
     * Creates a new entry.
     * @param {object} data
     * @returns {object} created entry
     */
    static create(data) {
        const store = readStore();
        const now = new Date().toISOString();
        const entry = {
            id: crypto.randomUUID(),
            displayDate: data.displayDate,
            version: data.version,
            title: data.title,
            message: data.message,
            whatChanged: Array.isArray(data.whatChanged) ? data.whatChanged : [],
            type: data.type,
            authors: Array.isArray(data.authors) ? data.authors : [],
            coAuthors: Array.isArray(data.coAuthors) ? data.coAuthors : [],
            createdAt: now,
            updatedAt: now,
        };
        store.entries.push(entry);
        writeStore(store);
        logger.info(changelogMessages.ENTRY_CREATED(entry.id));
        return entry;
    }

    /**
     * Updates an existing entry (partial update — only provided fields).
     * @param {string} id
     * @param {object} data
     * @returns {object} updated entry
     */
    static update(id, data) {
        const store = readStore();
        const idx = store.entries.findIndex((e) => e.id === id);
        if (idx === -1)
            throw new AppError(CHANGELOG_ERRORS.ENTRY_NOT_FOUND, 404);

        const ALLOWED = [
            "displayDate",
            "version",
            "title",
            "message",
            "whatChanged",
            "type",
            "authors",
            "coAuthors",
        ];
        ALLOWED.forEach((key) => {
            if (data[key] !== undefined) store.entries[idx][key] = data[key];
        });
        store.entries[idx].updatedAt = new Date().toISOString();
        writeStore(store);
        logger.info(changelogMessages.ENTRY_UPDATED(id));
        return store.entries[idx];
    }

    /**
     * Permanently removes an entry.
     * @param {string} id
     */
    static delete(id) {
        const store = readStore();
        const before = store.entries.length;
        store.entries = store.entries.filter((e) => e.id !== id);
        if (store.entries.length === before)
            throw new AppError(CHANGELOG_ERRORS.ENTRY_NOT_FOUND, 404);
        writeStore(store);
        logger.info(changelogMessages.ENTRY_DELETED(id));
    }

    /**
     * Wipes the current store and writes the provided entries from scratch.
     * Intended for use by `scripts/seed-changelog.js` only.
     * Never call from application request handlers.
     *
     * @param {object[]} entries  Changelog entries to seed.
     * @returns {number} Count of entries written.
     */
    static resetStore(entries) {
        const now = new Date().toISOString();
        const normalised = entries.map((e) => ({
            id: e.id ?? crypto.randomUUID(),
            displayDate: e.displayDate,
            version: e.version,
            title: e.title,
            message: e.message,
            whatChanged: Array.isArray(e.whatChanged) ? e.whatChanged : [],
            type: e.type,
            authors: Array.isArray(e.authors) ? e.authors : [],
            coAuthors: Array.isArray(e.coAuthors) ? e.coAuthors : [],
            createdAt: e.createdAt ?? now,
            updatedAt: now,
        }));
        writeStore({ entries: normalised });
        logger.notice(changelogMessages.STORE_INITIALIZED());
        return normalised.length;
    }
}

module.exports = ChangelogModel;
