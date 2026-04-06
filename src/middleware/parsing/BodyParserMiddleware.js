"use strict";

/**
 * @fileoverview Body parsing middleware — JSON + URL-encoded.
 * Limits payload size to prevent abuse.
 */

const bodyParser = require("body-parser");

class BodyParserMiddleware {
    constructor(options = {}) {
        this._limit = options.limit ?? process.env.BODY_LIMIT ?? "10mb";

        this._jsonParser = bodyParser.json({ limit: this._limit });
        this._urlencodedParser = bodyParser.urlencoded({
            extended: true,
            limit: this._limit,
        });
    }

    get jsonHandler() {
        return this._jsonParser;
    }

    get urlencodedHandler() {
        return this._urlencodedParser;
    }
}

const defaultBodyParser = new BodyParserMiddleware();
module.exports = { BodyParserMiddleware, defaultBodyParser };
