"use strict";

const { nanoid } = require("../../utils/nanoidLoader");

/**
 * Middleware that prevents HTTP redirects and converts them to JSON responses.
 * Overrides res.redirect to return a JSON response instead of performing
 * an actual redirect — keeps API behaviour predictable for SPA / mobile clients.
 */
function preventRedirects(req, res, next) {
    const redirectStatusMessages = {
        300: "Multiple Choices",
        301: "Moved Permanently",
        302: "Found (Temporary Redirect)",
        303: "See Other",
        304: "Not Modified",
        307: "Temporary Redirect",
        308: "Permanent Redirect",
    };

    res.redirect = function (statusOrUrl, url) {
        let status = 302;
        let redirectUrl = statusOrUrl;

        if (typeof statusOrUrl === "number") {
            status = statusOrUrl;
            redirectUrl = url;
        }

        const isRedirectStatus = status >= 300 && status < 400;

        return res.status(isRedirectStatus ? status : 302).json({
            status: "error",
            code: status,
            message: redirectStatusMessages[status] || "Redirect prevented",
            error: {
                type: "RedirectPrevented",
                details: [{ field: "redirectTo", issue: redirectUrl }],
                hint: "API routes do not support redirects. Use the provided URL directly.",
            },
        });
    };

    next();
}

module.exports = preventRedirects;
