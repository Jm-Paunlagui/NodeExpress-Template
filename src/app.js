"use strict";

const express = require("express");
const app = express();

// ─── Security middleware ──────────────────────────────────────────────────────
const { defaultHelmet } = require("./middleware/security/HelmetMiddleware");
const { defaultCors } = require("./middleware/security/CorsMiddleware");
const {
    defaultSecurityFilter,
} = require("./middleware/security/SecurityFilterMiddleware");
const { defaultIpFilter } = require("./middleware/security/IpFilterMiddleware");
const {
    defaultPreventRedirects,
} = require("./middleware/security/PreventRedirectsMiddleware");
const {
    defaultRateLimiter,
} = require("./middleware/security/RateLimiterMiddleware");

// ─── Traceability middleware ──────────────────────────────────────────────────
const {
    defaultTraceability,
} = require("./middleware/traceability/TraceabilityMiddleware");

// ─── Performance middleware ───────────────────────────────────────────────────
const {
    defaultCompression,
} = require("./middleware/performance/CompressionMiddleware");
const {
    defaultResponseTime,
} = require("./middleware/performance/ResponseTimeMiddleware");

// ─── Parsing middleware ───────────────────────────────────────────────────────
const {
    defaultBodyParser,
} = require("./middleware/parsing/BodyParserMiddleware");
const {
    defaultCookieParser,
} = require("./middleware/parsing/CookieParserMiddleware");

// ─── CSRF protection ──────────────────────────────────────────────────────────
const { defaultCsrf } = require("./middleware/security/CsrfMiddleware");

// ─── Error handling ───────────────────────────────────────────────────────────
const {
    defaultErrorHandler,
} = require("./middleware/errorHandling/ErrorHandlerMiddleware");

// ─── Routes ───────────────────────────────────────────────────────────────────
const routes = require("./routes");

// ═══════════════════════════════════════════════════════════════════════════════
// MIDDLEWARE STACK (order matters — do not reorder)
// ═══════════════════════════════════════════════════════════════════════════════

// 1. Security headers
app.use(defaultHelmet.handle.bind(defaultHelmet));

// 2. Security filter — block scanners & malicious requests EARLY
app.use(defaultSecurityFilter.handle.bind(defaultSecurityFilter));

// 3. Request ID + request/response logging
app.use(defaultTraceability.handle.bind(defaultTraceability)); // lgtm[js/missing-rate-limiting] Rate limiting is enforced by RateLimiterMiddleware (step 12)

// 4. Body parsing — must be before route handlers so req.body is available
app.use(defaultBodyParser.jsonHandler);
app.use(defaultBodyParser.urlencodedHandler);

// 5. Response-time tracking (X-Response-Time header + per-route metrics)
app.use(defaultResponseTime.handle.bind(defaultResponseTime));

// 6. Compression
app.use(defaultCompression.handle.bind(defaultCompression));

// 7. CORS
app.use(defaultCors.handle.bind(defaultCors));

// 8. Cookie parsing
app.use(defaultCookieParser.handle.bind(defaultCookieParser)); // lgtm[js/missing-csrf-middleware] CSRF is enforced at step 9 below

// 9. CSRF protection — must come after cookie-parser so the secret cookie is readable.
//    doubleCsrf only enforces on state-changing methods (POST/PUT/DELETE/PATCH);
//    GET /csrf/token and other safe methods pass through automatically.
app.use(defaultCsrf.handle.bind(defaultCsrf));

// 10. Capture response body for downstream logging
app.use(defaultErrorHandler.captureResponseBody.bind(defaultErrorHandler));

// 11. IP filtering (enabled via ENABLE_IP_FILTER env var)
app.use(defaultIpFilter.handle.bind(defaultIpFilter));

// 12. Rate limiting — custom Sliding Window Counter backed by NodeCache.
//     CodeQL may not recognise this as a rate limiter because it is not an
//     npm package with a known call signature; the protection is real.
// lgtm[js/missing-rate-limiting]
app.use(defaultRateLimiter.handle.bind(defaultRateLimiter));

// 13. Prevent redirects on API routes
app.use("/api", defaultPreventRedirects.handle.bind(defaultPreventRedirects));

// Disable Express default headers
app.disable("x-powered-by");

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

app.use("/api/v1", routes);

// ═══════════════════════════════════════════════════════════════════════════════
// ERROR HANDLING (must be LAST)
// ═══════════════════════════════════════════════════════════════════════════════

// 404 catch-all
app.use(defaultErrorHandler.notFoundHandler.bind(defaultErrorHandler));

// Global error handler
app.use(defaultErrorHandler.handle.bind(defaultErrorHandler));

module.exports = app;
