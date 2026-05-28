"use strict";

const auditLogMessages = {
  INSERT_FAILED: (requestId, err) =>
    `Audit log insert failed for REQUEST_ID ${requestId}: ${err}.`,
  INSERT_SKIPPED_DISABLED: () =>
    `Audit log middleware is disabled — skipping DB insert.`,
  LIST_FETCHED: (count, page) =>
    `Audit log list fetched — ${count} rows, page ${page}.`,
  STATS_FETCHED: (fromDate, toDate) =>
    `Audit log stats fetched — range: ${fromDate} to ${toDate}.`,
  INVALID_DATE_RANGE_WARN: (fromDate, toDate) =>
    `Audit log query called with invalid date range: fromDate=${fromDate}, toDate=${toDate}.`,
  LOG_TRACE_FETCHED: (requestId, count) =>
    `Request log trace fetched — ${requestId}: ${count} line(s).`,
  EXPORT_EXCEL_STARTED: (from, to) =>
    `Audit log Excel export started — range: ${from} to ${to}.`,
  EXPORT_ZIP_STARTED: (from, to) =>
    `Audit log ZIP export started — range: ${from} to ${to}.`,
  DELETE_RANGE_STARTED: (from, to) =>
    `Audit log delete range started — ${from} to ${to}.`,
  DELETE_RANGE_DONE: (rows, days) =>
    `Audit log delete complete — ${rows} DB rows, ${days} log day(s) removed.`,
  EXPORT_TRACE_STARTED: (requestId) =>
    `Audit log trace Excel export started — requestId: ${requestId}.`,
};

module.exports = { auditLogMessages };
