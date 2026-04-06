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

### What MEAL has that OPTISv2 lacks (keep these)

- `oracle-mongo-wrapper` library — unique to MEAL
- `AppError` + structured error responses
- `catchAsync` utility
- `sendSuccess` / `sendError` helpers
- Adapter pattern for database engines
- Proper controller/service layer separation
- Class-based architecture across all middleware

### What OPTISv2 does differently (not adopted)

- No controller layer (routes call services directly) — MEAL's separation is better
- No `catchAsync` — uses raw try/catch in routes — MEAL's approach is safer
- Response uses `success: true/false` — MEAL's `status: "success"/"error"` with `code` is richer
- No `AppError` — throws plain `Error` — MEAL's typed errors enable cleaner error handling

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

### Project Bootstrap

Register **all** stores once at startup (e.g. `app.js` or a dedicated `src/middleware/cache/setup.js`):

```js
const { registry } = require('./middleware/cache');

registry.registerAll({
    users:   { ttl: 300  },           // expire after 5 min
    reports: { ttl: 0    },           // never expire — manual invalidation only
    tokens:  { ttl: 900, maxKeys: 10000 },
});
```

### Using on HTTP Routes

```js
const { CacheMiddleware, CacheKeyBuilder, registry } = require('../middleware/cache');
const usersStore = registry.resolve('users');

// ── Read-through GET ──────────────────────────────────────────────────────────
router.get('/users',
    CacheMiddleware.read(
        usersStore,
        (req) => CacheKeyBuilder.build('users', {
            division: req.query.division,
            page:     req.query.page,
        }),
    ),
    UserController.list,
);

// ── Exact-key invalidation after POST ────────────────────────────────────────
router.post('/users',
    UserController.create,
    CacheMiddleware.invalidate(
        usersStore,
        (req) => CacheKeyBuilder.build('users', { division: req.body.division }),
    ),
);

// ── Pattern invalidation (wipe everything that starts with "users") ──────────
router.delete('/users/:id',
    UserController.remove,
    CacheMiddleware.invalidate(usersStore, () => 'users', { usePattern: true }),
);

// ── Predicate invalidation (fine-grained multi-store) ────────────────────────
router.put('/users/:id',
    UserController.update,
    CacheMiddleware.invalidateWhere(
        [usersStore, reportsStore],
        (key, req) => key.includes(`division=${req.body.division}`),
    ),
);
```

### Service-Layer Read-Through (No HTTP)

```js
const { registry }       = require('../middleware/cache');
const { CacheKeyBuilder } = require('../middleware/cache');

const reports = registry.resolve('reports');

class ReportService {
    static async getSummary(filters) {
        const key = CacheKeyBuilder.build('report:summary', filters);
        return reports.getOrSet(key, () => ReportModel.query(filters));
    }
}
```

### Manual Invalidation from a Service

```js
// Exact delete
reports.del(CacheKeyBuilder.build('report:summary', { year: 2025, month: 1 }));

// Pattern delete — removes all keys whose string contains "report:summary"
reports.delByPattern('report:summary');

// Predicate delete — full control
reports.delWhere((key) => key.startsWith('report:') && key.includes('year=2025'));

// Flush entire store
reports.flush();

// Flush all stores at once
registry.flushAll();
```

### Architecture Rules for the Cache System

**Rule:** Every cache store name must be a noun describing the data it holds (`users`, `reports`, `tokens`), not a verb or an endpoint path.

**Rule:** `CacheKeyBuilder` is the **only** way to construct cache keys. Never build key strings manually.

**Rule:** All stores are registered at boot via `registry.registerAll()` before any request is served. Resolving an unregistered store throws immediately — no silent misses masking bugs.

**Rule:** `CacheMiddleware.invalidate()` and `invalidateWhere()` run in `setImmediate` — they never block the HTTP response.

**Rule:** The `CacheStore`, `CacheRegistry`, `CacheKeyBuilder`, and `CacheMiddleware` classes contain **zero** domain-specific logic. Project-specific key shapes and invalidation triggers belong to the route files or a project-level `src/middleware/cache/setup.js`.

### What the OPITS-BE Cache Did Wrong (Do Not Repeat)

| Problem | Fix in MEAL template |
|---|---|
| `cache.js` had 1 500+ lines of inventory-specific logic baked in | Domain logic is **outside** the cache classes |
| Key construction was ad-hoc string concatenation spread across hundreds of call sites | `CacheKeyBuilder` is the single source of truth |
| Two files (`cache.js` + `cacheManagement.js`) for one concern | Four small, single-responsibility classes |
| `CacheInvalidator` had 30+ methods for specific operations | One generic `invalidate()` / `invalidateWhere()` covers every case |
| `CacheWrapper.execute()` wrapped NodeCache in yet another layer | `CacheStore.getOrSet()` is the direct equivalent, without the indirection |
| TTL was controlled by a global env var that affected all caches | Each store gets its own `ttl` at registration time |

---

## What NOT to Change

- The `oracle-mongo-wrapper` query optimizer (Oracle hints) — not needed at this level
- The overall CTE-chaining approach in `aggregatePipeline.js` — it works
- The `withConnection` / `withTransaction` / `withBatchConnection` API surface — stable