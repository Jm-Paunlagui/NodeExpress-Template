"use strict";

const { expect } = require("chai");
const {
    parseUpdate,
    resetUpdateCounter,
} = require("../../../../src/utils/oracle-mongo-wrapper/parsers/updateParser");

describe("updateParser — parseUpdate", function () {
    describe("validation", function () {
        it("throws when update is null", function () {
            expect(() => parseUpdate(null)).to.throw();
        });

        it("throws when update is undefined", function () {
            expect(() => parseUpdate(undefined)).to.throw();
        });

        it("throws when update is empty object", function () {
            expect(() => parseUpdate({})).to.throw();
        });

        it("throws when update has no $ operators", function () {
            expect(() => parseUpdate({ name: "Ana" })).to.throw();
        });
    });

    describe("$set", function () {
        it("produces SET clause for a single field", function () {
            const { setClause, binds } = parseUpdate({ $set: { name: "Ana" } });
            expect(setClause).to.include("SET");
            expect(setClause).to.include('"name"');
            expect(Object.values(binds)).to.include("Ana");
        });

        it("produces SET clause for multiple fields", function () {
            const { setClause, binds } = parseUpdate({
                $set: { name: "Ana", status: "active" },
            });
            expect(setClause).to.include('"name"');
            expect(setClause).to.include('"status"');
            expect(Object.values(binds)).to.include("Ana");
            expect(Object.values(binds)).to.include("active");
        });

        it("handles numeric values", function () {
            const { setClause, binds } = parseUpdate({ $set: { age: 25 } });
            expect(setClause).to.include('"age"');
            expect(Object.values(binds)).to.include(25);
        });

        it("handles null values", function () {
            const { setClause, binds } = parseUpdate({ $set: { email: null } });
            expect(setClause).to.include('"email"');
            expect(Object.values(binds)).to.include(null);
        });
    });

    describe("$unset", function () {
        it("produces SET field = NULL", function () {
            const { setClause, binds } = parseUpdate({ $unset: { temp: 1 } });
            expect(setClause).to.include('"temp" = NULL');
            expect(Object.keys(binds).length).to.equal(0);
        });

        it("handles multiple fields", function () {
            const { setClause } = parseUpdate({
                $unset: { temp: 1, cache: 1 },
            });
            expect(setClause).to.include('"temp" = NULL');
            expect(setClause).to.include('"cache" = NULL');
        });
    });

    describe("$inc", function () {
        it("produces field = field + :val", function () {
            const { setClause, binds } = parseUpdate({
                $inc: { loginCount: 1 },
            });
            expect(setClause).to.include('"loginCount" = "loginCount" +');
            expect(Object.values(binds)).to.include(1);
        });

        it("handles negative increments (decrement)", function () {
            const { setClause, binds } = parseUpdate({ $inc: { score: -5 } });
            expect(setClause).to.include('"score" = "score" +');
            expect(Object.values(binds)).to.include(-5);
        });
    });

    describe("$mul", function () {
        it("produces field = field * :val", function () {
            const { setClause, binds } = parseUpdate({ $mul: { price: 1.1 } });
            expect(setClause).to.include('"price" = "price" *');
            expect(Object.values(binds)).to.include(1.1);
        });
    });

    describe("$min", function () {
        it("produces LEAST(field, :val)", function () {
            const { setClause, binds } = parseUpdate({ $min: { score: 50 } });
            expect(setClause).to.include("LEAST(");
            expect(Object.values(binds)).to.include(50);
        });
    });

    describe("$max", function () {
        it("produces GREATEST(field, :val)", function () {
            const { setClause, binds } = parseUpdate({ $max: { score: 100 } });
            expect(setClause).to.include("GREATEST(");
            expect(Object.values(binds)).to.include(100);
        });
    });

    describe("$currentDate", function () {
        it("produces field = SYSDATE", function () {
            const { setClause, binds } = parseUpdate({
                $currentDate: { updatedAt: true },
            });
            expect(setClause).to.include('"updatedAt" = SYSDATE');
            expect(Object.keys(binds).length).to.equal(0);
        });
    });

    describe("$rename", function () {
        it("throws an error (not supported by Oracle)", function () {
            expect(() =>
                parseUpdate({ $rename: { oldField: "newField" } }),
            ).to.throw();
        });
    });

    describe("unsupported operator", function () {
        it("throws for unknown operators", function () {
            expect(() => parseUpdate({ $push: { arr: "val" } })).to.throw();
        });
    });

    describe("combined operators", function () {
        it("handles $set + $inc together", function () {
            const { setClause, binds } = parseUpdate({
                $set: { name: "Ana" },
                $inc: { loginCount: 1 },
            });
            expect(setClause).to.include('"name"');
            expect(setClause).to.include('"loginCount" = "loginCount" +');
            expect(Object.values(binds)).to.include("Ana");
            expect(Object.values(binds)).to.include(1);
        });

        it("handles $set + $currentDate together", function () {
            const { setClause } = parseUpdate({
                $set: { status: "active" },
                $currentDate: { updatedAt: true },
            });
            expect(setClause).to.include('"status"');
            expect(setClause).to.include("SYSDATE");
        });
    });

    describe("bind variable naming", function () {
        it("uses upd_ prefix for bind variables", function () {
            const { binds } = parseUpdate({ $set: { name: "Ana" } });
            const key = Object.keys(binds)[0];
            expect(key).to.match(/^upd_/);
        });

        it("two separate calls produce independent bind names", function () {
            const r1 = parseUpdate({ $set: { a: 1 } });
            const r2 = parseUpdate({ $set: { a: 2 } });
            const k1 = Object.keys(r1.binds)[0];
            const k2 = Object.keys(r2.binds)[0];
            expect(k1).to.match(/_0$/);
            expect(k2).to.match(/_0$/);
        });
    });

    describe("resetUpdateCounter", function () {
        it("is a no-op and does not throw", function () {
            expect(() => resetUpdateCounter()).to.not.throw();
        });
    });
});
