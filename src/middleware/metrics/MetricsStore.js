"use strict";

/**
 * @fileoverview In-process metrics store — RED (Rate, Errors, Duration) + system metrics.
 *
 * WHAT THIS FILE DOES
 *   Collects all in-process observability metrics without any external dependency.
 *   Exposes a getSnapshot() method that returns a fully structured metrics payload
 *   consumed by MetricsController → GET /api/v1/metrics.
 *
 * HOW IT WORKS
 *   - Per-route ring buffers (max 1000 durations) for accurate p50/p95/p99 percentiles.
 *   - System metrics polled every 10 s via setInterval (CPU, memory, handles, requests).
 *   - Event-loop lag measured via recurring setImmediate probe.
 *   - GC stats collected via perf_hooks PerformanceObserver when available.
 *   - Frontend vitals stored in a capped FIFO array (max 500 entries).
 *   - Oracle query stats tracked per pool name.
 *   - All public mutators are synchronous and non-blocking.
 *
 * EXAMPLE
 *   const { metricsStore } = require('./MetricsStore');
 *   metricsStore.recordRequest('GET /api/v1/health', 'GET', 200, 12);
 *   const snapshot = metricsStore.getSnapshot();
 */

const { PerformanceObserver, performance } = require("perf_hooks");

/** @constant {number} Maximum number of duration samples per route for percentile calc */
const RING_BUFFER_SIZE = 1000;

/** @constant {number} Maximum frontend vital events retained in memory */
const FRONTEND_VITALS_MAX = 500;

/** @constant {number} System metrics polling interval in milliseconds */
const SYSTEM_POLL_INTERVAL_MS = 10_000;

// ─── Percentile helper ────────────────────────────────────────────────────────

/**
 * Calculate a percentile value from a sorted array of numbers.
 * @param {number[]} sorted - Ascending-sorted array of numbers
 * @param {number}   pct    - Percentile 0–1 (e.g. 0.95 for p95)
 * @returns {number}
 */
function calcPercentile(sorted, pct) {
  if (!sorted.length) return 0;
  const idx = Math.floor(sorted.length * pct);
  return sorted[Math.min(idx, sorted.length - 1)];
}

// ─── MetricsStore class ───────────────────────────────────────────────────────

class MetricsStore {
  constructor() {
    /**
     * Per-route RED data.
     * Key: "<METHOD> <path>" e.g. "GET /api/v1/health"
     * Value: { count, errorCount, durations: CircularBuffer }
     * @type {Map<string, { count: number, errorCount: number, durations: number[] }>}
     */
    this._routes = new Map();

    /** Total request counter (all routes combined) */
    this._requestsTotal = 0;

    /** Total error counter (status >= 400) */
    this._errorsTotal = 0;

    /**
     * Oracle pool stats.
     * Key: poolName, Value: { queryCount, errorCount, totalMs, durations: number[] }
     * @type {Map<string, { queryCount: number, errorCount: number, totalMs: number, durations: number[] }>}
     */
    this._oracle = new Map();

    /**
     * Frontend vitals FIFO (max FRONTEND_VITALS_MAX entries).
     * @type {Array<{ name: string, value: number, rating: string, context: object, ts: string }>}
     */
    this._frontendVitals = [];

    /**
     * Frontend errors FIFO (max FRONTEND_VITALS_MAX entries).
     * @type {Array<{ message: string, stack: string, context: object, ts: string }>}
     */
    this._frontendErrors = [];

    /** Last captured system metrics (refreshed every 10 s) */
    this._system = {
      cpu: { user: 0, system: 0 },
      memory: { heapUsed: 0, heapTotal: 0, rss: 0, external: 0, arrayBuffers: 0 },
      eventLoopLag: 0,
      gc: { collections: 0, pauseMs: 0 },
      handles: 0,
      requests: 0,
    };

    /** Previous cpuUsage snapshot for delta calculation */
    this._prevCpuUsage = process.cpuUsage();

    this.#startSystemPoller();
    this.#startEventLoopProbe();
    this.#startGcObserver();
  }

  // ========================================
  // PRIVATE BACKGROUND PROBES
  // ========================================

  /**
   * Poll system metrics every SYSTEM_POLL_INTERVAL_MS milliseconds.
   * Unref'd so it does not prevent process exit.
   */
  #startSystemPoller() {
    const interval = setInterval(() => {
      this.#collectSystemMetrics();
    }, SYSTEM_POLL_INTERVAL_MS);

    if (typeof interval.unref === "function") interval.unref();

    // Collect once immediately so first getSnapshot() has data
    this.#collectSystemMetrics();
  }

  /**
   * Collect a fresh system metrics snapshot.
   * Called every 10 s and once at construction.
   */
  #collectSystemMetrics() {
    try {
      const mem = process.memoryUsage();
      this._system.memory = {
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
        rss: mem.rss,
        external: mem.external,
        arrayBuffers: mem.arrayBuffers ?? 0,
      };

      // Delta CPU usage since last poll
      const currentCpu = process.cpuUsage(this._prevCpuUsage);
      this._prevCpuUsage = process.cpuUsage();
      this._system.cpu = {
        user: Math.round(currentCpu.user / 1000),   // microseconds → ms
        system: Math.round(currentCpu.system / 1000),
      };

      // Active handles and requests (internal V8 metrics)
      this._system.handles =
        typeof process._getActiveHandles === "function"
          ? process._getActiveHandles().length
          : -1;
      this._system.requests =
        typeof process._getActiveRequests === "function"
          ? process._getActiveRequests().length
          : -1;
    } catch {
      // Non-fatal — metrics may be unavailable in constrained environments
    }
  }

  /**
   * Probe event-loop lag with a recurring setImmediate delta.
   * Measures time between scheduling and execution of setImmediate callbacks.
   * Unref'd so it does not prevent process exit.
   */
  #startEventLoopProbe() {
    const probe = () => {
      const before = Date.now();
      setImmediate(() => {
        const lag = Date.now() - before;
        // Smooth with a simple EMA (α = 0.3) to avoid spikes from GC pauses
        this._system.eventLoopLag =
          Math.round(0.7 * this._system.eventLoopLag + 0.3 * lag);

        const timer = setTimeout(probe, 1000);
        if (typeof timer.unref === "function") timer.unref();
      });
    };

    const initial = setTimeout(probe, 1000);
    if (typeof initial.unref === "function") initial.unref();
  }

  /**
   * Observe GC performance entries via perf_hooks when available.
   * Gracefully no-ops on platforms/versions that do not support it.
   */
  #startGcObserver() {
    try {
      const obs = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          this._system.gc.collections++;
          this._system.gc.pauseMs += Math.round(entry.duration);
        }
      });
      obs.observe({ entryTypes: ["gc"] });
    } catch {
      // perf_hooks GC observation not available — skip silently
    }
  }

  // ========================================
  // PRIVATE RING BUFFER HELPERS
  // ========================================

  /**
   * Push a duration into a ring buffer array, evicting the oldest entry when full.
   * Mutates the array in-place.
   * @param {number[]} buf      - The ring buffer array
   * @param {number}   durationMs
   */
  #pushRing(buf, durationMs) {
    if (buf.length >= RING_BUFFER_SIZE) {
      buf.shift(); // O(n) but n is bounded and small; acceptable for 1000 items
    }
    buf.push(durationMs);
  }

  // ========================================
  // PUBLIC MUTATORS
  // ========================================

  /**
   * Record a completed HTTP request for RED metric aggregation.
   *
   * @param {string} route      - "<METHOD> <path>" e.g. "GET /api/v1/health"
   * @param {string} method     - HTTP verb
   * @param {number} statusCode - HTTP response status code
   * @param {number} durationMs - Request duration in milliseconds
   */
  recordRequest(route, method, statusCode, durationMs) {
    this._requestsTotal++;
    const isError = statusCode >= 400;
    if (isError) this._errorsTotal++;

    let entry = this._routes.get(route);
    if (!entry) {
      entry = { count: 0, errorCount: 0, durations: [] };
      this._routes.set(route, entry);
    }

    entry.count++;
    if (isError) entry.errorCount++;
    this.#pushRing(entry.durations, durationMs);
  }

  /**
   * Record an Oracle DB query for dependency metrics.
   *
   * @param {string}  poolName   - Named connection pool (e.g. "userAccount")
   * @param {number}  durationMs - Query round-trip duration in milliseconds
   * @param {boolean} success    - Whether the query succeeded
   */
  recordDbQuery(poolName, durationMs, success) {
    let entry = this._oracle.get(poolName);
    if (!entry) {
      entry = { queryCount: 0, errorCount: 0, totalMs: 0, durations: [] };
      this._oracle.set(poolName, entry);
    }

    entry.queryCount++;
    entry.totalMs += durationMs;
    if (!success) entry.errorCount++;
    this.#pushRing(entry.durations, durationMs);
  }

  /**
   * Store a frontend web vital event.
   * Evicts oldest when buffer exceeds FRONTEND_VITALS_MAX.
   *
   * @param {string} name    - "LCP" | "CLS" | "FID" | "INP"
   * @param {number} value   - Metric value in the metric's native unit
   * @param {string} rating  - "good" | "needs-improvement" | "poor"
   * @param {object} [context={}] - Additional context from the client
   */
  recordFrontendVital(name, value, rating, context = {}) {
    if (this._frontendVitals.length >= FRONTEND_VITALS_MAX) {
      this._frontendVitals.shift();
    }
    this._frontendVitals.push({ name, value, rating, context, ts: new Date().toISOString() });
  }

  /**
   * Store a frontend JS error.
   * Evicts oldest when buffer exceeds FRONTEND_VITALS_MAX.
   *
   * @param {string} message  - Error message
   * @param {string} [stack]  - Error stack trace
   * @param {object} [context={}] - Additional context (page, userAgent, etc.)
   */
  recordFrontendError(message, stack = "", context = {}) {
    if (this._frontendErrors.length >= FRONTEND_VITALS_MAX) {
      this._frontendErrors.shift();
    }
    this._frontendErrors.push({ message, stack, context, ts: new Date().toISOString() });
  }

  // ========================================
  // PUBLIC SNAPSHOT
  // ========================================

  /**
   * Return a complete metrics snapshot.
   * Sorting ring buffers for percentile calculation is done on read, not on write,
   * to keep recordRequest() as fast as possible.
   *
   * @returns {{
   *   timestamp: string,
   *   uptime: number,
   *   red: Object.<string, { count: number, errorCount: number, errorRate: number, p50: number, p95: number, p99: number, avgMs: number }>,
   *   system: { cpu: object, memory: object, eventLoopLag: number, gc: object, handles: number, requests: number },
   *   dependencies: { oracle: Object.<string, { queryCount: number, errorCount: number, avgMs: number, p95Ms: number }> },
   *   totals: { requestsTotal: number, errorsTotal: number, errorRate: number },
   *   frontendVitals: Array,
   *   frontendErrors: Array
   * }}
   */
  getSnapshot() {
    // Build RED metrics per route
    const red = {};
    for (const [route, entry] of this._routes) {
      const sorted = [...entry.durations].sort((a, b) => a - b);
      const avg = sorted.length
        ? Math.round(sorted.reduce((s, v) => s + v, 0) / sorted.length)
        : 0;

      red[route] = {
        count: entry.count,
        errorCount: entry.errorCount,
        errorRate: entry.count ? entry.errorCount / entry.count : 0,
        p50: calcPercentile(sorted, 0.5),
        p95: calcPercentile(sorted, 0.95),
        p99: calcPercentile(sorted, 0.99),
        avgMs: avg,
      };
    }

    // Build Oracle dependency stats
    const oracleDeps = {};
    for (const [poolName, entry] of this._oracle) {
      const sorted = [...entry.durations].sort((a, b) => a - b);
      oracleDeps[poolName] = {
        queryCount: entry.queryCount,
        errorCount: entry.errorCount,
        avgMs: entry.queryCount
          ? Math.round(entry.totalMs / entry.queryCount)
          : 0,
        p95Ms: calcPercentile(sorted, 0.95),
        poolUtilization: null, // Placeholder — pool utilization requires OracleDB pool stats API
      };
    }

    return {
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      red,
      system: {
        cpu: { ...this._system.cpu },
        memory: { ...this._system.memory },
        eventLoopLag: this._system.eventLoopLag,
        gc: { ...this._system.gc },
        handles: this._system.handles,
        requests: this._system.requests,
      },
      dependencies: {
        oracle: oracleDeps,
      },
      totals: {
        requestsTotal: this._requestsTotal,
        errorsTotal: this._errorsTotal,
        errorRate: this._requestsTotal
          ? this._errorsTotal / this._requestsTotal
          : 0,
      },
      frontendVitals: [...this._frontendVitals],
      frontendErrors: [...this._frontendErrors],
    };
  }
}

// ─── Singleton export ─────────────────────────────────────────────────────────

const metricsStore = new MetricsStore();

module.exports = { MetricsStore, metricsStore };
