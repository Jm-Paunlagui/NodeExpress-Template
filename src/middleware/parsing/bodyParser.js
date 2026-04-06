"use strict";

const bodyParser = require("body-parser");

/**
 * Body parsing middleware — JSON + URL-encoded.
 * Limits payload size to prevent abuse.
 */
const jsonParser = bodyParser.json({
    limit: process.env.BODY_LIMIT || "10mb",
});

const urlencodedParser = bodyParser.urlencoded({
    extended: true,
    limit: process.env.BODY_LIMIT || "10mb",
});

module.exports = { jsonParser, urlencodedParser };
