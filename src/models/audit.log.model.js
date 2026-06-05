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
    // Total + per-category counts are derived from ONE GROUP BY STATUS_CATEGORY
    // pass so they always reconcile (total === sum of all category buckets).
    // The previous implementation used a separate total-aggregate plus four
    // independent STATUS_CATEGORY .find().count() queries; because the date
    // $match was evaluated independently per query, the buckets could fail to
    // sum to the total (e.g. Success + Redirect > Total). A single grouped pass
    // removes that drift and is 2 queries instead of 6.
    //
    // $addToSet is not supported by oracle-mongo-wrapper — distinct user count
    // is obtained via a separate GROUP BY USER_ID query run in parallel.
    const [byCategory, uniqueUserRows] = await Promise.all([
      _auditLogs.aggregate([
        { $match: matchFilter },
        {
          // _id: '$STATUS_CATEGORY' → group key returns as column STATUS_CATEGORY
          // (not _id); accumulator aliases return uppercased (CNT, RESPTIME).
          $group: {
            _id:      '$STATUS_CATEGORY',
            CNT:      { $sum: 1 },
            RESPTIME: { $sum: '$RESPONSE_TIME_MS' },
          },
        },
      ]),
      _auditLogs.aggregate([
        { $match: { ...matchFilter, USER_ID: { $gt: 0 } } },
        { $group: { _id: '$USER_ID', N: { $sum: 1 } } },
      ]),
    ]);

    const stats = AuditLogModel._reduceCategoryGroups(byCategory);

    return {
      total:           stats.total,
      success:         stats.buckets['2xx'],
      redirect:        stats.buckets['3xx'],
      clientError:     stats.buckets['4xx'],
      serverError:     stats.buckets['5xx'],
      uniqueUsers:     (uniqueUserRows ?? []).length,
      avgResponseTime: stats.total > 0
                         ? Math.round(stats.totalRespTime / stats.total)
                         : 0,
    };
  }

  /**
   * Reduce the rows of a `GROUP BY STATUS_CATEGORY` aggregate into a total,
   * total response time, and per-category counts. Pure function — no DB access,
   * so the reconciliation guarantee (total === Σ buckets + uncategorised) is
   * unit-testable in isolation.
   *
   * Rows whose STATUS_CATEGORY is null/blank or outside 2xx–5xx still count
   * toward `total` but match no bucket, so an inflated total (total > Σ known
   * buckets) is a visible signal of uncategorised audit rows rather than a
   * silently dropped request.
   *
   * @param {Array<{ STATUS_CATEGORY?: string, CNT?: number, RESPTIME?: number }>} rows
   * @returns {{ total: number, totalRespTime: number, buckets: { '2xx': number, '3xx': number, '4xx': number, '5xx': number } }}
   */
  static _reduceCategoryGroups(rows) {
    const buckets = { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 };
    let total = 0;
    let totalRespTime = 0;

    for (const r of rows ?? []) {
      const count = Number(r.CNT) || 0;
      total += count;
      totalRespTime += Number(r.RESPTIME) || 0;

      // Trim guards against CHAR-padded columns ('4xx   ' !== '4xx').
      const cat = (r.STATUS_CATEGORY ?? '').trim();
      if (Object.prototype.hasOwnProperty.call(buckets, cat)) {
        buckets[cat] += count;
      }
    }

    return { total, totalRespTime, buckets };
  }
}

module.exports = AuditLogModel;
