"use strict";

const { createDb, OracleCollection } = require("../utils/oracle-mongo-wrapper");

const _db = createDb("userAccount");
const _users = new OracleCollection("U_USERS", _db);

class HrisUaModel {
  /**
   * Finds a user in U_USERS by USERID, left-joined with U_PERSONALINFOS
   * so that EMAILADDRESS is returned in a single round-trip.
   * Returns null when the user does not exist.
   *
   * @param {string|number} userId
   * @returns {Promise<object|null>}
   */
  static async findByUserId(userId) {
    const rows = await _users.aggregate([
      { $match: { USERID: userId } },
      {
        $lookup: {
          from: "U_PERSONALINFOS",
          localField: "USERID",
          foreignField: "USERID",
          as: "pi",
          joinType: "left",
          select: ["EMAILADDRESS"],
        },
      },
      {
        $project: {
          USERID: 1,
          PASSWORD: 1,
          FIRSTNAME: 1,
          LASTNAME: 1,
          SEGMENT_CODE: 1,
          SEGMENT_DESC: 1,
          EMAILADDRESS: 1,
        },
      },
    ]);
    return rows[0] ?? null;
  }

  /**
   * Searches U_USERS by USERID, FIRSTNAME, or LASTNAME using partial
   * matching (LIKE '%term%'). Returns up to 20 results.
   *
   * The search term is uppercased before matching because HRIS stores
   * employee data in uppercase. All values flow through parseFilter
   * bind variables — no raw string interpolation.
   *
   * @param {string} query - Search term (employee ID, first name, or last name)
   * @returns {Promise<Array<{USERID: string, FIRSTNAME: string, LASTNAME: string, SEGMENT_CODE: string, SEGMENT_DESC: string}>>}
   *
   * @example
   * const results = await HrisUaModel.searchEmployees('JUAN');
   * // Matches USERID LIKE '%JUAN%' OR FIRSTNAME LIKE '%JUAN%' OR LASTNAME LIKE '%JUAN%'
   */
  static async searchEmployees(query) {
    // Search strategy:
    //   - All three fields use $regex with $options: 'i' for case-insensitive
    //     partial matching. This avoids assuming HRIS stores data in any
    //     specific case (some fields are uppercase, others are mixed).
    //   - Multi-word queries (e.g. "Juan Dela Cruz") are split into tokens.
    //     Each token must match at least one of USERID / FIRSTNAME / LASTNAME.
    //     This allows searching by full name across separate columns.
    //
    // Why $regex instead of $like?
    //   Oracle LIKE is case-sensitive. $regex maps to REGEXP_LIKE which
    //   accepts a third 'i' flag for case-insensitive matching — works
    //   regardless of how the HRIS stores the data.
    //
    // Bind variable safety: all values flow through parseFilter per-call
    // counters — no raw string interpolation.
    const tokens = query.trim().split(/\s+/).filter(Boolean);

    // Each token must match at least one column ($and across tokens, $or within).
    // Regex special chars are escaped to prevent injection into the pattern.
    const tokenFilters = tokens.map((token) => {
      const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return {
        $or: [
          { USERID: { $regex: escaped, $options: "i" } },
          { FIRSTNAME: { $regex: escaped, $options: "i" } },
          { LASTNAME: { $regex: escaped, $options: "i" } },
        ],
      };
    });

    const rows = await _users.aggregate([
      {
        $match:
          tokenFilters.length === 1 ? tokenFilters[0] : { $and: tokenFilters },
      },
      {
        $project: {
          USERID: 1,
          FIRSTNAME: 1,
          LASTNAME: 1,
          SEGMENT_CODE: 1,
          SEGMENT_DESC: 1,
        },
      },
      { $limit: 20 },
    ]);
    return rows;
  }
}

module.exports = HrisUaModel;
