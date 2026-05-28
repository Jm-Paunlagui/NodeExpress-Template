"use strict";

/**
 * Changelog routes
 *
 *   GET    /api/v1/changelog        list (all authenticated roles)
 *   POST   /api/v1/changelog        create (SUPER_ADMIN only)
 *   PUT    /api/v1/changelog/:id    update (SUPER_ADMIN only)
 *   DELETE /api/v1/changelog/:id    delete (SUPER_ADMIN only)
 */

const express = require("express");

const AuthMiddleware        = require("../middleware/authentication/AuthMiddleware");
const ChangelogController   = require("../controllers/ChangelogController");

const router = express.Router();

// ── Read — all authenticated roles ───────────────────────────────────────────
router.get(
    "/",
    AuthMiddleware.authenticate,
    ChangelogController.list,
);

// ── Mutate — SUPER_ADMIN only ─────────────────────────────────────────────────
router.post(
    "/",
    AuthMiddleware.authenticate,
    AuthMiddleware.requireAccess((user) => user.role === "SUPER_ADMIN"),
    ChangelogController.create,
);

router.put(
    "/:id",
    AuthMiddleware.authenticate,
    AuthMiddleware.requireAccess((user) => user.role === "SUPER_ADMIN"),
    ChangelogController.update,
);

router.delete(
    "/:id",
    AuthMiddleware.authenticate,
    AuthMiddleware.requireAccess((user) => user.role === "SUPER_ADMIN"),
    ChangelogController.delete,
);

module.exports = router;
