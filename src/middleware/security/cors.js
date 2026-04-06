"use strict";

const cors = require("cors");
const { logger } = require("../../utils/logger");

// Explicit origins from env
const explicitOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(",")
          .map((o) => o.trim())
          .filter(Boolean)
    : [];

// Network-aware patterns (localhost, private, VPN/WFH, corporate)
const dynamicPatterns = [
    /^https?:\/\/localhost:\d+$/,
    /^https?:\/\/127\.0\.0\.1:\d+$/,
    /^https?:\/\/192\.168\.\d+\.\d+:\d+$/, // 192.168.x.x
    /^https?:\/\/10\.\d+\.\d+\.\d+:\d+$/, // 10.x.x.x
    /^https?:\/\/172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+:\d+$/, // 172.16-31.x.x
    /^https?:\/\/.+\.local(:\d+)?$/, // *.local
    /^https?:\/\/.+\.lan(:\d+)?$/, // *.lan
    /^https?:\/\/.+\.corp(\..+)?$/i, // *.corp*
    /^https?:\/\/.+\.vpn(\..+)?$/i, // *.vpn*
    /^https?:\/\/.+\.internal(\..+)?$/i, // *.internal*
];

const corsOptions = {
    origin(origin, callback) {
        // Allow requests with no origin (mobile apps, curl, server-to-server)
        if (!origin) return callback(null, true);

        // Check explicit origins
        if (explicitOrigins.includes(origin)) return callback(null, true);

        // Check dynamic patterns
        if (dynamicPatterns.some((p) => p.test(origin))) {
            return callback(null, true);
        }

        logger.warn(`CORS: origin blocked — ${origin}`);
        callback(new Error(`Origin ${origin} not allowed by CORS`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"],
    allowedHeaders: [
        "Content-Type",
        "Authorization",
        "X-CSRF-Token",
        "X-Request-ID",
        "X-Requested-With",
        "X-Client-Username",
        "X-Client-Id",
        "Accept",
        "Accept-Encoding",
        "Accept-Language",
        "Cache-Control",
    ],
    exposedHeaders: [
        "X-Request-ID",
        "X-Response-Time",
        "X-CSRF-Token",
        "Content-Disposition",
        "RateLimit-Limit",
        "RateLimit-Remaining",
        "RateLimit-Reset",
    ],
    maxAge: 86400,
    optionsSuccessStatus: 200,
};

module.exports = cors(corsOptions);
