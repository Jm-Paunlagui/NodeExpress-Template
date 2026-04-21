// ─────────────────────────────────────────────────────────────────────────────
// Oracle ORA-code → { httpStatus, clientMessage }
// Comprehensive Error Map — Senior Oracle DBA Edition
//
// All Oracle official error messages verified against:
//   • docs.oracle.com/en/error-help/db/          (Oracle official error help)
//   • docs.oracle.com/database/121/ERRMG/         (Oracle 12c Error Messages)
//   • docs.oracle.com/en/database/oracle/oracle-database/21/errmg/
//   • techonthenet.com/oracle/errors/             (per-error cause/action)
//   • antapex.org/oracle_ora_messages.txt         (community reference)
//   • red-gate.com Simple Talk "40 Most Common"   (frequency analysis)
//
// CORRECTIONS vs. original 11-entry map:
//   • ORA-28000 : 401 → 403  (account locked = identity known, access denied)
//   • ORA-28001 : 401 → 403  (password expired = known user, access blocked)
//   • ORA-2291  : msg clarified to specify "parent key not found (FK violation)"
//   • ORA-12154 : msg aligned to Oracle's official "could not resolve the
//                 connect identifier specified" wording
//
// HTTP status rationale key:
//   400 Bad Request          – caller supplied invalid/malformed input
//   401 Unauthorized         – authentication failed (unknown or wrong creds)
//   403 Forbidden            – authenticated but access explicitly denied
//   404 Not Found            – server-side object/resource does not exist
//   408 Request Timeout      – operation cancelled due to time limit
//   409 Conflict             – state conflict (duplicate, dependent records)
//   422 Unprocessable Entity – semantic/business rule validation failure
//   423 Locked               – resource locked by another session
//   500 Internal Server Error– unexpected engine-level failure
//   503 Service Unavailable  – DB is down, unreachable, or over capacity
//   504 Gateway Timeout      – connection attempt timed out
//   507 Insufficient Storage – disk/tablespace quota exhausted
// ─────────────────────────────────────────────────────────────────────────────

const ORA_MAP = {
    // ════════════════════════════════════════════════════════════════════════
    // SECTION 1 — Session / Instance Errors
    // ════════════════════════════════════════════════════════════════════════

    18: {
        status: 503,
        msg: "Database has reached its maximum number of concurrent sessions.",
        // ORA-00018: maximum number of sessions exceeded
    },

    20: {
        status: 503,
        msg: "Database has reached its maximum number of concurrent processes.",
        // ORA-00020: maximum number of processes exceeded
    },

    28: {
        status: 401,
        msg: "Your database session was terminated by an administrator.",
        // ORA-00028: your session has been killed
        // Source: docs.oracle.com/en/error-help/db/ora-00028/ (confirmed)
    },

    1012: {
        status: 401,
        msg: "Not logged on. The session is no longer active.",
        // ORA-01012: not logged on
    },

    1013: {
        status: 408,
        msg: "The operation was cancelled because it exceeded the allowed time limit.",
        // ORA-01013: user requested cancel of current operation
        // Source: docs.oracle.com/en/error-help/db/ora-01013/ (confirmed)
        // Note: HTTP 408 is appropriate — operation timed out / was cancelled.
    },

    1033: {
        status: 503,
        msg: "Database is currently starting up or shutting down. Please try again shortly.",
        // ORA-01033: ORACLE initialization or shutdown in progress
        // Source: docs.oracle.com/database/121/ERRMG/ORA-00910.htm (confirmed)
    },

    1034: {
        status: 503,
        msg: "Database instance is not available. The instance may not have been started.",
        // ORA-01034: ORACLE not available
        // Source: docs.oracle.com/database/121/ERRMG/ORA-00910.htm (confirmed)
        // Caused by SGA allocation failure or incorrect instance pointer.
    },

    1035: {
        status: 503,
        msg: "Database is in restricted mode. Only privileged administrators can connect.",
        // ORA-01035: ORACLE only available to users with RESTRICTED SESSION privilege
        // Source: docs.oracle.com/database/121/ERRMG/ORA-00910.htm (confirmed)
    },

    // ════════════════════════════════════════════════════════════════════════
    // SECTION 2 — Locking / Concurrency Errors
    // ════════════════════════════════════════════════════════════════════════

    54: {
        status: 423,
        msg: "Resource is currently locked by another session. Please retry.",
        // ORA-00054: resource busy and acquire with NOWAIT specified, or timeout expired
        // Source: psoug.org/oraerror/ORA-00054.htm (confirmed)
    },

    60: {
        status: 409,
        msg: "Deadlock detected. Your transaction has been rolled back. Please retry.",
        // ORA-00060: deadlock detected while waiting for resource
        // Source: psoug.org/oraerror/ORA-00060.htm (confirmed)
    },

    // ════════════════════════════════════════════════════════════════════════
    // SECTION 3 — Storage / Archive / Space Errors
    // ════════════════════════════════════════════════════════════════════════

    257: {
        status: 503,
        msg: "Database archiver error: archive log destination is out of space. Transactions are halted.",
        // ORA-00257: Archiver error. Connect AS SYSDBA only until resolved.
        // Source: docs.oracle.com/en/database/oracle/oracle-database/21/errmg/ORA-00000.html (confirmed)
        // Cause: Archiver process cannot write redo logs; destination disk is full.
    },

    1536: {
        status: 507,
        msg: "Storage quota for your tablespace has been exceeded. No more space is available.",
        // ORA-01536: space quota exceeded for tablespace 'string'
    },

    1555: {
        status: 500,
        msg: "Query failed: snapshot too old. Required undo data has been overwritten by a long-running transaction.",
        // ORA-01555: snapshot too old: rollback segment number string with name "string" too small
        // Source: antapex.org (confirmed: "Long running Query terminates, Rollback/Undo overwritten")
    },

    1652: {
        status: 507,
        msg: "Unable to allocate temporary space for the operation. Temp tablespace is full.",
        // ORA-01652: unable to extend temp segment by string in tablespace string
    },

    4031: {
        status: 503,
        msg: "Insufficient shared memory in the database. The shared pool is exhausted.",
        // ORA-04031: unable to allocate string bytes of shared memory
        // Source: techonthenet.com/oracle/errors/ora04031.php (confirmed)
    },

    // ════════════════════════════════════════════════════════════════════════
    // SECTION 4 — SQL / DML / Syntax Errors
    // ════════════════════════════════════════════════════════════════════════

    900: {
        status: 400,
        msg: "Invalid SQL statement submitted to the database.",
        // ORA-00900: invalid SQL statement
        // Source: techonthenet.com/oracle/errors/ora00900.php (confirmed)
    },

    904: {
        status: 400,
        msg: "Invalid column name referenced. The column does not exist or is misspelled.",
        // ORA-00904: "string": invalid identifier
        // Source: techonthenet.com/oracle/errors/ora00904.php (confirmed)
    },

    907: {
        status: 400,
        msg: "SQL syntax error: missing right parenthesis or malformed expression.",
        // ORA-00907: missing right parenthesis
        // Source: tekstream.com/resource-center/oracle-error-messages/ (confirmed)
    },

    911: {
        status: 400,
        msg: "Invalid character found in the SQL statement or input value.",
        // ORA-00911: invalid character
        // Source: techonthenet.com/oracle/errors/ora00911.php (confirmed)
    },

    936: {
        status: 400,
        msg: "SQL syntax error: a required expression is missing from the statement.",
        // ORA-00936: missing expression
    },

    942: {
        status: 404,
        msg: "The table or view referenced does not exist or you do not have access to it.",
        // ORA-00942: table or view does not exist
        // Source: antapex.org (confirmed), tekstream.com (confirmed)
    },

    1000: {
        status: 500,
        msg: "Maximum number of open database cursors exceeded. A cursor leak may exist in the application.",
        // ORA-01000: maximum open cursors exceeded
        // Source: red-gate.com Simple Talk (#23 most searched, confirmed)
        // Cause: OPEN_CURSORS init param limit hit; often a cursor leak in app code.
    },

    1001: {
        status: 500,
        msg: "Invalid cursor. The cursor referenced has not been opened or is already closed.",
        // ORA-01001: invalid cursor
    },

    1002: {
        status: 500,
        msg: "Fetch operation is out of sequence. The cursor state is invalid.",
        // ORA-01002: fetch out of sequence
    },

    1400: {
        status: 400,
        msg: "A required field is missing. Cannot insert a NULL value into a NOT NULL column.",
        // ORA-01400: cannot insert NULL into ("string"."string"."string")
        // Source: techonthenet.com/oracle/errors/ora01400.php (confirmed)
    },

    1401: {
        status: 400,
        msg: "The value provided is too large for the target column.",
        // ORA-01401: inserted value too large for column
        // Source: antapex.org (confirmed: "inserted value too large for column")
    },

    1403: {
        status: 404,
        msg: "No data found. The query returned no rows.",
        // ORA-01403: no data found
        // Source: antapex.org (confirmed), techonthenet.com/oracle/errors/ora01403.php (confirmed)
        // Raised by: SELECT INTO with no rows, or reading past end of UTL_FILE.
    },

    1422: {
        status: 500,
        msg: "Query returned more than one row where exactly one was expected.",
        // ORA-01422: exact fetch returns more than requested number of rows
    },

    1427: {
        status: 400,
        msg: "Subquery returns more than one row where a single-row result is required.",
        // ORA-01427: single-row subquery returns more than one row
    },

    1438: {
        status: 400,
        msg: "Numeric value exceeds the precision or scale defined for the column.",
        // ORA-01438: value larger than specified precision allowed for this column
    },

    1476: {
        status: 400,
        msg: "Division by zero is not allowed.",
        // ORA-01476: divisor is equal to zero
    },

    1722: {
        status: 400,
        msg: "Invalid number: the value provided cannot be converted to a numeric type.",
        // ORA-01722: invalid number
        // Source: red-gate.com (#3 most searched, confirmed), techonthenet.com (confirmed)
    },

    1830: {
        status: 400,
        msg: "Date format error: the input string does not fully match the expected date format picture.",
        // ORA-01830: date format picture ends before converting entire input string
    },

    1843: {
        status: 400,
        msg: "Invalid date: the month value provided is not a valid month.",
        // ORA-01843: not a valid month
    },

    1858: {
        status: 400,
        msg: "Invalid date: a non-numeric character was found where a number was expected.",
        // ORA-01858: a non-numeric character was found where a numeric was expected
    },

    // ════════════════════════════════════════════════════════════════════════
    // SECTION 5 — Integrity / Constraint Violations
    // ════════════════════════════════════════════════════════════════════════

    1: {
        status: 409,
        msg: "A record with this value already exists. Unique constraint violated.",
        // ORA-00001: unique constraint (string.string) violated
        // Source: psoug.org/oraerror/ORA-00001.htm (confirmed)
    },

    2290: {
        status: 400,
        msg: "A check constraint was violated. The value does not satisfy the column's business rules.",
        // ORA-02290: check constraint (string.string) violated
    },

    2291: {
        status: 400,
        msg: "Referenced parent record not found. Foreign key constraint violated.",
        // ORA-02291: integrity constraint (string.string) violated - parent key not found
        // Source: techonthenet.com (confirmed: FK parent key not found)
    },

    2292: {
        status: 409,
        msg: "Cannot delete or update: dependent child records still exist. Foreign key constraint violated.",
        // ORA-02292: integrity constraint (string.string) violated - child record found
    },

    2293: {
        status: 400,
        msg: "Check constraint validation failed on this table.",
        // ORA-02293: cannot validate (string.string) - check constraint violated
    },

    // ════════════════════════════════════════════════════════════════════════
    // SECTION 6 — Internal / PL/SQL / Trigger Errors
    // ════════════════════════════════════════════════════════════════════════

    600: {
        status: 500,
        msg: "Internal database engine error. Please contact your database administrator immediately.",
        // ORA-00600: internal error code, arguments: [string], [string], ...
        // Source: red-gate.com (#2 most searched), blogs.oracle.com/database/ora-00600 (confirmed)
        // Critical: always logged to alert.log and trace file. Must be reported to Oracle Support.
    },

    3113: {
        status: 503,
        msg: "Database connection lost unexpectedly. The communication channel was closed.",
        // ORA-03113: end-of-file on communication channel
        // Source: antapex.org (confirmed: "you have lost the Network connection"),
        //         red-gate.com (#5 most searched, confirmed)
    },

    3114: {
        status: 503,
        msg: "Not connected to Oracle. The database session is no longer active.",
        // ORA-03114: not connected to ORACLE
        // Source: antapex.org (confirmed)
    },

    4043: {
        status: 404,
        msg: "The stored procedure, function, or package referenced does not exist.",
        // ORA-04043: object string does not exist
    },

    4088: {
        status: 500,
        msg: "A PL/SQL trigger raised an unhandled exception during execution.",
        // ORA-04088: error during execution of trigger 'string.string'
        // Source: techonthenet.com/oracle/errors/index.php (confirmed entry)
    },

    4091: {
        status: 500,
        msg: "Trigger error: the table is mutating and cannot be read or modified during this operation.",
        // ORA-04091: table string.string is mutating, trigger/function may not see it
        // Source: docs.oracle.com/en/error-help/db/ora-04091/ (confirmed, updated Mar 31 2026)
        // Cause: A trigger tried to query/modify its own firing table mid-statement.
    },

    6502: {
        status: 400,
        msg: "Numeric or value error in PL/SQL: data type conversion failed or value is out of range.",
        // ORA-06502: PL/SQL: numeric or value error: string
    },

    6511: {
        status: 500,
        msg: "PL/SQL cursor is already open. Cannot open a cursor that is currently in use.",
        // ORA-06511: PL/SQL: cursor already open
    },

    20000: {
        status: 400,
        msg: "Application-defined error raised by the database. Please contact support.",
        // ORA-20000: (user-defined RAISE_APPLICATION_ERROR, range 20000–20999)
        // Source: renenyffenegger.ch (confirmed: "reserved for user defined errors")
    },

    20001: {
        status: 422,
        msg: "Application validation error: the submitted data failed business rule validation.",
        // ORA-20001: custom application error (commonly used convention)
    },

    // ════════════════════════════════════════════════════════════════════════
    // SECTION 7 — Authentication / Authorization Errors
    // ════════════════════════════════════════════════════════════════════════

    1017: {
        status: 401,
        msg: "Database authentication failed: invalid username or password.",
        // ORA-01017: invalid username/password; logon denied
        // Source: antapex.org (confirmed), techonthenet.com (confirmed)
    },

    1031: {
        status: 403,
        msg: "Insufficient privileges. You do not have permission to perform this operation.",
        // ORA-01031: insufficient privileges
        // Source: antapex.org (confirmed), techonthenet.com (confirmed)
    },

    1045: {
        status: 403,
        msg: "User does not have the CREATE SESSION privilege. Database logon denied.",
        // ORA-01045: user string lacks CREATE SESSION privilege; logon denied
        // Source: techonthenet.com/oracle/errors/ora01045.php (confirmed)
    },

    28000: {
        status: 403,
        msg: "Database account is locked. Please contact your database administrator.",
        // ORA-28000: the account is locked
        // NOTE: 403 Forbidden is correct — identity is known but access is blocked.
        //       401 Unauthorized implies unknown/bad credentials (not the case here).
    },

    28001: {
        status: 403,
        msg: "Database account password has expired. Please reset your password to continue.",
        // ORA-28001: the password has expired
        // NOTE: 403 Forbidden is correct — same reasoning as ORA-28000.
    },

    28002: {
        status: 403,
        msg: "Warning: your database password is about to expire. Please change it soon.",
        // ORA-28002: the password will expire within string days; please change your password now
    },

    28003: {
        status: 400,
        msg: "New password does not meet the database password policy requirements.",
        // ORA-28003: password verification for the specified password failed
    },

    // ════════════════════════════════════════════════════════════════════════
    // SECTION 8 — Connection / Network / TNS Errors
    // ════════════════════════════════════════════════════════════════════════

    12154: {
        status: 503,
        msg: "Database connection failed: the TNS connect identifier could not be resolved.",
        // ORA-12154: TNS:could not resolve the connect identifier specified
        // Source: red-gate.com (#1 most searched), paessler.com (confirmed exact wording),
        //         antapex.org (confirmed: "TNS:could not resolve service name")
        // Cause: Typo in connection string or tnsnames.ora; file missing or inaccessible.
    },

    12170: {
        status: 504,
        msg: "Database connection timed out. The server did not respond within the allowed time.",
        // ORA-12170: TNS:Connect timeout occurred
    },

    12203: {
        status: 503,
        msg: "Database connection failed: unable to connect to the destination.",
        // ORA-12203: TNS:unable to connect to destination
        // Source: antapex.org (confirmed)
    },

    12500: {
        status: 503,
        msg: "Database listener failed to start a dedicated server process.",
        // ORA-12500: TNS:listener failed to start a dedicated server process
        // Source: antapex.org (confirmed)
    },

    12514: {
        status: 503,
        msg: "The database service name is not registered with the listener.",
        // ORA-12514: TNS:listener does not currently know of service requested in connect descriptor
        // Source: paessler.com (confirmed exact wording)
    },

    12541: {
        status: 503,
        msg: "Database service is unreachable: no listener is running at the specified host and port.",
        // ORA-12541: TNS:no listener
        // Source: paessler.com (confirmed)
    },

    12543: {
        status: 503,
        msg: "Cannot reach the database host. The destination host is unreachable.",
        // ORA-12543: TNS:destination host unreachable
    },

    12545: {
        status: 503,
        msg: "Database connection failed: hostname could not be resolved (name lookup failure).",
        // ORA-12545: Connect failed because target host or object does not exist
        // Source: antapex.org (confirmed: "TNS:name lookup failure")
    },

    12560: {
        status: 503,
        msg: "Database protocol adapter error. The database listener or instance may be down.",
        // ORA-12560: TNS:protocol adapter error
        // Source: antapex.org (confirmed: "TNS:protocol adapter error")
    },
};

module.exports = ORA_MAP;

// ─────────────────────────────────────────────────────────────────────────────
// USAGE EXAMPLE (Node.js / Express error-handling middleware):
// ─────────────────────────────────────────────────────────────────────────────
//
//  function handleOraError(err, res) {
//      const match = err.message && err.message.match(/ORA-0*(\d+)/i);
//      if (match) {
//          const code = parseInt(match[1], 10);
//          const mapped = ORA_MAP[code];
//          if (mapped) {
//              return res.status(mapped.status).json({
//                  error:   mapped.msg,
//                  oraCode: `ORA-${String(code).padStart(5, '0')}`
//              });
//          }
//      }
//      // Fallback for unmapped Oracle errors
//      return res.status(500).json({
//          error: "An unexpected database error occurred. Please contact support."
//      });
//  }
//
// ─────────────────────────────────────────────────────────────────────────────
// ERROR COUNT SUMMARY (v2 — web-verified):
//   Session / Instance          :  8  (ORA-18, 20, 28, 1012, 1013, 1033, 1034, 1035)
//   Locking / Concurrency       :  2  (ORA-54, 60)
//   Storage / Space             :  5  (ORA-257, 1536, 1555, 1652, 4031)
//   SQL / DML / Syntax          : 20  (ORA-900, 904, 907, 911, 936, 942, 1000, 1001,
//                                       1002, 1400, 1401, 1403, 1422, 1427, 1438,
//                                       1476, 1722, 1830, 1843, 1858)
//   Integrity / Constraints     :  5  (ORA-1, 2290, 2291, 2292, 2293)
//   Internal / PL/SQL / Trigger : 10  (ORA-600, 3113, 3114, 4043, 4088, 4091,
//                                       6502, 6511, 20000, 20001)
//   Authentication / AuthZ      :  7  (ORA-1017, 1031, 1045, 28000, 28001, 28002, 28003)
//   Connection / Network / TNS  :  9  (ORA-12154, 12170, 12203, 12500, 12514,
//                                       12541, 12543, 12545, 12560)
//   ─────────────────────────────────
//   TOTAL                       : 66  entries
// ─────────────────────────────────────────────────────────────────────────────
