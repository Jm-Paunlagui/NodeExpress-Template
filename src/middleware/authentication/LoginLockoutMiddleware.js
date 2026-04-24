"use strict";

/**
 * @fileoverview Per-user login lockout with configurable fixed/incremental mode.
 *
 * WHAT THIS FILE DOES
 *   Tracks failed login attempts per userId using CacheStore (in-memory, 24h TTL).
 *   Enforces a progressive lockout policy:
 *     - Each lockout cycle reduces the number of allowed attempts by LOGIN_RETRY_DECREMENT.
 *     - In incremental mode each lockout duration multiplies by LOGIN_LOCKOUT_MULTIPLIER.
 *     - After LOGIN_MAX_LOCKOUT_CYCLES completed cycles the account enters HR-reset state
 *       where every subsequent attempt is rejected with 423 until HR clears the record.
 *
 * HOW IT WORKS
 *   State per userId in CacheStore (24h TTL):
 *   {
 *     cycles:     number   — completed lockout episodes
 *     currentMax: number   — max attempts allowed in the current window
 *     failCount:  number   — failures in the current window
 *     lockUntil:  number|null — Date.now() ms when lock expires, null if not locked
 *   }
 *
 *   check(userId)         — read-only; returns { locked, retryAfter?, hrReset? }
 *   recordFailure(userId) — increments fail count, engages lockout when threshold hit
 *   recordSuccess(userId) — deletes the key (clean slate on good login)
 *
 * EXAMPLE
 *   const { loginLockout } = require('./LoginLockoutMiddleware');
 *
 *   // In AuthService.login():
 *   const lockState = loginLockout.check(userId);
 *   if (lockState.hrReset) throw new AppError(AUTH_ERRORS.ACCOUNT_LOCKED_PERMANENTLY, 423, ...);
 *   if (lockState.locked)  throw new AppError(AUTH_ERRORS.ACCOUNT_LOCKED, 429, ...);
 *
 *   // On credential failure:
 *   loginLockout.recordFailure(userId);
 *
 *   // On successful authentication:
 *   loginLockout.recordSuccess(userId);
 */

const { CacheStore } = require("../cache");
const { logger } = require("../../utils/logger");
const { authMessages } = require("../../constants/messages");

// ── Config (read once at class instantiation) ─────────────────────────────────

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_LOCKOUT_MODE = "incremental"; // 'fixed' | 'incremental'
const DEFAULT_LOCKOUT_DURATION_MS = 30_000; // 30 s
const DEFAULT_LOCKOUT_MULTIPLIER = 2;
const DEFAULT_MAX_LOCKOUT_CYCLES = 3;
const DEFAULT_RETRY_DECREMENT = 1;

class LoginLockoutMiddleware {
    /**
     * @param {object} [options]
     * @param {number}  [options.maxAttempts]      - LOGIN_MAX_ATTEMPTS. Default 3.
     * @param {string}  [options.lockoutMode]      - 'fixed' | 'incremental'. Default 'incremental'.
     * @param {number}  [options.lockoutDurationMs] - Base lockout duration in ms. Default 30000.
     * @param {number}  [options.lockoutMultiplier] - Incremental multiplier per cycle. Default 2.
     * @param {number}  [options.maxLockoutCycles]  - Cycles before HR-reset state. Default 3.
     * @param {number}  [options.retryDecrement]    - Attempts removed each cycle. Default 1.
     * @param {CacheStore} [options.store]           - Override the CacheStore instance (for testing).
     */
    constructor(options = {}) {
        this._maxAttempts =
            options.maxAttempts ??
            parseInt(process.env.LOGIN_MAX_ATTEMPTS || String(DEFAULT_MAX_ATTEMPTS), 10);

        this._lockoutMode =
            options.lockoutMode ??
            (process.env.LOGIN_LOCKOUT_MODE || DEFAULT_LOCKOUT_MODE);

        this._lockoutDurationMs =
            options.lockoutDurationMs ??
            parseInt(process.env.LOGIN_LOCKOUT_DURATION_MS || String(DEFAULT_LOCKOUT_DURATION_MS), 10);

        this._lockoutMultiplier =
            options.lockoutMultiplier ??
            parseFloat(process.env.LOGIN_LOCKOUT_MULTIPLIER || String(DEFAULT_LOCKOUT_MULTIPLIER));

        this._maxLockoutCycles =
            options.maxLockoutCycles ??
            parseInt(process.env.LOGIN_MAX_LOCKOUT_CYCLES || String(DEFAULT_MAX_LOCKOUT_CYCLES), 10);

        this._retryDecrement =
            options.retryDecrement ??
            parseInt(process.env.LOGIN_RETRY_DECREMENT || String(DEFAULT_RETRY_DECREMENT), 10);

        this._store =
            options.store ??
            new CacheStore("loginLockout", { ttl: 86400, checkPeriod: 600 });
    }

    // ── Public API ────────────────────────────────────────────────────────────

    /**
     * Checks the current lockout state for a userId without mutating it.
     *
     * @param {string} userId
     * @returns {{ locked: boolean, retryAfter?: number, hrReset?: boolean }}
     *   locked     — true if still within a lockout window
     *   retryAfter — seconds remaining in the lockout (only when locked)
     *   hrReset    — true when all cycles have been consumed (permanent block)
     */
    check(userId) {
        const state = this._readState(userId);
        const now = Date.now();

        // Active lockout window?
        if (state.lockUntil && now < state.lockUntil) {
            return {
                locked: true,
                retryAfter: Math.ceil((state.lockUntil - now) / 1000),
            };
        }

        // Lockout window expired — clear it so the caller sees a fresh window
        if (state.lockUntil && now >= state.lockUntil) {
            state.lockUntil = null;
            state.failCount = 0;
            this._writeState(userId, state);
        }

        // All cycles exhausted → permanent HR-reset block
        if (state.cycles >= this._maxLockoutCycles) {
            logger.warn(authMessages.LOGIN_LOCKOUT_PERMANENT(userId));
            return { locked: false, hrReset: true };
        }

        return { locked: false };
    }

    /**
     * Records a failed login attempt for a userId.
     * Engages a lockout when failCount reaches currentMax.
     *
     * @param {string} userId
     * @returns {object} The updated state object (for logging / testing).
     */
    recordFailure(userId) {
        const state = this._readState(userId);
        const now = Date.now();

        // Clear any expired lockout first
        if (state.lockUntil && now >= state.lockUntil) {
            state.lockUntil = null;
            state.failCount = 0;
        }

        state.failCount += 1;

        logger.warn(
            authMessages.LOGIN_ATTEMPT_FAILED(userId, state.failCount, state.currentMax),
        );

        if (state.failCount >= state.currentMax) {
            state.cycles += 1;

            const lockDuration =
                this._lockoutMode === "fixed"
                    ? this._lockoutDurationMs
                    : this._lockoutDurationMs * Math.pow(this._lockoutMultiplier, state.cycles - 1);

            state.lockUntil = now + lockDuration;
            state.currentMax = Math.max(1, state.currentMax - this._retryDecrement);
            state.failCount = 0;

            logger.warn(
                authMessages.LOGIN_LOCKOUT_ENGAGED(userId, lockDuration, state.cycles),
            );
        }

        this._writeState(userId, state);
        return state;
    }

    /**
     * Clears the lockout state for a userId on successful authentication.
     *
     * @param {string} userId
     */
    recordSuccess(userId) {
        this._store.del(userId);
        logger.info(authMessages.LOGIN_LOCKOUT_CLEARED(userId));
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    /**
     * Returns the current state for a userId, initialising defaults if absent.
     * @param {string} userId
     * @returns {{ cycles: number, currentMax: number, failCount: number, lockUntil: number|null }}
     * @private
     */
    _readState(userId) {
        return (
            this._store.get(userId) ?? {
                cycles: 0,
                currentMax: this._maxAttempts,
                failCount: 0,
                lockUntil: null,
            }
        );
    }

    /**
     * Persists state back into the cache with a 24h TTL.
     * @param {string} userId
     * @param {object} state
     * @private
     */
    _writeState(userId, state) {
        this._store.set(userId, state, 86400);
    }
}

// ── Singleton export ──────────────────────────────────────────────────────────

const loginLockout = new LoginLockoutMiddleware();

module.exports = { LoginLockoutMiddleware, loginLockout };
