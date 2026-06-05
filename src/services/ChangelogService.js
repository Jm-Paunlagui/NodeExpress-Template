"use strict";

/**
 * ChangelogService
 *
 * Business logic for the changelog feature.
 * All validation lives here; controllers stay thin.
 */

const {
    AppError,
    CHANGELOG_ERRORS,
    VALIDATION_ERRORS,
} = require("../constants/errors");
const ChangelogModel = require("../models/changelog.model");

const VALID_TYPES = [
    "feat",
    "fix",
    "patch",
    "perf",
    "refactor",
    "security",
    "docs",
    "chore",
];

// SemVer: MAJOR.MINOR.PATCH — must be numeric segments only.
const SEMVER_RE = /^\d+\.\d+\.\d+$/;

// ISO date string YYYY-MM-DD
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validates and normalises the fields for a changelog entry.
 * Throws AppError on validation failure.
 *
 * @param {object}  data           - Raw request body fields
 * @param {boolean} [requireAll=true] - false for partial update (PATCH-style)
 * @returns {object} Normalised fields
 */
function validate(data, requireAll = true) {
    const {
        displayDate,
        version,
        title,
        message,
        whatChanged,
        type,
        authors,
        coAuthors,
    } = data;

    if (requireAll) {
        if (!displayDate || !version || !title || !message || !type) {
            throw new AppError(VALIDATION_ERRORS.MISSING_FIELDS, 400, {
                type: "ValidationError",
                details: [
                    "displayDate, version, title, message, and type are required.",
                ],
            });
        }
    }

    if (displayDate !== undefined && !DATE_RE.test(displayDate)) {
        throw new AppError(CHANGELOG_ERRORS.INVALID_ENTRY, 400, {
            type: "ValidationError",
            details: ["displayDate must be YYYY-MM-DD."],
        });
    }

    if (type !== undefined && !VALID_TYPES.includes(type)) {
        throw new AppError(CHANGELOG_ERRORS.INVALID_ENTRY, 400, {
            type: "ValidationError",
            details: [`type must be one of: ${VALID_TYPES.join(", ")}.`],
        });
    }

    if (version !== undefined && !SEMVER_RE.test(String(version).trim())) {
        throw new AppError(CHANGELOG_ERRORS.INVALID_ENTRY, 400, {
            type: "ValidationError",
            details: [
                "version must follow Semantic Versioning format: MAJOR.MINOR.PATCH (e.g. 1.4.0).",
            ],
        });
    }

    if (whatChanged !== undefined && !Array.isArray(whatChanged)) {
        throw new AppError(CHANGELOG_ERRORS.INVALID_ENTRY, 400, {
            type: "ValidationError",
            details: ["whatChanged must be an array of change items."],
        });
    }

    const normalised = {};
    if (displayDate !== undefined) normalised.displayDate = displayDate;
    if (version !== undefined) normalised.version = String(version).trim();
    if (title !== undefined) normalised.title = String(title).trim();
    if (message !== undefined) normalised.message = String(message).trim();
    if (whatChanged !== undefined) normalised.whatChanged = whatChanged;
    if (type !== undefined) normalised.type = type;

    // authors / coAuthors: accept array or comma-separated string
    if (authors !== undefined) {
        normalised.authors = Array.isArray(authors)
            ? authors.map((a) => String(a).trim()).filter(Boolean)
            : String(authors)
                  .split(",")
                  .map((a) => a.trim())
                  .filter(Boolean);
    }
    if (coAuthors !== undefined) {
        normalised.coAuthors = Array.isArray(coAuthors)
            ? coAuthors.map((a) => String(a).trim()).filter(Boolean)
            : String(coAuthors)
                  .split(",")
                  .map((a) => a.trim())
                  .filter(Boolean);
    }

    return normalised;
}

class ChangelogService {
    /**
     * Lists all entries (newest first).
     * @returns {object[]}
     */
    static listAll() {
        return ChangelogModel.listAll();
    }

    /**
     * Creates a new changelog entry.
     * @param {object} body - Request body
     * @returns {object} Created entry
     */
    static create(body) {
        const data = validate(body, true);
        return ChangelogModel.create(data);
    }

    /**
     * Updates an existing entry (partial).
     * @param {string} id
     * @param {object} body
     * @returns {object} Updated entry
     */
    static update(id, body) {
        if (!id) throw new AppError(CHANGELOG_ERRORS.INVALID_ENTRY, 400);
        const data = validate(body, false);
        return ChangelogModel.update(id, data);
    }

    /**
     * Permanently deletes an entry.
     * @param {string} id
     */
    static delete(id) {
        if (!id) throw new AppError(CHANGELOG_ERRORS.INVALID_ENTRY, 400);
        ChangelogModel.delete(id);
    }
}

module.exports = ChangelogService;
