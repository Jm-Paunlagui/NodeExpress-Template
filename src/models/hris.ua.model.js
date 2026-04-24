"use strict";

const { createDb, OracleCollection } = require("../utils/oracle-mongo-wrapper");

const _db = createDb("userAccount");
const _users = new OracleCollection("U_USERS", _db);

class HrisUaModel {
    /**
     * Finds a user in U_USERS by USERID, left-joined with U_PERSONALINFOS
     * so that EMAILADDRESS is returned in a single round-trip.
     * Returns null when the user does not exist.
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
}

module.exports = HrisUaModel;
