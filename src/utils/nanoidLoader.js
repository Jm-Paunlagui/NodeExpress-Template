"use strict";

/**
 * nanoid CJS shim.
 *
 * nanoid v5+ is ESM-only. This module provides a synchronous `nanoid(size)`
 * function for CommonJS code using Node's built-in `crypto` module —
 * no external dependency needed at runtime.
 */

const crypto = require("crypto");

const URL_ALPHABET =
    "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict";

/**
 * Generate a cryptographically strong random string.
 * @param {number} [size=21] - Length of the ID
 * @returns {string}
 */
function nanoid(size = 21) {
    const bytes = crypto.randomBytes(size);
    let id = "";
    for (let i = 0; i < size; i++) {
        id += URL_ALPHABET[bytes[i] & 63];
    }
    return id;
}

module.exports = { nanoid };
