"use strict";

const { expect } = require("chai");
const {
    parseFilter,
    resetBindCounter,
} = require("../../../../src/utils/oracle-mongo-wrapper/parsers/filterParser");

describe("filterParser — parseFilter", function () {
    describe("empty / null filter", function () {
        it("returns empty whereClause for null", function () {
            const { whereClause, binds } = parseFilter(null);
            expect(whereClause).to.equal("");
            expect(binds).to.deep.equal({});
        });

        it("returns empty whereClause for undefined", function () {
            const { whereClause, binds } = parseFilter(undefined);
            expect(whereClause).to.equal("");
            expect(binds).to.deep.equal({});
        });

        it("returns empty whereClause for empty object", function () {
            const { whereClause, binds } = parseFilter({});
            expect(whereClause).to.equal("");
            expect(binds).to.deep.equal({});
        });
    });

    describe("equality (implicit $eq)", function () {
        it("produces WHERE with = for a string value", function () {
            const { whereClause, binds } = parseFilter({ status: "active" });
            expect(whereClause).to.include("WHERE");
            expect(whereClause).to.include('"status"');
            expect(whereClause).to.include("=");
            expect(Object.values(binds)).to.include("active");
        });

        it("produces WHERE with = for a numeric value", function () {
            const { whereClause, binds } = parseFilter({ age: 25 });
            expect(whereClause).to.include('"age"');
            expect(Object.values(binds)).to.include(25);
        });

        it("produces IS NULL for null value", function () {
            const { whereClause } = parseFilter({ status: null });
            expect(whereClause).to.include("IS NULL");
        });
    });

    describe("comparison operators", function () {
        it("$gt produces >", function () {
            const { whereClause, binds } = parseFilter({ age: { $gt: 18 } });
            expect(whereClause).to.include('"age" >');
            expect(Object.values(binds)).to.include(18);
        });

        it("$gte produces >=", function () {
            const { whereClause } = parseFilter({ age: { $gte: 18 } });
            expect(whereClause).to.include('"age" >=');
        });

        it("$lt produces <", function () {
            const { whereClause } = parseFilter({ age: { $lt: 65 } });
            expect(whereClause).to.include('"age" <');
        });

        it("$lte produces <=", function () {
            const { whereClause } = parseFilter({ age: { $lte: 65 } });
            expect(whereClause).to.include('"age" <=');
        });

        it("$ne produces <>", function () {
            const { whereClause } = parseFilter({ status: { $ne: "deleted" } });
            expect(whereClause).to.include('"status" <>');
        });

        it("$eq produces =", function () {
            const { whereClause } = parseFilter({ status: { $eq: "active" } });
            expect(whereClause).to.include('"status" =');
        });
    });

    describe("$in / $nin", function () {
        it("$in produces IN clause", function () {
            const { whereClause, binds } = parseFilter({
                role: { $in: ["admin", "user"] },
            });
            expect(whereClause).to.include("IN (");
            expect(Object.values(binds)).to.include("admin");
            expect(Object.values(binds)).to.include("user");
        });

        it("$in with empty array produces 1=0 (always false)", function () {
            const { whereClause } = parseFilter({ role: { $in: [] } });
            expect(whereClause).to.include("1=0");
        });

        it("$nin produces NOT IN clause", function () {
            const { whereClause } = parseFilter({ role: { $nin: ["banned"] } });
            expect(whereClause).to.include("NOT IN");
        });

        it("$nin with empty array produces 1=1 (always true)", function () {
            const { whereClause } = parseFilter({ role: { $nin: [] } });
            expect(whereClause).to.include("1=1");
        });
    });

    describe("$between / $notBetween", function () {
        it("$between produces BETWEEN clause", function () {
            const { whereClause, binds } = parseFilter({
                age: { $between: [18, 65] },
            });
            expect(whereClause).to.include("BETWEEN");
            expect(whereClause).to.include("AND");
            expect(Object.values(binds)).to.include(18);
            expect(Object.values(binds)).to.include(65);
        });

        it("$notBetween produces NOT BETWEEN clause", function () {
            const { whereClause } = parseFilter({
                age: { $notBetween: [0, 17] },
            });
            expect(whereClause).to.include("NOT BETWEEN");
        });
    });

    describe("$exists", function () {
        it("$exists: true produces IS NOT NULL", function () {
            const { whereClause } = parseFilter({ email: { $exists: true } });
            expect(whereClause).to.include("IS NOT NULL");
        });

        it("$exists: false produces IS NULL", function () {
            const { whereClause } = parseFilter({ email: { $exists: false } });
            expect(whereClause).to.include("IS NULL");
        });
    });

    describe("$regex", function () {
        it("produces REGEXP_LIKE", function () {
            const { whereClause, binds } = parseFilter({
                name: { $regex: "^J" },
            });
            expect(whereClause).to.include("REGEXP_LIKE");
            expect(Object.values(binds)).to.include("^J");
        });
    });

    describe("$like", function () {
        it("produces LIKE clause", function () {
            const { whereClause, binds } = parseFilter({
                name: { $like: "%Juan%" },
            });
            expect(whereClause).to.include("LIKE");
            expect(Object.values(binds)).to.include("%Juan%");
        });
    });

    describe("logical operators", function () {
        it("$or produces OR-joined conditions", function () {
            const { whereClause, binds } = parseFilter({
                $or: [{ status: "active" }, { role: "admin" }],
            });
            expect(whereClause).to.include("OR");
            expect(Object.values(binds)).to.include("active");
            expect(Object.values(binds)).to.include("admin");
        });

        it("$and produces AND-joined conditions", function () {
            const { whereClause } = parseFilter({
                $and: [{ status: "active" }, { age: { $gte: 18 } }],
            });
            expect(whereClause).to.include("AND");
        });

        it("$nor produces NOT (... OR ...)", function () {
            const { whereClause } = parseFilter({
                $nor: [{ status: "deleted" }, { status: "banned" }],
            });
            expect(whereClause).to.include("NOT (");
            expect(whereClause).to.include("OR");
        });

        it("$not produces NOT (...)", function () {
            const { whereClause } = parseFilter({
                $not: { status: "deleted" },
            });
            expect(whereClause).to.include("NOT (");
        });
    });

    describe("multiple fields (implicit AND)", function () {
        it("joins multiple field conditions with AND", function () {
            const { whereClause, binds } = parseFilter({
                status: "active",
                age: { $gte: 18 },
            });
            expect(whereClause).to.include("AND");
            expect(Object.values(binds)).to.include("active");
            expect(Object.values(binds)).to.include(18);
        });
    });

    describe("multiple operators on one field", function () {
        it("wraps in parentheses with AND", function () {
            const { whereClause, binds } = parseFilter({
                age: { $gte: 18, $lt: 65 },
            });
            expect(whereClause).to.include("(");
            expect(whereClause).to.include("AND");
            expect(Object.values(binds)).to.include(18);
            expect(Object.values(binds)).to.include(65);
        });
    });

    describe("bind variable isolation (concurrency safety)", function () {
        it("two separate calls produce independent bind names", function () {
            const r1 = parseFilter({ status: "a" });
            const r2 = parseFilter({ status: "b" });
            // Both should start from _0 since counters are per-call
            const keys1 = Object.keys(r1.binds);
            const keys2 = Object.keys(r2.binds);
            expect(keys1[0]).to.match(/_0$/);
            expect(keys2[0]).to.match(/_0$/);
        });
    });

    describe("resetBindCounter", function () {
        it("is a no-op and does not throw", function () {
            expect(() => resetBindCounter()).to.not.throw();
        });
    });

    describe("$exists (top-level subquery)", function () {
        it("produces EXISTS (SELECT 1 FROM ...)", function () {
            const { whereClause } = parseFilter({
                $exists: { collection: "ORDERS", match: { status: "active" } },
            });
            expect(whereClause).to.include("EXISTS (SELECT 1 FROM");
        });
    });

    describe("$notExists (top-level subquery)", function () {
        it("produces NOT EXISTS (SELECT 1 FROM ...)", function () {
            const { whereClause } = parseFilter({
                $notExists: {
                    collection: "ORDERS",
                    match: { status: "cancelled" },
                },
            });
            expect(whereClause).to.include("NOT EXISTS (SELECT 1 FROM");
        });
    });
});
