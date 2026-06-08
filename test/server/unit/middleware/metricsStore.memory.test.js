"use strict";

/**
 * Unit tests for MetricsStore — the memory & GC instrumentation.
 *
 * Companion to metricsStore.test.js (which pins the RED model). This file covers
 * the leak-detection / GC-health additions:
 *   - heapSizeLimit (the real V8 ceiling) is captured in the snapshot
 *   - GC events are bucketed by kind and per-kind counts reconcile with the total
 *   - recent GC pause stats are computed
 *   - the post-major-GC heap-baseline trend ("leak detector") behaves
 *   - linRegSlope math is correct (the engine behind leak detection)
 *
 * Fresh MetricsStore instances are used per test (the class is exported beside
 * the singleton). Background timers are unref'd, so they never keep mocha alive.
 */

const { expect } = require("chai");
const {
  MetricsStore,
  linRegSlope,
  calcPercentile,
  GC_KIND,
} = require("../../../../src/middleware/metrics/MetricsStore");

describe("MetricsStore — memory & GC instrumentation", function () {
  describe("linRegSlope() — leak-trend regression engine", function () {
    it("returns 0 for fewer than two points (undeterminable)", function () {
      expect(linRegSlope([], [])).to.equal(0);
      expect(linRegSlope([1], [10])).to.equal(0);
    });

    it("returns ~0 for a flat series (no growth = no leak)", function () {
      expect(linRegSlope([0, 1000, 2000, 3000, 4000], [50, 50, 50, 50, 50])).to.be.closeTo(0, 1e-9);
    });

    it("returns a positive slope for a rising series (leak signature)", function () {
      expect(linRegSlope([0, 1000, 2000, 3000], [100, 200, 300, 400])).to.be.closeTo(0.1, 1e-9);
    });

    it("returns a negative slope for a falling series (healthy reclaim)", function () {
      expect(linRegSlope([0, 1000, 2000, 3000], [400, 300, 200, 100])).to.be.closeTo(-0.1, 1e-9);
    });

    it("returns 0 when all x values are identical (zero-denominator guard)", function () {
      expect(linRegSlope([5, 5, 5], [1, 2, 3])).to.equal(0);
    });
  });

  describe("getSnapshot() — memory shape", function () {
    let store;
    beforeEach(function () {
      store = new MetricsStore();
    });

    it("exposes heapSizeLimit — the real ceiling, not heapTotal", function () {
      const { memory } = store.getSnapshot().system;
      expect(memory).to.have.property("heapSizeLimit").that.is.a("number");
      expect(memory.heapSizeLimit).to.be.greaterThan(memory.heapTotal);
      expect(memory.heapSizeLimit).to.be.greaterThan(0);
    });

    it("includes heapUsed, heapTotal, rss, external, arrayBuffers", function () {
      const { memory } = store.getSnapshot().system;
      ["heapUsed", "heapTotal", "rss", "external", "arrayBuffers"].forEach((k) =>
        expect(memory).to.have.property(k).that.is.a("number"),
      );
    });
  });

  describe("getSnapshot() — GC breakdown", function () {
    let store;
    beforeEach(function () {
      store = new MetricsStore();
    });

    it("exposes per-kind buckets, overhead, and recent stats", function () {
      const { gc } = store.getSnapshot().system;
      ["major", "minor", "incremental", "weakcb"].forEach((kind) => {
        expect(gc[kind]).to.include.keys("count", "pauseMs");
      });
      expect(gc).to.have.property("overheadPct").that.is.a("number");
      expect(gc.recent).to.include.keys("sampleCount", "avgPauseMs", "maxPauseMs", "p95PauseMs");
    });

    it("per-kind collection counts always reconcile with the total (invariant)", function () {
      let churn = [];
      for (let i = 0; i < 1_000_000; i++) churn.push({ i, s: String(i) });
      churn = null; // drop the reference so collection is possible

      return new Promise((resolve) => {
        setTimeout(() => {
          const { gc } = store.getSnapshot().system;
          const sumByKind = gc.major.count + gc.minor.count + gc.incremental.count + gc.weakcb.count;
          expect(sumByKind).to.equal(gc.collections);
          expect(gc.pauseMs).to.be.at.least(0);
          resolve();
        }, 50);
      });
    });

    it("GC_KIND maps to the documented V8 codes", function () {
      expect(GC_KIND).to.deep.equal({ MINOR: 1, MAJOR: 4, INCREMENTAL: 8, WEAKCB: 16 });
    });
  });

  describe("memoryTrend — leak detector", function () {
    let store;
    beforeEach(function () {
      store = new MetricsStore();
    });

    it('reports "gathering data" (not suspected) with too few baselines', function () {
      store._heapBaselines = [{ ts: Date.now(), heapUsed: 100 * 1024 * 1024 }];
      const trend = store.getSnapshot().system.memoryTrend;
      expect(trend.suspected).to.equal(false);
      expect(trend.sampleCount).to.equal(1);
    });

    it("does NOT flag a flat post-GC baseline over a long window", function () {
      const now = Date.now();
      const base = 120 * 1024 * 1024;
      store._heapBaselines = Array.from({ length: 12 }, (_, i) => ({
        ts: now - (11 - i) * 60_000,
        heapUsed: base + (i % 2) * 1024,
      }));
      const trend = store.getSnapshot().system.memoryTrend;
      expect(trend.suspected).to.equal(false);
      expect(Math.abs(trend.growthBytesPerMin)).to.be.lessThan(512 * 1024);
    });

    it("flags a sustained upward post-GC baseline as a suspected leak", function () {
      const now = Date.now();
      const base = 100 * 1024 * 1024;
      store._heapBaselines = Array.from({ length: 12 }, (_, i) => ({
        ts: now - (11 - i) * 60_000,
        heapUsed: base + i * 5 * 1024 * 1024,
      }));
      const trend = store.getSnapshot().system.memoryTrend;
      expect(trend.suspected).to.equal(true);
      expect(trend.growthBytesPerMin).to.be.greaterThan(512 * 1024);
      expect(trend.lastHeapUsed).to.be.greaterThan(trend.firstHeapUsed);
    });

    it("does NOT flag rapid growth over too SHORT a window (warmup guard)", function () {
      const now = Date.now();
      const base = 100 * 1024 * 1024;
      store._heapBaselines = Array.from({ length: 10 }, (_, i) => ({
        ts: now - (9 - i) * 10_000,
        heapUsed: base + i * 20 * 1024 * 1024,
      }));
      expect(store.getSnapshot().system.memoryTrend.suspected).to.equal(false);
    });
  });

  describe("recent GC pause percentile helper", function () {
    it("calcPercentile returns the high-end sample for p95", function () {
      const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      expect(calcPercentile(sorted, 0.95)).to.equal(10);
      expect(calcPercentile(sorted, 0.5)).to.equal(6);
      expect(calcPercentile([], 0.95)).to.equal(0);
    });
  });
});
