"use strict";

/**
 * @fileoverview Cookie parsing middleware.
 * Uses COOKIE_SECRET env var for signed cookies when available.
 */

const cookieParser = require("cookie-parser");

class CookieParserMiddleware {
    constructor(options = {}) {
        this._secret = options.secret ?? process.env.COOKIE_SECRET ?? undefined;
        this._parser = cookieParser(this._secret); // lgtm[js/missing-csrf-middleware] CSRF is enforced by CsrfMiddleware (csrf-csrf) in the app middleware stack

        this.handle = this.handle.bind(this);
    }

    handle(req, res, next) {
        return this._parser(req, res, next);
    }
}

const defaultCookieParser = new CookieParserMiddleware();
module.exports = { CookieParserMiddleware, defaultCookieParser };
