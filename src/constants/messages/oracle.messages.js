"use strict";

/**
 * @fileoverview Oracle pool / driver log messages.
 * Used ONLY in logger calls — never thrown or sent to clients.
 */

const oracleMessages = {
    ORACLE_INSTANT_CLIENT_NOT_SET:
        "ORACLE_INSTANT_CLIENT not set — skipping validation.",
    ORACLE_CLIENT_PATH_NOT_FOUND: (clientPath) =>
        `Oracle client path not found: ${clientPath}`,
    ORACLE_FILES_MISSING: (missing, clientPath) =>
        `Missing Oracle files [${missing.join(", ")}] in ${clientPath}`,
    ORACLE_CLIENT_VALIDATED: (clientPath) =>
        `Oracle client validated: ${clientPath}`,
    ORACLE_CLIENT_PREPENDED_PATH: (clientPath) =>
        `Oracle client prepended to PATH: ${clientPath}`,
    ENV_LOADED_FROM: (filePath) => `Env loaded from: ${filePath}`,
    COULD_NOT_READ_ENV: (filePath, err) =>
        `Could not read .env at ${filePath}: ${err}`,
    NO_ENV_FOUND: "No .env found in compiled environment.",
    ORACLE_CLIENT_INITIALISED_ENV:
        "Oracle client initialised from ORACLE_INSTANT_CLIENT.",
    ORACLE_CLIENT_INITIALISED_PATH:
        "Oracle client initialised from system PATH.",
    ORACLE_CLIENT_INIT_WARN: (err) => `Oracle client init: ${err}`,
    ORACLEDB_DRIVER_LOADED: "oracledb driver loaded.",
    ORACLEDB_DRIVER_FAILED: (err) => `Failed to load oracledb: ${err}`,
    POOL_CREATING: (name) => `Creating pool "${name}"…`,
    POOL_READY: (name, pool) =>
        `Pool "${name}" ready (min=${pool.poolMin}, max=${pool.poolMax}).`,
    POOL_FAILED: (name, attempt, max, err) =>
        `Pool "${name}" failed (attempt ${attempt}/${max}): ${err}`,
    POOL_RETRYING: (name, delay) => `Retrying pool "${name}" in ${delay}ms…`,
    POOL_COULD_NOT_CREATE: (name, max, err) =>
        `Could not create pool "${name}" after ${max} attempts: ${err}`,
    POOL_HEALTH_CHECK_FAILED: (name, failures) =>
        `Pool "${name}" health check failed (consecutive failures: ${failures}).`,
    POOL_MARKED_UNHEALTHY: (name, max) =>
        `Pool "${name}" marked UNHEALTHY after ${max} failures.`,
    POOL_RECOVERED: (name, failures) =>
        `Pool "${name}" RECOVERED after ${failures} consecutive failures.`,
    POOL_CLOSED: (name) => `Pool "${name}" closed.`,
    POOL_CLOSE_ERROR: (name, err) => `Pool "${name}" close error: ${err}`,
    SHUTDOWN_ALREADY: "Shutdown already in progress.",
    CLOSING_ALL_POOLS: "Closing all Oracle pools…",
    ALL_POOLS_CLOSED: "All Oracle pools closed.",
    SIGNAL_RECEIVED: (sig) => `${sig} received — shutting down.`,
    UNCATCHED_EXCEPTION: "Uncaught exception",
    UNHANDLED_REJECTION: "Unhandled rejection",
    OP_FAILED: (name, ms, err) => `Op failed on "${name}" (${ms}ms): ${err}`,
    DB_OP_FAILED: (name, err) => `DB op failed [${name}]: ${err}`,
    CLOSE_FAILED: (name, err) => `Close failed for "${name}": ${err}`,
    SLOW_OP: (name, ms) => `Slow op on "${name}": ${ms}ms`,
    POOL_UNHEALTHY_ATTEMPT: (name) =>
        `Pool "${name}" is unhealthy — attempting anyway.`,
    ROLLBACK_FAILED: (name, err) => `Rollback failed on "${name}": ${err}`,
    BATCH_OP_FAILED: (i, err) => `Batch op ${i} failed: ${err}`,
    DEV_PLACEHOLDER_CONFIG: (name, missing) =>
        `Dev mode: placeholder config for "${name}". Missing: ${missing}`,
    MISSING_CONFIG_FIELDS: (name, missing) =>
        `Missing config fields for "${name}": ${missing}`,
};

module.exports = { oracleMessages };
