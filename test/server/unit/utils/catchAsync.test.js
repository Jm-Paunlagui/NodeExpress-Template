"use strict";

const { expect } = require("chai");
const { catchAsync } = require("../../../../src/utils/catchAsync");

describe("catchAsync", function () {
    function mockReq() {
        return { method: "GET", path: "/test" };
    }

    function mockRes() {
        return {
            status(code) {
                this._status = code;
                return this;
            },
            json(body) {
                this._body = body;
                return this;
            },
        };
    }

    it("returns a function", function () {
        const wrapped = catchAsync(async () => {});
        expect(wrapped).to.be.a("function");
    });

    it("calls the wrapped function with req, res, next", function (done) {
        const req = mockReq();
        const res = mockRes();

        const wrapped = catchAsync(async (r, s, n) => {
            expect(r).to.equal(req);
            expect(s).to.equal(res);
            done();
        });

        wrapped(req, res, () => {});
    });

    it("calls next() with the error when the async function rejects", function (done) {
        const error = new Error("test failure");

        const wrapped = catchAsync(async () => {
            throw error;
        });

        wrapped(mockReq(), mockRes(), (err) => {
            expect(err).to.equal(error);
            done();
        });
    });

    it("does not call next() when the async function resolves", function (done) {
        const wrapped = catchAsync(async (req, res) => {
            res.json({ ok: true });
        });

        const res = mockRes();
        let nextCalled = false;

        wrapped(mockReq(), res, () => {
            nextCalled = true;
        });

        setTimeout(() => {
            expect(nextCalled).to.be.false;
            expect(res._body).to.deep.equal({ ok: true });
            done();
        }, 20);
    });

    it("handles synchronous functions that return a value", function (done) {
        const wrapped = catchAsync((req, res) => {
            res.json({ sync: true });
        });

        const res = mockRes();
        wrapped(mockReq(), res, (err) => {
            done(new Error("next should not be called"));
        });

        setTimeout(() => {
            expect(res._body).to.deep.equal({ sync: true });
            done();
        }, 20);
    });

    it("forwards synchronous throws to next()", function (done) {
        const error = new Error("sync throw");
        const wrapped = catchAsync(() => {
            throw error;
        });

        wrapped(mockReq(), mockRes(), (err) => {
            expect(err).to.equal(error);
            done();
        });
    });
});
