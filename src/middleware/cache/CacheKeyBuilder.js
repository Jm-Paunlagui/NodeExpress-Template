"use strict";

/**
 * @fileoverview CacheKeyBuilder — Fluent, deterministic cache key construction.
 *
 * Problems with ad-hoc string concatenation
 * ──────────────────────────────────────────
 * - Parameter order differs across call sites → two callers, two different keys for the same data.
 * - Optional parameters are silently omitted → cache collisions between "all" and "filtered" results.
 * - No canonical way to handle arrays, nulls, or nested objects.
 *
 * This class solves all of that:
 * - Parameters are sorted alphabetically → order-independent.
 * - Null / undefined values are normalised to the literal string "null".
 * - Arrays are sorted before joining → [2,1,3] and [3,1,2] produce the same key.
 * - Long keys (> 200 chars) are automatically hashed to a shorter fingerprint.
 *
 * Usage — static factory (recommended):
 *
 *   const key = CacheKeyBuilder.of("users")
 *       .param("division", division)
 *       .param("year",     year)
 *       .param("month",    month)
 *       .build();
 *   // → "users:division=WH:month=01:year=2025"
 *
 * Usage — instance (when building dynamically in a loop):
 *
 *   const builder = new CacheKeyBuilder("report");
 *   for (const [k, v] of Object.entries(filters)) builder.param(k, v);
 *   const key = builder.build();
 */

const crypto = require("crypto");

/** Keys longer than this are hashed automatically. */
const MAX_KEY_LENGTH = 200;

class CacheKeyBuilder {
    /**
     * @param {string} prefix  - The logical namespace for this key (e.g. "users", "report").
     */
    constructor(prefix) {
        if (!prefix || typeof prefix !== "string") {
            throw new TypeError("CacheKeyBuilder: prefix must be a non-empty string.");
        }
        this._prefix = prefix;
        /** @type {Map<string, string>} */
        this._params = new Map();
    }

    // ─── Static factory ───────────────────────────────────────────────────────

    /**
     * Create a builder starting with the given prefix.
     * Enables one-liner: `CacheKeyBuilder.of("users").param("id", id).build()`
     * @param {string} prefix
     * @returns {CacheKeyBuilder}
     */
    static of(prefix) {
        return new CacheKeyBuilder(prefix);
    }

    // ─── Builder methods ──────────────────────────────────────────────────────

    /**
     * Add a parameter to the key.
     * @param {string}  name   - Parameter name (will be part of the key string).
     * @param {*}       value  - Any scalar, array, or object value.
     * @returns {this}
     */
    param(name, value) {
        this._params.set(name, CacheKeyBuilder._normalise(value));
        return this;
    }

    /**
     * Add multiple parameters at once from a plain object.
     * @param {Object.<string, *>} obj
     * @returns {this}
     */
    params(obj) {
        for (const [k, v] of Object.entries(obj)) {
            this.param(k, v);
        }
        return this;
    }

    /**
     * Build and return the final cache key string.
     *
     * - Parameters are sorted alphabetically for determinism.
     * - If the resulting string exceeds MAX_KEY_LENGTH it is hashed.
     *
     * @returns {string}
     */
    build() {
        const parts = [...this._params.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => `${k}=${v}`);

        const raw = parts.length > 0
            ? `${this._prefix}:${parts.join(":")}`
            : this._prefix;

        if (raw.length <= MAX_KEY_LENGTH) return raw;

        // Hash the parameters portion to keep the key compact
        const hash = crypto
            .createHash("md5")
            .update(raw)
            .digest("hex")
            .slice(0, 16);

        return `${this._prefix}:h=${hash}`;
    }

    // ─── Static helpers ───────────────────────────────────────────────────────

    /**
     * Normalise any value to a cache-key-safe string.
     * - null / undefined → "null"
     * - arrays → sorted, comma-joined
     * - objects → JSON string
     * - primitives → String()
     * @param {*} value
     * @returns {string}
     */
    static _normalise(value) {
        if (value === null || value === undefined) return "null";

        if (Array.isArray(value)) {
            // Sort numerics numerically, everything else lexicographically
            const allNumeric = value.every(
                (v) => typeof v === "number" || (typeof v === "string" && !isNaN(Number(v)))
            );
            const sorted = [...value].sort((a, b) =>
                allNumeric ? Number(a) - Number(b) : String(a).localeCompare(String(b))
            );
            return sorted.map(String).join(",");
        }

        if (typeof value === "object") {
            try {
                return JSON.stringify(value);
            } catch {
                return "[object]";
            }
        }

        return String(value);
    }

    /**
     * Convenience: build a key from a prefix + params object in one call.
     * @param {string}              prefix
     * @param {Object.<string, *>}  [paramsObj={}]
     * @returns {string}
     */
    static build(prefix, paramsObj = {}) {
        return CacheKeyBuilder.of(prefix).params(paramsObj).build();
    }
}

module.exports = { CacheKeyBuilder };