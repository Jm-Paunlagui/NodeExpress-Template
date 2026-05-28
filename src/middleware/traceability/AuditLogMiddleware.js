"use strict";

const AuditLogService = require('../../services/AuditLogService');
const os = require('os');

// Resolve server IP once at startup
const _serverIp = (() => {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return '127.0.0.1';
})();

class AuditLogMiddleware {
  constructor(options = {}) {
    this._enabled         = options.enabled         ?? (process.env.AUDIT_LOG_ENABLED !== 'false');
    this._excludeHealth   = options.excludeHealth   ?? (process.env.AUDIT_LOG_EXCLUDE_HEALTH !== 'false');
    this._excludedPaths   = options.excludedPaths   ?? (
      process.env.AUDIT_LOG_EXCLUDE_PATHS
        ? process.env.AUDIT_LOG_EXCLUDE_PATHS.split(',').map((p) => p.trim())
        : ['/api/v1/audit-logs']
    );
    this.handle = this.handle.bind(this);
  }

  handle(req, res, next) {
    if (!this._enabled) return next();
    if (this._excludeHealth && req.path === '/health') return next();
    if (this._excludedPaths.some((p) => req.path.startsWith(p))) return next();

    const startTime      = Date.now();
    const originalEnd    = res.end.bind(res);

    res.end = (...args) => {
      const result = originalEnd(...args);
      const duration = Date.now() - startTime;
      const record = AuditLogMiddleware._buildRecord(req, res, duration);
      setImmediate(() => AuditLogService.insertAsync(record));
      return result;
    };

    next();
  }

  static _buildRecord(req, res, duration) {
    const statusCode     = res.statusCode || 200;
    const statusCategory = Math.floor(statusCode / 100) + 'xx';
    return {
      REQUEST_ID:       req.id ?? null,
      USER_ID:          req.user?.id ?? req.user?.GID ?? req.user?.userId ?? null,
      USERNAME:         req.user?.username ?? req.user?.firstName ?? null,
      METHOD:           req.method,
      ENDPOINT:         req.path,   // CWE-200: req.path only — never req.originalUrl
      PARAMS:           AuditLogMiddleware._sanitizeParams(req.query),
      STATUS_CODE:      statusCode,
      STATUS_CATEGORY:  statusCategory,
      RESPONSE_TIME_MS: duration,
      CLIENT_IP:        req.ip ?? null,
      SERVER_IP:        _serverIp,
      CREATED_AT:       new Date(),
    };
  }

  static _sanitizeParams(query) {
    if (!query || typeof query !== 'object') return null;
    const SENSITIVE = new Set(['token', 'password', 'key', 'secret', 'auth', 'apikey', 'api_key', 'access_token']);
    const filtered = {};
    for (const [k, v] of Object.entries(query)) {
      if (!SENSITIVE.has(k.toLowerCase())) filtered[k] = v;
    }
    if (Object.keys(filtered).length === 0) return null;
    const str = JSON.stringify(filtered);
    return str.length > 2000 ? str.slice(0, 1997) + '...' : str;
  }
}

const defaultAuditLog = new AuditLogMiddleware();
module.exports = { AuditLogMiddleware, defaultAuditLog };
