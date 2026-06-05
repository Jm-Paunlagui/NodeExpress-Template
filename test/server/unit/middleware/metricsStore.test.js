"use strict";

/**
 * Unit tests for the MetricsStore RED three-bucket model.
 *
 * Focus: the availability / error-rate computation must EXCLUDE client errors
 * (4xx) and count only successes (2xx/3xx) and server errors (5xx). These tests
 * pin the status-code classification boundaries (399/400/499/500) and the
 * complementary identity availability === 1 - errorRate.
 */

const { expect } = require("chai");
const {
    MetricsStore,
    computeRates,
    CLIENT_ERROR_MIN_STATUS,
    SERVER_ERROR_MIN_STATUS,
} = require("../../../../src/middleware/metrics/MetricsStore");

// A tiny tolerance for floating-point ratio comparisons.
const EPSILON = 1e-9;

describe("MetricsStore — RED three-bucket model", function () {
    describe("status-code boundary constants", function () {
        it("classifies 4xx as client and 5xx as server", function () {
            expect(CLIENT_ERROR_MIN_STATUS).to.equal(400);
            expect(SERVER_ERROR_MIN_STATUS).to.equal(500);
        });
    });

    describe("computeRates() — pure rate math", function () {
        it("returns 100% availability and 0 error rates for an empty store", function () {
            const r = computeRates(0, 0, 0);
            expect(r.availability).to.equal(1);
            expect(r.errorRate).to.equal(0);
            expect(r.clientErrorRate).to.equal(0);
        });

        it("treats an all-success workload as fully available", function () {
            const r = computeRates(10, 0, 0);
            expect(r.availability).to.equal(1);
            expect(r.errorRate).to.equal(0);
            expect(r.clientErrorRate).to.equal(0);
        });

        it("EXCLUDES client errors from availability and error rate", function () {
            // 10 requests, all 4xx: service rejected bad input correctly.
            const r = computeRates(10, 10, 0);
            expect(r.availability).to.equal(1); // serviced denominator is 0 → fully available
            expect(r.errorRate).to.equal(0);
            expect(r.clientErrorRate).to.equal(1); // but still 100% visible in its own lane
        });

        it("counts server errors fully against availability", function () {
            const r = computeRates(10, 0, 10);
            expect(r.availability).to.equal(0);
            expect(r.errorRate).to.equal(1);
            expect(r.clientErrorRate).to.equal(0);
        });

        it("computes a mixed workload with 4xx removed from the denominator", function () {
            // 8 success, 1 client (4xx), 1 server (5xx) → serviced = 9
            const r = computeRates(10, 1, 1);
            expect(r.availability).to.be.closeTo(8 / 9, EPSILON);
            expect(r.errorRate).to.be.closeTo(1 / 9, EPSILON);
            expect(r.clientErrorRate).to.be.closeTo(1 / 10, EPSILON);
        });

        it("guarantees the identity availability === 1 - errorRate", function () {
            const r = computeRates(100, 17, 6); // arbitrary mix
            expect(r.availability + r.errorRate).to.be.closeTo(1, EPSILON);
        });
    });

    describe("recordRequest() — classification boundaries", function () {
        let store;
        beforeEach(function () {
            store = new MetricsStore();
        });

        function rate(statusCode) {
            store.recordRequest("GET /x", "GET", statusCode, 5);
            return store.getSnapshot().totals;
        }

        it("classifies 399 as success (not an error)", function () {
            const t = rate(399);
            expect(t.serverErrorsTotal).to.equal(0);
            expect(t.clientErrorsTotal).to.equal(0);
            expect(t.availability).to.equal(1);
        });

        it("classifies 400 as a client error", function () {
            const t = rate(400);
            expect(t.clientErrorsTotal).to.equal(1);
            expect(t.serverErrorsTotal).to.equal(0);
            expect(t.availability).to.equal(1); // 4xx excluded
            expect(t.clientErrorRate).to.equal(1);
        });

        it("classifies 499 as a client error", function () {
            const t = rate(499);
            expect(t.clientErrorsTotal).to.equal(1);
            expect(t.serverErrorsTotal).to.equal(0);
        });

        it("classifies 500 as a server error", function () {
            const t = rate(500);
            expect(t.serverErrorsTotal).to.equal(1);
            expect(t.clientErrorsTotal).to.equal(0);
            expect(t.availability).to.equal(0);
            expect(t.errorRate).to.equal(1);
        });
    });

    describe("getSnapshot() — per-route and global aggregation", function () {
        let store;
        beforeEach(function () {
            store = new MetricsStore();
        });

        it("exposes the three buckets and derived rates per route", function () {
            // 8×200, 1×404, 1×503 on one route
            for (let i = 0; i < 8; i++) store.recordRequest("GET /a", "GET", 200, 5);
            store.recordRequest("GET /a", "GET", 404, 5);
            store.recordRequest("GET /a", "GET", 503, 5);

            const m = store.getSnapshot().red["GET /a"];
            expect(m.count).to.equal(10);
            expect(m.clientErrorCount).to.equal(1);
            expect(m.serverErrorCount).to.equal(1);
            expect(m.availability).to.be.closeTo(8 / 9, EPSILON);
            expect(m.errorRate).to.be.closeTo(1 / 9, EPSILON);
            expect(m.clientErrorRate).to.be.closeTo(1 / 10, EPSILON);
        });

        it("aggregates totals across routes with 4xx excluded from availability", function () {
            store.recordRequest("GET /a", "GET", 200, 5);
            store.recordRequest("GET /b", "GET", 403, 5); // client — excluded
            store.recordRequest("GET /c", "GET", 500, 5); // server — counts

            const t = store.getSnapshot().totals;
            expect(t.requestsTotal).to.equal(3);
            expect(t.clientErrorsTotal).to.equal(1);
            expect(t.serverErrorsTotal).to.equal(1);
            // serviced = 3 - 1 = 2; availability = (2 - 1) / 2 = 0.5
            expect(t.availability).to.be.closeTo(0.5, EPSILON);
            expect(t.errorRate).to.be.closeTo(0.5, EPSILON);
            expect(t.clientErrorRate).to.be.closeTo(1 / 3, EPSILON);
        });
    });
});
