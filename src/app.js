"use strict";

const express = require("express");
const app = express();

// ─── Security middleware ──────────────────────────────────────────────────────
const helmetMiddleware = require("./middleware/security/helmet");
const corsMiddleware = require("./middleware/security/cors");
const { securityFilter } = require("./middleware/security/securityFilter");
const { createIpFilter } = require("./middleware/security/filterIPs");
const preventRedirects = require("./middleware/security/preventRedirects");
const rateLimiter = require("./middleware/security/rateLimiter");
const {
    addRequestId,
    requestLogger,
} = require("./middleware/security/traceability");

// ─── Performance middleware ───────────────────────────────────────────────────
const compressionMiddleware = require("./middleware/performance/compression");
const { trackResponseTime } = require("./middleware/performance/responseTime");

// ─── Parsing middleware ───────────────────────────────────────────────────────
const {
    jsonParser,
    urlencodedParser,
} = require("./middleware/parsing/bodyParser");
const cookieParserMiddleware = require("./middleware/parsing/cookieParser");

// ─── Error handling ───────────────────────────────────────────────────────────
const {
    errorHandler,
    notFoundHandler,
    captureResponseBody,
} = require("./middleware/errorHandling/errorHandler");

// ─── Routes ───────────────────────────────────────────────────────────────────
const routes = require("./routes");

// ─── Logger ───────────────────────────────────────────────────────────────────
const { logger } = require("./utils/logger");

// ═══════════════════════════════════════════════════════════════════════════════
// MIDDLEWARE STACK (order matters)
// ═══════════════════════════════════════════════════════════════════════════════

// 1. Security headers
app.use(helmetMiddleware);

// 2. Security filter — block scanners & malicious requests EARLY
app.use(securityFilter);

// 3. Request ID — must be before logging so every log line carries req.id
app.use(addRequestId);

// 4. Body parsing — must be before logging so req.body is available
app.use(jsonParser);
app.use(urlencodedParser);

// 5. Request / response logging (uses req.id + req.body)
app.use(requestLogger);

// 6. Response-time tracking (X-Response-Time header + per-route metrics)
app.use(trackResponseTime);

// 7. Compression
app.use(compressionMiddleware);

// 8. CORS
app.use(corsMiddleware);

// 9. Cookie parsing
app.use(cookieParserMiddleware);

// 10. Capture response body for downstream logging
app.use(captureResponseBody);

// 11. IP filtering (enabled via ENABLE_IP_FILTER env var)
app.use(createIpFilter());

// 12. Rate limiting
app.use(rateLimiter.default);

// 13. Prevent redirects on API routes
app.use("/api", preventRedirects);

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
app.use(notFoundHandler);

// Global error handler
app.use(errorHandler);

module.exports = app;
