"use strict";

const { expect } = require("chai");
const agent = require("../../helpers/request");

const SCANNER_PATHS = [
    "/robots.txt",
    "/.env",
    "/wp-admin",
    "/phpinfo.php",
    "/admin.php",
    "/login.jsp",
    "/../etc/passwd",
    "/weblogic/login",
    "/_layouts/15/error.aspx",
];

const BLOCKED_METHODS = ["TRACE", "PROPFIND"];

describe("Security Filter — Scanner & Traversal Blocking", function () {
    SCANNER_PATHS.forEach((path) => {
        it(`blocks scanner path: ${path}`, async function () {
            const res = await agent.get(path);
            // Must return 400, 403, or 404 — never 200
            expect([400, 403, 404, 405]).to.include(res.status);
        });
    });

    BLOCKED_METHODS.forEach((method) => {
        it(`blocks HTTP method: ${method}`, async function () {
            const res =
                (await agent[method.toLowerCase()]?.("/api/v1/health")) ||
                (await agent
                    .options("/api/v1/health")
                    .set("X-Method-Override", method));
            // Security filter should not allow through
            expect([400, 403, 404, 405]).to.include(res.status);
        });
    });
});
