"use strict";

const express = require("express");
const router = express.Router();
const os = require("os");

const db = require("../config");

/**
 * GET /health
 * Liveness check + optional DB ping.
 */
router.get("/health", async (_req, res) => {
    const health = {
        status: "success",
        code: 200,
        message: "OK",
        data: {
            uptime: process.uptime(),
            timestamp: new Date().toISOString(),
            environment: process.env.NODE_ENV || "development",
            host: os.hostname(),
            pid: process.pid,
            database: "unknown",
        },
    };

    try {
        await db.withConnection("userAccount", async (conn) => {
            await conn.execute("SELECT 1 FROM DUAL");
        });
        health.data.database = "connected";
    } catch {
        health.data.database = "disconnected";
    }

    res.json(health);
});

module.exports = router;
