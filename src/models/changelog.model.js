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
 *   summary     string
 *   type        string   feat|fix|perf|refactor|security|docs|chore
 *   authors     string[]
 *   coAuthors   string[]
 *   createdAt   string   ISO 8601
 *   updatedAt   string   ISO 8601
 */

const crypto = require("crypto");
const fs     = require("fs");
const path   = require("path");

const { logger }            = require("../utils/logger");
const { changelogMessages } = require("../constants/messages/changelog.messages");
const { AppError, CHANGELOG_ERRORS } = require("../constants/errors");

const DATA_DIR  = path.resolve(__dirname, "../../data");
const STORE_PATH = path.join(DATA_DIR, "changelog.enc");
const ALG        = "aes-256-gcm";
const IV_BYTES   = 12;
const TAG_BYTES  = 16;

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
    const iv  = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv(ALG, key, iv);
    const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return JSON.stringify({
        iv:         iv.toString("hex"),
        authTag:    cipher.getAuthTag().toString("hex"),
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

// ── Seed data (combined git history, user-friendly summaries) ─────────────────

const SEED_ENTRIES = [
    {
        id: "1a2b3c4d-0001-0000-0000-000000000001",
        displayDate: "2026-05-28",
        version: "1.15.0",
        title: "Security & Data Integrity Hardening",
        summary:
            "Fixed a security issue where user personal information (name, email) was being accidentally stored in the browser. Hardened login security so tampered or forged login tokens are now properly rejected. Fixed a financial calculation bug in meal consumption tracking that could produce incorrect totals when certain inputs were missing.",
        type: "security",
        authors: ["John Moises Paunlagui"],
        coAuthors: [],
        createdAt: "2026-05-28T08:00:00.000Z",
        updatedAt: "2026-05-28T08:00:00.000Z",
    },
    {
        id: "1a2b3c4d-0002-0000-0000-000000000002",
        displayDate: "2026-05-27",
        version: "1.14.0",
        title: "Observability Renamed & Consumption Performance",
        summary:
            "Renamed 'Logs Management' to 'Logging & Observability' for clarity. The log viewer now auto-refreshes every 30 seconds and also automatically refreshes after you export a log file. On the performance side, meal consumption queries now run significantly faster because they use a single database aggregation instead of multiple back-and-forth requests. Fixed several issues in RFID and subsidy data handling.",
        type: "perf",
        authors: ["John Moises Paunlagui"],
        coAuthors: [],
        createdAt: "2026-05-27T08:00:00.000Z",
        updatedAt: "2026-05-27T08:00:00.000Z",
    },
    {
        id: "1a2b3c4d-0003-0000-0000-000000000003",
        displayDate: "2026-05-26",
        version: "1.13.0",
        title: "Financial Transaction Integrity & Test Coverage",
        summary:
            "Settlement and excess fund calculations are now wrapped in a single atomic database transaction, preventing data corruption if something goes wrong mid-operation. Added a processing lock to prevent two settlements from running at the same time. Subsidy upload error messages are now clearer. Added comprehensive automated tests for the metrics and RFID management routes.",
        type: "fix",
        authors: ["John Moises Paunlagui"],
        coAuthors: [],
        createdAt: "2026-05-26T08:00:00.000Z",
        updatedAt: "2026-05-26T08:00:00.000Z",
    },
    {
        id: "1a2b3c4d-0004-0000-0000-000000000004",
        displayDate: "2026-05-25",
        version: "1.12.0",
        title: "Refresh Controls, Search Improvements & Audit Log Export",
        summary:
            "Added one-click refresh buttons to the Pay Period, RFID Management, and Audit Log screens so you always see the latest data without reloading the page. RFID search now supports filtering by both GID and Employee ID simultaneously. Audit logs can now be exported as a formatted Excel workbook. Improved table layouts on the Subsidy and Stub Report screens. Fixed the pay period year calculation to use the correct date field.",
        type: "feat",
        authors: ["John Moises Paunlagui"],
        coAuthors: [],
        createdAt: "2026-05-25T08:00:00.000Z",
        updatedAt: "2026-05-25T08:00:00.000Z",
    },
    {
        id: "1a2b3c4d-0005-0000-0000-000000000005",
        displayDate: "2026-05-22",
        version: "1.11.0",
        title: "Excel Export, Billing Improvements & Frontend Error Logging",
        summary:
            "Added Excel export for consumption records — you can now export QR stub history and tap transactions filtered by year, with an option to include all, active, or expired stubs. A confirmation warning now appears before exporting sensitive payroll data from the billing section. Fixed dropdown overlap issues in the billing filter bar. Fixed the billing cutoff date label to show the correct year. Updated the date library to version 4.3.0. Frontend application errors are now automatically reported to the server for faster diagnosis.",
        type: "feat",
        authors: ["John Moises Paunlagui"],
        coAuthors: [],
        createdAt: "2026-05-22T08:00:00.000Z",
        updatedAt: "2026-05-22T08:00:00.000Z",
    },
    {
        id: "1a2b3c4d-0006-0000-0000-000000000006",
        displayDate: "2026-05-21",
        version: "1.10.0",
        title: "Observability Dashboard & RFC 5424 Logging",
        summary:
            "Launched the Logging & Observability dashboard featuring five tabs: Overview, RED Metrics (Request, Error, Duration), System health, Alerts, and Health probes. Added live web performance monitoring that tracks page load quality against Google's Core Web Vitals benchmarks. Upgraded the server logging system to the industry-standard RFC 5424 format with eight severity levels. Fixed an audit log date display off-by-one error. Added a Delete Logging stepper for bulk audit log cleanup.",
        type: "feat",
        authors: ["John Moises Paunlagui"],
        coAuthors: [],
        createdAt: "2026-05-21T08:00:00.000Z",
        updatedAt: "2026-05-21T08:00:00.000Z",
    },
    {
        id: "1a2b3c4d-0007-0000-0000-000000000007",
        displayDate: "2026-05-20",
        version: "1.9.0",
        title: "Audit Logging Module & Subsidy Status Handling",
        summary:
            "Launched the Audit Logging module: view a table of all system activity, filter by date range with quick-select presets, and open an investigation modal to inspect the full details of any request. Added audit statistics for a quick summary of recent activity. Fixed the sidebar user card profile button alignment. Improved session management so that your login session now persists correctly with an expiry timestamp. Added comprehensive integration tests for RFID Management, Settlements, and Subsidy Management.",
        type: "feat",
        authors: ["John Moises Paunlagui"],
        coAuthors: [],
        createdAt: "2026-05-20T08:00:00.000Z",
        updatedAt: "2026-05-20T08:00:00.000Z",
    },
    {
        id: "1a2b3c4d-0008-0000-0000-000000000008",
        displayDate: "2026-05-19",
        version: "1.8.0",
        title: "Settlement Engine & Carry-Over Projections",
        summary:
            "Settlements can now be re-triggered from the consumption screen. The carry-over balance calculation now correctly factors in any prior excess funds, giving you an accurate live projection. Added a banner on the consumption page for employees who have not yet linked their employee record. Removed the 'Other Fund' field from subsidy management to simplify the upload process. Added settlement administration routes on the backend.",
        type: "feat",
        authors: ["John Moises Paunlagui"],
        coAuthors: [],
        createdAt: "2026-05-19T08:00:00.000Z",
        updatedAt: "2026-05-19T08:00:00.000Z",
    },
    {
        id: "1a2b3c4d-0009-0000-0000-000000000009",
        displayDate: "2026-05-18",
        version: "1.7.0",
        title: "Billing Refactor & Form Upload Fix",
        summary:
            "Refactored the Download Request modal and the billing service for improved code organisation. Improved the formatting and styling of billing download email templates. Fixed a bug where file upload forms would fail to send the correct content type, causing uploads to be rejected. Fixed the Tabs component to properly notify parent screens when the active tab changes.",
        type: "refactor",
        authors: ["John Moises Paunlagui"],
        coAuthors: [],
        createdAt: "2026-05-18T08:00:00.000Z",
        updatedAt: "2026-05-18T08:00:00.000Z",
    },
    {
        id: "1a2b3c4d-0010-0000-0000-000000000010",
        displayDate: "2026-04-30",
        version: "1.6.0",
        title: "RFID Management Feature",
        summary:
            "Launched the RFID Management module. Administrators can now upload, verify, and save employee RFID card records via an Excel stepper workflow. The verify step shows a row-by-row preview of what will be created or updated, with per-row exclude/restore controls. The backend exposes dedicated verify and save endpoints that validate each row before committing to the database.",
        type: "feat",
        authors: ["John Moises Paunlagui"],
        coAuthors: [],
        createdAt: "2026-04-30T08:00:00.000Z",
        updatedAt: "2026-04-30T08:00:00.000Z",
    },
    {
        id: "1a2b3c4d-0011-0000-0000-000000000011",
        displayDate: "2026-04-28",
        version: "1.5.0",
        title: "Admin Management & UI Improvements",
        summary:
            "Renamed 'User Management' to 'Admin Management' for clarity. Improved the Admin Management screen layout for better readability on all screen sizes. Enhanced the Change Password form layout and organisation. Updated the Modal component with a blur backdrop and portal rendering so dialogs appear correctly above all other content.",
        type: "feat",
        authors: ["John Moises Paunlagui"],
        coAuthors: [],
        createdAt: "2026-04-28T08:00:00.000Z",
        updatedAt: "2026-04-28T08:00:00.000Z",
    },
    {
        id: "1a2b3c4d-0012-0000-0000-000000000012",
        displayDate: "2026-04-24",
        version: "1.4.0",
        title: "Session Management & Login Enhancements",
        summary:
            "Added a proactive session warning modal that notifies you before your login session expires, giving you the option to extend it. Login now enforces rate limiting to block brute-force attempts. Added a per-user lockout mechanism after repeated failed sign-in attempts. Added a Signature Mismatch error page for tampered account records. Route paths and navigation links were updated for consistency across the app.",
        type: "feat",
        authors: ["John Moises Paunlagui"],
        coAuthors: [],
        createdAt: "2026-04-24T08:00:00.000Z",
        updatedAt: "2026-04-24T08:00:00.000Z",
    },
    {
        id: "1a2b3c4d-0013-0000-0000-000000000013",
        displayDate: "2026-04-23",
        version: "1.3.0",
        title: "Traceability & Error Handling Enhancements",
        summary:
            "Added sensitive data redaction to the request traceability middleware so that passwords and tokens are never written to log files. Improved the account integrity error message to include a support contact prompt. Added Coming Soon placeholder screens for finance and management features that are not yet available.",
        type: "feat",
        authors: ["John Moises Paunlagui"],
        coAuthors: [],
        createdAt: "2026-04-23T08:00:00.000Z",
        updatedAt: "2026-04-23T08:00:00.000Z",
    },
    {
        id: "1a2b3c4d-0014-0000-0000-000000000014",
        displayDate: "2026-04-22",
        version: "1.2.0",
        title: "Authentication Security Hardening",
        summary:
            "Authentication cookies are now identified by a clear constant name ('accessToken') rather than an anonymous string, preventing accidental duplication. Implemented HMAC-SHA256 data signing for tamper-evident record storage — any modification to a signed record is automatically detected on the next login. Improved the CSRF middleware to use named constants for all cookie and header names.",
        type: "security",
        authors: ["John Moises Paunlagui"],
        coAuthors: [],
        createdAt: "2026-04-22T08:00:00.000Z",
        updatedAt: "2026-04-22T08:00:00.000Z",
    },
    {
        id: "1a2b3c4d-0015-0000-0000-000000000015",
        displayDate: "2026-04-21",
        version: "1.1.0",
        title: "Oracle Integration & Security Foundation",
        summary:
            "Connected the application to the Oracle database with a dual-connection-pool setup for improved reliability. Implemented comprehensive Oracle error classification so database problems produce clear, actionable messages instead of cryptic error codes. Added join column disambiguation to prevent column ambiguity errors when querying related tables. Set up the authentication service, a SuperAdmin seed account, and a full test suite for the cryptography module.",
        type: "feat",
        authors: ["John Moises Paunlagui"],
        coAuthors: [],
        createdAt: "2026-04-21T08:00:00.000Z",
        updatedAt: "2026-04-21T08:00:00.000Z",
    },
    {
        id: "1a2b3c4d-0016-0000-0000-000000000016",
        displayDate: "2026-04-20",
        version: "1.0.0",
        title: "Initial Platform Setup",
        summary:
            "First release of the eMeal Monitoring System. Established the full-stack project structure: React 19 + Tailwind CSS v4 frontend with the Aumovio Design System, and a Node.js + Express v5 backend with OracleDB. Implemented login, logout, dark mode, role-based navigation, and all foundational security middleware (CSRF, rate limiting, Helmet headers, IP filtering).",
        type: "feat",
        authors: ["John Moises Paunlagui"],
        coAuthors: [],
        createdAt: "2026-04-20T08:00:00.000Z",
        updatedAt: "2026-04-20T08:00:00.000Z",
    },
];

// ── File I/O ──────────────────────────────────────────────────────────────────

function ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * Reads all entries from the encrypted store.
 * Initialises the file with seed data on first run.
 * @returns {{ entries: object[] }}
 */
function readStore() {
    ensureDataDir();

    if (!fs.existsSync(STORE_PATH)) {
        const initial = { entries: SEED_ENTRIES };
        writeStore(initial);
        logger.notice(changelogMessages.STORE_INITIALIZED());
        return initial;
    }

    try {
        const raw = fs.readFileSync(STORE_PATH, "utf8");
        const plaintext = decrypt(raw);
        const store = JSON.parse(plaintext);
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
        logger.debug(changelogMessages.STORE_WRITTEN(store.entries?.length ?? 0));
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
            if (b.displayDate !== a.displayDate) return b.displayDate.localeCompare(a.displayDate);
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
            id:          crypto.randomUUID(),
            displayDate: data.displayDate,
            version:     data.version,
            title:       data.title,
            summary:     data.summary,
            type:        data.type,
            authors:     Array.isArray(data.authors)   ? data.authors   : [],
            coAuthors:   Array.isArray(data.coAuthors) ? data.coAuthors : [],
            createdAt:   now,
            updatedAt:   now,
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
        if (idx === -1) throw new AppError(CHANGELOG_ERRORS.ENTRY_NOT_FOUND, 404);

        const ALLOWED = ["displayDate", "version", "title", "summary", "type", "authors", "coAuthors"];
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
        if (store.entries.length === before) throw new AppError(CHANGELOG_ERRORS.ENTRY_NOT_FOUND, 404);
        writeStore(store);
        logger.info(changelogMessages.ENTRY_DELETED(id));
    }
}

module.exports = ChangelogModel;
