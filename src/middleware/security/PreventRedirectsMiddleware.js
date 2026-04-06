"use strict";

/**
 * @fileoverview Prevent HTTP redirects on API routes.
 * Overrides res.redirect to return JSON — keeps API behaviour
 * predictable for SPA / mobile clients.
 */

class PreventRedirectsMiddleware {
    constructor() {
        this._redirectStatusMessages = {
            300: "Multiple Choices",
            301: "Moved Permanently",
            302: "Found (Temporary Redirect)",
            303: "See Other",
            304: "Not Modified",
            307: "Temporary Redirect",
            308: "Permanent Redirect",
        };

        this.handle = this.handle.bind(this);
    }

    handle(req, res, next) {
        const messages = this._redirectStatusMessages;

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
                message: messages[status] || "Redirect prevented",
                error: {
                    type: "RedirectPrevented",
                    details: [{ field: "redirectTo", issue: redirectUrl }],
                    hint: "API routes do not support redirects. Use the provided URL directly.",
                },
            });
        };

        next();
    }
}

const defaultPreventRedirects = new PreventRedirectsMiddleware();
module.exports = { PreventRedirectsMiddleware, defaultPreventRedirects };
