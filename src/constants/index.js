"use strict";

/**
 * @fileoverview App-wide constants
 * @description HTTP status codes, app metadata, and re-exports of errors/responses.
 */

const HTTP_STATUS = {
    OK: 200,
    CREATED: 201,
    ACCEPTED: 202,
    NO_CONTENT: 204,
    MULTI_STATUS: 207,
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    CONFLICT: 409,
    METHOD_NOT_ALLOWED: 405,
    UNPROCESSABLE: 422,
    TOO_MANY_REQUESTS: 429,
    INTERNAL_SERVER_ERROR: 500,
    BAD_GATEWAY: 502,
    SERVICE_UNAVAILABLE: 503,
};

module.exports = {
    HTTP_STATUS,
    ...require("./errors"),
    ...require("./responses"),
};
