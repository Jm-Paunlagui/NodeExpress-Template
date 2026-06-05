/**
 * @fileoverview Enterprise Logging System with RFC 5424 Syslog Levels and File Rotation
 * @description Comprehensive logging solution with RFC 5424 severity levels, automatic
 *   file rotation, and organized directory structure. Levels follow priority 0 (highest)
 *   to 7 (lowest) — emergency, alert, critical, error, warning, notice, info, debug.
 * @author Jm-Paunlagui
 * @version 5.0.0
 * @since v4.0.0 2025-08-16 — initial four-level logger
 * @since v5.0.0 2026-05-21 — RFC 5424 eight-level expansion (emergency/alert/critical/notice added)
 */

const fs = require("fs").promises;
const path = require("path");
const os = require("os");
const { requestContext } = require("./requestContext");

class Logger {
    // ========================================
    // STATIC CONFIGURATION
    // ========================================

    static CONFIG = {
        MAX_FILE_SIZE: 50 * 1024 * 1024,

        /**
         * RFC 5424 syslog numeric priorities.
         * Lower number = higher priority. A log at level N is written when N <= currentLevel.
         * Backward-compatible mapping:
         *   Old ERROR:0 → ERROR:3, Old WARN:1 → WARNING:4, Old INFO:2 → INFO:6, Old DEBUG:3 → DEBUG:7
         */
        LEVELS: {
            EMERGENCY: 0, // System is unusable — panic, should never occur in a running process
            ALERT: 1, // Action must be taken immediately (e.g. DB pool completely down)
            CRITICAL: 2, // critical conditions (e.g. health check hard failure, cert expiry)
            ERROR: 3, // Error conditions (formerly ERROR:0)
            WARNING: 4, // Warning conditions (formerly WARN:1)
            NOTICE: 5, // Normal but significant condition (startup complete, config change)
            INFO: 6, // Informational (formerly INFO:2)
            DEBUG: 7, // Debug-level messages (formerly DEBUG:3)
        },

        COLORS: {
            // RFC 5424 new levels
            EMERGENCY: "\x1b[105m", // Bright magenta background — highest severity
            ALERT: "\x1b[105m", // Bright magenta background — critical alert
            CRITICAL: "\x1b[91m", // Bright red — critical condition
            NOTICE: "\x1b[97m", // Bright white — normal but significant
            // Existing levels (kept identical)
            ERROR: "\x1b[31m",
            WARNING: "\x1b[33m",
            WARN: "\x1b[33m", // Alias for internal lookups that still use WARN key
            INFO: "\x1b[36m",
            DEBUG: "\x1b[35m",
            // Structural
            MACHINE_ID: "\x1b[94m",
            TIMESTAMP: "\x1b[90m",
            PID: "\x1b[92m",
            LOCATION: "\x1b[93m",
            REQUEST_PHASE: "\x1b[95m",
            METHOD: "\x1b[96m",
            MESSAGE: "\x1b[97m",
            RESET: "\x1b[0m",
            BRACKET: "\x1b[37m",
            SEPARATOR: "\x1b[37m",
        },

        LOG_BASE_DIR: path.join(process.cwd(), "logs"),

        /**
         * Accepts all 8 RFC 5424 level names case-insensitively.
         * Also accepts legacy "WARN" as alias for "WARNING".
         * Default: INFO (numeric 6).
         */
        CURRENT_LEVEL: process.env.LOG_LEVEL || "INFO",

        CONSOLE_OUTPUT:
            process.env.ENABLE_CONSOLE_LOGS === "false"
                ? false
                : process.env.ENABLE_CONSOLE_LOGS === "true" ||
                  process.env.NODE_ENV !== "production" ||
                  process.env.DOCKER_CONTAINER === "true",

        EXCLUDED_URLS: [
            ...(process.env.LOG_EXCLUDE_HEALTH === "true" ? ["/health"] : []),
            ...(process.env.LOG_EXCLUDE_URLS
                ? process.env.LOG_EXCLUDE_URLS.split(",")
                : []),
        ],

        MAX_SAFESTR_LENGTH: process.env.LOG_MAX_SAFESTR_LENGTH
            ? parseInt(process.env.LOG_MAX_SAFESTR_LENGTH, 10)
            : Infinity,

        DATE_OPTIONS: {
            timeZone: "Asia/Manila",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
        },
    };

    // ========================================
    // CONSTRUCTOR
    // ========================================

    constructor() {
        // Normalize WARN → WARNING for backward compatibility with env vars
        const rawLevel = (Logger.CONFIG.CURRENT_LEVEL || "INFO").toUpperCase();
        const normalizedLevel = rawLevel === "WARN" ? "WARNING" : rawLevel;

        this.currentLevel =
            Logger.CONFIG.LEVELS[normalizedLevel] ?? Logger.CONFIG.LEVELS.INFO;

        this._maxSafeStrLength = Logger.CONFIG.MAX_SAFESTR_LENGTH;
        this.writeQueue = [];
        this.isWriting = false;
        this.machineIdentifier = this.#computeMachineIdentifier();
        this.#initializeBaseDirectory();
    }

    // ========================================
    // PRIVATE UTILITY METHODS
    // ========================================

    /**
     * Compute and cache machine identifier (hostname, primary IPv4)
     */
    #computeMachineIdentifier() {
        try {
            const hostname = os.hostname();
            const interfaces = os.networkInterfaces();
            let ipAddress = "unknown";

            for (const entries of Object.values(interfaces)) {
                if (!entries) continue;
                for (const net of entries) {
                    const family = net.family || net.addressFamily || "";
                    const isIPv4 = family === "IPv4" || family === 4;
                    if (isIPv4 && !net.internal) {
                        ipAddress = net.address || ipAddress;
                        break;
                    }
                }
                if (ipAddress !== "unknown") break;
            }

            return `${hostname} (S) ${ipAddress}`;
        } catch {
            return "unknown (S) unknown";
        }
    }

    /**
     * Get current date components for directory structure and timestamps
     */
    #getDateComponents() {
        const now = new Date();
        const formatter = new Intl.DateTimeFormat(
            "en-CA",
            Logger.CONFIG.DATE_OPTIONS,
        );
        const partsMap = Object.fromEntries(
            formatter
                .formatToParts(now)
                .map(({ type, value }) => [type, value]),
        );

        return {
            year: partsMap.year,
            month: partsMap.month,
            day: partsMap.day,
            timestamp: `${partsMap.year}-${partsMap.month}-${partsMap.day} ${partsMap.hour}:${partsMap.minute}:${partsMap.second}`,
        };
    }

    /**
     * Shorten absolute paths to start at src/ when possible
     */
    #shortenPath(fullPath) {
        try {
            const cwd = process.cwd().replace(/\\/g, "/");
            const norm = String(fullPath || "").replace(/\\/g, "/");
            const srcIdx = norm.lastIndexOf("/src/");

            if (srcIdx !== -1) return norm.substring(srcIdx + 1);
            if (norm.startsWith(cwd)) {
                const rel = norm.substring(cwd.length);
                return rel.startsWith("/") ? rel.substring(1) : rel;
            }

            const parts = norm.split("/");
            return parts.slice(Math.max(0, parts.length - 2)).join("/");
        } catch {
            return String(fullPath || "");
        }
    }

    /**
     * Safely serialize any value to string, handling objects, arrays, and primitives
     */
    #safeStringify(value, maxLength = this._maxSafeStrLength) {
        try {
            if (value === null) return "null";
            if (value === undefined) return "undefined";
            if (typeof value === "string") return value;
            if (typeof value === "number" || typeof value === "boolean")
                return String(value);

            if (typeof value === "object") {
                let jsonStr;
                try {
                    jsonStr = JSON.stringify(value);
                } catch {
                    try {
                        const seen = new WeakSet();
                        jsonStr = JSON.stringify(value, (key, val) => {
                            if (typeof val === "object" && val !== null) {
                                if (seen.has(val))
                                    return "[Circular Reference]";
                                seen.add(val);
                            }
                            return val;
                        });
                    } catch {
                        return "[Complex Object - Unable to Stringify]";
                    }
                }
                return jsonStr.length > maxLength
                    ? jsonStr.substring(0, maxLength - 3) + "..."
                    : jsonStr;
            }

            return String(value);
        } catch (error) {
            return `[Stringify Error: ${error.message}]`;
        }
    }

    /**
     * Ensure a directory exists, creating it if necessary
     */
    async #ensureDirectoryExists(dirPath) {
        try {
            await fs.mkdir(dirPath, { recursive: true });
        } catch (error) {
            if (error.code !== "EEXIST") {
                console.error(
                    "Failed to create log directory:",
                    dirPath,
                    error.message,
                );
                throw error;
            }
        }
    }

    /**
     * Get a file's size in bytes, returning 0 if it doesn't exist
     */
    async #getFileSize(filePath) {
        try {
            return (await fs.stat(filePath)).size;
        } catch (error) {
            if (error.code === "ENOENT") return 0;
            throw error;
        }
    }

    /**
     * Capture call site information (function, file, line) from stack trace
     */
    #captureCallSite(meta = {}) {
        let displayFn = meta.function || "anonymous";
        let displayFile = meta.file ? this.#shortenPath(meta.file) : "";
        let displayLine = meta.line ? `:${meta.line}` : "";

        if (!meta.function || !meta.file || !meta.line) {
            try {
                const enabled =
                    String(process.env.LOG_CALLSITE || "true").toLowerCase() ===
                    "true";
                if (enabled) {
                    const stack = (new Error().stack || "").split("\n");
                    const chosenFrame = stack
                        .slice(2)
                        .find(
                            (line) =>
                                line.trim() && !line.includes("logger.js"),
                        );

                    if (chosenFrame) {
                        const m1 = chosenFrame
                            .trim()
                            .match(/^at\s+(.+?)\s+\((.+):(\d+):(\d+)\)$/);
                        const m2 = chosenFrame
                            .trim()
                            .match(/^at\s+(.+):(\d+):(\d+)$/);

                        if (m1) {
                            displayFn = m1[1];
                            displayFile = this.#shortenPath(m1[2]);
                            displayLine = `:${m1[3]}`;
                        } else if (m2) {
                            displayFn = "anonymous";
                            displayFile = this.#shortenPath(m2[1]);
                            displayLine = `:${m2[2]}`;
                        }
                    }
                }
            } catch {
                // Ignore callsite errors
            }
        }

        return { displayFn, displayFile, displayLine };
    }

    /**
     * Get next available log filename, rolling over when the size limit is exceeded
     */
    async #getAvailableFilename(baseDir, baseName) {
        let filename = `${baseName}.log`;
        let fullPath = path.join(baseDir, filename);

        if ((await this.#getFileSize(fullPath)) < Logger.CONFIG.MAX_FILE_SIZE) {
            return { filename, fullPath };
        }

        for (let counter = 1; counter < 1000; counter++) {
            filename = `${baseName}_${counter}.log`;
            fullPath = path.join(baseDir, filename);
            if (
                (await this.#getFileSize(fullPath)) <
                Logger.CONFIG.MAX_FILE_SIZE
            ) {
                return { filename, fullPath };
            }
        }

        filename = `${baseName}_${Date.now()}.log`;
        fullPath = path.join(baseDir, filename);
        return { filename, fullPath };
    }

    /**
     * Get log directory path for the current date
     */
    #getLogDirectory() {
        const { year, month, day } = this.#getDateComponents();
        return path.join(Logger.CONFIG.LOG_BASE_DIR, year, month, day);
    }

    /**
     * Initialize the base log directory on startup
     */
    async #initializeBaseDirectory() {
        try {
            await this.#ensureDirectoryExists(Logger.CONFIG.LOG_BASE_DIR);
        } catch (error) {
            console.error("Failed to initialize log directory:", error.message);
        }
    }

    /**
     * Build the plain-text log entry string
     */
    #formatMessage(level, message, meta = {}, requestId = null) {
        const { timestamp } = this.#getDateComponents();
        const cleanMessage = this.#resolveMessage(message);
        const { displayFn, displayFile, displayLine } =
            this.#captureCallSite(meta);
        const isHttpRequest = meta._isHttpRequest;
        const method = isHttpRequest ? meta.method || "UNKNOWN" : "FUNC";
        const machineId = meta._clientMachine || this.machineIdentifier;

        let entry = `[${machineId}] [${timestamp}] [${level}] [PID:${process.pid}] [${displayFn} @ ${displayFile}${displayLine}]`;

        if (isHttpRequest && meta._requestPhase)
            entry += ` ${meta._requestPhase}`;
        if (!(isHttpRequest && cleanMessage.includes(`[${meta.method} @`)))
            entry += ` [${method}]`;
        const _reqId = requestId ?? requestContext.getStore()?.requestId;
        if (_reqId) entry += ` [${_reqId}]`;
        entry += ` - ${cleanMessage}`;

        const metaStr = this.#buildMetaString(meta);
        if (metaStr) entry += ` | META: ${metaStr}`;

        return entry;
    }

    /**
     * Build the colorized console log entry string
     */
    #formatColorizedMessage(level, message, meta = {}, requestId = null) {
        const colors = Logger.CONFIG.COLORS;
        const { timestamp } = this.#getDateComponents();
        const cleanMessage = this.#resolveMessage(message);
        const { displayFn, displayFile, displayLine } =
            this.#captureCallSite(meta);
        const isHttpRequest = meta._isHttpRequest;
        const method = isHttpRequest ? meta.method || "UNKNOWN" : "FUNC";
        const machineId = meta._clientMachine || this.machineIdentifier;
        const levelColor = colors[level] || "";

        let entry = "";
        entry += `${colors.BRACKET}[${colors.MACHINE_ID}${machineId}${colors.BRACKET}]${colors.RESET}`;
        entry += ` ${colors.BRACKET}[${colors.TIMESTAMP}${timestamp}${colors.BRACKET}]${colors.RESET}`;
        entry += ` ${colors.BRACKET}[${levelColor}${level}${colors.BRACKET}]${colors.RESET}`;
        entry += ` ${colors.BRACKET}[${colors.PID}PID:${process.pid}${colors.BRACKET}]${colors.RESET}`;
        entry += ` ${colors.BRACKET}[${colors.LOCATION}${displayFn} @ ${displayFile}${displayLine}${colors.BRACKET}]${colors.RESET}`;

        if (isHttpRequest && meta._requestPhase) {
            entry += ` ${colors.REQUEST_PHASE}${meta._requestPhase}${colors.RESET}`;
        }

        if (!(isHttpRequest && cleanMessage.includes(`[${meta.method} @`))) {
            entry += ` ${colors.BRACKET}[${colors.METHOD}${method}${colors.BRACKET}]${colors.RESET}`;
        }

        const _reqId2 = requestId ?? requestContext.getStore()?.requestId;
        if (_reqId2)
            entry += ` ${colors.BRACKET}[${colors.PID}${_reqId2}${colors.BRACKET}]${colors.RESET}`;

        entry += ` ${colors.SEPARATOR}- ${colors.MESSAGE}${cleanMessage}${colors.RESET}`;

        const metaStr = this.#buildMetaString(meta);
        if (metaStr) {
            entry += ` ${colors.SEPARATOR}| ${colors.BRACKET}META: ${colors.MESSAGE}${metaStr}${colors.RESET}`;
        }

        return entry;
    }

    /**
     * Resolve a raw message value to a clean string
     */
    #resolveMessage(message) {
        if (message === null || message === undefined) return "[Empty Message]";
        return this.#safeStringify(message).trim() || "[Empty Message]";
    }

    /**
     * Serialize non-internal meta keys to a string
     */
    #buildMetaString(meta) {
        const INTERNAL_KEYS = new Set([
            "method",
            "url",
            "function",
            "file",
            "line",
        ]);
        const metaKeys = Object.keys(meta).filter(
            (k) => !k.startsWith("_") && !INTERNAL_KEYS.has(k),
        );
        if (metaKeys.length === 0) return null;

        const metaObj = Object.fromEntries(metaKeys.map((k) => [k, meta[k]]));
        return this.#safeStringify(metaObj);
    }

    /**
     * Inject call site info into a meta object from the current stack
     */
    #injectCallSite(meta) {
        try {
            const enabled =
                String(process.env.LOG_CALLSITE || "true").toLowerCase() ===
                "true";
            if (!enabled) return;

            const stack = (new Error().stack || "").split("\n");
            const chosenFrame = stack.slice(2).find((line) => {
                const t = line.trim();
                return (
                    t &&
                    !t.includes("utils/logger.js") &&
                    !t.includes("\\utils\\logger.js") &&
                    !t.includes("/utils/logger.js")
                );
            });

            if (!chosenFrame) return;

            const m1 = chosenFrame
                .trim()
                .match(/^at\s+(.+?)\s+\((.+):(\d+):(\d+)\)$/);
            const m2 = chosenFrame.trim().match(/^at\s+(.+):(\d+):(\d+)$/);

            if (m1) {
                if (!meta.function) meta.function = m1[1];
                if (!meta.file) meta.file = m1[2];
                if (!meta.line) meta.line = m1[3];
            } else if (m2) {
                if (!meta.function) meta.function = "anonymous";
                if (!meta.file) meta.file = m2[1];
                if (!meta.line) meta.line = m2[2];
            }
        } catch {
            // Ignore callsite errors
        }
    }

    // ========================================
    // PRIVATE WRITE METHODS
    // ========================================

    /**
     * Write a formatted log entry to the appropriate file
     */
    async #writeToFile(level, message, meta = {}, requestId = null) {
        const logDir = this.#getLogDirectory();
        try {
            await this.#ensureDirectoryExists(logDir);
            const { fullPath } = await this.#getAvailableFilename(
                logDir,
                level.toLowerCase(),
            );
            const formattedMessage = this.#formatMessage(
                level,
                message,
                meta,
                requestId,
            );

            if (Logger.CONFIG.CONSOLE_OUTPUT) {
                console.log(
                    this.#formatColorizedMessage(
                        level,
                        message,
                        meta,
                        requestId,
                    ),
                );
            }

            await fs.appendFile(fullPath, formattedMessage + "\n", "utf8");
        } catch (error) {
            console.error(`Failed to write ${level} log:`, error.message);
        }
    }

    /**
     * Process the internal write queue sequentially to prevent concurrent writes
     */
    async #processWriteQueue() {
        if (this.isWriting || this.writeQueue.length === 0) return;

        this.isWriting = true;
        while (this.writeQueue.length > 0) {
            const { level, message, meta, requestId } = this.writeQueue.shift();
            try {
                await this.#writeToFile(level, message, meta, requestId);
            } catch (error) {
                console.error("Error processing write queue:", error.message);
            }
        }
        this.isWriting = false;
    }

    // ========================================
    // ARGUMENT NORMALIZATION
    // ========================================

    #normalizeLogArguments(args) {
        if (args.length === 0) return { message: "[Empty Log]", meta: {} };
        if (args.length === 1) return { message: args[0], meta: {} };

        const [message, ...rest] = args;

        if (rest.length === 1 && this.#isPlainMetaObject(rest[0])) {
            return { message, meta: rest[0] };
        }

        const formattedArgs = rest.map((a) => this.#formatMetaValue(a, true));
        return {
            message: `${message} ${formattedArgs.join(" ")}`,
            meta: { additionalData: rest.map((a) => this.#formatMetaValue(a)) },
        };
    }

    #isPlainMetaObject(value) {
        if (
            value === null ||
            value === undefined ||
            typeof value !== "object" ||
            Array.isArray(value)
        )
            return false;
        const keys = Object.keys(value);
        return keys.length === 0 || !keys.every((key, i) => key === String(i));
    }

    #formatMetaValue(value, forMessage = false) {
        if (value === null) return "null";
        if (value === undefined) return "undefined";
        if (typeof value === "string") return value;
        if (typeof value === "number" || typeof value === "boolean")
            return String(value);
        if (Array.isArray(value) || typeof value === "object")
            return forMessage ? JSON.stringify(value) : value;
        return String(value);
    }

    // ========================================
    // CORE LOGGING
    // ========================================

    /**
     * Core log method — enqueues a log entry for async file writing.
     * A log at RFC 5424 level N is written if N <= this.currentLevel
     * (lower number = higher priority = always shown).
     *
     * @param {string} level - One of EMERGENCY, ALERT, critical, ERROR, WARNING, NOTICE, INFO, DEBUG
     * @param {string|*} message - Log message or value
     * @param {object} [meta={}] - Optional metadata object
     */
    async log(level, message, meta = {}) {
        if (Logger.CONFIG.LEVELS[level] > this.currentLevel) return;
        if (!message || (typeof message === "string" && !message.trim()))
            return;

        this.#injectCallSite(meta);
        // Capture now — the ALS context is correct here. By the time #processWriteQueue
        // dequeues this item it may be running under a different request's context.
        const requestId = requestContext.getStore()?.requestId ?? null;
        this.writeQueue.push({ level, message, meta, requestId });
        this.#processWriteQueue();
    }

    // ========================================
    // PUBLIC LEVEL METHODS — RFC 5424
    // ========================================

    /**
     * EMERGENCY (priority 0) — System is unusable. Should never occur in a running process.
     * Use for unrecoverable panics only.
     * @param {...*} args
     */
    emergency(...args) {
        const { message, meta } = this.#normalizeLogArguments(args);
        return this.log("EMERGENCY", message, meta);
    }

    /**
     * EMERG — Deprecated short alias for emergency(). Retained for backward compatibility.
     * @deprecated Use logger.emergency() instead.
     * @param {...*} args
     */
    emerg(...args) {
        return this.emergency(...args);
    }

    /**
     * ALERT (priority 1) — Action must be taken immediately.
     * Examples: DB pool completely down, critical dependency unreachable.
     * @param {...*} args
     */
    alert(...args) {
        const { message, meta } = this.#normalizeLogArguments(args);
        return this.log("ALERT", message, meta);
    }

    /**
     * critical (priority 2) — critical conditions.
     * Examples: health check hard failure, certificate expiry.
     * @param {...*} args
     */
    critical(...args) {
        const { message, meta } = this.#normalizeLogArguments(args);
        return this.log("critical", message, meta);
    }

    /**
     * CRIT — Deprecated short alias for critical(). Retained for backward compatibility.
     * @deprecated Use logger.critical() instead.
     * @param {...*} args
     */
    crit(...args) {
        return this.critical(...args);
    }

    /**
     * ERROR (priority 3) — Error conditions.
     * Backward-compatible replacement for old error() at level 0.
     * @param {...*} args
     */
    error(...args) {
        const { message, meta } = this.#normalizeLogArguments(args);
        return this.log("ERROR", message, meta);
    }

    /**
     * WARNING (priority 4) — Warning conditions.
     * Canonical RFC 5424 method name. Replaces the old warn() call site name.
     * Backward-compatible replacement for old warn() at level 1.
     * @param {...*} args
     */
    warning(...args) {
        const { message, meta } = this.#normalizeLogArguments(args);
        return this.log("WARNING", message, meta);
    }

    /**
     * WARN — Deprecated alias for warning(). Retained for backward compatibility only.
     * All new call sites must use logger.warning(). This alias will be removed in v6.
     * @deprecated Use logger.warning() instead.
     * @param {...*} args
     */
    warn(...args) {
        return this.warning(...args);
    }

    /**
     * NOTICE (priority 5) — Normal but significant condition.
     * Examples: startup complete, config change, expected administrative events.
     * @param {...*} args
     */
    notice(...args) {
        const { message, meta } = this.#normalizeLogArguments(args);
        return this.log("NOTICE", message, meta);
    }

    /**
     * INFO (priority 6) — Informational messages.
     * Backward-compatible replacement for old info() at level 2.
     * @param {...*} args
     */
    info(...args) {
        const { message, meta } = this.#normalizeLogArguments(args);
        return this.log("INFO", message, meta);
    }

    /**
     * DEBUG (priority 7) — Debug-level messages.
     * Backward-compatible replacement for old debug() at level 3.
     * @param {...*} args
     */
    debug(...args) {
        const { message, meta } = this.#normalizeLogArguments(args);
        return this.log("DEBUG", message, meta);
    }

    // ========================================
    // HTTP REQUEST LIFECYCLE LOGGING
    // ========================================

    logIncomingRequest(req, customMessage = null) {
        return this.log("INFO", customMessage || "Incoming Request", {
            method: req.method,
            url: req.originalUrl || req.url,
            _isHttpRequest: true,
            _requestPhase: "[Incoming Request]",
            _clientMachine: this.#createClientMachineIdentifier(req),
        });
    }

    logHandlingRequest(req, additionalMeta = {}) {
        return this.log("INFO", "Handling Request", {
            method: req.method,
            url: req.originalUrl || req.url,
            _isHttpRequest: true,
            _requestPhase: "[Handling Request]",
            _clientMachine: this.#createClientMachineIdentifier(req),
            ...additionalMeta,
        });
    }

    logCompletedRequest(req, res, duration, customMessage = null) {
        const level = res.statusCode >= 400 ? "ERROR" : "INFO";
        return this.log(level, customMessage || "Request Complete", {
            method: req.method,
            url: req.originalUrl || req.url,
            // statusCode + durationMs make ERROR-level completions diagnosable —
            // without them a request in error.log shows the route but not whether
            // it was a 401, 404, 429, or 500.
            statusCode: res.statusCode,
            durationMs: duration,
            _isHttpRequest: true,
            _requestPhase: "[Request Complete]",
            _clientMachine: this.#createClientMachineIdentifier(req),
        });
    }

    #createClientMachineIdentifier(req) {
        const username =
            req.get?.("X-Client-Username") ||
            (req.query?.username && req.query?.userId
                ? `${req.query.username}@${req.query.userId}`
                : null) ||
            (req.user?.userId ?? req.user?.sub) ||
            "anonymous@unknown";
        return `${username} (C) ${this.#getClientIp(req)}`;
    }

    #getClientIp(req) {
        const headers = req.headers || {};
        const xff = headers["x-forwarded-for"];
        const xri = headers["x-real-ip"];
        const cfi = headers["cf-connecting-ip"];

        if (xff && typeof xff === "string") return xff.split(",")[0].trim();
        if (xri && typeof xri === "string") return xri.trim();
        if (cfi && typeof cfi === "string") return cfi.trim();

        return (
            req.ip ||
            req.connection?.remoteAddress ||
            req.socket?.remoteAddress ||
            "unknown"
        );
    }

    // ========================================
    // SPECIALIZED LOGGING
    // ========================================

    cache(operation, key, result, duration = null) {
        return this.log("DEBUG", "Cache Operation", {
            operation,
            key,
            result,
            ...(duration != null && { duration: `${duration}ms` }),
        });
    }

    database(operation, table, duration = null, rowCount = null) {
        return this.log("DEBUG", "Database Operation", {
            operation,
            table,
            ...(duration != null && { duration: `${duration}ms` }),
            ...(rowCount != null && { rowCount }),
        });
    }

    performance(operation, duration, details = {}) {
        const level = duration > 5000 ? "WARNING" : "INFO";
        return this.log(level, "Performance", {
            operation,
            duration: `${duration}ms`,
            ...details,
        });
    }

    security(event, details = {}) {
        return this.log("WARNING", "Security Event", {
            event,
            timestamp: new Date().toISOString(),
            ...details,
        });
    }

    // ========================================
    // MAINTENANCE & STATS
    // ========================================

    async getLogStats() {
        try {
            const logDir = this.#getLogDirectory();
            const files = await fs.readdir(logDir);

            const fileStats = await Promise.all(
                files
                    .filter((f) => f.endsWith(".log"))
                    .map(async (file) => {
                        const stats = await fs.stat(path.join(logDir, file));
                        return {
                            name: file,
                            size: stats.size,
                            sizeHuman: this.#formatBytes(stats.size),
                            created: stats.birthtime,
                            modified: stats.mtime,
                        };
                    }),
            );

            return {
                directory: logDir,
                totalFiles: fileStats.length,
                files: fileStats,
            };
        } catch (error) {
            return { error: error.message, directory: this.#getLogDirectory() };
        }
    }

    async cleanupOldLogs(daysToKeep = 30) {
        try {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
            this.info("Log cleanup completed", { daysToKeep, cutoffDate });
        } catch (error) {
            this.error("Log cleanup failed", { error: error.message });
        }
    }

    #formatBytes(bytes, decimals = 2) {
        if (bytes === 0) return "0 Bytes";
        const k = 1024;
        const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals < 0 ? 0 : decimals))} ${sizes[i]}`;
    }

    // ========================================
    // EXPRESS MIDDLEWARE FACTORY
    // ========================================

    /**
     * Returns an Express middleware that logs the full HTTP request lifecycle
     */
    createHttpLoggerMiddleware() {
        return (req, res, next) => {
            const startTime = Date.now();
            this.logIncomingRequest(req);

            const originalEnd = res.end.bind(res);
            res.end = (...args) => {
                this.logCompletedRequest(req, res, Date.now() - startTime);
                return originalEnd(...args);
            };

            next();
        };
    }
}

// ========================================
// SINGLETON INSTANCE & EXPORTS
// ========================================

const logger = new Logger();

module.exports = { Logger, logger };
