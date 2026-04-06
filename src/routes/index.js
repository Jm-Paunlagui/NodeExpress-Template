"use strict";

const express = require("express");
const router = express.Router();

// ─── Route modules ────────────────────────────────────────────────────────────

const healthRoutes = require("./health");
const csrfRoutes = require("./csrf.route");

// ─── Mount routes ─────────────────────────────────────────────────────────────

// Health check — no auth required, no /api/v1 prefix
router.use(healthRoutes);

// CSRF routes
router.use("/csrf", csrfRoutes);

// ── Resource routes (add here as you build them) ──────────────────────────────
// const authRoutes = require('./auth.route');
// router.use('/auth', authRoutes);

module.exports = router;
