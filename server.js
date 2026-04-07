// Apply encoding polyfills for compiled environment (must be first)
require("./src/utils/encodingPolyfill");

// NOTE: "use strict" cannot precede the polyfill require above, so each module
// declares its own strict mode via the "use strict" directive at the top.

const dotenv = require("dotenv");
dotenv.config({ path: ".env" });

const cluster = require("cluster");
const os = require("os");
const http = require("http");
const fs = require("fs");
const path = require("path");

const { logger } = require("./src/utils/logger");
const { consoleManager } = require("./src/utils/consoleManager");

// ─── Configuration ────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT || "2106", 10);
const HOST = process.env.HOST || "0.0.0.0";
const USE_HTTPS = process.env.USE_HTTPS === "true";
const ENABLE_CLUSTERING = process.env.ENABLE_CLUSTERING === "true";
const NUM_WORKERS = parseInt(
    process.env.NUM_WORKERS || String(Math.max(1, os.cpus().length)),
    10,
);

// ─── Clustering ───────────────────────────────────────────────────────────────

if (ENABLE_CLUSTERING && cluster.isMaster) {
    logger.info(
        `Master process ${process.pid} — forking ${NUM_WORKERS} workers…`,
    );

    for (let i = 0; i < NUM_WORKERS; i++) cluster.fork();

    cluster.on("exit", (worker, code, signal) => {
        logger.error(
            `Worker ${worker.process.pid} died (code=${code}, signal=${signal}) — replacing…`,
        );
        cluster.fork();
    });
} else {
    // ── Worker / single-process boot ──────────────────────────────────────

    // Initialise console manager (process title, ASCII art, daily clearing)
    consoleManager.initialize();

    const app = require("./src/app");
    const db = require("./src/config");

    // ─── Server creation ──────────────────────────────────────────────────

    let server;

    if (USE_HTTPS) {
        const https = require("https");
        const certDir = path.join(__dirname, "certs");

        let httpsOptions;

        // Support PFX (PKCS#12) or PEM key+cert
        const pfxPath = path.join(certDir, "server.pfx");
        if (fs.existsSync(pfxPath)) {
            httpsOptions = {
                pfx: fs.readFileSync(pfxPath),
                passphrase: process.env.PFX_PASSPHRASE || "",
            };
            logger.info("HTTPS: using PFX certificate.");
        } else {
            httpsOptions = {
                key: fs.readFileSync(path.join(certDir, "key.key")),
                cert: fs.readFileSync(path.join(certDir, "cert.crt")),
            };
            logger.info("HTTPS: using PEM key + cert.");
        }

        server = https.createServer(httpsOptions, app);
    } else {
        server = http.createServer(app);
    }

    // ─── Start ────────────────────────────────────────────────────────────

    server.listen(PORT, HOST, () => {
        const protocol = USE_HTTPS ? "https" : "http";

        // Server info metadata (like OPTISv2)
        const serverInfo = {
            protocol,
            host: HOST,
            port: PORT,
            pid: process.pid,
            environment: process.env.NODE_ENV || "development",
            clustering: ENABLE_CLUSTERING ? "enabled" : "disabled",
        };

        logger.info(
            `Server listening on ${protocol}://${HOST}:${PORT}`,
            serverInfo,
        );

        // Network access information
        if (HOST === "0.0.0.0") {
            logger.info(
                "Server is accessible from other devices on your local network",
                {
                    localUrl: `${protocol}://localhost:${PORT}`,
                    healthCheck: `${protocol}://localhost:${PORT}/api/v1/health`,
                    networkInfo:
                        "Use your computer's IP address to access from other devices",
                },
            );
        } else {
            logger.info(`Server bound to specific host: ${HOST}`, {
                url: `${protocol}://${HOST}:${PORT}`,
                healthCheck: `${protocol}://${HOST}:${PORT}/api/v1/health`,
            });
        }

        // ── Eager pool initialization ─────────────────────────────────────
        if (typeof db.initializePools === "function") {
            db.initializePools().catch((err) => {
                logger.error("Pool initialization failed", {
                    error: err.message,
                    stack: err.stack,
                    type: err.constructor.name,
                    hint: "Pools will retry lazily on first request. Check DB credentials and network connectivity.",
                });
            });
        }
    });

    // ─── Graceful shutdown ────────────────────────────────────────────────

    let isShuttingDown = false;

    async function gracefulShutdown(signal) {
        if (isShuttingDown) return;
        isShuttingDown = true;

        logger.info(`${signal} received — shutting down gracefully…`);

        // Stop accepting new connections
        server.close(async () => {
            logger.info("HTTP server closed.");

            try {
                if (typeof db.shutdown === "function") {
                    await db.shutdown();
                } else if (typeof db.closeAll === "function") {
                    await db.closeAll();
                }
                logger.info("All resources cleaned up.");
            } catch (err) {
                logger.error("Error during shutdown cleanup", {
                    error: err.message,
                });
            }

            process.exit(0);
        });

        // Force exit after 10 s if graceful shutdown hangs
        setTimeout(() => {
            logger.error("Forced shutdown after timeout.");
            process.exit(1);
        }, 10_000).unref();
    }

    process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
    process.on("SIGINT", () => gracefulShutdown("SIGINT"));

    process.on("unhandledRejection", (reason) => {
        logger.error("Unhandled rejection", { error: reason });
        gracefulShutdown("unhandledRejection");
    });

    process.on("uncaughtException", (err) => {
        logger.error("Uncaught exception", {
            error: err.message,
            stack: err.stack,
        });
        gracefulShutdown("uncaughtException");
    });
}
