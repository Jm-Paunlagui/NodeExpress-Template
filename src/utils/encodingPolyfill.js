"use strict";

/**
 * @fileoverview Encoding polyfills for PKG-compiled executables.
 * Must be loaded FIRST in server.js — before any other require().
 *
 * PKG's bundled Node runtime doesn't ship every ICU encoding.
 * This module patches TextDecoder and Buffer.from to remap
 * unsupported labels (ascii, binary, us-ascii) to safe equivalents.
 */

const isCompiled = typeof process.pkg !== "undefined";

if (isCompiled) {
    // Save originals before patching
    const OriginalTextDecoder = global.TextDecoder;

    const ENCODING_MAP = {
        ascii: "utf-8",
        binary: "latin1",
        "us-ascii": "utf-8",
    };

    global.TextDecoder = class TextDecoder {
        constructor(encoding = "utf-8", options = {}) {
            const mapped = ENCODING_MAP[encoding.toLowerCase()] || encoding;
            try {
                this._decoder = new OriginalTextDecoder(mapped, options);
                this.encoding = mapped;
            } catch {
                this._decoder = new OriginalTextDecoder("utf-8", options);
                this.encoding = "utf-8";
            }
        }
        decode(input, options) {
            return this._decoder.decode(input, options);
        }
    };

    const originalBufferFrom = Buffer.from;
    Buffer.from = function (data, encoding, ...rest) {
        if (typeof encoding === "string") {
            const mapped = ENCODING_MAP[encoding.toLowerCase()] || encoding;
            try {
                return originalBufferFrom.call(this, data, mapped, ...rest);
            } catch {
                return originalBufferFrom.call(this, data, "utf-8", ...rest);
            }
        }
        return originalBufferFrom.call(this, data, encoding, ...rest);
    };
}

module.exports = { isCompiled };
