"use strict";

/**
 * @fileoverview CacheMiddleware — Express middleware factory for request-level caching.
 *
 * Two concerns are cleanly separated:
 *
 * 1. `CacheMiddleware.read(store, keyFn)`
 *    Intercept GET requests, serve from cache on HIT, or store the JSON response on MISS.
 *
 * 2. `CacheMiddleware.invalidate(store, keyFn | patternFn)`
 *    After a mutating request succeeds (2xx), delete the affected cache entries.
 *
 * Domain-specific key generation belongs to the project's own key-builder modules
 * (passed in as `keyFn`). This class stays domain-agnostic.
 *
 * Usage — read-through on a GET route:
 *
 *   const { CacheMiddleware } = require('../middleware/cache/CacheMiddleware');
 *   const { registry }        = require('../middleware/cache/CacheRegistry');
 *
 *   const usersStore = registry.resolve('users');
 *
 *   router.get('/users',
 *       CacheMiddleware.read(
 *           usersStore,
 *           (req) => CacheKeyBuilder.build('users', { division: req.query.division })
 *       ),
 *       UserController.list,
 *   );
 *
 * Usage — invalidate after mutation:
 *
 *   router.post('/users',
 *       UserController.create,
 *       CacheMiddleware.invalidate(
 *           usersStore,
 *           (req) => 'users'   // delByPattern — removes all keys that contain "users"
 *       ),
 *   );
 */

const { logger } = require("../../utils/logger");

class CacheMiddleware {
    // ─── Read-through (cache-aside) ───────────────────────────────────────────

    /**
     * Returns an Express middleware that:
     *   - On HIT  → responds immediately with the cached value.
     *   - On MISS → calls next(), then captures the JSON response and stores it.
     *
     * @param {import('./CacheStore').CacheStore} store
     *   The target cache store (from `registry.resolve(...)`).
     *
     * @param {(req: import('express').Request) => string} keyFn
     *   Pure function: given the request, return the cache key string.
     *
     * @param {Object} [options={}]
     * @param {string[]} [options.bypassMethods=['POST','PUT','PATCH','DELETE']]
     *   HTTP methods that skip caching entirely.
     * @param {number}   [options.ttl]
     *   Per-route TTL override (seconds). Omit to use the store's default.
     * @param {boolean}  [options.setHeaders=true]
     *   Attach X-Cache, X-Cache-Key headers to the response.
     *
     * @returns {import('express').RequestHandler}
     */
    static read(store, keyFn, options = {}) {
        const bypass      = new Set(options.bypassMethods ?? ["POST", "PUT", "PATCH", "DELETE"]);
        const setHeaders  = options.setHeaders !== false;
        const ttl         = options.ttl; // may be undefined → use store default

        return (req, res, next) => {
            // Skip write verbs — they should never be cached.
            if (bypass.has(req.method)) return next();

            let key;
            try {
                key = keyFn(req);
            } catch (err) {
                logger.warn(`[CacheMiddleware.read] keyFn threw — bypassing cache: ${err.message}`);
                return next();
            }

            const cached = store.get(key);

            if (cached !== undefined) {
                if (setHeaders) {
                    res.set("X-Cache",     "HIT");
                    res.set("X-Cache-Key", key);
                }
                return res.json(cached);
            }

            // MISS — let the handler run, then intercept the response.
            if (setHeaders) {
                res.set("X-Cache",     "MISS");
                res.set("X-Cache-Key", key);
            }

            const originalJson = res.json.bind(res);
            res.json = function (data) {
                // Only cache successful responses.
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    store.set(key, data, ttl);
                }
                return originalJson(data);
            };

            next();
        };
    }

    // ─── Invalidation ────────────────────────────────────────────────────────

    /**
     * Returns an Express middleware that deletes cache entries **after** the
     * handler responds successfully (2xx).
     *
     * The `keyFn` can return:
     *   - A single key string        → exact delete
     *   - An array of key strings    → multi-delete
     *   - null / undefined           → no-op (useful when nothing needs invalidation)
     *
     * For pattern-based invalidation, call `store.delByPattern(pattern)` inside
     * a custom middleware — or pass `{ usePattern: true }` and return a substring.
     *
     * @param {import('./CacheStore').CacheStore | import('./CacheStore').CacheStore[]} store
     *   One or multiple stores to invalidate from.
     *
     * @param {(req: import('express').Request, res: import('express').Response) => string | string[] | null} keyFn
     *   Returns the key(s) to delete. Called after a successful response.
     *
     * @param {Object}  [options={}]
     * @param {boolean} [options.usePattern=false]
     *   If true, treat the returned value as a pattern for `delByPattern()`.
     *
     * @returns {import('express').RequestHandler}
     */
    static invalidate(store, keyFn, options = {}) {
        const stores     = Array.isArray(store) ? store : [store];
        const usePattern = options.usePattern === true;

        return (req, res, next) => {
            const originalJson = res.json.bind(res);
            res.json = function (data) {
                const result = originalJson(data);

                // Fire-and-forget invalidation only on success.
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    setImmediate(() => {
                        try {
                            const target = keyFn(req, res);
                            if (target == null) return;

                            for (const s of stores) {
                                if (usePattern) {
                                    s.delByPattern(String(target));
                                } else {
                                    const keys = Array.isArray(target) ? target : [target];
                                    s.del(keys);
                                }
                            }
                        } catch (err) {
                            logger.error(`[CacheMiddleware.invalidate] keyFn threw: ${err.message}`);
                        }
                    });
                }

                return result;
            };

            next();
        };
    }

    // ─── Convenience: invalidate by predicate ────────────────────────────────

    /**
     * Like `invalidate()` but deletes every key for which `predicateFn` returns true.
     *
     * @param {import('./CacheStore').CacheStore | import('./CacheStore').CacheStore[]} store
     * @param {(key: string, req: import('express').Request) => boolean} predicateFn
     * @returns {import('express').RequestHandler}
     */
    static invalidateWhere(store, predicateFn) {
        const stores = Array.isArray(store) ? store : [store];

        return (req, res, next) => {
            const originalJson = res.json.bind(res);
            res.json = function (data) {
                const result = originalJson(data);

                if (res.statusCode >= 200 && res.statusCode < 300) {
                    setImmediate(() => {
                        try {
                            for (const s of stores) {
                                s.delWhere((key) => predicateFn(key, req));
                            }
                        } catch (err) {
                            logger.error(`[CacheMiddleware.invalidateWhere] predicateFn threw: ${err.message}`);
                        }
                    });
                }

                return result;
            };

            next();
        };
    }
}

module.exports = { CacheMiddleware };