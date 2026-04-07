"use strict";

const request = require("supertest");
const app = require("../../../src/app");

/**
 * Returns a supertest agent bound to the app.
 * Creates the app once per import — do not call multiple times.
 */
module.exports = request(app);
