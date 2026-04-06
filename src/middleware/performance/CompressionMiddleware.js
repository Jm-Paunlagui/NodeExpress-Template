"use strict";

/**
 * @fileoverview Gzip compression middleware.
 * Skips responses smaller than 1 KB to avoid overhead.
 */

const compression = require("compression");

class CompressionMiddleware {
    constructor(options = {}) {
        this._compression = compression({
            level: options.level ?? 6,
            threshold: options.threshold ?? 1024,
            filter(req, res) {
                if (req.headers["x-no-compression"]) return false;
                return compression.filter(req, res);
            },
        });

        this.handle = this.handle.bind(this);
    }

    handle(req, res, next) {
        return this._compression(req, res, next);
    }
}

const defaultCompression = new CompressionMiddleware();
module.exports = { CompressionMiddleware, defaultCompression };
