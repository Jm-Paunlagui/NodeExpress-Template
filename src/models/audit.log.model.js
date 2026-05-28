"use strict";

const { createDb, OracleCollection } = require('../utils/oracle-mongo-wrapper');

const _db        = createDb('Meal');
const _auditLogs = new OracleCollection('T_AUDIT_LOGS', _db);

class AuditLogModel {
  static async insert(record) {
    return _auditLogs.insertOne(record);
  }

  static async findPaginated(filter, page, pageSize) {
    return _auditLogs
      .find(filter)
      .sort({ CREATED_AT: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .toArray();
  }

  static async countTotal(filter) {
    return _auditLogs.find(filter).count();
    // .count() is the terminal method on QueryBuilder — NOT countDocuments()
  }

  /**
   * Permanently delete all audit log records matching the supplied filter.
   *
   * @param {object} filter - oracle-mongo-wrapper filter object.
   * @returns {Promise<object>} Raw oracle-mongo-wrapper deleteMany result.
   */
  static async deleteMany(filter) {
    return _auditLogs.deleteMany(filter);
  }

  static async aggregate(matchFilter) {
    // $addToSet is not supported by oracle-mongo-wrapper — distinct user count
    // is obtained via a separate GROUP BY USER_ID query run in parallel.
    const [base, successCount, redirectCount, clientErrCount, serverErrCount, uniqueUserRows] =
      await Promise.all([
        _auditLogs.aggregate([
          { $match: matchFilter },
          {
            $group: {
              _id:           null,
              TOTAL:         { $sum: 1 },
              TOTALRESPTIME: { $sum: '$RESPONSE_TIME_MS' },
            },
          },
        ]),
        _auditLogs.find({ ...matchFilter, STATUS_CATEGORY: '2xx' }).count(),
        _auditLogs.find({ ...matchFilter, STATUS_CATEGORY: '3xx' }).count(),
        _auditLogs.find({ ...matchFilter, STATUS_CATEGORY: '4xx' }).count(),
        _auditLogs.find({ ...matchFilter, STATUS_CATEGORY: '5xx' }).count(),
        _auditLogs.aggregate([
          { $match: { ...matchFilter, USER_ID: { $gt: 0 } } },
          { $group: { _id: '$USER_ID', n: { $sum: 1 } } },
        ]),
      ]);

    const row = base[0] ?? { TOTAL: 0, TOTALRESPTIME: 0 };
    return {
      total:           row.TOTAL,
      success:         successCount,
      redirect:        redirectCount,
      clientError:     clientErrCount,
      serverError:     serverErrCount,
      uniqueUsers:     (uniqueUserRows ?? []).length,
      avgResponseTime: row.TOTAL > 0
                         ? Math.round(row.TOTALRESPTIME / row.TOTAL)
                         : 0,
    };
  }
}

module.exports = AuditLogModel;
