# Project: Project Template for Node.js Express API
This project template provides a basic structure for building a Node.js Express API. It includes essential middleware for security, performance, and request parsing. The template is designed to be easily extendable, allowing you to add routes, controllers, and other features as needed.

## Features
- Express.js for building the API
- Helmet for securing HTTP headers
- CSRF protection for preventing cross-site request forgery attacks
- CORS for enabling cross-origin requests
- Compression for improving performance
- Cookie-parser for parsing cookies
- Body-parser for parsing JSON and URL-encoded request bodies
- Basic error handling middleware
- Standard response format for API responses 
- Standard error response format for API errors
- Supports Oracle Database connection using oracledb
- Supports MySQL Database connection using mysql2
- Environment variable management with dotenv
- Prevent Redirects for API routes to enhance security
- Captures user and request tracing information in logs for better debugging and monitoring
- Captures and logs all errors with stack traces for easier debugging and monitoring
- Captures Incoming request details (method, URL, headers, body) in logs for better debugging and monitoring
- Captures Outgoing response details (status code, headers, body) in logs for better debugging and monitoring
- Sliding Window Counter rate limiting to protect against abuse and DDoS attacks
- IP filtering middleware to restrict access to trusted IP addresses or ranges
- Graceful shutdown handling to ensure proper cleanup of resources on server shutdown
- OracleDB wrapper library that mimics MongoDB's API while leveraging Oracle's SQL capabilities (in `src/utils/oracle-mongo-wrapper/`)

## Project Structure
express-template/
├── server.js                        # Entry point – HTTP/HTTPS, graceful shutdown
├── package.json
├── .env.example                     # All env vars documented with safe defaults
├── certs/                           # Drop server.key + server.crt here for HTTPS
├── logs/                            # Auto-created rotating log files land here
│
└── src/
    ├── app.js                       # Express app (middleware chain, routes)
    │
    ├── config/
    │   ├── index.js                 # Central config object (validates prod secrets)
    │   ├── database.js              # DB manager with retry logic + adapter pattern
    │   └── adapters/
    │       ├── mysql.js             # MySQL (mysql2) later setup, priority is OracleDB  
    │       └── oracle.js            # OracleDB (oracledb)
    |
    ├── constants/
    │   ├── index.js                 # App-wide constants (e.g. HTTP status codes)
    │   ├── errors/
    │   │   └── index.js             # App-wide error messages + codes + types + stack traces
    │   └── responses/
    │       └── index.js             # App-wide response messages + codes + types + stack traces
    │   
    ├── middleware/
    │   ├── security/
    │   │   ├── csrf.js                 # Double-submit cookie CSRF (replaces csurf)
    │   │   ├── cors.js                 # CORS configuration middleware
    │   │   ├── helmet.js               # Helmet configuration for secure HTTP headers
    │   │   ├── filterIPs.js            # Middleware to filter requests based on IP address
    |   |   |-- rateLimiter.js          # Sliding Window Counter rate limiting middleware
    |   |   |-- traceability.js         # To add user and request tracing information to logs for better debugging and monitoring
    │   │   └── preventRedirects.js     # Prevents automatic redirections for API security
    |   |
    │   ├── performance/
    │   │   └── compression.js          # Compression middleware (gzip)
    |   |
    │   ├── parsing/
    │   │   ├── bodyParser.js          # Body parsing middleware (JSON + URL-encoded)
    │   │   └── cookieParser.js        # Cookie parsing middleware
    |   |
    │   |-- authentication/
    │   │   └── auth.js                # Placeholder for authentication middleware (e.g. JWT)
    |   |
    │   └── errorHandling/
    │       └── errorHandler.js        # Centralized error handling middleware and where all errors funnel through
    │
    ├── routes/
    │   ├── index.js                 # Route aggregator
    │   └── health.js                # GET /api/health (liveness + DB ping)
    │
    ├── controllers/                 # One controller per resource
    ├── models/                      # DB models / schemas
    ├── services/                    # Business logic (keeps controllers thin)
    └── utils/
        ├── logger.js                # Winston – daily rotating files + console
        └── oracle-mongo-wrapper/  # Wrapper library that mimics MongoDB's API while leveraging Oracle's SQL capabilities
            
## Architecture Rules
 
### Controllers
- Only handle `req`/`res`/`next` — no DB calls, no business logic
- Always delegate to a service, then return a formatted response
- Wrap in `catchAsync` to avoid try/catch boilerplate
 
```js
export const getUser = catchAsync(async (req, res) => {
  const user = await userService.getById(req.params.id);
  res.json(sendSuccess('User fetched', user));
});
```
 
### Services
- All business logic lives here
- Interact with models/DB directly
- Throw `AppError` on failure — never send HTTP responses from here
 
### Models
- DB schemas only (OracleDB or MySQL — check `src/models/`)
- No business logic in models
 
---
 
## API Response Shape
Always use the standardized response format. Never return raw data.
- for error responses: status + code + message + error details
- for success responses: status + code + message + data
 
**Success:**
```json
{
  "status": "success",
  "code": 200,
  "message": "User fetched successfully",
  "data": { ... }
}
```

**Error:**
```json
{
  "status": "error",
  "code": 400,
  "message": "Invalid request data",
  "error": {
    "type": "ValidationError",
    "details": [
      { "field": "email", "issue": "Invalid email format" },
      { "field": "password", "issue": "Password must be at least 8 characters" }
    ],
    "hint": "Ensure the email is valid and the password meets complexity requirements.",
    "stack": "ValidationError: Invalid request data at ... "
  }
}
```

Use `sendSuccess(message, data)` and `sendError(message, error)` helpers to generate these responses in controllers.
 
---
 
## Error Handling
- Throw `new AppError(message, statusCode)` from services/controllers
- The global error middleware in `middlewares/errorHandler.js` catches everything
- Never `console.error` raw errors in production — use the Winston logger
- Handle unhandled promise rejections and uncaught exceptions in `app.js`
 
---
 
## Middleware Stack (order matters)
```js
app.use(helmet())
app.use(cors())
app.use(express.json())
app.use(morgan('dev'))
app.use(rateLimiter)
```
Do not reorder these without a reason.
 
---
 
## Auth
- JWT-based auth. Tokens issued at `POST /api/v1/auth/login`
- Protect routes with `authenticate` middleware from `middlewares/auth.js`
- Refresh tokens stored in DB; access tokens are stateless
- Passwords hashed with `bcryptjs` or plain text which is configured in `.env` (for testing)
 
Auth routes:
- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`
 
---
 
## Route Conventions
- All routes prefixed with `/api/v1/`
- Group by resource: `authRoutes`, `userRoutes`, etc.
- Health check: `GET /health` → always returns `200 OK`
 
---
 
## Validation
- Validate all incoming request bodies using `zod` (or `joi` — check existing schemas)
- Validation middleware sits before the controller in the route definition
- Reject early; never let invalid data reach the service layer
 
---
 
## Environment Variables
- Copy `.env.example` and fill values before running
- Load via `src/config/env.js` — never import `dotenv` directly in feature files
- Required vars: `PORT`, `NODE_ENV`, `DATABASE_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`

## Gotchas
- Always use `catchAsync` around async controller functions — missing it will crash the process on unhandled rejections
- `cors()` origin whitelist is in `src/config/constants.js` — update it for new environments
- Prisma: run `npx prisma generate` after any schema change before starting the server
- Rate limiter is per-IP by default — adjust `windowMs` and `max` in `middlewares/rateLimiter.js` for specific routes if needed