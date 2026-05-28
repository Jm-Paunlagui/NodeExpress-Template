"use strict";

/**
 * @fileoverview Express middleware that records per-request RED metrics into MetricsStore.
 *
 * WHAT THIS FILE DOES
 *   Taps into each Express response's "finish" event to capture route, method,
 *   status code, and duration, then calls metricsStore.recordRequest() with that data.
 *
 * HOW IT WORKS
 *   - On handle(), records process.hrtime.bigint() as the request start time.
 *   - Hooks res.on("finish") to compute elapsed time once the response is flushed.
 *   - Route key uses req.route?.path (Express matched path) falling back to req.path
 *     so wildcard routes are grouped correctly instead of appearing as N distinct keys.
 *   - Does NOT duplicate ResponseTimeMiddleware's X-Response-Time header work.
 *   - Follows the standard MEAL middleware pattern: class + bound handle() + named export.
 *
 * EXAMPLE
 *   const { defaultMetrics } = require('./MetricsMiddleware');
 *   app.use(defaultMetrics.handle.bind(defaultMetrics)); // position 5a in app.js
 */

const { metricsStore: defaultStore } = require("./MetricsStore");

class MetricsMiddleware {
  /**
   * @param {import('./MetricsStore').MetricsStore} [store] - Metrics store instance.
   *   Defaults to the module-level singleton so all middleware share one store.
   */
  constructor(store = defaultStore) {
    this._store = store;
    this.handle = this.handle.bind(this);
  }

  /**
   * Express middleware. Hooks res "finish" to record the completed request.
   *
   * @param {import('express').Request}  req
   * @param {import('express').Response} res
   * @param {import('express').NextFunction} next
   */
  handle(req, res, next) {
    const startNs = process.hrtime.bigint();

    res.on("finish", () => {
      try {
        const durationMs = Number(
          (process.hrtime.bigint() - startNs) / BigInt(1_000_000),
        );

        // Prefer the matched route pattern (e.g. "/api/v1/users/:id") over the
        // literal path so hot-path routes don't fragment into per-ID keys.
        const routePath = req.route?.path || req.path;
        const route = `${req.method} ${routePath}`;

        this._store.recordRequest(route, req.method, res.statusCode, durationMs);
      } catch {
        // Non-fatal — metrics collection must never crash the request pipeline
      }
    });

    next();
  }
}

// ─── Singleton export ─────────────────────────────────────────────────────────

const defaultMetrics = new MetricsMiddleware();

module.exports = { MetricsMiddleware, defaultMetrics };
