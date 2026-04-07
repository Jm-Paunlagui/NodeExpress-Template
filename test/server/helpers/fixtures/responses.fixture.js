"use strict";

/**
 * Expected response shapes for assertions.
 */

const SUCCESS_SHAPE = {
    status: "success",
    code: Number,
    message: String,
    data: Object,
};

const ERROR_SHAPE = {
    status: "error",
    code: Number,
    message: String,
    error: {
        type: String,
    },
};

/**
 * Assert that a response body matches the success shape.
 * @param {Object} body - Response body to check
 * @param {Function} expect - Chai expect function
 */
function assertSuccessShape(body, expect) {
    expect(body).to.have.property("status", "success");
    expect(body).to.have.property("code").that.is.a("number");
    expect(body).to.have.property("message").that.is.a("string");
    expect(body).to.have.property("data");
}

/**
 * Assert that a response body matches the error shape.
 * @param {Object} body - Response body to check
 * @param {Function} expect - Chai expect function
 */
function assertErrorShape(body, expect) {
    expect(body).to.have.property("status", "error");
    expect(body).to.have.property("code").that.is.a("number");
    expect(body).to.have.property("message").that.is.a("string");
    expect(body)
        .to.have.property("error")
        .that.has.property("type")
        .that.is.a("string");
}

module.exports = {
    SUCCESS_SHAPE,
    ERROR_SHAPE,
    assertSuccessShape,
    assertErrorShape,
};
