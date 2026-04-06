"use strict";

/**
 * @fileoverview CacheRegistry — Central registry for all named CacheStore instances.
 *
 * Acts as a service-locator / factory for caches. Consumers register stores by name
 * at startup and resolve them anywhere in the app without circular imports.
 *
 * Design rules
 * ─────────────
 * - Registering the same name twice throws — prevents silent misconfiguration.
 * - Resolving an unknown name throws — prevents silent cache misses masking bugs.
 * - All stores share the same logger; the name prefix distinguishes them.
 * - The registry is a singleton (one module-level instance exported at the bottom).
 *
 * Typical project bootstrap (e.g. app.js or a dedicated cache/index.js):
 *
 *   const { registry } = require('./middleware/cache/CacheRegistry');
 *
 *   registry.register('sessions', { ttl: 900 });
 *   registry.register('users',    { ttl: 300, maxKeys: 5000 });
 *   registry.register('reports',  { ttl: 0 });       // never-expire, manual invalidation
 *
 * Then anywhere in the app:
 *
 *   const sessions = registry.resolve('sessions');
 *   const user = await sessions.getOrSet(`user:${id}`, () => UserService.findById(id));
 */

const { CacheStore } = require("./CacheStore");
const { logger } = require("../../utils/logger");

class CacheRegistry {
    constructor() {
        /** @type {Map<string, CacheStore>} */
        this._stores = new Map();
    }

    // ─── Registration ─────────────────────────────────────────────────────────

    /**
     * Create and register a new CacheStore by name.
     *
     * @param {string}  name              - Unique store identifier.
     * @param {Object}  [options={}]
     * @param {number}  [options.ttl=0]        - Seconds until expiry. 0 = never.
     * @param {number}  [options.checkPeriod]   - Sweep interval in seconds (auto-derived if omitted).
     * @param {number}  [options.maxKeys=-1]    - Maximum key count. -1 = unlimited.
     * @returns {CacheStore} The newly created store (useful for one-liner registration).
     * @throws {Error}  If the name is already registered.
     */
    register(name, options = {}) {
        if (this._stores.has(name)) {
            throw new Error(
                `CacheRegistry: store "${name}" is already registered. ` +
                `Use registry.resolve("${name}") to get the existing instance.`
            );
        }
        const store = new CacheStore(name, options);
        this._stores.set(name, store);
        logger.info(
            `[CacheRegistry] Registered store "${name}" — ` +
            `ttl=${options.ttl ?? 0}s, maxKeys=${options.maxKeys ?? -1}`
        );
        return store;
    }

    /**
     * Register multiple stores at once from a plain object map.
     *
     * @param {Object.<string, Object>} definitions
     *   e.g. { sessions: { ttl: 900 }, reports: { ttl: 0 } }
     * @returns {void}
     */
    registerAll(definitions) {
        for (const [name, options] of Object.entries(definitions)) {
            this.register(name, options);
        }
    }

    // ─── Resolution ──────────────────────────────────────────────────────────

    /**
     * Retrieve a registered CacheStore by name.
     * @param {string} name
     * @returns {CacheStore}
     * @throws {Error} If the name has not been registered.
     */
    resolve(name) {
        const store = this._stores.get(name);
        if (!store) {
            const known = [...this._stores.keys()].join(", ") || "(none)";
            throw new Error(
                `CacheRegistry: store "${name}" is not registered. ` +
                `Registered stores: ${known}`
            );
        }
        return store;
    }

    /**
     * Returns true when a store with the given name is registered.
     * @param {string} name
     * @returns {boolean}
     */
    has(name) {
        return this._stores.has(name);
    }

    // ─── Global operations ────────────────────────────────────────────────────

    /**
     * Flush all registered stores.
     */
    flushAll() {
        for (const store of this._stores.values()) {
            store.flush();
        }
        logger.info("[CacheRegistry] All stores flushed.");
    }

    /**
     * Flush a single store by name.
     * @param {string} name
     */
    flush(name) {
        this.resolve(name).flush();
    }

    /**
     * Returns a stats snapshot for every registered store.
     * @returns {Object[]}
     */
    statsAll() {
        return [...this._stores.values()].map((s) => s.stats());
    }

    /**
     * Returns aggregate stats plus per-store breakdown.
     * @returns {Object}
     */
    report() {
        const perStore = this.statsAll();
        const totalHits   = perStore.reduce((n, s) => n + s.hits,   0);
        const totalMisses = perStore.reduce((n, s) => n + s.misses, 0);
        const totalKeys   = perStore.reduce((n, s) => n + s.keys,   0);
        const total = totalHits + totalMisses;

        return {
            stores: perStore,
            aggregate: {
                storeCount: perStore.length,
                totalKeys,
                totalHits,
                totalMisses,
                hitRate: total > 0 ? +((totalHits / total) * 100).toFixed(2) : 0,
            },
            timestamp: new Date().toISOString(),
        };
    }

    /**
     * Returns all registered store names.
     * @returns {string[]}
     */
    names() {
        return [...this._stores.keys()];
    }
}

// Singleton — the whole app shares one registry.
const registry = new CacheRegistry();

module.exports = { CacheRegistry, registry };