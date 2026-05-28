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
        version: "1.14.0",
        title: "Version History Page",
        summary:
            "Added this Version History page so you can always see what changed in the system and when. The history is stored in an AES-256 encrypted file on the server so no one can alter the release record without the encryption key. Super Administrators can add, edit, and delete entries directly from this page.",
        type: "feat",
        authors: ["John Moises Paunlagui"],
        coAuthors: [],
        createdAt: "2026-05-28T12:00:00.000Z",
        updatedAt: "2026-05-28T12:00:00.000Z",
    },
    {
        id: "1a2b3c4d-0002-0000-0000-000000000002",
        displayDate: "2026-05-28",
        version: "1.13.1",
        title: "47 Security Audit Fixes",
        summary:
            "Resolved 47 security issues flagged by an automated audit. Key fixes: your personal details (name, email) are no longer stored in the browser between sessions — only a session expiry timestamp is kept. File download filenames are now sanitized to prevent HTTP header manipulation. Login rate limiting was tightened from 10 to 5 attempts per window. Missing tokens now return 401, tampered tokens return 403, and expired tokens return 440. The server no longer leaks internal error details in production. The request cache is now capped at 200 entries to prevent unbounded memory growth.",
        type: "security",
        authors: ["John Moises Paunlagui"],
        coAuthors: [],
        createdAt: "2026-05-28T12:00:00.000Z",
        updatedAt: "2026-05-28T12:00:00.000Z",
    },
    {
        id: "1a2b3c4d-0003-0000-0000-000000000003",
        displayDate: "2026-05-28",
        version: "1.13.0",
        title: "Role Model Overhaul & UI Refresh",
        summary:
            "Updated the permission system across the entire application: instead of numeric codes (1, 2, 3…), users now have a readable role label — ROBOT, USER, ADMIN, SUPER_ADMIN, VIEWER, or APPROVER. This makes access control rules much easier to read and maintain. The Select, Pagination, and Table components received major improvements. Added the xlsx library for Excel export features and date-fns for reliable date formatting.",
        type: "feat",
        authors: ["John Moises Paunlagui"],
        coAuthors: [],
        createdAt: "2026-05-28T12:00:00.000Z",
        updatedAt: "2026-05-28T12:00:00.000Z",
    },
    {
        id: "1a2b3c4d-0004-0000-0000-000000000004",
        displayDate: "2026-05-20",
        version: "1.12.0",
        title: "User Profile Card & Centralized Navigation",
        summary:
            "Added a user profile card in the sidebar navigation showing your avatar (with a unique colour generated from your name), Employee ID, email address, division, and role. Navigation links are now managed from a single central configuration file that separates public links (visible before login) from authenticated role-based navigation groups — making it straightforward to add or rearrange navigation items.",
        type: "feat",
        authors: ["John Moises Paunlagui"],
        coAuthors: [],
        createdAt: "2026-05-20T12:00:00.000Z",
        updatedAt: "2026-05-20T12:00:00.000Z",
    },
    {
        id: "1a2b3c4d-0005-0000-0000-000000000005",
        displayDate: "2026-05-07",
        version: "1.11.1",
        title: "Timezone Offset & Documentation Update",
        summary:
            "Added a configurable timezone offset setting for the database integrity service. This ensures that tamper-detection checksums are calculated correctly for servers running in different time zones, preventing false-positive integrity failures. Updated and clarified internal project documentation.",
        type: "fix",
        authors: ["John Moises Paunlagui"],
        coAuthors: [],
        createdAt: "2026-05-07T12:00:00.000Z",
        updatedAt: "2026-05-07T12:00:00.000Z",
    },
    {
        id: "1a2b3c4d-0006-0000-0000-000000000006",
        displayDate: "2026-04-28",
        version: "1.11.0",
        title: "Case-Insensitive Search & Improved Modal",
        summary:
            "Search and filter functions now support case-insensitive matching, so you can type in any mix of upper and lower case when searching. The popup dialog (Modal) component was upgraded to use portal rendering — modals now appear above all other content — and a blur effect was added to the backdrop for a more polished look.",
        type: "feat",
        authors: ["John Moises Paunlagui"],
        coAuthors: [],
        createdAt: "2026-04-28T12:00:00.000Z",
        updatedAt: "2026-04-28T12:00:00.000Z",
    },
    {
        id: "1a2b3c4d-0007-0000-0000-000000000007",
        displayDate: "2026-04-25",
        version: "1.10.1",
        title: "Database Record Integrity Check",
        summary:
            "Added a SHA-256 checksum verification method compatible with Oracle's native hashing. This lets the system confirm that any row fetched from the database matches the hash recorded when it was last saved, automatically detecting silent data corruption or unauthorised modifications.",
        type: "feat",
        authors: ["John Moises Paunlagui"],
        coAuthors: [],
        createdAt: "2026-04-25T12:00:00.000Z",
        updatedAt: "2026-04-25T12:00:00.000Z",
    },
    {
        id: "1a2b3c4d-0008-0000-0000-000000000008",
        displayDate: "2026-04-24",
        version: "1.10.0",
        title: "Login Lockout & Coming Soon Pages",
        summary:
            "Login now enforces a lockout policy: after a configurable number of failed sign-in attempts, the account is temporarily locked to prevent brute-force attacks. Error messages across all server routes now include clearer titles to help administrators diagnose problems faster. Added placeholder Coming Soon screens for sections of the application still under development.",
        type: "feat",
        authors: ["John Moises Paunlagui"],
        coAuthors: [],
        createdAt: "2026-04-24T12:00:00.000Z",
        updatedAt: "2026-04-24T12:00:00.000Z",
    },
    {
        id: "1a2b3c4d-0009-0000-0000-000000000009",
        displayDate: "2026-04-23",
        version: "1.9.0",
        title: "Dark Mode Consistency Across All Components",
        summary:
            "Updated all remaining UI components — Checkbox, File Input, Phone Input, Radio, Range slider, Navbar, Sidebar, Tooltip, Timeline, Modal, Progress bar, Speed Dial, and others — to use a consistent dark mode colour scheme. The HTTP client and authentication middleware were also refined for better token handling and request traceability.",
        type: "refactor",
        authors: ["John Moises Paunlagui"],
        coAuthors: [],
        createdAt: "2026-04-23T12:00:00.000Z",
        updatedAt: "2026-04-23T12:00:00.000Z",
    },
    {
        id: "1a2b3c4d-000a-0000-0000-00000000000a",
        displayDate: "2026-04-22",
        version: "1.8.1",
        title: "HMAC-SHA256 Signing & Navigation Refactor",
        summary:
            "Upgraded the data signing mechanism to use HMAC-SHA256 with a secret key, making it significantly harder for an attacker to forge a valid signature even if they can read the stored data. Refactored the sidebar and navigation bar to share a common hook and central configuration file, reducing code duplication and making it easier to add new navigation items.",
        type: "security",
        authors: ["John Moises Paunlagui"],
        coAuthors: [],
        createdAt: "2026-04-22T12:00:00.000Z",
        updatedAt: "2026-04-22T12:00:00.000Z",
    },
    {
        id: "1a2b3c4d-000b-0000-0000-00000000000b",
        displayDate: "2026-04-21",
        version: "1.8.0",
        title: "Tamper-Evident Storage & Error Classification",
        summary:
            "Added data signing and verification so the system can detect if any record was secretly modified outside of normal operations. Any record whose signature does not match is flagged on the next read. Improved the error handling middleware with a detailed classification system that categorises errors by severity (authentication failure, validation error, database error, etc.) and logs them with structured detail.",
        type: "security",
        authors: ["John Moises Paunlagui"],
        coAuthors: [],
        createdAt: "2026-04-21T12:00:00.000Z",
        updatedAt: "2026-04-21T12:00:00.000Z",
    },
    {
        id: "1a2b3c4d-000c-0000-0000-00000000000c",
        displayDate: "2026-04-19",
        version: "1.7.1",
        title: "Transition Standardisation & Button Ripple",
        summary:
            "Standardised hover and transition animations across all interactive UI components — buttons, navigation elements, dropdowns, modals, and more — using the new named transition constants. Added a ripple effect on button clicks for better tactile feedback.",
        type: "refactor",
        authors: ["John Moises Paunlagui"],
        coAuthors: [],
        createdAt: "2026-04-19T12:00:00.000Z",
        updatedAt: "2026-04-19T12:00:00.000Z",
    },
    {
        id: "1a2b3c4d-000d-0000-0000-00000000000d",
        displayDate: "2026-04-18",
        version: "1.7.0",
        title: "Animation System & Sidebar Redesign",
        summary:
            "Built a comprehensive animation system with named constants for transitions, easing curves, and duration tokens — ensuring consistent motion across all UI components. Overhauled the sidebar navigation: it now features a user information card at the top, colour-coded group indicators, tooltips on collapsed items, public links visible to unauthenticated users, and a dark mode toggle in the footer.",
        type: "feat",
        authors: ["John Moises Paunlagui"],
        coAuthors: [],
        createdAt: "2026-04-18T12:00:00.000Z",
        updatedAt: "2026-04-18T12:00:00.000Z",
    },
    {
        id: "1a2b3c4d-000e-0000-0000-00000000000e",
        displayDate: "2026-04-17",
        version: "1.6.1",
        title: "Encryption Test Coverage",
        summary:
            "Added a comprehensive automated test suite for the CryptoVault encryption system, covering symmetric encryption and decryption, BCrypt password hashing and verification, Argon2 hashing and verification, and the migration path from BCrypt to Argon2. Tests include edge cases and error handling scenarios.",
        type: "docs",
        authors: ["John Moises Paunlagui"],
        coAuthors: [],
        createdAt: "2026-04-17T12:00:00.000Z",
        updatedAt: "2026-04-17T12:00:00.000Z",
    },
    {
        id: "1a2b3c4d-000f-0000-0000-00000000000f",
        displayDate: "2026-04-14",
        version: "1.6.0",
        title: "BCrypt, Argon2 & Symmetric Encryption",
        summary:
            "Added two password hashing algorithms: BCrypt (the current industry standard) and Argon2id (more resistant to GPU-based attacks and recommended for new installations). Argon2 includes an automatic migration path so existing BCrypt hashes are upgraded transparently on the user's next login. Added a symmetric AES encryption utility for protecting sensitive data stored on disk or in the database.",
        type: "feat",
        authors: ["John Moises Paunlagui"],
        coAuthors: [],
        createdAt: "2026-04-14T12:00:00.000Z",
        updatedAt: "2026-04-14T12:00:00.000Z",
    },
    {
        id: "1a2b3c4d-0010-0000-0000-000000000010",
        displayDate: "2026-04-12",
        version: "1.5.1",
        title: "Error Page Polish",
        summary:
            "Improved the typography and entrance animations on error pages (404, 403, 500, and others) for a more polished appearance. Cleaned up the internal component code structure for better readability and maintainability.",
        type: "fix",
        authors: ["John Moises Paunlagui"],
        coAuthors: [],
        createdAt: "2026-04-12T12:00:00.000Z",
        updatedAt: "2026-04-12T12:00:00.000Z",
    },
    {
        id: "1a2b3c4d-0011-0000-0000-000000000011",
        displayDate: "2026-04-11",
        version: "1.5.0",
        title: "Error Pages, Dark Mode & Request Caching",
        summary:
            "Launched custom error pages for 404 (Not Found), 403 (Forbidden), 500 (Server Error), and other HTTP errors — each with unique illustrations and friendly messages. Updated Accordion, Alert, Badge, Breadcrumb, Carousel, Drawer, Modal, QRCode, SearchBar, Tabs, and ThemeToggle components to support dark mode. Added a theme selector (system / light / dark). Introduced a request deduplication hook so the same server call is never made twice simultaneously, reducing redundant network traffic.",
        type: "feat",
        authors: ["John Moises Paunlagui"],
        coAuthors: [],
        createdAt: "2026-04-11T12:00:00.000Z",
        updatedAt: "2026-04-11T12:00:00.000Z",
    },
    {
        id: "1a2b3c4d-0012-0000-0000-000000000012",
        displayDate: "2026-04-10",
        version: "1.4.0",
        title: "Sidebar Navigation & Login Page",
        summary:
            "Launched the collapsible sidebar navigation with support for flat link lists and grouped role-based sections. A layout context was added so the application can switch between top-bar and sidebar navigation modes. The login page was updated with a background image and the company logo. A CSRF status endpoint was added to the server so the frontend can verify whether CSRF protection is active.",
        type: "feat",
        authors: ["John Moises Paunlagui"],
        coAuthors: [],
        createdAt: "2026-04-10T12:00:00.000Z",
        updatedAt: "2026-04-10T12:00:00.000Z",
    },
    {
        id: "1a2b3c4d-0013-0000-0000-000000000013",
        displayDate: "2026-04-09",
        version: "1.3.0",
        title: "Core UI Components & Logger Fix",
        summary:
            "Added the foundational design system components: Badge, Button, Modal, and SearchBar, along with utility hooks for debounced input, document title management, and pagination with ellipsis rendering. Added a loading spinner and an ErrorBoundary to catch unexpected render errors. Fixed the server logger so debug output goes to the correct stream. Improved CSRF token error handling in the middleware.",
        type: "feat",
        authors: ["John Moises Paunlagui"],
        coAuthors: [],
        createdAt: "2026-04-09T12:00:00.000Z",
        updatedAt: "2026-04-09T12:00:00.000Z",
    },
    {
        id: "1a2b3c4d-0014-0000-0000-000000000014",
        displayDate: "2026-04-08",
        version: "1.2.0",
        title: "Role-Based Route Protection",
        summary:
            "Added a ProtectedRoute component that automatically redirects unauthenticated users to the login page. Users with insufficient permissions (for example, a regular user trying to access an admin page) are shown a 403 Forbidden page instead of broken or empty content.",
        type: "feat",
        authors: ["John Moises Paunlagui"],
        coAuthors: [],
        createdAt: "2026-04-08T12:00:00.000Z",
        updatedAt: "2026-04-08T12:00:00.000Z",
    },
    {
        id: "1a2b3c4d-0015-0000-0000-000000000015",
        displayDate: "2026-04-07",
        version: "1.1.0",
        title: "Tests, Auth Hardening & Frontend Bootstrap",
        summary:
            "Added automated test suites for all security middleware (rate limiter, IP filter, CORS, CSRF, security filter, logger, cache key builder) and database reconnection resilience. Improved the authentication middleware to handle token verification and file-download authentication more robustly. Set up the React frontend with Vite and Tailwind CSS v4, installing FontAwesome icons, Headless UI, Heroicons, and Axios. Enabled Dependabot to automatically keep dependencies up to date; bumped Axios, dotenv, express-validator, and brace-expansion.",
        type: "feat",
        authors: ["John Moises Paunlagui"],
        coAuthors: [],
        createdAt: "2026-04-07T12:00:00.000Z",
        updatedAt: "2026-04-07T12:00:00.000Z",
    },
    {
        id: "1a2b3c4d-0016-0000-0000-000000000016",
        displayDate: "2026-04-06",
        version: "1.0.0",
        title: "Security Foundation & Cache System",
        summary:
            "First working version of the server. Implemented the complete security middleware stack: CSRF protection using double-submit cookies, IP address filtering, HTTP security headers (Helmet), a sliding-window rate limiter to block brute-force requests, and a security scanner that blocks common attack paths. Added a cache system for storing frequently accessed data in memory to reduce database load. Request logs now only show query parameters and request bodies when they are actually present, keeping logs readable.",
        type: "feat",
        authors: ["John Moises Paunlagui"],
        coAuthors: [],
        createdAt: "2026-04-06T12:00:00.000Z",
        updatedAt: "2026-04-06T12:00:00.000Z",
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
