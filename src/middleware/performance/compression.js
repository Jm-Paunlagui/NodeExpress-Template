"use strict";

const compression = require("compression");

/**
 * Compression middleware (gzip / deflate).
 * Skips responses smaller than 1 KB to avoid overhead.
 */
module.exports = compression({
    level: 6,
    threshold: 1024, // 1 KB
    filter(req, res) {
        if (req.headers["x-no-compression"]) return false;
        return compression.filter(req, res);
    },
});
