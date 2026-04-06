"use strict";

const cookieParser = require("cookie-parser");

/**
 * Cookie parsing middleware.
 * Uses COOKIE_SECRET env var for signed cookies when available.
 */
module.exports = cookieParser(process.env.COOKIE_SECRET || undefined);
