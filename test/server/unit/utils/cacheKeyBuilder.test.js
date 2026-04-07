"use strict";

const { expect } = require("chai");
const {
    CacheKeyBuilder,
} = require("../../../../src/middleware/cache/CacheKeyBuilder");

describe("CacheKeyBuilder", function () {
    it("produces the same key regardless of parameter insertion order", function () {
        const k1 = CacheKeyBuilder.build("users", {
            division: "WH",
            year: 2025,
            month: 1,
        });
        const k2 = CacheKeyBuilder.build("users", {
            month: 1,
            year: 2025,
            division: "WH",
        });
        expect(k1).to.equal(k2);
    });

    it('normalises null and undefined values to the string "null"', function () {
        const k = CacheKeyBuilder.build("users", {
            division: null,
            year: undefined,
        });
        expect(k).to.include("division=null");
        expect(k).to.include("year=null");
    });

    it("sorts array parameters before joining", function () {
        const k1 = CacheKeyBuilder.build("ids", { ids: [3, 1, 2] });
        const k2 = CacheKeyBuilder.build("ids", { ids: [2, 3, 1] });
        expect(k1).to.equal(k2);
    });

    it("hashes keys longer than 200 characters", function () {
        const longParams = {};
        for (let i = 0; i < 30; i++) longParams[`param${i}`] = `value${i}`;
        const key = CacheKeyBuilder.build("prefix", longParams);
        expect(key.length).to.be.lessThan(220); // hashed — never obscenely long
        expect(key).to.include("h=");
    });

    it("throws TypeError when prefix is empty", function () {
        expect(() => new CacheKeyBuilder("")).to.throw(TypeError);
        expect(() => new CacheKeyBuilder(null)).to.throw(TypeError);
    });

    it("fluent builder and static build() produce identical keys", function () {
        const fluent = CacheKeyBuilder.of("report")
            .param("year", 2025)
            .param("month", 3)
            .build();
        const stat = CacheKeyBuilder.build("report", { year: 2025, month: 3 });
        expect(fluent).to.equal(stat);
    });
});
