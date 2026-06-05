// Apply encoding polyfills first (mirrors server.js startup order)
require("../src/utils/encodingPolyfill");

"use strict";

/**
 * Seed (or reset) the changelog encrypted store — Catherine Template edition.
 *
 * This script wipes the existing data/changelog.enc file and writes a fresh
 * copy from the SEED_ENTRIES constant below. Entries describe the evolution of
 * the Catherine full-stack template itself (not any consuming application).
 *
 * Entries follow these rules:
 *   • Saturday commits are folded into the preceding Friday's displayDate.
 *   • Sunday commits are folded into the following Monday's displayDate.
 *   • Frontend and backend commits on the same displayDate are combined into
 *     one user-friendly entry.
 *
 * Usage:
 *   node scripts/seed-changelog.js
 *
 * Prerequisites:
 *   CHANGELOG_ENCRYPTION_KEY (64-char hex)  OR  DATA_SIGNING_SECRET (≥32 chars)
 *   must be set in .env.
 */

const dotenv = require("dotenv");
dotenv.config({ path: ".env" });

const ChangelogModel = require("../src/models/changelog.model");

// ─── Seed entries (oldest → newest) ──────────────────────────────────────────
// Each displayDate is the "logical workday" after applying the Sat→Fri / Sun→Mon
// shift rule. Dates below are illustrative — adjust them to your real timeline.

const SEED_ENTRIES = [
    // ── 2026-03-02 (Monday) ─────────────────────────────────────────────────────
    {
        id: "ca7e1100-0001-0000-0000-000000000001",
        displayDate: "2026-03-02",
        version: "1.0.0",
        title: "Initial Template Scaffold",
        message:
            "First release of the Catherine full-stack template — a production-grade Express v5 + React 19 foundation with clean layered architecture and a standardized API contract.",
        whatChanged: [
            {
                text: "Established the full-stack project structure",
                items: [
                    "React 19 + Tailwind CSS v4 frontend with the Aumovio Design System",
                    "Node.js + Express v5 backend with a class-based OOP architecture",
                ],
            },
            {
                text: "Defined the frontend three-layer architecture (api → hook → view)",
            },
            {
                text: "Defined the backend layered architecture (Route → Controller → Service → Model)",
            },
            {
                text: "Added a standardized API response shape (sendSuccess / sendError)",
            },
            {
                text: "Added the AppError class and a single global error handler",
            },
        ],
        type: "feat",
        authors: ["John Moises Paunlagui"],
        coAuthors: [],
        createdAt: "2026-03-02T08:00:00.000Z",
        updatedAt: "2026-03-02T08:00:00.000Z",
    },

    // ── 2026-03-06 (Friday) ─────────────────────────────────────────────────────
    {
        id: "ca7e1100-0002-0000-0000-000000000002",
        displayDate: "2026-03-06",
        version: "1.1.0",
        title: "Security Middleware Suite",
        message:
            "Hardened the template with a full suite of security middleware covering response headers, CSRF, CORS, IP filtering, and scanner blocking.",
        whatChanged: [
            {
                text: "Added Helmet for secure HTTP response headers",
            },
            {
                text: "Added double-submit-cookie CSRF protection",
            },
            {
                text: "Added network-aware CORS with corporate, VPN, and local origin matching",
            },
            {
                text: "Added a CIDR-aware IP allowlist filter",
            },
            {
                text: "Added a security filter that blocks scanners, path traversal, and script injection",
            },
            {
                text: "Added redirect prevention for all /api routes",
            },
        ],
        type: "security",
        authors: ["John Moises Paunlagui"],
        coAuthors: [],
        createdAt: "2026-03-06T08:00:00.000Z",
        updatedAt: "2026-03-06T08:00:00.000Z",
    },

    // ── 2026-03-11 (Wednesday) ──────────────────────────────────────────────────
    {
        id: "ca7e1100-0003-0000-0000-000000000003",
        displayDate: "2026-03-11",
        version: "1.2.0",
        title: "JWT Authentication & Dynamic Permissions",
        message:
            "Added JWT authentication with a data-driven permission model, per-user login lockout, and route guarding on the frontend.",
        whatChanged: [
            {
                text: "Added JWT authentication with HTTP-only cookie token storage",
            },
            {
                text: "Introduced a dynamic requireAccess(predicate) authorization model",
                items: [
                    "Permissions are data-driven, not hardcoded per project",
                ],
            },
            {
                text: "Added per-user login lockout after repeated failed attempts",
            },
            {
                text: "Added ProtectedRoute and AuthMiddleware.isAuth() on the frontend",
            },
            {
                text: "Added the standard auth routes (register, login, refresh, logout)",
            },
        ],
        type: "feat",
        authors: ["John Moises Paunlagui"],
        coAuthors: [],
        createdAt: "2026-03-11T08:00:00.000Z",
        updatedAt: "2026-03-11T08:00:00.000Z",
    },

    // ── 2026-03-16 (Monday) ─────────────────────────────────────────────────────
    {
        id: "ca7e1100-0004-0000-0000-000000000004",
        displayDate: "2026-03-16",
        version: "1.3.0",
        title: "OracleDB Dual-Pool & Mongo-Style Wrapper",
        message:
            "Connected the template to OracleDB with a resilient dual-pool setup and a MongoDB-style query wrapper that makes Oracle SQL feel familiar.",
        whatChanged: [
            {
                text: "Added an OracleDB adapter with a dual-connection-pool pattern",
            },
            {
                text: "Added a PoolHealthMonitor (30s checks, 3-strike unhealthy marking)",
            },
            {
                text: "Added exponential-backoff retry on pool initialization",
            },
            {
                text: "Added the oracle-mongo-wrapper library (MongoDB-style API over Oracle SQL)",
            },
            {
                text: "Added Oracle error classification for clear, actionable messages",
            },
            {
                text: "Added join column disambiguation to prevent ORA-00918 ambiguity errors",
            },
        ],
        type: "feat",
        authors: ["John Moises Paunlagui"],
        coAuthors: [],
        createdAt: "2026-03-16T08:00:00.000Z",
        updatedAt: "2026-03-16T08:00:00.000Z",
    },

    // ── 2026-03-20 (Friday) ─────────────────────────────────────────────────────
    {
        id: "ca7e1100-0005-0000-0000-000000000005",
        displayDate: "2026-03-20",
        version: "1.4.0",
        title: "Rate Limiting, Traceability & Response Timing",
        message:
            "Added per-IP rate limiting, end-to-end request traceability, and response-time tracking with slow-response detection.",
        whatChanged: [
            {
                text: "Added a Sliding Window Counter rate limiter (in-memory, no Redis)",
            },
            {
                text: "Added request traceability with a unique X-Request-Id per request",
            },
            {
                text: "Added response-time tracking with an X-Response-Time header",
            },
            {
                text: "Added structured incoming and completed request logging",
            },
            {
                text: "Added graceful shutdown with connection-pool cleanup",
            },
        ],
        type: "feat",
        authors: ["John Moises Paunlagui"],
        coAuthors: [],
        createdAt: "2026-03-20T08:00:00.000Z",
        updatedAt: "2026-03-20T08:00:00.000Z",
    },

    // ── 2026-03-27 (Friday) ─────────────────────────────────────────────────────
    {
        id: "ca7e1100-0006-0000-0000-000000000006",
        displayDate: "2026-03-27",
        version: "1.5.0",
        title: "Aumovio Design System Component Library",
        message:
            "Shipped the Aumovio Design System — a large, dark-mode-ready React component library covering forms, UI, charts, layout, and typography.",
        whatChanged: [
            {
                text: "Added form components",
                items: [
                    "Input, Select, Textarea, Checkbox, Radio, Toggle, FileInput, and more",
                ],
            },
            {
                text: "Added UI components",
                items: [
                    "Modal, Drawer, Tabs, Table, Card, Badge, Tooltip, Datepicker, and more",
                ],
            },
            {
                text: "Added a charts suite (Area, Bar, Donut, Heatmap, Line, Radial, Scatter)",
            },
            {
                text: "Added layout components (Navbar, Sidebar, Footer, BottomNav)",
            },
            {
                text: "Added a dark-mode ThemeToggle with persisted preference",
            },
            {
                text: "Wrapped every view in an ErrorBoundary",
            },
        ],
        type: "feat",
        authors: ["John Moises Paunlagui"],
        coAuthors: [],
        createdAt: "2026-03-27T08:00:00.000Z",
        updatedAt: "2026-03-27T08:00:00.000Z",
    },

    // ── 2026-04-02 (Thursday) ───────────────────────────────────────────────────
    {
        id: "ca7e1100-0007-0000-0000-000000000007",
        displayDate: "2026-04-02",
        version: "1.6.0",
        title: "Domain-Agnostic Cache Subsystem",
        message:
            "Added a reusable cache subsystem with a registry, deterministic key builder, and cache-aside middleware that ports cleanly to any project.",
        whatChanged: [
            {
                text: "Added CacheStore — a NodeCache wrapper with structured operation logging",
            },
            {
                text: "Added CacheRegistry — the single place where cache stores are created",
            },
            {
                text: "Added CacheKeyBuilder — alphabetically sorted keys, auto-hashed when long",
            },
            {
                text: "Added CacheMiddleware — cache-aside read with fire-and-forget invalidation",
                items: [
                    "Only caches 2xx JSON responses; errors are never stored",
                ],
            },
        ],
        type: "feat",
        authors: ["John Moises Paunlagui"],
        coAuthors: [],
        createdAt: "2026-04-02T08:00:00.000Z",
        updatedAt: "2026-04-02T08:00:00.000Z",
    },

    // ── 2026-04-08 (Wednesday) ──────────────────────────────────────────────────
    {
        id: "ca7e1100-0008-0000-0000-000000000008",
        displayDate: "2026-04-08",
        version: "1.7.0",
        title: "Metrics & Health Observability",
        message:
            "Added live request metrics and a health endpoint so the running service can be monitored at a glance.",
        whatChanged: [
            {
                text: "Added a metrics middleware tracking Requests, Errors, and Duration (RED)",
            },
            {
                text: "Added an in-memory MetricsStore with a metrics API route",
            },
            {
                text: "Added a GET /api/v1/health endpoint that always returns 200 OK",
            },
            {
                text: "Added frontend charts to visualize live service metrics",
            },
        ],
        type: "feat",
        authors: ["John Moises Paunlagui"],
        coAuthors: [],
        createdAt: "2026-04-08T08:00:00.000Z",
        updatedAt: "2026-04-08T08:00:00.000Z",
    },

    // ── 2026-04-14 (Tuesday) ────────────────────────────────────────────────────
    {
        id: "ca7e1100-0009-0000-0000-000000000009",
        displayDate: "2026-04-14",
        version: "1.8.0",
        title: "Audit Logging Module",
        message:
            "Added an audit logging module that records system activity for traceability and later investigation.",
        whatChanged: [
            {
                text: "Added an audit-log middleware that records mutating requests",
            },
            {
                text: "Added audit-log route, controller, and service layers",
            },
            {
                text: "Captured the request actor, action, and timestamp for every audited event",
            },
        ],
        type: "feat",
        authors: ["John Moises Paunlagui"],
        coAuthors: [],
        createdAt: "2026-04-14T08:00:00.000Z",
        updatedAt: "2026-04-14T08:00:00.000Z",
    },

    // ── 2026-04-20 (Monday) ─────────────────────────────────────────────────────
    {
        id: "ca7e1100-0010-0000-0000-000000000010",
        displayDate: "2026-04-20",
        version: "1.9.0",
        title: "RFC 5424 Logging & Session UX",
        message:
            "Upgraded the logger to the industry-standard RFC 5424 8-level hierarchy and added proactive session-expiry handling on the frontend.",
        whatChanged: [
            {
                text: "Upgraded the logger from 4 levels to the RFC 5424 8-level hierarchy",
                items: [
                    "logger.warn(...) renamed to logger.warning(...) — warn kept as a deprecated alias",
                ],
            },
            {
                text: "Added a proactive Session Warning modal before the login session expires",
            },
            {
                text: "Added a Profile modal and toast notifications",
            },
            {
                text: "Logs are organized as logs/YYYY/MM/DD/level.log and never truncated",
            },
        ],
        type: "refactor",
        authors: ["John Moises Paunlagui"],
        coAuthors: [],
        createdAt: "2026-04-20T08:00:00.000Z",
        updatedAt: "2026-04-20T08:00:00.000Z",
    },

    // ── 2026-04-24 (Friday) ─────────────────────────────────────────────────────
    {
        id: "ca7e1100-0011-0000-0000-000000000011",
        displayDate: "2026-04-24",
        version: "1.10.0",
        title: "Theme Personalization",
        message:
            "Added a Personalize option so each user can pick the app's accent color theme, saved between sessions.",
        whatChanged: [
            {
                text: "Added a ColorPicker-based Personalize option for the accent color theme",
            },
            {
                text: "Theme preference is persisted between sessions",
            },
            {
                text: "Replaced hardcoded color values with design-system palette variables for consistency",
            },
        ],
        type: "feat",
        authors: ["John Moises Paunlagui"],
        coAuthors: [],
        createdAt: "2026-04-24T08:00:00.000Z",
        updatedAt: "2026-04-24T08:00:00.000Z",
    },

    // ── 2026-04-28 (Tuesday) ────────────────────────────────────────────────────
    {
        id: "ca7e1100-0012-0000-0000-000000000012",
        displayDate: "2026-04-28",
        version: "1.11.0",
        title: "Changelog / Version History Module",
        message:
            "Added the Changelog module — an encrypted entry store on the backend and a timeline-style Version History page on the frontend.",
        whatChanged: [
            {
                text: "Added an AES-256-GCM encrypted changelog store (data/changelog.enc)",
            },
            {
                text: "Added changelog routes with SUPER_ADMIN-only create, update, and delete",
            },
            {
                text: "Added a Version History timeline page with collapsible 'What Changed' sections",
            },
            {
                text: "Added SemVer-aware version auto-suggestion based on the selected change type",
            },
        ],
        type: "feat",
        authors: ["John Moises Paunlagui"],
        coAuthors: [],
        createdAt: "2026-04-28T08:00:00.000Z",
        updatedAt: "2026-04-28T08:00:00.000Z",
    },

    // ── 2026-05-04 (Monday) ─────────────────────────────────────────────────────
    {
        id: "ca7e1100-0013-0000-0000-000000000013",
        displayDate: "2026-05-04",
        version: "1.11.1",
        title: "Changelog Entry Format Upgrade",
        message:
            "Restructured changelog entries from a single summary field into a short headline message plus a structured 'What Changed' list, with automatic migration of older entries.",
        whatChanged: [
            {
                text: "Replaced the single summary field with a message + structured whatChanged array",
                items: [
                    "whatChanged supports nested sub-bullets (indent 2 spaces in the form)",
                ],
            },
            {
                text: "Added automatic, idempotent migration of legacy summary-only entries on read",
            },
            {
                text: "Updated the entry form to a one-item-per-line 'What Changed' textarea",
            },
        ],
        type: "refactor",
        authors: ["John Moises Paunlagui"],
        coAuthors: [],
        createdAt: "2026-05-04T08:00:00.000Z",
        updatedAt: "2026-05-04T08:00:00.000Z",
    },
];

// ─── Main ─────────────────────────────────────────────────────────────────────

const LINE = "─".repeat(55);

async function main() {
    console.log(`\n${LINE}`);
    console.log(`  seed-changelog — reset the changelog store`);
    console.log(`${LINE}`);
    console.log(`  Entries to write : ${SEED_ENTRIES.length}`);
    console.log(
        `  Date range       : ${SEED_ENTRIES[0].displayDate} → ${SEED_ENTRIES[SEED_ENTRIES.length - 1].displayDate}`,
    );
    console.log(`${LINE}\n`);

    process.stdout.write("  Writing encrypted store ... ");
    const count = ChangelogModel.resetStore(SEED_ENTRIES);
    console.log("done.\n");

    console.log(`${LINE}`);
    console.log(`  Changelog seeded successfully!`);
    console.log(`${LINE}`);
    console.log(`  Entries written : ${count}`);
    console.log(`  Store location  : data/changelog.enc`);
    console.log(`${LINE}\n`);
}

main().catch((err) => {
    console.error("\n  Seed failed:", err.message || err);
    if (process.env.NODE_ENV !== "production") {
        console.error(err.stack);
    }
    process.exit(1);
});
