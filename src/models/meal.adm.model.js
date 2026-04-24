"use strict";

const { createDb, OracleCollection } = require("../utils/oracle-mongo-wrapper");

const _db = createDb("Meal");
const _empAdmin = new OracleCollection("T_EMP_MGMT_ADMIN", _db);

class MealAdmModel {
    /**
     * Finds an admin record by EMP_ID.
     * @param {string|number} empId
     * @returns {Promise<object|null>}
     */
    static async findByEmpId(empId) {
        return _empAdmin
            .find({ EMP_ID: empId })
            .project({ EMP_ID: 1, EMP_PW: 1, EMP_ROLE: 1, SYSSIGNATURE: 1 })
            .next();
    }

    /**
     * Inserts a new admin record with a freshly-computed SYSSIGNATURE.
     * Caller is responsible for hashing EMP_PW and signing before calling.
     * @param {string|number} empId
     * @param {string} empPwHash   - hashed password (bcrypt or argon2)
     * @param {string} empRole
     * @param {string} sysSignature - from CryptoVault.signRecord()
     * @returns {Promise<void>}
     */
    static async insertAdmin(empId, empPwHash, empRole, sysSignature) {
        // T_EMP_MGMT_ADMIN has no "ID" column — returning EMP_ID prevents
        // insertOne from appending the default RETURNING "ID" clause.
        await _empAdmin.insertOne(
            {
                EMP_ID: empId,
                EMP_PW: empPwHash,
                EMP_ROLE: empRole,
                SYSSIGNATURE: sysSignature,
            },
            { returning: ["EMP_ID"] },
        );
    }

    /**
     * Updates EMP_PW / EMP_ROLE and renews SYSSIGNATURE atomically.
     * Only call this after computing a fresh signature via CryptoVault.signRecord().
     * @param {string|number} empId
     * @param {string} empPwHash
     * @param {string} empRole
     * @param {string} sysSignature
     * @returns {Promise<void>}
     */
    static async updateAdmin(empId, empPwHash, empRole, sysSignature) {
        await _empAdmin.updateOne(
            { EMP_ID: empId },
            {
                $set: {
                    EMP_PW: empPwHash,
                    EMP_ROLE: empRole,
                    SYSSIGNATURE: sysSignature,
                },
            },
        );
    }
}

module.exports = MealAdmModel;
