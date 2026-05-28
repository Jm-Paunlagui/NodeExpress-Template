"use strict";

/**
 * @fileoverview Cache subsystem log message templates.
 * Used ONLY in logger calls — never thrown or sent to clients.
 */

const cacheMessages = {
    /**
     * @param {string} storeName
     * @param {string} key
     * @returns {string}
     */
    CACHE_HIT: (storeName, key) =>
        `Cache HIT — store: ${storeName}, key: ${key}`,

    /**
     * @param {string} storeName
     * @param {string} key
     * @returns {string}
     */
    CACHE_MISS: (storeName, key) =>
        `Cache MISS — store: ${storeName}, key: ${key}`,

    /**
     * @param {string} storeName
     * @param {string} reason
     * @returns {string}
     */
    CACHE_BYPASS: (storeName, reason) =>
        `Cache BYPASS — store: ${storeName}, keyFn threw, falling through to controller: ${reason}`,

    /**
     * @param {string} storeName
     * @param {string} key
     * @returns {string}
     */
    CACHE_STORE: (storeName, key) =>
        `Cache STORE — store: ${storeName}, key: ${key}`,

    /**
     * @param {string} storeName
     * @param {string} keys
     * @param {number} count
     * @returns {string}
     */
    CACHE_INVALIDATE: (storeName, keys, count) =>
        `Cache INVALIDATE — store: ${storeName}, keys: [${keys}], ${count} key(s) removed`,

    /**
     * @param {string} storeName
     * @param {string} pattern
     * @param {number} count
     * @returns {string}
     */
    CACHE_INVALIDATE_PATTERN: (storeName, pattern, count) =>
        `Cache INVALIDATE — store: ${storeName}, pattern: "${pattern}", ${count} key(s) removed`,

    /**
     * @param {string} storeName
     * @param {number} count
     * @returns {string}
     */
    CACHE_INVALIDATE_WHERE: (storeName, count) =>
        `Cache INVALIDATE — store: ${storeName}, predicate match, ${count} key(s) removed`,

    /**
     * @param {string} reason
     * @returns {string}
     */
    CACHE_ERROR: (reason) =>
        `Cache INVALIDATE ERROR — keyFn threw: ${reason}`,

    /**
     * @param {string} reason
     * @returns {string}
     */
    CACHE_PREDICATE_ERROR: (reason) =>
        `Cache INVALIDATE ERROR — predicateFn threw: ${reason}`,
};

module.exports = { cacheMessages };
