"use strict";

/**
 * Standard user payloads for testing.
 */

const VALID_USER = {
    username: "testuser",
    password: "TestPassword123!",
    email: "test@example.com",
    userLevel: 1,
};

const ADMIN_USER = {
    username: "adminuser",
    password: "AdminPassword456!",
    email: "admin@example.com",
    userLevel: 3,
};

const MANAGER_USER = {
    username: "manageruser",
    password: "ManagerPassword789!",
    email: "manager@example.com",
    userLevel: 2,
};

const INVALID_USER_MISSING_USERNAME = {
    password: "SomePassword123!",
    email: "nouser@example.com",
};

const INVALID_USER_MISSING_PASSWORD = {
    username: "nopwduser",
    email: "nopwd@example.com",
};

module.exports = {
    VALID_USER,
    ADMIN_USER,
    MANAGER_USER,
    INVALID_USER_MISSING_USERNAME,
    INVALID_USER_MISSING_PASSWORD,
};
