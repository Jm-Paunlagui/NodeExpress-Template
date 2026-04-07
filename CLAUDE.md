# Project: MEAL Backend — Node.js Express API Template

This template provides a production-grade structure for building Node.js Express APIs.
It is designed around **Class-based (OOP) architecture**, clean separation of concerns,
and is intended to be maintainable from the perspective of any developer who picks it up.

---

## Features

- Express.js (v5) for building the API
- Helmet for securing HTTP headers
- CSRF protection (double-submit cookie via `csrf-csrf`)
- CORS with advanced network-aware pattern matching
- Compression middleware (gzip)
- Cookie-parser for signed cookie support
- Body-parser for JSON and URL-encoded payloads
- JWT-based authentication with dynamic, permission-based authorization
- Sliding Window Counter rate limiting (in-memory, no Redis)
- IP filtering middleware (CIDR-aware)
- Security filter (blocks scanners, path traversal, script injection)
- Standardized API response shape (`sendSuccess` / `sendError`)
- Structured AppError class with operational error handling
- Global error handler — all errors funnel through one place
- Winston-style custom logger with daily file rotation, microsecond precision, and no truncation
- Request traceability (unique `X-Request-Id` per request via `nanoid`)
- Response time tracking with slow-response detection
- Graceful shutdown with pool cleanup
- OracleDB dual-pool pattern with PoolHealthMonitor and exponential backoff retry
- Console manager (ASCII art, daily clearing, process title for PKG)
- Encoding polyfills for PKG-compiled executables
- Clustering support (master/worker, configurable via env)
- OracleDB wrapper library that mimics MongoDB's API (`src/utils/oracle-mongo-wrapper/`)
- PKG-compatible for compiling into a standalone `.exe`

---

## Project Structure

```
express-template/
├── server.js                          # Entry point — HTTP/HTTPS, clustering, graceful shutdown
├── package.json
├── .env.example                       # All env vars documented with safe defaults
├── certs/                             # Drop server.key + server.crt here for HTTPS
├── logs/                              # Auto-created rotating log files (YYYY/MM/DD/level.log)
│
└── src/
    ├── app.js                         # Express app — middleware chain + routes
    │
    ├── config/
    │   ├── index.js                   # Adapter factory — exports active DB adapter
    │   ├── database.js                # Connection registry (named pools, credentials)
    │   └── adapters/
    │       ├── oracle.js              # OracleDB adapter (pools, health monitor, retry)
    │       └── mysql.js               # MySQL adapter (future)
    │
    ├── constants/
    │   ├── index.js                   # Re-exports HTTP_STATUS + all sub-modules
    │   ├── errors/
    │   │   └── index.js               # AppError class + static error message strings
    │   ├── responses/
    │   │   └── index.js               # sendSuccess / sendError helpers + response strings
    │   └── messages/
    │       ├── index.js               # Re-exports all message namespaces
    │       ├── oracle.messages.js     # Oracle pool / driver log messages
    │       ├── oracleWrapper.messages.js  # Oracle-Mongo-Wrapper validation messages
    │       ├── auth.messages.js       # Authentication / authorization messages
    │       ├── middleware.messages.js # Security filter, rate limit, IP filter messages
    │       └── database.messages.js  # General DB operation messages
    │
    ├── middleware/
    │   ├── security/
    │   │   ├── CsrfMiddleware.js      # Class: double-submit cookie CSRF
    │   │   ├── CorsMiddleware.js      # Class: network-aware CORS
    │   │   ├── HelmetMiddleware.js    # Class: HTTP security headers
    │   │   ├── IpFilterMiddleware.js  # Class: CIDR-aware IP allowlist
    │   │   ├── RateLimiterMiddleware.js  # Class: Sliding Window Counter
    │   │   ├── SecurityFilterMiddleware.js  # Class: scanner/traversal blocking
    │   │   └── PreventRedirectsMiddleware.js # Class: prevent API redirects
    │   │
    │   ├── performance/
    │   │   ├── CompressionMiddleware.js  # Class: gzip compression
    │   │   └── ResponseTimeMiddleware.js  # Class: X-Response-Time header + metrics
    │   │
    │   ├── parsing/
    │   │   ├── BodyParserMiddleware.js    # Class: JSON + URL-encoded parsing
    │   │   └── CookieParserMiddleware.js  # Class: cookie parsing
    │   │
    │   ├── authentication/
    │   │   └── AuthMiddleware.js      # Class: JWT auth + dynamic permission-based access
    │   │
    │   ├── traceability/
    │   │   └── TraceabilityMiddleware.js  # Class: request ID injection + structured logging
    │   │
    │   └── errorHandling/
    │       └── ErrorHandlerMiddleware.js  # Class: global error handler + 404 + body capture
    │
    ├── routes/
    │   ├── index.js                   # Route aggregator
    │   ├── health.route.js            # GET /api/v1/health
    │   └── csrf.route.js              # GET /api/v1/csrf/token etc.
    │
    ├── controllers/                   # One class per resource, thin HTTP layer
    ├── models/                        # DB schemas / query definitions
    ├── services/                      # Business logic classes
    └── utils/
        ├── logger.js                  # Custom logger (daily rotation, no truncation)
        ├── catchAsync.js              # Async error wrapper for controllers
        ├── encodingPolyfill.js        # PKG encoding polyfills (must load first)
        ├── consoleManager.js          # Class: ASCII art, process title, daily clear
        ├── nanoidLoader.js            # Nanoid with fallback chain for PKG
        └── oracle-mongo-wrapper/      # MongoDB-style Oracle query library
```

---

## Architecture Rules

### Class-Based OOP

**All modules that maintain state, manage resources, or encapsulate behavior MUST be classes.**
Pure transformation functions (no state, no side effects, no resource management) may remain as
exported functions.

```
USE CLASS when:                        USE FUNCTION when:
- Holds internal state                 - Pure transformation (in → out)
- Manages a resource (pool, timer)     - No state, no side effects
- Has multiple related methods         - Single-purpose utility
- Lifecycle: init / start / stop       - Helper used in one place
- Wraps a third-party client
```

#### Middleware Pattern

Every middleware module exports an **instantiated class** whose `handle()` method is an
Express middleware function. Instantiation happens once at app startup.

```js
// ✅ CORRECT — Class-based middleware
class RateLimiterMiddleware {
    constructor(options = {}) {
        this._max = options.max ?? parseInt(process.env.RATE_LIMIT_MAX, 10);
        this._windowMs = options.windowMs ?? parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10);
        this._store = new NodeCache({ stdTTL: 3600, useClones: false });
    }

    handle(req, res, next) {
        // ... middleware logic
    }

    getStats() {
        return this._store.getStats();
    }
}

// Export a default instance + the class for custom instances
const defaultRateLimiter = new RateLimiterMiddleware();
module.exports = { RateLimiterMiddleware, defaultRateLimiter };
```

```js
// app.js usage
const { defaultRateLimiter } = require('./middleware/security/RateLimiterMiddleware');
app.use(defaultRateLimiter.handle.bind(defaultRateLimiter));
```

#### Controller Pattern

Controllers are **classes** with static methods (or bound instance methods).
Each controller handles one resource. Never put DB calls or business logic in controllers.

```js
class UserController {
    static getById = catchAsync(async (req, res) => {
        const user = await UserService.getById(req.params.id);
        res.json(sendSuccess('User fetched', user));
    });

    static create = catchAsync(async (req, res) => {
        const user = await UserService.create(req.body);
        res.status(HTTP_STATUS.CREATED).json(sendSuccess('User created', user));
    });
}

module.exports = UserController;
```

#### Service Pattern

Services are **classes** that own all business logic for a domain.
They talk to models/DB directly. They throw `AppError` on failure — never send HTTP responses.

```js
class UserService {
    static async getById(id) {
        const user = await UserModel.findById(id);
        if (!user) throw new AppError(AUTH_ERRORS.USER_NOT_FOUND, HTTP_STATUS.NOT_FOUND);
        return user;
    }
}

module.exports = UserService;
```

---

## Constants — Detailed Structure

### Why Three Sub-Directories?

| Directory | Purpose | Contents |
|-----------|---------|---------|
| `constants/errors/` | Operational error definitions | `AppError` class, static error strings used in `throw` statements |
| `constants/responses/` | Success response helpers | `sendSuccess`, `sendError` formatting functions + success message strings |
| `constants/messages/` | Log message templates | Functions/strings used **only in logger calls**, never thrown or sent to clients |

### The `messages/` Namespace — Breakdown

The original `messages.js` was a single large file with Oracle pool messages and Oracle wrapper
messages mixed together. It is now split by concern:

```
constants/messages/
├── index.js                  # Re-exports all namespaces as named exports
├── oracle.messages.js        # Pool lifecycle, health monitor, driver init
├── oracleWrapper.messages.js # Oracle-Mongo-Wrapper parser/schema validation
├── auth.messages.js          # JWT verify errors, permission denied details
├── middleware.messages.js    # IP blocked, rate limit exceeded, CSRF, security filter
└── database.messages.js      # Generic DB op failed, connection timeout
```

```js
// ✅ constants/messages/index.js
module.exports = {
    ...require('./oracle.messages'),       // { oracleMessages }
    ...require('./oracleWrapper.messages'), // { oracleMongoWrapperMessages }
    ...require('./auth.messages'),          // { authMessages }
    ...require('./middleware.messages'),    // { middlewareMessages }
    ...require('./database.messages'),      // { databaseMessages }
};
```

**Rule:** If a string is used in a `throw new AppError(...)` → it belongs in `constants/errors/`.
If it is used in a `res.json(sendSuccess(...))` → it belongs in `constants/responses/`.
If it is used in a `logger.info(...)` or `logger.error(...)` → it belongs in `constants/messages/`.

---

## Authentication & Authorization — Dynamic Permissions

### Problem with the Old Design

The old `auth.js` had hardcoded `AREAS` and `ROLES` constants. Every project built on this
template had different permission models, so hardcoding `INV_CON`, `INV_UNIT_SUP` etc.
was wrong.

### New Design: Dynamic Permission Model

Permissions are **data-driven**, not hardcoded. The JWT payload carries a `permissions` array
(or `userLevel` number). The `requireAccess` factory accepts a **predicate function** that
receives the decoded user and returns `true/false`.

```js
// ✅ CORRECT — Dynamic access control
class AuthMiddleware {
    // Attach decoded JWT to req.user
    static authenticate(req, res, next) { /* ... */ }

    // Factory: returns middleware that checks a predicate against req.user
    // predicate: (user) => boolean
    static requireAccess(predicate, options = {}) {
        return (req, res, next) => {
            if (!req.user) return next(new AppError(AUTH_ERRORS.USER_NOT_FOUND, 401));
            if (!predicate(req.user)) return next(new AppError(AUTH_ERRORS.FORBIDDEN_ACCESS, 403));
            next();
        };
    }
}
```

**Usage in routes** — each project defines its own access rules:

```js
// Project A: role-based only
router.get('/report',
    AuthMiddleware.authenticate,
    AuthMiddleware.requireAccess(user => user.userLevel >= 2),
    ReportController.get,
);

// Project B: area/permission-based
router.post('/inventory',
    AuthMiddleware.authenticate,
    AuthMiddleware.requireAccess(user => {
        const areas = (user.area ?? '').split(',').map(a => a.trim());
        return areas.includes('INV_CON');
    }),
    InventoryController.create,
);

// Project C: combined
router.delete('/admin',
    AuthMiddleware.authenticate,
    AuthMiddleware.requireAccess(user =>
        user.userLevel >= 3 && user.permissions?.includes('DELETE_USERS')
    ),
    AdminController.deleteUser,
);
```

**Why this is better:**
- No `AREAS` or `ROLES` constants in the template — they belong to the consuming application
- The template ships a **mechanism**, not a hard-coded permission set
- Each route documents its own access requirement inline — no mystery
- Backwards-compatible: `user.userLevel >= N` still works for simple projects

---

## Logger — Usage Rules

`src/utils/logger.js` is the **only** logger in the application.
**Never use `console.log`, `console.error`, or any other logging mechanism in production code.**

### Log Format

```
[MACHINE_IDENTIFIER] [TIMESTAMP] [LEVEL] [PID:processId] [FUNCTION @ FILE:LINE] [REQUEST_PHASE?] [METHOD] - MESSAGE | META: {...}

Examples:

Server function call:
[JmPaunlagui (S) 192.168.100.92] [2025-08-22 19:43:03] [INFO] [PID:23632] [initializePool @ src/config/adapters/oracle.js:234] [FUNC] - UserAccount pool created successfully

Client incoming request:
[paunlaguij@48022603 (C) 192.168.100.187] [2025-08-22 19:43:13] [INFO] [PID:23632] [handle @ src/middleware/traceability/TraceabilityMiddleware.js:55] [Incoming Request] [POST] - [POST @ /api/v1/auth/login]

Client request complete:
[paunlaguij@48022603 (C) 192.168.100.187] [2025-08-22 19:43:13] [INFO] [PID:23632] [handle @ src/middleware/traceability/TraceabilityMiddleware.js:80] [Request Complete] [POST] - [POST @ /api/v1/auth/login]
```

### Log Truncation Policy

**Logs are NEVER truncated by default.** Truncation defeats the purpose of traceability.
The `MAX_SAFESTR_LENGTH` option is configurable via `LOG_MAX_SAFESTR_LENGTH` env var
(defaults to `Infinity`). Only set a limit if disk I/O is a specific concern.

```js
// logger.js — safeStringify with configurable max
#safeStringify(value, maxLength = this._maxSafeStrLength) {
    // maxLength defaults to Infinity (no cut)
}
```

### Logger API

```js
const { logger } = require('../utils/logger');

// General purpose
logger.info('Message', { key: 'value' });
logger.warn('Message', { key: 'value' });
logger.error('Message', { key: 'value', stack: err.stack });
logger.debug('Message', { key: 'value' });

// HTTP request lifecycle (attach client machine identifier automatically)
logger.logIncomingRequest(req);
logger.logHandlingRequest(req, { userId: 12345 });
logger.logCompletedRequest(req, res, durationMs);

// Specialized
logger.cache('GET', 'cache:users:42', 'HIT', 3);       // cache op
logger.database('SELECT', 'USERS', 12, 5);              // db op
logger.performance('generateReport', 4200, { rows: 50000 }); // slow op warning
logger.security('IP_BLOCKED', { ip: '10.0.0.1' });      // security event
```

### Logger Integration in Classes

```js
// ✅ CORRECT — logger used in every class that logs
const { logger } = require('../../utils/logger');
const { oracleMessages } = require('../../constants/messages');

class OracleAdapter {
    async #createPool(name, config, attempt = 0) {
        logger.info(oracleMessages.POOL_CREATING(name));
        try {
            const pool = await oracledb.createPool(config);
            logger.info(oracleMessages.POOL_READY(name, pool));
            return pool;
        } catch (err) {
            logger.error(oracleMessages.POOL_FAILED(name, attempt + 1, 4, err.message));
            throw err;
        }
    }
}
```

**Rule:** All log message template strings (e.g. `POOL_CREATING(name)`) live in
`constants/messages/oracle.messages.js` — never inline strings in class methods.

---

## Environment Variables

All environment variables are documented in `.env.example`.
**Never import `dotenv` directly in feature files** — only `server.js` and compiled-env bootstrap.
**Never hardcode values** that belong in `.env.example`.

Complete `.env.example` categories:

```
# ── Server ──────────────────────────────────────────────────────────
PORT, HOST, NODE_ENV, USE_HTTPS, APP_NAME

# ── Clustering ──────────────────────────────────────────────────────
ENABLE_CLUSTERING, NUM_WORKERS

# ── JWT ─────────────────────────────────────────────────────────────
JWT_SECRET, JWT_EXPIRES_IN, JWT_REFRESH_EXPIRES_IN

# ── CSRF ────────────────────────────────────────────────────────────
CSRF_SECRET

# ── CORS ────────────────────────────────────────────────────────────
CORS_ORIGINS

# ── Cookies ─────────────────────────────────────────────────────────
COOKIE_SECRET

# ── Body Parsing ────────────────────────────────────────────────────
BODY_LIMIT

# ── Rate Limiting ───────────────────────────────────────────────────
RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS, TRUST_PROXY

# ── IP Filtering ────────────────────────────────────────────────────
ENABLE_IP_FILTER, ALLOWED_IPS

# ── Database (Oracle) ───────────────────────────────────────────────
DB_TYPE, DB_HOST, DB_PORT, DB_SERVICE_NAME
UA_DB_USERNAME, UA_DB_PASSWORD
UI_DB_USERNAME, UI_DB_PASSWORD

# ── Database (Test / Dev) ───────────────────────────────────────────
DB_TEST_HOST, DB_TEST_PORT, DB_TEST_SID
UI_TEST_DB_USERNAME, UI_TEST_DB_PASSWORD

# ── Oracle Instant Client ───────────────────────────────────────────
ORACLE_INSTANT_CLIENT

# ── Logging ─────────────────────────────────────────────────────────
LOG_LEVEL, ENABLE_CONSOLE_LOGS, LOG_EXCLUDE_HEALTH, LOG_EXCLUDE_URLS
LOG_MAX_SAFESTR_LENGTH    # Defaults to Infinity (no truncation). Set a number only if needed.
LOG_CALLSITE              # true/false — capture function/file/line in logs (default: true)

# ── Password Hashing ────────────────────────────────────────────────
PASSWORD_HASH_MODE        # 'bcrypt' for production, 'plain' for development only

# ── PKG ─────────────────────────────────────────────────────────────
PFX_PASSPHRASE            # Passphrase for PFX certificate (HTTPS)
```

---

## API Response Shape

Always use helpers from `constants/responses/`. **Never return raw data.**

```json
// Success
{
  "status": "success",
  "code": 200,
  "message": "User fetched successfully",
  "data": { ... }
}

// Error
{
  "status": "error",
  "code": 400,
  "message": "Invalid request data",
  "error": {
    "type": "ValidationError",
    "details": [
      { "field": "email", "issue": "Invalid email format" }
    ],
    "hint": "Ensure the email is a valid address.",
    "stack": "ValidationError: ... (development only)"
  }
}
```

```js
// In controllers
res.json(sendSuccess(RESPONSE_MESSAGES.USER_FETCHED, user));
res.status(HTTP_STATUS.CREATED).json(sendSuccess(RESPONSE_MESSAGES.USER_CREATED, user));

// In error handler (via AppError)
throw new AppError(AUTH_ERRORS.USER_NOT_FOUND, HTTP_STATUS.UNAUTHORIZED);
```

---

## Error Handling

- Services throw `new AppError(message, statusCode, { type, details, hint })`
- The global `ErrorHandlerMiddleware` catches everything — including `AppError`, DB errors, and unexpected crashes
- `catchAsync(fn)` wraps async controller methods — missing it will crash the process on unhandled rejections
- **Never** `console.error` raw errors — always `logger.error(...)`
- Unhandled promise rejections and uncaught exceptions are handled in `server.js`

```js
// AppError usage
throw new AppError(AUTH_ERRORS.FORBIDDEN_ACCESS, HTTP_STATUS.FORBIDDEN, {
    type: 'AuthorizationError',
    hint: 'You do not have the required permission for this resource.',
});
```

---

## Middleware Stack (order matters — do not reorder)

```js
// app.js
app.use(helmetMiddleware.handle)           // 1. Security headers
app.use(securityFilter.handle)             // 2. Block scanners / traversal EARLY
app.use(addRequestId.handle)              // 3. Inject X-Request-Id before logging
app.use(jsonParser.handle)                // 4. Body parsing before logging (req.body available)
app.use(urlencodedParser.handle)
app.use(requestLogger.handle)             // 5. Log incoming + completed requests
app.use(trackResponseTime.handle)         // 6. X-Response-Time header
app.use(compressionMiddleware.handle)     // 7. Compress responses
app.use(corsMiddleware.handle)            // 8. CORS
app.use(cookieParser.handle)              // 9. Cookie parsing
app.use(captureResponseBody.handle)       // 10. Capture body for logging
app.use(createIpFilter.handle)            // 11. IP allowlist
app.use(defaultRateLimiter.handle)        // 12. Rate limiting
app.use('/api', preventRedirects.handle)  // 13. API-only redirect prevention
```

---

## Auth Routes (Standard)

```
POST /api/v1/auth/register
POST /api/v1/auth/login
POST /api/v1/auth/refresh
POST /api/v1/auth/logout
```

---

## Route Conventions

- All routes prefixed with `/api/v1/`
- Group by resource: `authRoutes`, `userRoutes`, etc.
- Health check: `GET /api/v1/health` → always returns `200 OK`
- Route files are named `<resource>.route.js`

---

## Validation

- Validate all incoming request bodies using `zod` (preferred) or `express-validator`
- Validation middleware sits **before** the controller in the route definition
- Reject early — never let invalid data reach the service layer
- Validation errors become `AppError` with `details` array matching the error response shape

---

## Database — OracleDB Adapter Rules

- **Dual-pool pattern**: separate pools per named connection (`userAccount`, `unitInventory`, etc.)
- Adding a new connection requires only a new entry in `src/config/database.js` — no other file changes
- `PoolHealthMonitor` runs every 30 seconds, marks unhealthy pools after 3 consecutive failures
- Exponential backoff on pool init: 3 retries, delay `min(1000 * 2^n, 10000)ms`
- **Never** use raw `oracledb` outside `src/config/adapters/oracle.js`

```js
// Usage everywhere else in the app
const db = require('../config');
await db.withConnection('userAccount', async (conn) => {
    const result = await conn.execute('SELECT 1 FROM DUAL');
    return result.rows;
});
```

---

## OracleDB Wrapper Library

The `oracle-mongo-wrapper` in `src/utils/oracle-mongo-wrapper/` is the **unique feature**
of this template. It provides a MongoDB-style API backed by Oracle SQL:

```js
const { createDb, OracleCollection } = require('../utils/oracle-mongo-wrapper');
const db = createDb('userAccount');
const users = new OracleCollection('T_OPITS_USERS', db);

const row = await users.findOne({ USERNAME: 'jmpaunlagui' });
await users.updateOne({ ID: row.ID }, { $set: { STATUS: 'active' } });
```

Full API documented in `src/utils/oracle-mongo-wrapper/README.md`.

---

## PKG Compilation

The application can be compiled into a standalone Windows executable via `pkg`:

```bash
npm run build        # Produces dist/meal_backend.exe
npm run build:debug  # With debug output
```

Requirements for PKG compatibility:
1. `src/utils/encodingPolyfill.js` is **always the first require** in `server.js`
2. `src/utils/nanoidLoader.js` handles nanoid's ESM-only issue in compiled environments
3. `src/config/adapters/oracle.js` handles Thick mode init for compiled Oracle client
4. `src/utils/consoleManager.js` sets the process title for the compiled exe window

---

## Gotchas

- Always use `catchAsync` around async controller functions — missing it crashes on unhandled rejections
- `cors()` origin patterns are in `CorsMiddleware.js` — add project-specific origins to `CORS_ORIGINS` env var
- Rate limiter is per-IP by default — create `new RateLimiterMiddleware({ max: 5 })` for strict routes
- Cache stores are registered once at startup via `registry.registerAll({...})` — resolving an unregistered name throws immediately.
- Always build cache keys with `CacheKeyBuilder` — never concatenate strings manually; parameters are sorted alphabetically so call-site order never matters.
- `CacheMiddleware.read()` only caches 2xx JSON responses; errors are never stored.
- Invalidation runs in `setImmediate` (fire-and-forget) so it never blocks the response.
- Use `store.delByPattern(prefix)` for broad invalidation; use `store.del(exactKey)` for surgical precision.
- Log files are organized as `logs/YYYY/MM/DD/level.log` — they rotate daily, never truncate mid-message
- `LOG_MAX_SAFESTR_LENGTH` defaults to `Infinity` — only set it if you encounter disk-space issues in a specific environment
- `PASSWORD_HASH_MODE=plain` is **only** for local development — always `bcrypt` in production

---

## Cache System

The cache subsystem lives in `src/middleware/cache/`. It is **domain-agnostic** — it ships zero inventory or project-specific logic, so it ports cleanly to any project built on this template.

### File Map

```
src/middleware/cache/
├── index.js           # Barrel — import everything from here
├── CacheStore.js      # Low-level NodeCache wrapper (get/set/del/flush/getOrSet)
├── CacheRegistry.js   # Singleton registry: register → resolve → statsAll
├── CacheKeyBuilder.js # Fluent, deterministic key construction
└── CacheMiddleware.js # Express middleware factory (read / invalidate / invalidateWhere)
```

### Four Building Blocks

| Class | Responsibility |
|---|---|
| `CacheStore` | Wraps one NodeCache instance. Emits structured log lines on every operation. Exposes `getOrSet()` for service-layer read-through. |
| `CacheRegistry` | Singleton that owns all `CacheStore` instances. The only place where stores are created. |
| `CacheKeyBuilder` | Fluent builder that sorts parameters alphabetically and auto-hashes keys > 200 chars. |
| `CacheMiddleware` | Express middleware factory. `read()` = cache-aside. `invalidate()` = post-response cleanup. |

---

## OPTISv2 Reference Analysis

The OPTISv2 backend at `D:\Web\OPTISv2\OPITS-BE` is used as a reference for
advanced patterns. Key features borrowed from OPTISv2:

| Feature | Status |
|---------|--------|
| PKG encoding polyfills (`encodingPolyfill.js`) | ✅ Implemented |
| Dual DB pool + PoolHealthMonitor (30s, 3-strike) | ✅ Implemented |
| Exponential backoff on pool init (3 retries) | ✅ Implemented |
| Security filter (scanner/traversal blocking) | ✅ Implemented |
| Machine identifier in logs (hostname + IP) | ✅ Implemented |
| Request ID middleware (nanoid, `X-Request-Id`) | ✅ Implemented |
| Response time tracking + slow detection | ✅ Implemented |
| Clustering support (master/worker, configurable) | ✅ Implemented |
| Advanced CORS (VPN, WFH, corporate, local) | ✅ Implemented |
| Console manager (process title, ASCII art, daily clear) | ✅ Implemented |
| Cache system (domain-agnostic, OOP, registry + key-builder + middleware) | ✅ Implemented in `src/middleware/cache/` |
| Object pooling for high-frequency DB ops | ⬜ Optional, add if profiling indicates need |
| Graceful batch processing (partial success) | ✅ Via `withBatchConnection` |

---

## What NOT to Change

- The `oracle-mongo-wrapper` query optimizer (Oracle hints) — not needed at this level
- The overall CTE-chaining approach in `aggregatePipeline.js` — it works
- The `withConnection` / `withTransaction` / `withBatchConnection` API surface — stable

---

---

# Testing Guide — Server Quality Assurance

> **Persona:** Senior software developer. Tests are not afterthoughts — they are
> first-class deliverables. Every feature that ships without a test is a bug waiting
> to be discovered in production.

---

## Test Directory Structure

```
test/server/
├── setup.js                        # Global test setup: env loading, DB teardown helpers
├── helpers/
│   ├── request.js                  # Supertest app factory (creates a fresh app per suite)
│   ├── auth.js                     # JWT token factory (sign tokens for any permission level)
│   ├── db.js                       # Seed/teardown helpers for Oracle scratch tables
│   └── fixtures/
│       ├── users.fixture.js        # Standard user payloads
│       └── responses.fixture.js    # Expected response shapes
│
├── unit/                           # Pure function / class tests — no DB, no HTTP
│   ├── middleware/
│   │   ├── rateLimiter.test.js
│   │   ├── ipFilter.test.js
│   │   ├── cors.test.js
│   │   ├── csrf.test.js
│   │   └── securityFilter.test.js
│   ├── utils/
│   │   ├── catchAsync.test.js
│   │   ├── logger.test.js
│   │   └── cacheKeyBuilder.test.js
│   └── constants/
│       ├── filterParser.test.js
│       └── updateParser.test.js
│
├── integration/                    # HTTP-level tests against a real Express app instance
│   ├── auth/
│   │   ├── login.test.js
│   │   ├── register.test.js
│   │   ├── refresh.test.js
│   │   └── logout.test.js
│   ├── health.test.js
│   ├── csrf.test.js
│   └── error-handling.test.js
│
├── security/                       # Adversarial tests — what should be rejected
│   ├── injection.test.js           # SQLi, path traversal, XSS payloads
│   ├── auth-bypass.test.js         # Missing / forged / expired tokens
│   ├── rate-limit.test.js          # Flood attack simulation
│   ├── cors.test.js                # Disallowed origins
│   ├── csrf.test.js                # Missing / replayed tokens
│   └── headers.test.js             # Helmet header presence and values
│
├── performance/                    # Timing and throughput assertions
│   ├── response-time.test.js       # P95 latency under normal load
│   ├── concurrent.test.js          # Parallel request correctness
│   └── pool.test.js                # DB pool exhaustion and recovery
│
└── reliability/                    # Fault-tolerance and recovery tests
    ├── graceful-shutdown.test.js
    ├── db-reconnect.test.js
    └── unhandled-errors.test.js
```

---

## Test Stack

```
mocha          — test runner (already a devDependency)
chai           — assertions (already a devDependency)
supertest      — HTTP integration testing against the Express app
sinon          — spies, stubs, fakes (for isolating external dependencies)
```

Install the two additions:

```bash
npm install --save-dev supertest sinon
```

---

## Running Tests

```bash
# All tests
npx mocha 'test/**/*.test.js' --timeout 30000 --exit --recursive

# Category by category
npx mocha 'test/unit/**/*.test.js'         --timeout 10000 --exit
npx mocha 'test/integration/**/*.test.js'  --timeout 30000 --exit
npx mocha 'test/security/**/*.test.js'     --timeout 30000 --exit
npx mocha 'test/performance/**/*.test.js'  --timeout 60000 --exit
npx mocha 'test/reliability/**/*.test.js'  --timeout 60000 --exit
```

Add to `package.json`:

```json
"scripts": {
  "test":              "mocha 'test/**/*.test.js' --timeout 30000 --exit --recursive",
  "test:unit":         "mocha 'test/unit/**/*.test.js' --timeout 10000 --exit",
  "test:integration":  "mocha 'test/integration/**/*.test.js' --timeout 30000 --exit",
  "test:security":     "mocha 'test/security/**/*.test.js' --timeout 30000 --exit",
  "test:performance":  "mocha 'test/performance/**/*.test.js' --timeout 60000 --exit",
  "test:reliability":  "mocha 'test/reliability/**/*.test.js' --timeout 60000 --exit"
}
```

---

## 1. Unit Tests

Unit tests verify individual classes and pure functions in complete isolation.
No network, no DB, no filesystem. Fast — entire suite should complete in under 5 seconds.

### Rules

- Every middleware class gets its own unit test file.
- Stub `req`, `res`, and `next` manually — do not use supertest here.
- Never read from `.env` in unit tests — all configuration is passed via constructor options.
- Test the unhappy path first, then the happy path.

### Example — RateLimiterMiddleware

```js
// test/unit/middleware/rateLimiter.test.js
'use strict';

const { expect } = require('chai');
const { RateLimiterMiddleware } = require('../../../src/middleware/security/RateLimiterMiddleware');

function mockReq(ip = '127.0.0.1', path = '/api/v1/users') {
    return { ip, path, method: 'GET', headers: {}, route: null };
}

function mockRes() {
    const headers = {};
    return {
        headersSent: false,
        setHeader(k, v) { headers[k] = v; },
        getHeader(k) { return headers[k]; },
        status(code) { this._status = code; return this; },
        json(body) { this._body = body; return this; },
        _headers: headers,
    };
}

describe('RateLimiterMiddleware', function () {
    describe('constructor validation', function () {
        it('throws RangeError when max <= 0', function () {
            expect(() => new RateLimiterMiddleware({ max: 0 })).to.throw(RangeError);
            expect(() => new RateLimiterMiddleware({ max: -1 })).to.throw(RangeError);
        });

        it('throws RangeError when windowMs <= 0', function () {
            expect(() => new RateLimiterMiddleware({ max: 10, windowMs: 0 })).to.throw(RangeError);
        });

        it('initializes with valid options', function () {
            expect(() => new RateLimiterMiddleware({ max: 10, windowMs: 60000 })).to.not.throw();
        });
    });

    describe('handle()', function () {
        it('calls next() when under the limit', function (done) {
            const limiter = new RateLimiterMiddleware({ max: 5, windowMs: 60000 });
            const req = mockReq();
            const res = mockRes();
            limiter.handle(req, res, done);
        });

        it('responds 429 after exceeding max requests', function (done) {
            const limiter = new RateLimiterMiddleware({ max: 2, windowMs: 60000 });
            const req = mockReq('10.0.0.1');
            const res = mockRes();
            const noop = () => {};

            limiter.handle(req, mockRes(), noop);
            limiter.handle(req, mockRes(), noop);

            limiter.handle(req, res, () => {
                done(new Error('next() should not be called when limit is exceeded'));
            });

            setTimeout(() => {
                expect(res._status).to.equal(429);
                expect(res._body.status).to.equal('error');
                done();
            }, 10);
        });

        it('sets RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset headers', function (done) {
            const limiter = new RateLimiterMiddleware({ max: 100, windowMs: 60000 });
            const res = mockRes();
            limiter.handle(mockReq(), res, () => {
                expect(res._headers).to.have.property('RateLimit-Limit');
                expect(res._headers).to.have.property('RateLimit-Remaining');
                expect(res._headers).to.have.property('RateLimit-Reset');
                done();
            });
        });

        it('bypasses OPTIONS requests', function (done) {
            const limiter = new RateLimiterMiddleware({ max: 1, windowMs: 60000 });
            const req = { ...mockReq(), method: 'OPTIONS' };
            limiter.handle(req, mockRes(), done);
            limiter.handle(req, mockRes(), done); // second call must also pass
        });

        it('clears a specific key with clearKey()', function (done) {
            const limiter = new RateLimiterMiddleware({ max: 1, windowMs: 60000 });
            const req = mockReq('192.168.1.5');
            limiter.handle(req, mockRes(), () => {});  // exhaust
            limiter.clearKey('rl:ip:192.168.1.5');

            // Should pass after clear
            limiter.handle(req, mockRes(), done);
        });
    });

    describe('getStats()', function () {
        it('returns a NodeCache stats object', function () {
            const limiter = new RateLimiterMiddleware({ max: 10, windowMs: 60000 });
            const stats = limiter.getStats();
            expect(stats).to.be.an('object');
            expect(stats).to.have.property('hits');
            expect(stats).to.have.property('misses');
        });
    });
});
```

### Example — IpFilterMiddleware

```js
// test/unit/middleware/ipFilter.test.js
'use strict';

const { expect } = require('chai');
const { IpFilterMiddleware } = require('../../../src/middleware/security/IpFilterMiddleware');

describe('IpFilterMiddleware', function () {
    describe('when disabled', function () {
        it('always calls next()', function (done) {
            const filter = new IpFilterMiddleware({ enabled: false });
            filter.handle({ ip: '1.2.3.4', path: '/' }, {}, done);
        });
    });

    describe('when enabled', function () {
        it('allows an exact IP on the allowlist', function (done) {
            const filter = new IpFilterMiddleware({
                enabled: true,
                allowedIps: ['192.168.1.10'],
            });
            filter.handle({ ip: '192.168.1.10', path: '/' }, {}, done);
        });

        it('blocks an IP not on the allowlist', function (done) {
            const filter = new IpFilterMiddleware({
                enabled: true,
                allowedIps: ['192.168.1.10'],
            });
            const res = {
                status(c) { this._status = c; return this; },
                json(b)   { this._body = b; done(); },
            };
            filter.handle({ ip: '10.0.0.5', path: '/api' }, res, () => {
                done(new Error('should have been blocked'));
            });
        });

        it('allows an IP within a CIDR range', function (done) {
            const filter = new IpFilterMiddleware({
                enabled: true,
                allowedIps: ['10.0.0.0/24'],
            });
            filter.handle({ ip: '10.0.0.99', path: '/' }, {}, done);
        });

        it('blocks an IP outside the CIDR range', function (done) {
            const filter = new IpFilterMiddleware({
                enabled: true,
                allowedIps: ['10.0.0.0/24'],
            });
            const res = {
                status(c) { this._status = c; return this; },
                json()    { done(); },
            };
            filter.handle({ ip: '10.0.1.1', path: '/api' }, res, () => {
                done(new Error('should have been blocked'));
            });
        });
    });

    describe('static helpers', function () {
        it('ipInCidr correctly classifies IPs', function () {
            expect(IpFilterMiddleware.ipInCidr('192.168.1.5', '192.168.1.0/24')).to.be.true;
            expect(IpFilterMiddleware.ipInCidr('192.168.2.1', '192.168.1.0/24')).to.be.false;
        });

        it('extractClientIp strips ::ffff: IPv4-mapped prefix', function () {
            const req = { ip: '::ffff:10.0.0.1', socket: {} };
            expect(IpFilterMiddleware.extractClientIp(req)).to.equal('10.0.0.1');
        });
    });
});
```

### Example — CacheKeyBuilder

```js
// test/unit/utils/cacheKeyBuilder.test.js
'use strict';

const { expect } = require('chai');
const { CacheKeyBuilder } = require('../../../src/middleware/cache/CacheKeyBuilder');

describe('CacheKeyBuilder', function () {
    it('produces the same key regardless of parameter insertion order', function () {
        const k1 = CacheKeyBuilder.build('users', { division: 'WH', year: 2025, month: 1 });
        const k2 = CacheKeyBuilder.build('users', { month: 1, year: 2025, division: 'WH' });
        expect(k1).to.equal(k2);
    });

    it('normalises null and undefined values to the string "null"', function () {
        const k = CacheKeyBuilder.build('users', { division: null, year: undefined });
        expect(k).to.include('division=null');
        expect(k).to.include('year=null');
    });

    it('sorts array parameters before joining', function () {
        const k1 = CacheKeyBuilder.build('ids', { ids: [3, 1, 2] });
        const k2 = CacheKeyBuilder.build('ids', { ids: [2, 3, 1] });
        expect(k1).to.equal(k2);
    });

    it('hashes keys longer than 200 characters', function () {
        const longParams = {};
        for (let i = 0; i < 30; i++) longParams[`param${i}`] = `value${i}`;
        const key = CacheKeyBuilder.build('prefix', longParams);
        expect(key.length).to.be.lessThan(220); // hashed — never obscenely long
        expect(key).to.include('h=');
    });

    it('throws TypeError when prefix is empty', function () {
        expect(() => new CacheKeyBuilder('')).to.throw(TypeError);
        expect(() => new CacheKeyBuilder(null)).to.throw(TypeError);
    });

    it('fluent builder and static build() produce identical keys', function () {
        const fluent = CacheKeyBuilder.of('report').param('year', 2025).param('month', 3).build();
        const stat   = CacheKeyBuilder.build('report', { year: 2025, month: 3 });
        expect(fluent).to.equal(stat);
    });
});
```

---

## 2. Integration Tests

Integration tests fire real HTTP requests against a live Express app instance
(created fresh per file using `supertest`). They test the full middleware stack
end-to-end: routing, validation, auth, response shape.

### Setup Helper

```js
// test/helpers/request.js
'use strict';

const request = require('supertest');
const app     = require('../../src/app');

/**
 * Returns a supertest agent bound to the app.
 * Creates the app once per import — do not call multiple times.
 */
module.exports = request(app);
```

```js
// test/helpers/auth.js
'use strict';

const jwt = require('jsonwebtoken');

function signToken(payload = {}, expiresIn = '1h') {
    return jwt.sign(
        { sub: 'test-user', userLevel: 1, ...payload },
        process.env.JWT_SECRET || 'test-secret',
        { expiresIn },
    );
}

module.exports = { signToken };
```

### Example — Health Route

```js
// test/integration/health.test.js
'use strict';

const { expect } = require('chai');
const agent      = require('../helpers/request');

describe('GET /api/v1/health', function () {
    it('returns 200 with status "success"', async function () {
        const res = await agent.get('/api/v1/health');
        expect(res.status).to.equal(200);
        expect(res.body.status).to.equal('success');
    });

    it('response body includes uptime, timestamp, environment, and host', async function () {
        const res = await agent.get('/api/v1/health');
        const { data } = res.body;
        expect(data).to.have.property('uptime').that.is.a('number');
        expect(data).to.have.property('timestamp');
        expect(data).to.have.property('environment');
        expect(data).to.have.property('host');
    });

    it('responds in under 500ms', async function () {
        const start = Date.now();
        await agent.get('/api/v1/health');
        expect(Date.now() - start).to.be.lessThan(500);
    });

    it('sets X-Request-ID header on every response', async function () {
        const res = await agent.get('/api/v1/health');
        expect(res.headers).to.have.property('x-request-id');
        expect(res.headers['x-request-id']).to.match(/^req_/);
    });
});
```

### Example — 404 and Error Shape

```js
// test/integration/error-handling.test.js
'use strict';

const { expect } = require('chai');
const agent      = require('../helpers/request');

describe('Error Handling', function () {
    describe('404 — unknown routes', function () {
        it('GET unknown path returns 404 JSON with error shape', async function () {
            const res = await agent.get('/api/v1/does-not-exist');
            expect(res.status).to.equal(404);
            expect(res.body.status).to.equal('error');
            expect(res.body.code).to.equal(404);
            expect(res.body.error).to.have.property('type', 'NotFoundError');
        });

        it('POST unknown path returns 404 not 405', async function () {
            const res = await agent.post('/api/v1/does-not-exist').send({});
            expect(res.status).to.equal(404);
        });
    });

    describe('global error shape contract', function () {
        it('every error response has status, code, message, error fields', async function () {
            const res = await agent.get('/api/v1/does-not-exist');
            expect(res.body).to.have.all.keys('status', 'code', 'message', 'error');
        });

        it('error.type is always a string', async function () {
            const res = await agent.get('/api/v1/does-not-exist');
            expect(res.body.error.type).to.be.a('string');
        });
    });
});
```

---

## 3. Security Tests

Security tests are adversarial. Their job is to prove that the server correctly
**rejects** dangerous or unauthorized input. A passing security test means an
attack was blocked.

> **Rule:** A security test that never fails is worthless. Intentionally remove the
> defense being tested, confirm the test fails, then restore the defense.

### 3.1 Authentication & Authorization

```js
// test/security/auth-bypass.test.js
'use strict';

const { expect } = require('chai');
const agent      = require('../helpers/request');
const { signToken } = require('../helpers/auth');

// Replace with any route that requires AuthMiddleware.authenticate
const PROTECTED = '/api/v1/users/me';

describe('Auth Security', function () {
    describe('missing token', function () {
        it('returns 401 when no Authorization header is provided', async function () {
            const res = await agent.get(PROTECTED);
            expect(res.status).to.equal(401);
            expect(res.body.error.type).to.equal('AuthenticationError');
        });

        it('returns 401 when Authorization header is malformed', async function () {
            const res = await agent.get(PROTECTED).set('Authorization', 'NotBearer abc');
            expect(res.status).to.equal(401);
        });

        it('returns 401 when token is present in neither header nor cookie', async function () {
            const res = await agent.get(PROTECTED).unset('Authorization');
            expect(res.status).to.equal(401);
        });
    });

    describe('invalid token', function () {
        it('returns 403 for a token signed with the wrong secret', async function () {
            const forged = require('jsonwebtoken').sign({ sub: 'hacker' }, 'wrong-secret');
            const res = await agent.get(PROTECTED).set('Authorization', `Bearer ${forged}`);
            expect(res.status).to.equal(403);
        });

        it('returns 403 for an expired token', async function () {
            const expired = signToken({ sub: 'test' }, '-1s');
            const res = await agent.get(PROTECTED).set('Authorization', `Bearer ${expired}`);
            expect(res.status).to.equal(403);
        });

        it('returns 403 for a structurally invalid JWT', async function () {
            const res = await agent.get(PROTECTED).set('Authorization', 'Bearer not.a.jwt');
            expect(res.status).to.equal(403);
        });

        it('returns 403 for a token with a tampered payload', async function () {
            // Sign a valid token, then corrupt the payload segment
            const valid = signToken({ userLevel: 1 });
            const parts = valid.split('.');
            parts[1] = Buffer.from(JSON.stringify({ sub: 'hacker', userLevel: 99 }))
                .toString('base64url');
            const tampered = parts.join('.');
            const res = await agent.get(PROTECTED).set('Authorization', `Bearer ${tampered}`);
            expect(res.status).to.equal(403);
        });
    });

    describe('authorization (permission level)', function () {
        it('returns 403 when user level is below route requirement', async function () {
            // Route requires userLevel >= 2; token has userLevel 1
            const token = signToken({ userLevel: 1 });
            const res = await agent
                .get('/api/v1/admin/dashboard')
                .set('Authorization', `Bearer ${token}`);
            expect(res.status).to.equal(403);
            expect(res.body.error.type).to.equal('AuthorizationError');
        });
    });
});
```

### 3.2 HTTP Headers (Helmet)

```js
// test/security/headers.test.js
'use strict';

const { expect } = require('chai');
const agent      = require('../helpers/request');

describe('Security Headers (Helmet)', function () {
    let headers;

    before(async function () {
        const res = await agent.get('/api/v1/health');
        headers = res.headers;
    });

    it('sets X-Content-Type-Options: nosniff', function () {
        expect(headers['x-content-type-options']).to.equal('nosniff');
    });

    it('sets X-Frame-Options to deny framing', function () {
        expect(headers['x-frame-options']).to.equal('DENY');
    });

    it('sets Strict-Transport-Security', function () {
        expect(headers['strict-transport-security']).to.exist;
        expect(headers['strict-transport-security']).to.include('max-age=');
    });

    it('sets Content-Security-Policy', function () {
        expect(headers['content-security-policy']).to.exist;
        expect(headers['content-security-policy']).to.include("default-src 'self'");
    });

    it('does not expose X-Powered-By', function () {
        expect(headers).to.not.have.property('x-powered-by');
    });

    it('sets Referrer-Policy', function () {
        expect(headers['referrer-policy']).to.exist;
    });

    it('sets Cross-Origin-Opener-Policy', function () {
        expect(headers['cross-origin-opener-policy']).to.exist;
    });
});
```

### 3.3 Injection Attacks

```js
// test/security/injection.test.js
'use strict';

const { expect } = require('chai');
const agent      = require('../helpers/request');

// Payloads that should never reach the DB or be reflected in a 500
const SQL_PAYLOADS = [
    "'; DROP TABLE USERS; --",
    "' OR '1'='1",
    "' OR 1=1--",
    "admin'--",
    "1; SELECT * FROM information_schema.tables",
];

const PATH_TRAVERSAL_PAYLOADS = [
    '../../../etc/passwd',
    '..\\..\\..\\windows\\system32',
    '%2e%2e%2f%2e%2e%2f',
    '....//....//etc/passwd',
];

const XSS_PAYLOADS = [
    '<script>alert(1)</script>',
    '"><img src=x onerror=alert(1)>',
    'javascript:alert(1)',
];

describe('Injection Attack Mitigation', function () {
    describe('SQL injection via query string', function () {
        SQL_PAYLOADS.forEach((payload) => {
            it(`rejects or sanitizes: ${payload.slice(0, 40)}`, async function () {
                const res = await agent
                    .get('/api/v1/users')
                    .query({ search: payload });
                // Must not crash the server with a 500
                expect(res.status).to.not.equal(500);
            });
        });
    });

    describe('SQL injection via request body', function () {
        SQL_PAYLOADS.forEach((payload) => {
            it(`body payload blocked: ${payload.slice(0, 40)}`, async function () {
                const res = await agent
                    .post('/api/v1/auth/login')
                    .send({ username: payload, password: 'test' });
                expect(res.status).to.not.equal(500);
            });
        });
    });

    describe('path traversal via URL', function () {
        PATH_TRAVERSAL_PAYLOADS.forEach((payload) => {
            it(`path traversal blocked: ${payload}`, async function () {
                const res = await agent.get(`/api/v1/${encodeURIComponent(payload)}`);
                // Security filter should return 400, 403, or 404 — never 200
                expect([400, 403, 404]).to.include(res.status);
            });
        });
    });

    describe('XSS via query parameters', function () {
        XSS_PAYLOADS.forEach((payload) => {
            it(`XSS payload not reflected: ${payload.slice(0, 40)}`, async function () {
                const res = await agent.get('/api/v1/search').query({ q: payload });
                // Response body must never echo the script tag verbatim
                expect(JSON.stringify(res.body)).to.not.include('<script>');
                expect(JSON.stringify(res.body)).to.not.include('onerror=');
            });
        });
    });
});
```

### 3.4 CSRF Protection

```js
// test/security/csrf.test.js
'use strict';

const { expect } = require('chai');
const request    = require('supertest');
const app        = require('../../src/app');

describe('CSRF Protection', function () {
    let agent;

    beforeEach(function () {
        // Use a persistent agent so cookies are retained between requests
        agent = request.agent(app);
    });

    it('GET /api/v1/csrf/token returns a token and sets cookie', async function () {
        const res = await agent.get('/api/v1/csrf/token');
        expect(res.status).to.equal(200);
        expect(res.body).to.have.property('token').that.is.a('string');
        // Cookie must be set
        const cookies = res.headers['set-cookie'] || [];
        expect(cookies.some(c => c.includes('csrf'))).to.be.true;
    });

    it('POST without CSRF token returns 403', async function () {
        // First get a session so CSRF cookie is set, then attempt mutation without token
        await agent.get('/api/v1/csrf/token');
        const res = await agent
            .post('/api/v1/auth/login')
            .send({ username: 'test', password: 'test' });
        expect(res.status).to.equal(403);
        expect(res.body.code).to.equal('CSRF_TOKEN_INVALID');
    });

    it('POST with valid CSRF token is accepted (not blocked by CSRF)', async function () {
        const tokenRes = await agent.get('/api/v1/csrf/token');
        const csrfToken = tokenRes.body.token;

        const res = await agent
            .post('/api/v1/auth/login')
            .set('x-csrf-token', csrfToken)
            .send({ username: 'nonexistent', password: 'wrong' });

        // May be 400/401 due to bad credentials — but must NOT be 403 CSRF error
        expect(res.status).to.not.equal(403);
    });

    it('POST with a forged CSRF token returns 403', async function () {
        await agent.get('/api/v1/csrf/token');
        const res = await agent
            .post('/api/v1/auth/login')
            .set('x-csrf-token', 'forged-token-abc123')
            .send({ username: 'test', password: 'test' });
        expect(res.status).to.equal(403);
    });

    it('GET /csrf/status describes protection configuration', async function () {
        const res = await agent.get('/api/v1/csrf/status');
        expect(res.status).to.equal(200);
        expect(res.body.status.enabled).to.be.true;
        expect(res.body.status.methods.protected).to.include('POST');
        expect(res.body.status.methods.safe).to.include('GET');
    });
});
```

### 3.5 Rate Limiting (Flood Attack)

```js
// test/security/rate-limit.test.js
'use strict';

const { expect } = require('chai');
const agent      = require('../helpers/request');

describe('Rate Limiting', function () {
    it('returns 429 after exceeding the configured limit from a single IP', async function () {
        // authRateLimiter is set to max: 10 per 15 minutes
        // We fire 15 requests and expect at least one 429
        const responses = await Promise.all(
            Array.from({ length: 15 }, () =>
                agent.post('/api/v1/auth/login').send({ username: 'x', password: 'x' }),
            ),
        );
        const tooMany = responses.filter((r) => r.status === 429);
        expect(tooMany.length).to.be.greaterThan(0);
    });

    it('429 response includes Retry-After header', async function () {
        const res = responses.find((r) => r.status === 429);
        if (res) expect(res.headers).to.have.property('retry-after');
    });

    it('RateLimit-Policy header is present on every response', async function () {
        const res = await agent.get('/api/v1/health');
        expect(res.headers).to.have.property('ratelimit-policy');
    });

    it('RateLimit-Remaining decreases with each request', async function () {
        const r1 = await agent.get('/api/v1/health');
        const r2 = await agent.get('/api/v1/health');
        const rem1 = parseInt(r1.headers['ratelimit-remaining'], 10);
        const rem2 = parseInt(r2.headers['ratelimit-remaining'], 10);
        expect(rem2).to.be.lessThanOrEqual(rem1);
    });
});
```

### 3.6 CORS

```js
// test/security/cors.test.js
'use strict';

const { expect } = require('chai');
const agent      = require('../helpers/request');

describe('CORS Policy', function () {
    it('allows requests from an explicitly allowed origin', async function () {
        const res = await agent
            .get('/api/v1/health')
            .set('Origin', 'http://localhost:3000');
        expect(res.headers['access-control-allow-origin']).to.equal('http://localhost:3000');
    });

    it('allows requests from a private network IP', async function () {
        const res = await agent
            .get('/api/v1/health')
            .set('Origin', 'http://192.168.1.100:3000');
        expect(res.headers['access-control-allow-origin']).to.exist;
    });

    it('blocks requests from a random public origin', async function () {
        const res = await agent
            .get('/api/v1/health')
            .set('Origin', 'https://evil.hacker.com');
        // Must not echo back the disallowed origin
        expect(res.headers['access-control-allow-origin']).to.not.equal('https://evil.hacker.com');
    });

    it('responds to preflight OPTIONS with correct CORS headers', async function () {
        const res = await agent
            .options('/api/v1/health')
            .set('Origin', 'http://localhost:3000')
            .set('Access-Control-Request-Method', 'GET')
            .set('Access-Control-Request-Headers', 'Authorization');
        expect(res.status).to.equal(200);
        expect(res.headers['access-control-allow-methods']).to.exist;
    });

    it('exposes X-Request-ID and X-Response-Time in Access-Control-Expose-Headers', async function () {
        const res = await agent
            .get('/api/v1/health')
            .set('Origin', 'http://localhost:3000');
        const exposed = res.headers['access-control-expose-headers'] || '';
        expect(exposed.toLowerCase()).to.include('x-request-id');
    });
});
```

### 3.7 Scanner / Path Traversal Blocking

```js
// test/security/scanner-blocking.test.js
'use strict';

const { expect } = require('chai');
const agent      = require('../helpers/request');

const SCANNER_PATHS = [
    '/robots.txt',
    '/.env',
    '/wp-admin',
    '/phpinfo.php',
    '/admin.php',
    '/login.jsp',
    '/../etc/passwd',
    '/weblogic/login',
    '/_layouts/15/error.aspx',
];

const BLOCKED_METHODS = ['TRACE', 'TRACK', 'PROPFIND'];

describe('Security Filter — Scanner & Traversal Blocking', function () {
    SCANNER_PATHS.forEach((path) => {
        it(`blocks scanner path: ${path}`, async function () {
            const res = await agent.get(path);
            // Must return 400, 403, or 404 — never 200
            expect([400, 403, 404, 405]).to.include(res.status);
        });
    });

    BLOCKED_METHODS.forEach((method) => {
        it(`blocks HTTP method: ${method}`, async function () {
            const res = await agent[method.toLowerCase()]?.('/api/v1/health')
                || await agent.options('/api/v1/health').set('X-Method-Override', method);
            // Security filter should not allow through
            expect([400, 403, 404, 405]).to.include(res.status);
        });
    });
});
```

---

## 4. Performance Tests

Performance tests assert timing guarantees. They do not replace load-testing tools
(k6, wrk) but give fast in-process feedback on regression.

### Rules

- Use `process.hrtime.bigint()` for sub-millisecond timing.
- Each timing assertion must have a documented budget and justification.
- A test environment with a cold DB pool is not a fair benchmark — warm the pool in `before()`.

```js
// test/performance/response-time.test.js
'use strict';

const { expect } = require('chai');
const agent      = require('../helpers/request');

// Warm the pool before running timing assertions
before(async function () {
    this.timeout(15_000);
    await agent.get('/api/v1/health');
});

describe('Response Time Budgets', function () {
    describe('GET /api/v1/health', function () {
        it('p50 (median of 20 runs) is under 50ms', async function () {
            const times = [];
            for (let i = 0; i < 20; i++) {
                const start = process.hrtime.bigint();
                await agent.get('/api/v1/health');
                times.push(Number(process.hrtime.bigint() - start) / 1e6);
            }
            times.sort((a, b) => a - b);
            const p50 = times[Math.floor(times.length * 0.5)];
            expect(p50).to.be.lessThan(50);
        });

        it('p95 (95th percentile of 20 runs) is under 200ms', async function () {
            const times = [];
            for (let i = 0; i < 20; i++) {
                const start = process.hrtime.bigint();
                await agent.get('/api/v1/health');
                times.push(Number(process.hrtime.bigint() - start) / 1e6);
            }
            times.sort((a, b) => a - b);
            const p95 = times[Math.floor(times.length * 0.95)];
            expect(p95).to.be.lessThan(200);
        });

        it('X-Response-Time header is present and numeric', async function () {
            const res = await agent.get('/api/v1/health');
            const rt = res.headers['x-response-time'];
            expect(rt).to.match(/^\d+ms$/);
            expect(parseInt(rt, 10)).to.be.a('number');
        });
    });
});
```

```js
// test/performance/concurrent.test.js
'use strict';

const { expect } = require('chai');
const agent      = require('../helpers/request');

describe('Concurrent Request Correctness', function () {
    it('handles 50 concurrent health checks without error', async function () {
        const results = await Promise.all(
            Array.from({ length: 50 }, () => agent.get('/api/v1/health')),
        );
        const errors = results.filter((r) => r.status >= 500);
        expect(errors.length).to.equal(0);
    });

    it('every concurrent response has a unique X-Request-ID', async function () {
        const results = await Promise.all(
            Array.from({ length: 20 }, () => agent.get('/api/v1/health')),
        );
        const ids = results.map((r) => r.headers['x-request-id']);
        const unique = new Set(ids);
        expect(unique.size).to.equal(20);
    });

    it('50 concurrent POSTs to login all receive a valid JSON error (not crash)', async function () {
        const results = await Promise.all(
            Array.from({ length: 50 }, () =>
                agent.post('/api/v1/auth/login').send({ username: 'x', password: 'x' }),
            ),
        );
        const crashes = results.filter((r) => r.status >= 500);
        expect(crashes.length).to.equal(0);
    });
});
```

---

## 5. Reliability Tests

Reliability tests verify graceful degradation, recovery from transient failures,
and correct process lifecycle behavior.

```js
// test/reliability/unhandled-errors.test.js
'use strict';

const { expect } = require('chai');
const agent      = require('../helpers/request');

describe('Unhandled Error Protection', function () {
    it('synchronous errors in routes are caught and return 500 JSON', async function () {
        // If the app exposes a deliberate throw-test route in non-production
        const res = await agent.get('/api/v1/health');
        // In normal operation, the server must never crash on a single bad request
        expect(res.status).to.be.lessThan(600);
        expect(res.headers['content-type']).to.include('application/json');
    });

    it('sending a malformed JSON body returns 400 not 500', async function () {
        const res = await agent
            .post('/api/v1/auth/login')
            .set('Content-Type', 'application/json')
            .send('{invalid json}');
        expect(res.status).to.equal(400);
        expect(res.body.status).to.equal('error');
    });

    it('sending an oversized body returns 413 not 500', async function () {
        const huge = Buffer.alloc(11 * 1024 * 1024, 'x').toString(); // 11 MB > 10MB limit
        const res = await agent
            .post('/api/v1/auth/login')
            .set('Content-Type', 'application/json')
            .send(JSON.stringify({ data: huge }));
        expect(res.status).to.equal(413);
    });
});
```

---

## 6. Test Coverage Standards

| Category | Minimum Coverage | Rationale |
|---|---|---|
| Middleware classes | 90% branch coverage | Every `if` in a security gate must be tested on both sides |
| Service classes | 85% branch coverage | Business logic dictates correctness |
| Controllers | 80% line coverage | Thin layer — mostly delegation |
| Utils / helpers | 95% line coverage | Pure functions are cheap to test exhaustively |
| Constants / messages | 100% export coverage | Verify nothing is accidentally undefined |

---

## 7. What to Test on Every New Route

When adding a new route, the following tests are **mandatory before merge**:

```
✅  Happy path — correct input, correct output, correct HTTP status
✅  Missing required fields — returns 400 with details array
✅  Invalid field types — returns 400 with field-level hints
✅  Unauthenticated request — returns 401
✅  Authenticated but unauthorized (wrong level/area) — returns 403
✅  Request body too large — returns 413
✅  Response shape matches { status, code, message, data } contract
✅  X-Request-ID is present in the response
✅  Response time under 500ms (hot path)
✅  Route is not accessible via scanner paths (if under /api/)
```

---

## 8. CI Pipeline Integration

Add to `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run unit tests
        run: npm run test:unit
        env:
          NODE_ENV: test
          JWT_SECRET: ci-test-secret
          CSRF_SECRET: ci-csrf-secret

      - name: Run integration tests
        run: npm run test:integration
        env:
          NODE_ENV: test
          JWT_SECRET: ci-test-secret
          CSRF_SECRET: ci-csrf-secret
          PORT: 4000

      - name: Run security tests
        run: npm run test:security
        env:
          NODE_ENV: test
          JWT_SECRET: ci-test-secret
          CSRF_SECRET: ci-csrf-secret
          PORT: 4001

      - name: Run performance tests
        run: npm run test:performance
        env:
          NODE_ENV: test
          JWT_SECRET: ci-test-secret
          PORT: 4002
```

---

## 9. Testing Principles (Non-Negotiable)

These rules apply to every test in this codebase regardless of category.

**Tests are deterministic.** A test that passes on one run and fails on another is
not a test — it is a liability. Eliminate time-dependent assertions, shared mutable
state across test files, and reliance on network availability in unit tests.

**Tests are independent.** No test depends on the side-effects of another test.
If test B only passes because test A inserted a row, that is a design flaw.
Use `before`/`after` hooks to set up and tear down state per-suite.

**Tests document intent.** The test description is the specification. Write it in
plain English that a non-developer can read: `"returns 403 when user level is below
route requirement"` — not `"test auth 2"`.

**Tests catch regressions, not just greenfield bugs.** Every bug fixed in production
gets a regression test. The test description includes the ticket or PR number.

**Never mock what you own.** Stub external services (Oracle, SMTP, third-party APIs)
but never stub your own middleware, services, or utilities in integration tests.
If it is your code, test the real thing.

**Security tests are permanently adversarial.** Never skip a security test because
it is "inconvenient." A skipped security test is a documented vulnerability.