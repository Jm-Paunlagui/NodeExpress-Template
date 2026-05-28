"use strict";

const { catchAsync } = require('../utils/catchAsync');
const { sendSuccess, RESPONSE_MESSAGES } = require('../constants/responses');
const AuditLogService = require('../services/AuditLogService');

class AuditLogController {
  static getList = catchAsync(async (req, res) => {
    const { page = 1, pageSize = 20, fromDate, toDate, method, statusCategory, search } = req.query;
    const data = await AuditLogService.getList({
      page:     parseInt(page, 10)     || 1,
      pageSize: parseInt(pageSize, 10) || 20,
      fromDate,
      toDate,
      method,
      statusCategory,
      search,
    });
    res.json(sendSuccess(RESPONSE_MESSAGES.AUDIT_LOG_LIST_FETCHED, data));
  });

  static getStats = catchAsync(async (req, res) => {
    const { fromDate, toDate } = req.query;
    const data = await AuditLogService.getStats({ fromDate, toDate });
    res.json(sendSuccess(RESPONSE_MESSAGES.AUDIT_LOG_STATS_FETCHED, data));
  });

  static getRequestLogs = catchAsync(async (req, res) => {
    const { requestId } = req.params;
    const { date }      = req.query;
    const data = await AuditLogService.getRequestLogs(requestId, date);
    res.json(sendSuccess(RESPONSE_MESSAGES.AUDIT_LOG_TRACE_FETCHED, data));
  });

  /**
   * Export a single request trace as an Excel workbook (two sheets:
   * "Request Summary" and "Log Trace"). Reads the requestId from the URL
   * param and the date (YYYY-MM-DD) from the query string.
   *
   * @param {import('express').Request}  req
   * @param {import('express').Response} res
   */
  static exportTraceExcel = catchAsync(async (req, res) => {
    const { requestId } = req.params;
    const { date }      = req.query;
    const buffer = await AuditLogService.exportTraceExcel(requestId, date);
    const safeId = requestId.replace(/[^A-Za-z0-9_-]/g, '');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="trace-${safeId}-${date}.xlsx"`);
    res.send(buffer);
  });

  /**
   * Export audit log DB records for a date range as an Excel file.
   * Responds with the raw buffer and appropriate Content-Disposition header.
   *
   * @param {import('express').Request}  req
   * @param {import('express').Response} res
   */
  static exportExcel = catchAsync(async (req, res) => {
    const { fromDate, toDate } = req.query;
    const buffer = await AuditLogService.exportToExcel({ fromDate, toDate });
    // Sanitize date strings before interpolating into header (CWE-113).
    const safeFrom = String(fromDate).replace(/[^0-9\-]/g, '');
    const safeTo = String(toDate).replace(/[^0-9\-]/g, '');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="audit-logs-${safeFrom}-to-${safeTo}.xlsx"`);
    res.send(buffer);
  });

  /**
   * Export server log files for a date range as a ZIP archive.
   * Responds with the raw buffer and appropriate Content-Disposition header.
   *
   * @param {import('express').Request}  req
   * @param {import('express').Response} res
   */
  static exportLogs = catchAsync(async (req, res) => {
    const { fromDate, toDate } = req.query;
    const buffer = await AuditLogService.exportToZip({ fromDate, toDate });
    // Sanitize date strings before interpolating into header (CWE-113).
    const safeFrom = String(fromDate).replace(/[^0-9\-]/g, '');
    const safeTo = String(toDate).replace(/[^0-9\-]/g, '');
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="server-logs-${safeFrom}-to-${safeTo}.zip"`);
    res.send(buffer);
  });

  /**
   * Permanently delete audit log DB records and server log files in the given range.
   *
   * @param {import('express').Request}  req
   * @param {import('express').Response} res
   */
  static deleteRange = catchAsync(async (req, res) => {
    const { fromDate, toDate } = req.query;
    const result = await AuditLogService.deleteRange({ fromDate, toDate });
    res.json(sendSuccess(RESPONSE_MESSAGES.AUDIT_LOG_DELETED, result));
  });
}

module.exports = AuditLogController;
