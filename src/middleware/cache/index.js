"use strict";

/**
 * @fileoverview Cache subsystem barrel — import everything from here.
 *
 * Exports
 * ───────
 *  CacheStore       — low-level NodeCache wrapper (get / set / del / flush / getOrSet)
 *  CacheRegistry    — singleton store registry (register / resolve / statsAll / flushAll)
 *  registry         — the singleton CacheRegistry instance
 *  CacheKeyBuilder  — fluent, deterministic key construction
 *  CacheMiddleware  — Express middleware factory (read / invalidate / invalidateWhere)
 *
 * Quickstart
 * ──────────
 * 1. Register stores at startup (e.g. in app.js or a dedicated cache/setup.js):
 *
 *      const { registry } = require('./middleware/cache');
 *      registry.registerAll({
 *          users:   { ttl: 300  },
 *          reports: { ttl: 0    },   // manual invalidation only
 *          tokens:  { ttl: 900, maxKeys: 10000 },
 *      });
 *
 * 2. Use on routes:
 *
 *      const { CacheMiddleware, CacheKeyBuilder, registry } = require('./middleware/cache');
 *      const usersStore = registry.resolve('users');
 *
 *      router.get('/users',
 *          CacheMiddleware.read(
 *              usersStore,
 *              (req) => CacheKeyBuilder.build('users', { div: req.query.division }),
 *          ),
 *          UserController.list,
 *      );
 *
 *      router.post('/users',
 *          UserController.create,
 *          CacheMiddleware.invalidate(usersStore, () => null, { usePattern: true }),
 *          // ↑ returns null → no-op if you want to let TTL handle it naturally,
 *          //   OR return 'users' to wipe all keys that contain "users".
 *      );
 *
 * 3. For service-layer (non-HTTP) caching use getOrSet:
 *
 *      const reports = registry.resolve('reports');
 *      const data = await reports.getOrSet(
 *          CacheKeyBuilder.build('report', { year, month, division }),
 *          () => ReportService.generate({ year, month, division }),
 *      );
 */

const { CacheStore }      = require("./CacheStore");
const { CacheRegistry, registry } = require("./CacheRegistry");
const { CacheKeyBuilder } = require("./CacheKeyBuilder");
const { CacheMiddleware } = require("./CacheMiddleware");

module.exports = {
    CacheStore,
    CacheRegistry,
    registry,
    CacheKeyBuilder,
    CacheMiddleware,
};