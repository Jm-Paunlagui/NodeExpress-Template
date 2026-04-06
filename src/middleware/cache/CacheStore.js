"use strict";

/**
 * @fileoverview CacheStore — Single named cache instance backed by NodeCache.
 *
 * This is the lowest-level building block. Each CacheStore wraps one NodeCache
 * instance and exposes a clean, domain-agnostic API for get / set / del / flush
 * with structured logging and stats.
 *
 * You never instantiate CacheStore directly in application code. Use
 * CacheRegistry.register() instead.
 */

const NodeCache = require("node-cache");
const { logger } = require("../../utils/logger");

class CacheStore {
    /**
     * @param {string} name          - Human-readable name used in log output.
     * @param {Object} [options={}]
     * @param {number} [options.ttl=0]        - Seconds until expiry. 0 = never expires.
     * @param {number} [options.checkPeriod=0] - Seconds between expired-key sweeps. 0 = disabled.
     * @param {number} [options.maxKeys=-1]    - Max keys before oldest is evicted. -1 = unlimited.
     */
    constructor(name, options = {}) {
        if (!name || typeof name !== "string") {
            throw new TypeError("CacheStore: name must be a non-empty string.");
        }

        this._name = name;
        this._ttl = options.ttl ?? 0;
        this._maxKeys = options.maxKeys ?? -1;

        this._store = new NodeCache({
            stdTTL: this._ttl,
            checkperiod: options.checkPeriod ?? (this._ttl > 0 ? Math.floor(this._ttl / 4) : 0),
            useClones: false,        // Return references — callers must not mutate cached values
            deleteOnExpire: true,
            errorOnMissing: false,
            maxKeys: this._maxKeys,
        });

        // Bind event listeners for observability
        this._store.on("set",     (key)       => this._log("SET",     key));
        this._store.on("del",     (key)       => this._log("DEL",     key));
        this._store.on("expired", (key)       => this._log("EXPIRED", key));
        this._store.on("flush",   ()          => logger.info(`[Cache:${this._name}] FLUSH`));
    }

    // ─── Core Operations ──────────────────────────────────────────────────────

    /**
     * Read a value. Returns `undefined` on miss (never throws).
     * @param {string} key
     * @returns {*}
     */
    get(key) {
        const value = this._store.get(key);
        this._log(value !== undefined ? "HIT" : "MISS", key);
        return value;
    }

    /**
     * Write a value.
     * @param {string} key
     * @param {*}      value
     * @param {number} [ttl]  - Per-entry override in seconds. Omit to use the store default.
     * @returns {boolean}
     */
    set(key, value, ttl) {
        return ttl !== undefined
            ? this._store.set(key, value, ttl)
            : this._store.set(key, value);
    }

    /**
     * Delete one or more keys.
     * @param {string|string[]} keys
     * @returns {number} Count of deleted entries.
     */
    del(keys) {
        return this._store.del(Array.isArray(keys) ? keys : [keys]);
    }

    /**
     * Returns true if the key exists (and has not expired).
     * @param {string} key
     * @returns {boolean}
     */
    has(key) {
        return this._store.has(key);
    }

    /**
     * Return all current cache keys.
     * @returns {string[]}
     */
    keys() {
        return this._store.keys();
    }

    /**
     * Delete all keys whose string representation includes `pattern`.
     * @param {string} pattern - Plain substring (not regex).
     * @returns {number} Count of deleted entries.
     */
    delByPattern(pattern) {
        const matched = this._store.keys().filter((k) => k.includes(pattern));
        if (matched.length === 0) return 0;
        const count = this._store.del(matched);
        logger.info(
            `[Cache:${this._name}] DEL_PATTERN "${pattern}" → removed ${count} key(s)`
        );
        return count;
    }

    /**
     * Delete all keys that satisfy a predicate function.
     * @param {(key: string) => boolean} predicate
     * @returns {number} Count of deleted entries.
     */
    delWhere(predicate) {
        const matched = this._store.keys().filter(predicate);
        if (matched.length === 0) return 0;
        const count = this._store.del(matched);
        logger.info(
            `[Cache:${this._name}] DEL_WHERE → removed ${count} key(s)`
        );
        return count;
    }

    /**
     * Remove all entries from this store.
     */
    flush() {
        this._store.flushAll();
    }

    // ─── Read-through helper ──────────────────────────────────────────────────

    /**
     * Get-or-set pattern. Returns cached value if present, otherwise calls
     * `loader()`, stores its result, and returns it.
     *
     * @param {string}            key
     * @param {() => Promise<*>}  loader  - Async function that produces the value.
     * @param {number}            [ttl]   - Per-entry TTL override.
     * @returns {Promise<*>}
     */
    async getOrSet(key, loader, ttl) {
        const cached = this.get(key);
        if (cached !== undefined) return cached;

        const value = await loader();
        if (value !== undefined && value !== null) {
            this.set(key, value, ttl);
        }
        return value;
    }

    // ─── Stats & metadata ─────────────────────────────────────────────────────

    /**
     * Returns a snapshot of store statistics and current key count.
     * @returns {Object}
     */
    stats() {
        const raw = this._store.getStats();
        const keys = this._store.keys().length;
        const hits = raw.hits ?? 0;
        const misses = raw.misses ?? 0;
        const total = hits + misses;
        return {
            name: this._name,
            keys,
            hits,
            misses,
            hitRate: total > 0 ? +((hits / total) * 100).toFixed(2) : 0,
            ttl: this._ttl,
            maxKeys: this._maxKeys,
        };
    }

    get name() {
        return this._name;
    }

    // ─── Internal ─────────────────────────────────────────────────────────────

    _log(event, key) {
        logger.debug(`[Cache:${this._name}] ${event.padEnd(7)} ${key}`);
    }
}

module.exports = { CacheStore };