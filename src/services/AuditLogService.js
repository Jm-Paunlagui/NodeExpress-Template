"use strict";

const fs   = require('fs').promises;
const path = require('path');

const { logger }   = require('../utils/logger');
const { AppError, AUDIT_LOG_ERRORS } = require('../constants/errors');
const { auditLogMessages } = require('../constants/messages');
const AuditLogModel = require('../models/audit.log.model');

// Lazy-loaded to avoid hard dependency at startup
let _ExcelJS   = null;
let _archiverMod = null;

const _getExcelJS  = () => { if (!_ExcelJS)     _ExcelJS     = require('exceljs');  return _ExcelJS; };
const _getArchiver = () => { if (!_archiverMod) _archiverMod = require('archiver'); return _archiverMod; };

class AuditLogService {
  /**
   * Fire-and-forget audit log insert. Never throws — all errors are swallowed
   * with a warn log so a DB hiccup never disrupts the HTTP response.
   *
   * @param {object} record - The audit log record to persist.
   * @returns {Promise<void>}
   */
  static async insertAsync(record) {
    try {
      await AuditLogModel.insert(record);
    } catch (err) {
      logger.warning(auditLogMessages.INSERT_FAILED(record.REQUEST_ID, err.message));
    }
  }

  /**
   * Retrieve a paginated list of audit log entries with optional filters.
   *
   * @param {object} params
   * @param {number} params.page              - Page number (1-based).
   * @param {number} params.pageSize          - Rows per page (capped at 100).
   * @param {string} [params.fromDate]        - ISO date string lower bound (inclusive).
   * @param {string} [params.toDate]          - ISO date string upper bound (inclusive, end-of-day).
   * @param {string} [params.method]          - HTTP method filter (e.g. 'GET').
   * @param {string} [params.statusCategory]  - Status category filter (e.g. '4xx').
   * @param {string} [params.search]          - Partial text search across USERNAME, CLIENT_IP, and GID.
   * @returns {Promise<{ rows: object[], total: number, page: number, pageSize: number, totalPages: number }>}
   * @throws {AppError} 400 when fromDate is not before toDate.
   */
  static async getList({ page, pageSize, fromDate, toDate, method, statusCategory, search }) {
    const cappedPageSize = Math.min(pageSize, 100);

    if (fromDate && toDate) {
      const from = new Date(fromDate);
      const to   = new Date(toDate);
      if (isNaN(from.getTime()) || isNaN(to.getTime()) || from >= to) {
        throw new AppError(AUDIT_LOG_ERRORS.INVALID_DATE_RANGE, 400);
      }
    }

    const filter = {};

    if (fromDate && toDate) {
      filter.CREATED_AT = {
        $gte: new Date(fromDate),
        $lte: new Date(new Date(toDate).setHours(23, 59, 59, 999)),
      };
    }

    if (method)         filter.METHOD          = method;
    if (statusCategory) filter.STATUS_CATEGORY = statusCategory;

    if (search) {
      const orClauses = [
        { USERNAME:  { $regex: search } },
        { CLIENT_IP: { $regex: search } },
      ];
      // USER_ID is NUMBER (stores GID/EMP_ID); $regex is invalid on NUMBER columns —
      // add an exact equality match only when the search term is a valid integer.
      const numericId = /^\d+$/.test(search.trim()) ? parseInt(search.trim(), 10) : null;
      if (numericId !== null) orClauses.push({ USER_ID: numericId });
      filter.$or = orClauses;
    }

    const [rows, total] = await Promise.all([
      AuditLogModel.findPaginated(filter, page, cappedPageSize),
      AuditLogModel.countTotal(filter),
    ]);

    logger.info(auditLogMessages.LIST_FETCHED(rows.length, page));

    return {
      rows,
      total,
      page,
      pageSize: cappedPageSize,
      totalPages: Math.ceil(total / cappedPageSize),
    };
  }

  /**
   * Retrieve aggregate statistics for audit log entries within a date range.
   *
   * @param {object} params
   * @param {string} [params.fromDate] - ISO date string. Defaults to 30 days ago.
   * @param {string} [params.toDate]   - ISO date string. Defaults to today 23:59:59.
   * @returns {Promise<object>} Aggregate statistics including successRate.
   */
  static async getStats({ fromDate, toDate }) {
    const resolvedToDate   = toDate   ? new Date(new Date(toDate).setHours(23, 59, 59, 999))
                                      : new Date(new Date().setHours(23, 59, 59, 999));
    const resolvedFromDate = fromDate ? new Date(fromDate)
                                      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const matchFilter = {
      CREATED_AT: {
        $gte: resolvedFromDate,
        $lte: resolvedToDate,
      },
    };

    const agg = await AuditLogModel.aggregate(matchFilter);

    // ── Availability SLI (health) ─────────────────────────────────────────────
    // Client errors (4xx) are EXCLUDED from the denominator — a 4xx means the
    // service correctly rejected bad input, not that it failed. Availability
    // answers: "of the requests the server was responsible for, what fraction
    // were served correctly?"
    //   serviced     = total − clientError          (= success + redirect + serverError)
    //   availability = (success + redirect) / serviced
    const serviced = agg.total - agg.clientError;

    const successRate = serviced > 0
      ? parseFloat(((agg.success + agg.redirect) / serviced * 100).toFixed(1))
      : 100.0; // no serviced requests → nothing failed → fully available

    // ── Error rates (traffic breakdown) ───────────────────────────────────────
    // Each error class as an INDEPENDENT share of TOTAL traffic, so Client and
    // Server rates are symmetric and directly comparable. NOTE: these are a
    // traffic breakdown, not the availability SLI — availability deliberately
    // ignores 4xx, so availability is NOT 1 − serverErrorRate.
    //   clientErrorRate = clientError / total
    //   serverErrorRate = serverError / total
    const clientErrorRate = agg.total > 0
      ? parseFloat((agg.clientError / agg.total * 100).toFixed(1))
      : 0.0;

    const serverErrorRate = agg.total > 0
      ? parseFloat((agg.serverError / agg.total * 100).toFixed(1))
      : 0.0;

    logger.info(auditLogMessages.STATS_FETCHED(resolvedFromDate.toISOString(), resolvedToDate.toISOString()));

    return {
      total:           agg.total,
      success:         agg.success,
      redirect:        agg.redirect,
      clientError:     agg.clientError,
      serverError:     agg.serverError,
      uniqueUsers:     agg.uniqueUsers,
      avgResponseTime: agg.avgResponseTime,
      successRate,       // Availability (SLI) — 4xx excluded from denominator
      clientErrorRate,   // 4xx / total — independent traffic share
      serverErrorRate,   // 5xx / total — independent traffic share
      fromDate:        resolvedFromDate.toISOString(),
      toDate:          resolvedToDate.toISOString(),
    };
  }

  /**
   * Read log files for a given date and return all lines that reference requestId.
   * Searches info*.log, warn*.log, and error*.log (including rotation files) in the
   * daily log directory. Lines are merged across all three level files and sorted
   * chronologically by their embedded [YYYY-MM-DD HH:MM:SS] timestamp.
   *
   * @param {string} requestId  - Request ID (e.g. "req_abc1234567").
   * @param {string} dateStr    - ISO date string YYYY-MM-DD (the day to search).
   * @returns {Promise<{ requestId: string, lines: string[] }>}
   */
  static async getRequestLogs(requestId, dateStr) {
    if (!requestId || !/^req_[A-Za-z0-9_-]{1,30}$/.test(requestId)) {
      throw new AppError(AUDIT_LOG_ERRORS.AUDIT_LOG_INVALID_REQUEST_ID, 400);
    }
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      throw new AppError(AUDIT_LOG_ERRORS.AUDIT_LOG_INVALID_DATE_FORMAT, 400);
    }

    const [year, month, day] = dateStr.split('-');
    const logDir  = path.join(process.cwd(), 'logs', year, month, day);
    const token   = `[${requestId}]`;
    const matched = [];

    let files;
    try {
      const all = await fs.readdir(logDir);
      files = all
        .filter((f) => /^(info|warn|error)(_\d+)?\.log$/.test(f))
        .sort();
    } catch {
      return { requestId, lines: [] };
    }

    const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB safety cap per file

    for (const file of files) {
      try {
        const filePath = path.join(logDir, file);
        const stat     = await fs.stat(filePath);
        if (stat.size > MAX_FILE_BYTES) continue; // skip oversized files

        const content = await fs.readFile(filePath, 'utf8');
        for (const line of content.split('\n')) {
          if (line.includes(token)) matched.push(line.trim());
        }
      } catch {
        // Skip files that fail to read
      }
    }

    // Sort all lines from all level files chronologically by embedded timestamp
    matched.sort((a, b) => {
      const ta = a.match(/\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]/)?.[1] ?? '';
      const tb = b.match(/\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]/)?.[1] ?? '';
      return ta.localeCompare(tb);
    });

    logger.info(auditLogMessages.LOG_TRACE_FETCHED(requestId, matched.length));
    return { requestId, lines: matched };
  }

  /**
   * Generate an Excel workbook with two sheets:
   *   Sheet 1 — "Audit Records"  (all DB rows in the date range, up to 100 k)
   *   Sheet 2 — "Summary"        (aggregate stats for the range)
   *
   * @param {string} fromDate - ISO date string (YYYY-MM-DD).
   * @param {string} toDate   - ISO date string (YYYY-MM-DD).
   * @returns {Promise<Buffer>} Excel file as a Buffer.
   * @throws {AppError} 400 when either date is missing or range is invalid.
   */
  static async exportToExcel({ fromDate, toDate }) {
    if (!fromDate || !toDate) {
      throw new AppError(AUDIT_LOG_ERRORS.INVALID_DATE_RANGE, 400);
    }

    const resolvedFrom = new Date(fromDate);
    const resolvedTo   = new Date(new Date(toDate).setHours(23, 59, 59, 999));

    if (isNaN(resolvedFrom.getTime()) || isNaN(resolvedTo.getTime()) || resolvedFrom >= resolvedTo) {
      throw new AppError(AUDIT_LOG_ERRORS.INVALID_DATE_RANGE, 400);
    }

    logger.info(auditLogMessages.EXPORT_EXCEL_STARTED(fromDate, toDate));

    const matchFilter = { CREATED_AT: { $gte: resolvedFrom, $lte: resolvedTo } };

    const [rows, agg] = await Promise.all([
      AuditLogModel.findPaginated(matchFilter, 1, 100_000),
      AuditLogModel.aggregate(matchFilter),
    ]);

    const ExcelJS   = _getExcelJS();
    const workbook  = new ExcelJS.Workbook();
    workbook.creator  = 'MEAL System';
    workbook.created  = new Date();

    // ── Sheet 1: Audit Records ──
    const sheet1 = workbook.addWorksheet('Audit Records');
    sheet1.columns = [
      { header: 'Date',               key: 'CREATED_AT',       width: 22 },
      { header: 'Username',           key: 'USERNAME',         width: 20 },
      { header: 'Method',             key: 'METHOD',           width: 10 },
      { header: 'Endpoint',           key: 'ENDPOINT',         width: 50 },
      { header: 'Status Code',        key: 'STATUS_CODE',      width: 14 },
      { header: 'Response Time (ms)', key: 'RESPONSE_TIME_MS', width: 20 },
      { header: 'Client IP',          key: 'CLIENT_IP',        width: 18 },
    ];

    // Style header row
    sheet1.getRow(1).font = { bold: true };
    sheet1.getRow(1).fill = {
      type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF4208' },
    };
    sheet1.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

    rows.forEach((row) => {
      sheet1.addRow({
        CREATED_AT:       row.CREATED_AT ? new Date(row.CREATED_AT).toISOString() : '',
        USERNAME:         row.USERNAME         ?? '',
        METHOD:           row.METHOD           ?? '',
        ENDPOINT:         row.ENDPOINT         ?? '',
        STATUS_CODE:      row.STATUS_CODE       ?? '',
        RESPONSE_TIME_MS: row.RESPONSE_TIME_MS  ?? 0,
        CLIENT_IP:        row.CLIENT_IP         ?? '',
      });
    });

    // ── Sheet 2: Summary ──
    const sheet2 = workbook.addWorksheet('Summary');
    sheet2.columns = [
      { header: 'Metric', key: 'metric', width: 24 },
      { header: 'Value',  key: 'value',  width: 20 },
    ];
    sheet2.getRow(1).font = { bold: true };
    sheet2.getRow(1).fill = {
      type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF4208' },
    };
    sheet2.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

    const summaryRows = [
      { metric: 'Date Range From',    value: fromDate },
      { metric: 'Date Range To',      value: toDate },
      { metric: 'Total Requests',     value: agg.total },
      { metric: 'Success (2xx)',       value: agg.success },
      { metric: 'Redirect (3xx)',      value: agg.redirect },
      { metric: 'Client Error (4xx)', value: agg.clientError },
      { metric: 'Server Error (5xx)', value: agg.serverError },
      { metric: 'Unique Users',        value: agg.uniqueUsers },
      { metric: 'Avg Response Time',   value: `${agg.avgResponseTime} ms` },
    ];
    summaryRows.forEach((r) => sheet2.addRow(r));

    return workbook.xlsx.writeBuffer();
  }

  /**
   * Generate an Excel workbook for a single request trace:
   *   Sheet 1 — "Request Summary"  (one row: Method, Status Code, Duration, User, Endpoint, Params)
   *   Sheet 2 — "Log Trace"        (one row per log line: Timestamp, Phase, Message, Location)
   *
   * @param {string} requestId - Request ID (e.g. "req_abc1234567").
   * @param {string} dateStr   - ISO date string YYYY-MM-DD (the day to search for log lines).
   * @returns {Promise<Buffer>} Excel file as a Buffer.
   * @throws {AppError} 400 when requestId or dateStr format is invalid.
   * @throws {AppError} 404 when no audit record is found for the requestId.
   */
  static async exportTraceExcel(requestId, dateStr) {
    if (!requestId || !/^req_[A-Za-z0-9_-]{1,30}$/.test(requestId)) {
      throw new AppError(AUDIT_LOG_ERRORS.AUDIT_LOG_INVALID_REQUEST_ID, 400);
    }
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      throw new AppError(AUDIT_LOG_ERRORS.AUDIT_LOG_INVALID_DATE_FORMAT, 400);
    }

    logger.info(auditLogMessages.EXPORT_TRACE_STARTED(requestId));

    // Fetch the audit DB row and the file-based log lines in parallel
    const [[dbRow], { lines }] = await Promise.all([
      AuditLogModel.findPaginated({ REQUEST_ID: requestId }, 1, 1),
      AuditLogService.getRequestLogs(requestId, dateStr),
    ]);

    if (!dbRow) {
      throw new AppError(AUDIT_LOG_ERRORS.AUDIT_LOG_TRACE_NOT_FOUND, 404);
    }

    // ── Phase detection helpers (mirrors frontend detectPhase) ──
    const _detectPhase = (line) => {
      if (line.includes('[Incoming Request]')) return 'Incoming';
      if (line.includes('[Request Complete]')) return 'Complete';
      if (line.includes('[Handling Request]')) return 'Handling';
      return 'Function';
    };
    const _extractTimestamp = (line) => {
      const m = line.match(/\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]/);
      return m ? m[1] : '';
    };
    const _extractMessage = (line) => {
      const idx = line.lastIndexOf('] - ');
      return idx !== -1 ? line.slice(idx + 4) : line;
    };
    const _extractLocation = (line) => {
      const m = line.match(/\[([^\]]+\s@\s[^\]]+:\d+)\]/);
      return m ? m[1] : '';
    };

    const ExcelJS  = _getExcelJS();
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'MEAL System';
    workbook.created = new Date();

    // ── Sheet 1: Request Summary ──
    const sheet1 = workbook.addWorksheet('Request Summary');
    sheet1.columns = [
      { header: 'Method',       key: 'METHOD',           width: 12 },
      { header: 'Status Code',  key: 'STATUS_CODE',      width: 14 },
      { header: 'Duration (ms)',key: 'RESPONSE_TIME_MS', width: 16 },
      { header: 'User',         key: 'USERNAME',         width: 24 },
      { header: 'Endpoint',     key: 'ENDPOINT',         width: 60 },
      { header: 'Params',       key: 'PARAMS',           width: 40 },
    ];
    sheet1.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet1.getRow(1).fill = {
      type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF4208' },
    };
    sheet1.addRow({
      METHOD:           dbRow.METHOD           ?? '',
      STATUS_CODE:      dbRow.STATUS_CODE       ?? '',
      RESPONSE_TIME_MS: dbRow.RESPONSE_TIME_MS  ?? 0,
      USERNAME:         dbRow.USERNAME         ?? '',
      ENDPOINT:         dbRow.ENDPOINT         ?? '',
      PARAMS:           dbRow.PARAMS           ?? '',
    });

    // ── Sheet 2: Log Trace ──
    const sheet2 = workbook.addWorksheet('Log Trace');
    sheet2.columns = [
      { header: 'Timestamp', key: 'timestamp', width: 22 },
      { header: 'Phase',     key: 'phase',     width: 14 },
      { header: 'Message',   key: 'message',   width: 80 },
      { header: 'Location',  key: 'location',  width: 50 },
    ];
    sheet2.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet2.getRow(1).fill = {
      type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF4208' },
    };
    for (const line of lines) {
      sheet2.addRow({
        timestamp: _extractTimestamp(line),
        phase:     _detectPhase(line),
        message:   _extractMessage(line),
        location:  _extractLocation(line),
      });
    }

    return workbook.xlsx.writeBuffer();
  }

  /**
   * Stream log files for the date range as a ZIP archive buffer.
   * Reads logs/YYYY/MM/DD/*.log files for every calendar day in [fromDate, toDate].
   * Days with no log directory are skipped silently.
   *
   * @param {string} fromDate - ISO date string (YYYY-MM-DD).
   * @param {string} toDate   - ISO date string (YYYY-MM-DD).
   * @returns {Promise<Buffer>} ZIP buffer.
   * @throws {AppError} 400 when either date is missing or range is invalid.
   */
  static async exportToZip({ fromDate, toDate }) {
    if (!fromDate || !toDate) {
      throw new AppError(AUDIT_LOG_ERRORS.INVALID_DATE_RANGE, 400);
    }

    const resolvedFrom = new Date(fromDate + 'T00:00:00');
    const resolvedTo   = new Date(toDate   + 'T00:00:00');

    if (isNaN(resolvedFrom.getTime()) || isNaN(resolvedTo.getTime()) || resolvedFrom > resolvedTo) {
      throw new AppError(AUDIT_LOG_ERRORS.INVALID_DATE_RANGE, 400);
    }

    logger.info(auditLogMessages.EXPORT_ZIP_STARTED(fromDate, toDate));

    const { PassThrough } = require('stream');
    const archiver = _getArchiver();

    return new Promise((resolve, reject) => {
      const chunks = [];
      const pass   = new PassThrough();
      pass.on('data',  (chunk) => chunks.push(chunk));
      pass.on('end',   ()      => resolve(Buffer.concat(chunks)));
      pass.on('error', reject);

      const archive = archiver('zip', { zlib: { level: 9 } });
      archive.on('error', reject);
      archive.pipe(pass);

      const iter = new Date(resolvedFrom);
      const addNextDay = async () => {
        if (iter > resolvedTo) {
          archive.finalize();
          return;
        }

        const yyyy = String(iter.getFullYear());
        const mm   = String(iter.getMonth() + 1).padStart(2, '0');
        const dd   = String(iter.getDate()).padStart(2, '0');
        const logDir = path.join(process.cwd(), 'logs', yyyy, mm, dd);

        try {
          const files = await fs.readdir(logDir);
          for (const file of files) {
            if (file.endsWith('.log')) {
              const filePath = path.join(logDir, file);
              archive.file(filePath, { name: `${yyyy}/${mm}/${dd}/${file}` });
            }
          }
        } catch {
          // Directory does not exist for this day — skip silently
        }

        iter.setDate(iter.getDate() + 1);
        setImmediate(addNextDay);
      };

      addNextDay().catch(reject);
    });
  }

  /**
   * Permanently delete all audit DB records and server log files in [fromDate, toDate].
   * DB rows are removed first; then each calendar day's log directory is removed.
   *
   * @param {string} fromDate - ISO date string (YYYY-MM-DD).
   * @param {string} toDate   - ISO date string (YYYY-MM-DD).
   * @returns {Promise<{ deletedRows: number, deletedDays: number }>}
   * @throws {AppError} 400 when either date is missing or range is invalid.
   */
  static async deleteRange({ fromDate, toDate }) {
    if (!fromDate || !toDate) {
      throw new AppError(AUDIT_LOG_ERRORS.INVALID_DATE_RANGE, 400);
    }

    const resolvedFrom = new Date(fromDate);
    const resolvedTo   = new Date(new Date(toDate).setHours(23, 59, 59, 999));

    if (isNaN(resolvedFrom.getTime()) || isNaN(resolvedTo.getTime()) || resolvedFrom >= resolvedTo) {
      throw new AppError(AUDIT_LOG_ERRORS.INVALID_DATE_RANGE, 400);
    }

    logger.info(auditLogMessages.DELETE_RANGE_STARTED(fromDate, toDate));

    // Delete DB rows
    const deleteResult = await AuditLogModel.deleteMany({
      CREATED_AT: { $gte: resolvedFrom, $lte: resolvedTo },
    });

    const deletedRows = deleteResult?.rowsAffected ?? 0;

    // Remove log directories for each day in the range
    const iterDate  = new Date(fromDate + 'T00:00:00');
    const endDate   = new Date(toDate   + 'T00:00:00');
    let deletedDays = 0;

    while (iterDate <= endDate) {
      const yyyy   = String(iterDate.getFullYear());
      const mm     = String(iterDate.getMonth() + 1).padStart(2, '0');
      const dd     = String(iterDate.getDate()).padStart(2, '0');
      const logDir = path.join(process.cwd(), 'logs', yyyy, mm, dd);

      try {
        await fs.rm(logDir, { recursive: true, force: true });
        deletedDays++;
      } catch {
        // Directory may not exist — skip silently
      }

      iterDate.setDate(iterDate.getDate() + 1);
    }

    logger.info(auditLogMessages.DELETE_RANGE_DONE(deletedRows, deletedDays));

    return { deletedRows, deletedDays };
  }
}

module.exports = AuditLogService;

