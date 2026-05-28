"use strict";

/**
 * @fileoverview Audit Log routes.
 *
 * Authorization:
 *   - isAdminOrSuperAdmin — ADMIN or SUPER_ADMIN: list, stats, per-request logs
 *   - isSuperAdmin        — SUPER_ADMIN only: export routes, delete range
 *
 * Cache strategy
 * ──────────────
 * Store: `auditLog` (TTL 120s, maxKeys 200)
 *
 *   GET /stats
 *     key: auditLog:type=stats
 *     Rationale: aggregate counts change on every new audit entry; 120s TTL
 *     prevents serving stale security telemetry while still absorbing repeated
 *     admin refreshes.
 *
 *   GET /
 *     key: auditLog:page=<p|null>:pageSize=<s|null>:type=list
 *     Rationale: paginated list; page and pageSize encoded for isolation.
 *     Search/filter params (if added in future) must also be included here.
 *
 *   GET /:requestId/logs
 *     key: auditLog:requestId=<id>:type=requestLogs
 *     Rationale: per-request log is immutable once written; 120s TTL is
 *     conservative but safe for a security audit trail.
 *
 * NOT cached:
 *   GET /export/excel  — triggers file download; must never be cached.
 *   GET /export/logs   — triggers ZIP download; must never be cached.
 *
 * Invalidation:
 *   DELETE /  (deleteRange) → delByPattern('auditLog') — entire namespace wipe.
 *     A range delete removes DB rows and log files; list, stats, and any
 *     per-requestId log keys within the deleted range are all stale.
 *
 * Positional rationale: authenticate and requireAccess run per-route (not via
 * router.use()) to preserve the existing pattern in this file. Cache read runs
 * AFTER authenticate + requireAccess and BEFORE the controller — CWE-639
 * compliance: we never serve cached data to an unauthenticated/unauthorised caller.
 *
 * Route ordering note: /stats, /export/excel, and /export/logs are declared
 * BEFORE /:requestId/logs so that Express does not treat the literal segments
 * "stats", "export" as requestId param values.
 */

const express = require("express");
const router  = express.Router();

const AuthMiddleware     = require("../middleware/authentication/AuthMiddleware");
const AuditLogController = require("../controllers/AuditLogController");
const { CacheMiddleware, CacheKeyBuilder, registry } = require("../middleware/cache");

// ── Cache store ───────────────────────────────────────────────────────────────
const auditStore = registry.resolve("auditLog");

// ── Access predicates (inline, consistent with original file style) ───────────
const isAdminOrSuperAdmin = (user) => ["ADMIN", "SUPER_ADMIN"].includes(user.role);
const isSuperAdmin        = (user) => user.role === "SUPER_ADMIN";

// ── Static-segment routes must precede /:requestId/logs ──────────────────────
// Express matches routes in declaration order. /stats, /export/excel, and
// /export/logs must be registered first so they are not captured by the
// /:requestId/logs parameterised route (which would treat "stats" or "export"
// as a requestId).

/**
 * GET /api/v1/audit-logs/stats
 * Aggregate counts: total requests, error rates, top endpoints, etc.
 *
 * Cache key: auditLog:fromDate=<f>:toDate=<t>:type=stats
 * Date params are encoded so each selected date range gets its own cache slot.
 */
router.get(
  "/stats",
  AuthMiddleware.authenticate,
  AuthMiddleware.requireAccess(isAdminOrSuperAdmin),
  CacheMiddleware.read(
    auditStore,
    (req) => CacheKeyBuilder.build("auditLog", {
      type:     "stats",
      fromDate: req.query.fromDate ?? null,
      toDate:   req.query.toDate   ?? null,
    }),
  ),
  AuditLogController.getStats,
);

/**
 * GET /api/v1/audit-logs/export/excel
 * SUPER_ADMIN only — export DB records as Excel workbook.
 * NOT cached — triggers a binary file download. Caching a binary stream
 * would corrupt the response and waste significant memory per key.
 */
router.get(
  "/export/excel",
  AuthMiddleware.authenticate,
  AuthMiddleware.requireAccess(isSuperAdmin),
  AuditLogController.exportExcel,
);

/**
 * GET /api/v1/audit-logs/export/logs
 * SUPER_ADMIN only — export server log files as ZIP archive.
 * NOT cached — same rationale as /export/excel.
 */
router.get(
  "/export/logs",
  AuthMiddleware.authenticate,
  AuthMiddleware.requireAccess(isSuperAdmin),
  AuditLogController.exportLogs,
);

/**
 * GET /api/v1/audit-logs?page=&pageSize=&fromDate=&toDate=&method=&statusCategory=&search=
 * Paginated audit log list.
 *
 * Cache key encodes every query dimension so each unique filter/search/page
 * combination is stored independently. CacheKeyBuilder sorts params
 * alphabetically, so call-site order never matters.
 */
router.get(
  "/",
  AuthMiddleware.authenticate,
  AuthMiddleware.requireAccess(isAdminOrSuperAdmin),
  CacheMiddleware.read(
    auditStore,
    (req) =>
      CacheKeyBuilder.build("auditLog", {
        fromDate:       req.query.fromDate       ?? null,
        method:         req.query.method         ?? null,
        page:           req.query.page           ?? null,
        pageSize:       req.query.pageSize       ?? null,
        search:         req.query.search         ?? null,
        statusCategory: req.query.statusCategory ?? null,
        toDate:         req.query.toDate         ?? null,
        type:           "list",
      }),
  ),
  AuditLogController.getList,
);

/**
 * GET /api/v1/audit-logs/:requestId/export/trace
 * SUPER_ADMIN only — export a single request trace as a two-sheet Excel workbook
 * (Request Summary + Log Trace lines). NOT cached — binary file download.
 * Must come BEFORE /:requestId/logs so the literal "export" segment is not
 * ambiguous; Express matches routes in declaration order.
 */
router.get(
  "/:requestId/export/trace",
  AuthMiddleware.authenticate,
  AuthMiddleware.requireAccess(isSuperAdmin),
  AuditLogController.exportTraceExcel,
);

/**
 * GET /api/v1/audit-logs/:requestId/logs
 * All log lines for a single request ID.
 * Must come AFTER all static /segment routes.
 *
 * Cache key encodes requestId; once a request is complete its log is immutable
 * so a 120s cache is conservative but safe.
 */
router.get(
  "/:requestId/logs",
  AuthMiddleware.authenticate,
  AuthMiddleware.requireAccess(isAdminOrSuperAdmin),
  CacheMiddleware.read(
    auditStore,
    (req) =>
      CacheKeyBuilder.build("auditLog", {
        requestId: req.params.requestId,
        type:      "requestLogs",
      }),
  ),
  AuditLogController.getRequestLogs,
);

/**
 * DELETE /api/v1/audit-logs/
 * SUPER_ADMIN only — permanently delete DB rows and log files for the range.
 *
 * Cache invalidation: namespace wipe — range delete removes records from the
 * list, changes aggregate stats, and invalidates any per-requestId log keys
 * that fall within the deleted range.
 */
router.delete(
  "/",
  AuthMiddleware.authenticate,
  AuthMiddleware.requireAccess(isSuperAdmin),
  CacheMiddleware.invalidate(auditStore, () => "auditLog", { usePattern: true }),
  AuditLogController.deleteRange,
);

module.exports = router;
