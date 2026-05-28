"use strict";

const { createDb, OracleCollection } = require("../utils/oracle-mongo-wrapper");

const _db          = createDb("Meal");
const _empAdmin    = new OracleCollection("T_EMP_MGMT_ADMIN",   _db);
const _empMasterList = new OracleCollection("T_EMP_MASTER_LIST", _db);

class MealAdmModel {
  /**
   * Finds an admin record by EMP_ID.
   *
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
   * Returns all rows in T_EMP_MGMT_ADMIN ordered by EMP_ID.
   *
   * @returns {Promise<Array<{EMP_ID: string, EMP_PW: string, EMP_ROLE: string, SYSSIGNATURE: string}>>}
   */
  static async findAll() {
    return _empAdmin
      .find({})
      .project({ EMP_ID: 1, EMP_PW: 1, EMP_ROLE: 1, SYSSIGNATURE: 1 })
      .sort({ EMP_ID: 1 })
      .toArray();
  }

  /**
   * Returns a minimal list of admins for the re-download request recipient selector.
   * Joins T_EMP_MGMT_ADMIN (EMP_ID, EMP_ROLE) with T_EMP_MASTER_LIST (NAME) so
   * the frontend can display "Full Name (EMP_ID)" instead of raw IDs.
   *
   * Only EMP_ID and EMP_ROLE are returned from the admin table — EMP_PW is
   * deliberately excluded (never expose hashed passwords in list APIs).
   *
   * @returns {Promise<Array<{ empId: number, role: string, name: string|null }>>}
   */
  static async listForSelector() {
    const admins = await _empAdmin
      .find({})
      .project({ EMP_ID: 1, EMP_ROLE: 1 })
      .sort({ EMP_ID: 1 })
      .toArray();

    // Resolve names from T_EMP_MASTER_LIST in parallel — best-effort only.
    // Missing name → name will be null; caller should display EMP_ID instead.
    const rows = await Promise.all(
      admins.map(async (a) => {
        const master = await _empMasterList
          .find({ EMP_ID: a.EMP_ID })
          .project({ EMP_NAME: 1 })
          .next()
          .catch(() => null);
        return {
          empId: Number(a.EMP_ID),
          role:  String(a.EMP_ROLE ?? ""),
          name:  master?.EMP_NAME ?? null,
        };
      }),
    );
    return rows;
  }

  /**
   * Returns true when an admin record with the given EMP_ID already exists.
   *
   * @param {string|number} empId
   * @returns {Promise<boolean>}
   */
  static async existsByEmpId(empId) {
    const count = await _empAdmin.find({ EMP_ID: empId }).count();
    return count > 0;
  }

  /**
   * Inserts a new admin record with a freshly-computed SYSSIGNATURE.
   * Caller is responsible for hashing EMP_PW and signing before calling.
   *
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
   *
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

  /**
   * Deletes an admin record by EMP_ID.
   *
   * @param {string|number} empId
   * @returns {Promise<void>}
   */
  static async deleteAdmin(empId) {
    await _empAdmin.deleteOne({ EMP_ID: empId });
  }

  /**
   * Resolves the permanent GID for an employee by their EMP_ID.
   *
   * GID is the permanent identifier — it never changes even when HR updates
   * EMP_ID across entity transfers. Returns null when the employee is not
   * yet registered in T_EMP_MASTER_LIST (e.g. new admin accounts).
   *
   * @param {string|number} empId - EMP_ID used as login credential
   * @returns {Promise<number|null>} GID, or null if not found
   */
  static async findGidByEmpId(empId) {
    const row = await _empMasterList
      .find({ EMP_ID: empId })
      .project({ GID: 1 })
      .next();
    return row ? Number(row.GID) : null;
  }
}

module.exports = MealAdmModel;
