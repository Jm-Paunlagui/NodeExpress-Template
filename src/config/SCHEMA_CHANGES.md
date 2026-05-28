# MEAL Schema: `tables.sql` → `tables_normalized-copy.sql`

**v1.0 → v2.0 | 2026-04-25**

---

## Summary

Original schema: no PKs, no FKs, dates stored as text, money stored as FLOAT, no integrity, no tamper protection, duplicate triggers, plaintext-friendly password column. Everything wrong that could be wrong.

---

## 1. Type Fixes

| Column(s)                     | Before                                                                    | After                                                    | Why                                                                           |
| ----------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------- |
| All date/time fields          | `VARCHAR2(25/64)`                                                         | `DATE` / `TIMESTAMP`                                     | Stored as strings — no range check, no sort, no index efficiency              |
| `T_CUTOFF_DATE` START/END     | 4 cols: `START_DATE`, `START_TIME`, `END_DATE`, `END_TIME` (all VARCHAR2) | 2 cols: `PERIOD_START TIMESTAMP`, `PERIOD_END TIMESTAMP` | 4 columns to express 2 values; string-concat date math is wrong               |
| `T_EMP_TRANSACTION` date      | `TRANS_DATE VARCHAR2(25)` + `TRANS_TIME VARCHAR2(25)`                     | `TRANS_DATETIME TIMESTAMP`                               | Same problem — 2 strings for 1 value                                          |
| Financial amounts             | `FLOAT(126)`, bare `NUMBER`                                               | `NUMBER(10,2)` / `NUMBER(19,2)` / `NUMBER(19,4)`         | `FLOAT` is binary — 0.1 + 0.2 ≠ 0.3; bare `NUMBER` has no precision guarantee |
| `T_CREDIT_LIMIT.CREDIT_LIMIT` | `NUMBER(8,0)` — integer only                                              | `NUMBER(10,2)`                                           | Credit limits need cents                                                      |
| `T_EMP_MGMT_ADMIN.EMP_PW`     | `VARCHAR2(25)`                                                            | `VARCHAR2(128)`                                          | bcrypt hash = 60 chars minimum; 25 forces plaintext storage                   |
| `T_SCAN_VALUE_LENGTH.TYPE`    | Column named `TYPE`                                                       | Renamed `SCAN_TYPE`                                      | `TYPE` is Oracle reserved word — causes parse errors                          |

---

## 2. Primary Keys

Every table in v1.0 had no `PRIMARY KEY` constraint declared. PK enforced only via separate `CREATE UNIQUE INDEX` + `ALTER TABLE MODIFY NOT NULL` — two extra statements, no inline constraint, optimizer can't always use it.

**v2.0:** `PRIMARY KEY` declared inline on every table, one statement.

| Table               | v1.0 PK mechanism                    | v2.0 PK                                                |
| ------------------- | ------------------------------------ | ------------------------------------------------------ |
| All MEAL\_\* tables | Separate unique index + ALTER MODIFY | `CONSTRAINT PK_... PRIMARY KEY` inline                 |
| `T_EMP_MASTER_LIST` | Separate unique index `U_EMP_ID2`    | `CONSTRAINT PK_T_EMP_MASTER_LIST PRIMARY KEY (EMP_ID)` |
| `T_HOST_DETAIL`     | No PK — only identity column         | `CONSTRAINT PK_T_HOST_DETAIL PRIMARY KEY` on identity  |

---

## 3. Identity Columns (Sequences Eliminated)

v1.0 used Oracle sequences + sequence triggers for every auto-increment PK. 9 separate triggers whose only job was `SELECT SEQ.NEXTVAL INTO :NEW.ID FROM DUAL`.

Problems:

- Sequence object separate from table — orphaned sequences if table dropped
- `WHEN (NEW.ID IS NULL)` guard means app can supply any ID — bypass sequence
- 9 extra objects to manage

**v2.0:** `GENERATED ALWAYS AS IDENTITY` — built into column definition, no sequences, no triggers, Oracle rejects any app-supplied value.

```sql
-- BEFORE (v1.0): sequence + trigger
CREATE SEQUENCE MEAL_TRAN_STUBS_SEQ;
CREATE TRIGGER MEAL_TRAN_STUBS_SEQ_TR
BEFORE INSERT ON MEAL_TRAN_STUBS FOR EACH ROW
WHEN (NEW.ID IS NULL)
BEGIN SELECT MEAL_TRAN_STUBS_SEQ.NEXTVAL INTO :NEW.ID FROM DUAL; END;

-- AFTER (v2.0): one line
ID NUMBER GENERATED ALWAYS AS IDENTITY CONSTRAINT PK_MEAL_TRAN_STUBS PRIMARY KEY
```

---

## 4. Foreign Keys Added

v1.0 had zero FK constraints. No referential integrity — orphaned records possible, employee deleted while transactions still exist.

**v2.0 FK map:**

| Child Table            | Column             | Parent Table        | Column        |
| ---------------------- | ------------------ | ------------------- | ------------- |
| `T_EMP_MEAL_ALLOWANCE` | `EMP_ID`           | `T_EMP_MASTER_LIST` | `EMP_ID`      |
| `T_EMP_TRANSACTION`    | `EMP_ID`           | `T_EMP_MASTER_LIST` | `EMP_ID`      |
| `T_EMP_TRANSACTION`    | `CREDIT_ID`        | `T_CREDIT_LIMIT`    | `CREDIT_ID`   |
| `T_EMP_TRANSACTION`    | `TERMINAL_ID`      | `T_HOST_DETAIL`     | `TERMINAL_ID` |
| `T_EMP_TRANS_SUMMARY`  | `EMP_ID`           | `T_EMP_MASTER_LIST` | `EMP_ID`      |
| `T_FUND_DETAILS`       | `EMP_ID`           | `T_EMP_MASTER_LIST` | `EMP_ID`      |
| `T_FUND_DETAILS`       | `CUTOFF_ID`        | `T_CUTOFF_DATE`     | `CUTOFF_ID`   |
| `T_EXCESS_FUND`        | `EMP_ID`           | `T_EMP_MASTER_LIST` | `EMP_ID`      |
| `T_EXCESS_FUND`        | `CUTOFF_ID`        | `T_CUTOFF_DATE`     | `CUTOFF_ID`   |
| `MEAL_TRAN_STUBS`      | `TRXN_ID` (UNIQUE) | —                   | —             |
| `MEAL_APPROVAL_STUBS`  | `TRXN_ID`          | `MEAL_TRAN_STUBS`   | `TRXN_ID`     |
| `MEAL_STUB_PO`         | `TRXN_ID`          | `MEAL_TRAN_STUBS`   | `TRXN_ID`     |
| `MEAL_SUBSIDIES`       | `EMP_ID`           | `MEAL_EMP_MASTER`   | `EMP_ID`      |
| `MEAL_CREDIT_INFO`     | `EMP_ID`           | `MEAL_EMP_MASTER`   | `EMP_ID`      |

> `T_EMP_TRANSACTION.CUTOFF_ID` FK intentionally omitted — value `0` means no matching period, not a null FK.

---

## 5. CHECK Constraints Added

v1.0: no CHECK constraints. Any string could go into STATUS columns. Negative amounts possible.

**v2.0 CHECK constraints:**

| Table                 | Constraint              | Rule                                                                               |
| --------------------- | ----------------------- | ---------------------------------------------------------------------------------- |
| `T_EMP_MASTER_LIST`   | `CHK_EMP_TYPE`          | `IN ('REG','PROB','CONT','TERM','AGENCY')`                                         |
| `T_CREDIT_LIMIT`      | `CHK_CREDIT_LIMIT`      | `>= 0`                                                                             |
| `T_CUTOFF_DATE`       | `CHK_CUTOFF_RANGE`      | `PERIOD_END > PERIOD_START`                                                        |
| `T_EMP_MGMT_ADMIN`    | `CHK_ADMIN_ROLE`        | `IN ('ADMIN','SUPER_ADMIN','APPROVER','VIEWER')`                                   |
| `MEAL_TRAN_STUBS`     | `CHK_MEAL_TRAN_STATUS`  | `IN ('PENDING','APPROVED','REJECTED','CANCELLED','EXPIRED','USED')`                |
| `MEAL_TRAN_STUBS`     | `CHK_MEAL_TRAN_AMOUNT`  | `>= 0`                                                                             |
| `MEAL_APPROVAL_STUBS` | `CHK_APPROVAL_STATUS`   | `IN ('PENDING','APPROVED_1','APPROVED_2','FULLY_APPROVED','REJECTED','CANCELLED')` |
| `MEAL_SUBSIDIES`      | `CHK_SUBSIDIES_DATES`   | `END_DATE >= START_DATE`                                                           |
| `MEAL_SUBSIDIES`      | `CHK_SUBSIDIES_SUBSIDY` | `>= 0`                                                                             |
| `MEAL_SUBSIDIES`      | `CHK_SUBSIDIES_DELETED` | `IN (0, 1)`                                                                        |
| `MEAL_RESET_REQUEST`  | `CHK_RESET_STATUS`      | `IN ('PENDING','APPROVED','REJECTED','CANCELLED')`                                 |
| `MEAL_RESET_REQUEST`  | `CHK_RESET_AMOUNT`      | `>= 0`                                                                             |
| `MEAL_TRAN_SUMCOUNT`  | `CHK_SUMCOUNT_YEAR`     | `REGEXP_LIKE(CYEAR, '^\d{4}$')`                                                    |
| `T_SCAN_VALUE_LENGTH` | `CHK_SCAN_VALUE_LEN`    | `VALUE_LENGTH > 0`                                                                 |

---

## 6. Audit Columns

v1.0: some tables had `CREATEDDATE VARCHAR2(64)` — string, not enforced, nullable, mutable.

**v2.0:**

- `CREATED_DATE DATE DEFAULT SYSDATE NOT NULL` — auto-set on insert
- `LAST_MODIFIED_DATE DATE` — auto-set on update by trigger
- Both enforced **immutably** — trigger raises `ORA-20001` if app tries to change `CREATED_DATE`

---

## 7. Tamper Detection (ROW_HASH)

v1.0: no tamper detection. Direct `UPDATE amount = 999` — undetectable.

**v2.0:** Financial tables carry `ROW_HASH VARCHAR2(64)` — SHA-256 computed by trigger on every INSERT/UPDATE.

| Table                     | Hash inputs                                                                  |
| ------------------------- | ---------------------------------------------------------------------------- |
| `MEAL_TRAN_STUBS`         | `ID \| TRXN_ID \| EMP_ID \| AMOUNT \| STATUS \| CREATED_DATE`                |
| `MEAL_SUBSIDIES`          | `EMP_ID \| TOTAL_MEAL_SUBSIDY \| PREV_BALANCE \| OTHER_FUND \| CREATED_DATE` |
| `MEAL_TRANSACTIONRECORDS` | `EMP_ID \| SUBSIDY \| POSTED_TOTAL \| DEDUCTION \| CREATED_DATE`             |

Verify with:

```sql
SELECT
    "MEAL"."FN_VERIFY_TRAN_STUBS_HASH"        AS TRAN_STUBS_TAMPERED,
    "MEAL"."FN_VERIFY_SUBSIDIES_HASH"          AS SUBSIDIES_TAMPERED,
    "MEAL"."FN_VERIFY_TRANSACTIONRECORDS_HASH" AS TXREC_TAMPERED
FROM DUAL;
-- 0 = clean. Any positive = tampered rows.
```

Direct DB UPDATE bypasses app layer but **cannot recompute correct hash** — mismatch detected on next verification run.

---

## 8. Soft Delete (IS_DELETED Flag)

v1.0: no pattern — hard deletes possible on financial records.

**v2.0:** `MEAL_SUBSIDIES` and `MEAL_TRANSACTIONRECORDS` get:

```sql
IS_DELETED NUMBER(1,0) DEFAULT 0 NOT NULL,
CONSTRAINT CHK_..._DELETED CHECK (IS_DELETED IN (0, 1))
```

Hard `DELETE` forbidden by design — set `IS_DELETED=1` instead. Also tracks `DELETED_BY` and `DELETED_DATE`.

---

## 9. LOGGING Mode

`T_EMP_MEAL_ALLOWANCE` was `NOLOGGING` in v1.0. Financial data must survive media recovery — redo log entries required.

**v2.0:** All tables `LOGGING`. No table is `NOLOGGING`.

---

## 10. Trigger Overhaul

### Removed (sequence triggers — all 9 eliminated)

`MEAL_APPROVAL_STUBS_SEQ_TR`, `MEAL_CREDIT_INFO_SEQ_TR`, `MEAL_RESET_REQUEST_TRG`, `MEAL_STUB_LOGS_SEQ_TR`, `MEAL_STUB_PO_SEQ_TR`, `MEAL_SUBSIDIES_SEQ_TR`, `MEAL_TRAN_STUBS_SEQ_TR`, `MEAL_TRAN_SUMCOUNT_TRG`, `MEAL_TRANSACTIONRECORDS_SEQ_TR`

Replaced by `GENERATED ALWAYS AS IDENTITY` on each table.

### Removed (duplicate trigger)

`TRG_T_CUTOFF_DATE` — fired on `T_EMP_TRANSACTION` INSERT. Did same thing as `TRG_T_EMP_TRANSACTION` but without `NO_DATA_FOUND` handling. When both fired, `TOO_MANY_ROWS` possible.

### Replaced

`TRG_T_EMP_TRANSACTION` → `TRG_T_EMP_TRANSACTION_NRM`

- Handles `PERIOD_START`/`PERIOD_END` (TIMESTAMP columns, not 4× VARCHAR2)
- `ROWNUM = 1` guard prevents `TOO_MANY_ROWS` on overlapping periods
- Handles both `NO_DATA_FOUND` and `TOO_MANY_ROWS` — sets `CUTOFF_ID = 0` on both

### Added (audit triggers)

| Trigger                             | Table                     | Does                                                                 |
| ----------------------------------- | ------------------------- | -------------------------------------------------------------------- |
| `TRG_MEAL_TRAN_STUBS_AUDIT`         | `MEAL_TRAN_STUBS`         | SET `CREATED_DATE`, compute `ROW_HASH`; guard immutability on UPDATE |
| `TRG_MEAL_SUBSIDIES_AUDIT`          | `MEAL_SUBSIDIES`          | Same pattern                                                         |
| `TRG_MEAL_TRANSACTIONRECORDS_AUDIT` | `MEAL_TRANSACTIONRECORDS` | Same pattern                                                         |
| `TRG_MEAL_APPROVAL_STUBS_AUDIT`     | `MEAL_APPROVAL_STUBS`     | Audit-only (no hash)                                                 |
| `TRG_MEAL_RESET_REQUEST_AUDIT`      | `MEAL_RESET_REQUEST`      | Guard `REQUESTED_DATE` immutability                                  |

### Added (DDL guard trigger)

`TRG_SCHEMA_DDL_GUARD` — fires `BEFORE DDL ON SCHEMA` from **any session** (SQL Developer, SQL\*Plus, remote tool — no bypass).

| Event            | Scope                 | Result                                                   |
| ---------------- | --------------------- | -------------------------------------------------------- |
| `DROP TABLE`     | Any table             | `ORA-20099` — blocked                                    |
| `TRUNCATE TABLE` | Any table             | `ORA-20099` — blocked (TRUNCATE bypasses DML triggers)   |
| `ALTER TABLE`    | Financial tables only | `ORA-20099` — blocked (protects ROW_HASH, audit columns) |

To run schema migration: `DROP TRIGGER "MEAL"."TRG_SCHEMA_DDL_GUARD"` → migrate → re-run Section 8.

---

## 11. Performance Indexes (New)

v1.0: indexes only on PK columns.

**v2.0 composite indexes for query patterns:**

| Index                        | Table                 | Columns                        | Use case                            |
| ---------------------------- | --------------------- | ------------------------------ | ----------------------------------- |
| `IDX_TRANS_EMP_DATE`         | `T_EMP_TRANSACTION`   | `EMP_ID, TRANS_DATETIME`       | Employee transaction history lookup |
| `IDX_TRANS_CUTOFF`           | `T_EMP_TRANSACTION`   | `CUTOFF_ID`                    | Period rollup queries               |
| `IDX_TRAN_STUBS_EMP_STATUS`  | `MEAL_TRAN_STUBS`     | `EMP_ID, STATUS`               | Employee stub dashboard             |
| `IDX_TRAN_STUBS_DATE_STATUS` | `MEAL_TRAN_STUBS`     | `TRANSACTION_DATE, STATUS`     | Date-range + status filter          |
| `IDX_SUBSIDIES_EMP_PERIOD`   | `MEAL_SUBSIDIES`      | `EMP_ID, START_DATE, END_DATE` | Subsidy period lookup               |
| `IDX_CREDIT_INFO_EMP_PERIOD` | `MEAL_CREDIT_INFO`    | `EMP_ID, PAY_PERIOD`           | Credit info by period               |
| `IDX_APPROVAL_STATUS_TRXN`   | `MEAL_APPROVAL_STUBS` | `APPROVAL_STATUS, TRXN_ID`     | Pending approvals dashboard         |
| `IDX_RESET_EMP_STATUS`       | `MEAL_RESET_REQUEST`  | `EMP_ID, APPROVAL_STATUS`      | Reset request dashboard             |
| `IDX_FUND_DET_CUTOFF_EMP`    | `T_FUND_DETAILS`      | `CUTOFF_ID, EMP_ID`            | Period fund summary                 |

---

## 12. Oracle Audit Trail (New)

`BY ACCESS` auditing on all financial tables — one audit record per DML statement, written even if transaction rolls back.

```sql
-- Query all direct DB edits on financial tables:
SELECT username, action_name, obj_name, timestamp
FROM dba_audit_trail
WHERE owner = 'MEAL'
ORDER BY timestamp DESC;
```

Tables audited: `MEAL_TRAN_STUBS`, `MEAL_SUBSIDIES`, `MEAL_TRANSACTIONRECORDS`, `MEAL_APPROVAL_STUBS`, `MEAL_RESET_REQUEST`, `MEAL_CREDIT_INFO`, `MEAL_STUB_PO`, `T_EMP_MGMT_ADMIN`, `T_EMP_TRANSACTION`, `T_FUND_DETAILS`, `T_EXCESS_FUND`

---

## 13. Synthetic PKs Added to Summary Tables

v1.0: `T_EMP_TRANS_SUMMARY`, `T_FUND_DETAILS`, `T_EXCESS_FUND` had no PK — no unique row identifier, no FK target possible.

**v2.0:** Each gets `GENERATED ALWAYS AS IDENTITY` PK. `T_FUND_DETAILS` also gets `UNIQUE (EMP_ID, CUTOFF_ID)` — one record per employee per period enforced at DB level.

---

## 14. Naming Fixes

| v1.0                | v2.0                 | Table                                         |
| ------------------- | -------------------- | --------------------------------------------- |
| `EMPID`             | `EMP_ID`             | `MEAL_SUBSIDIES`                              |
| `CREATEDDATE`       | `CREATED_DATE`       | Multiple                                      |
| `MODIFIEDDATE`      | `MODIFIED_DATE`      | Multiple                                      |
| `TOTALMEALSUBSIDY`  | `TOTAL_MEAL_SUBSIDY` | `MEAL_SUBSIDIES`                              |
| `STARTDATE`         | `START_DATE`         | `MEAL_SUBSIDIES`                              |
| `ENDDATE`           | `END_DATE`           | `MEAL_SUBSIDIES`                              |
| `POSTED_EARNEDDATE` | `POSTED_EARNED_DATE` | `MEAL_CREDIT_INFO`, `MEAL_TRANSACTIONRECORDS` |
| `CREATEDBY`         | `CREATED_BY`         | `MEAL_STUB_PO`, `MEAL_SUBSIDIES`              |
| `TYPE`              | `SCAN_TYPE`          | `T_SCAN_VALUE_LENGTH`                         |
| `DATE_TIME`         | `RECORD_DATE`        | `T_EXCESS_FUND`                               |

---

## 15. VARCHAR2 Length Fixes

| Column                                 | v1.0           | v2.0            | Why                              |
| -------------------------------------- | -------------- | --------------- | -------------------------------- |
| `MEAL_APPROVAL_STUBS.REQUESTOR_EMAIL`  | `VARCHAR2(64)` | `VARCHAR2(128)` | RFC 5321 max email = 254 chars   |
| `MEAL_APPROVAL_STUBS.EMAIL_APPROVER_*` | `VARCHAR2(64)` | `VARCHAR2(128)` | Same                             |
| `MEAL_RESET_REQUEST.FULLNAME`          | `VARCHAR2(64)` | `VARCHAR2(256)` | Full names exceed 64 chars       |
| `MEAL_RESET_REQUEST.REMARKS`           | `VARCHAR2(64)` | `VARCHAR2(512)` | 64 too short for remarks         |
| `MEAL_STUB_PO.REMARKS`                 | `VARCHAR2(64)` | `VARCHAR2(512)` | Same                             |
| `MEAL_STUB_PO.CREATED_BY`              | `VARCHAR2(64)` | `VARCHAR2(128)` | Consistent with other audit cols |
| `T_HOST_DETAIL.HOST_NAME`              | `VARCHAR2(20)` | `VARCHAR2(100)` | Hostnames exceed 20 chars        |
| `T_EMP_MGMT_ADMIN.EMP_PW`              | `VARCHAR2(25)` | `VARCHAR2(128)` | bcrypt minimum 60 chars          |

---

## Object Count

| Object type       | v1.0                              | v2.0   | Delta                     |
| ----------------- | --------------------------------- | ------ | ------------------------- |
| Tables            | 22                                | 22     | —                         |
| Sequences         | 9+                                | **0**  | −9 (replaced by IDENTITY) |
| Triggers          | 14 (9 seq + 2 cutoff + TRG_T_EMP) | **7**  | −7                        |
| Functions         | 0                                 | **3**  | +3 (hash verify)          |
| Composite indexes | 0                                 | **9**  | +9                        |
| FK constraints    | 0                                 | **14** | +14                       |
| CHECK constraints | 0                                 | **19** | +19                       |
| DDL guard         | 0                                 | **1**  | +1                        |
| Audit policies    | 0                                 | **11** | +11                       |

---

---

# v3.2 → v4.0 (Breaking Change)

**Date:** 2026-05-11
**File:** `schema_v4.0.sql`
**Type:** Breaking — god-table decomposition, wallet extraction, settlement normalization

---

## Motivation

Seven structural problems in v3.2 drove this change:

1. `T_FUND_DETAILS` was a god table holding HR template data, live wallet state, period-close computed fields, ticket data, soft-delete flags, and audit columns in a single row. Any read of any one concern required scanning the full wide row.

2. `CONSUMPTION` was dual-sourced: stored on `T_FUND_DETAILS.CONSUMPTION` (updated by trigger) and derivable from `SUM(TTL_CONSUMPTION - VOID_CONSUMPTION)` on `T_EMP_TRANSACTION`. These could drift if a trigger failed or was skipped.

3. `PAYGROUP` and `JOBCLASS` were denormalized per-employee per-period on `T_FUND_DETAILS`, requiring a join to retrieve current classification. The master list was the correct home.

4. `MEAL_TRANSACTIONRECORDS` was a full denormalized snapshot table duplicating nearly everything from `T_FUND_DETAILS` and `T_EMP_TRANSACTION`. It was a write-time reporting snapshot that became stale the moment it was written.

5. `TRG_T_EMP_TRANS_WALLET_DEC` silently skipped wallet updates when `CUTOFF_ID = 0` (the fallback value when no period matched). Orphan transactions were accepted, reducing wallet balance on screen but not in the DB — a silent corruption risk.

6. `T_EMP_TRANS_SUMMARY` was redundant with `T_FUND_DETAILS` post-merge; both stored per-period consumption/fund snapshots for the same employee set.

7. The upload template format mapped directly into `T_FUND_DETAILS` with no separation between what HR uploaded vs. what the system computed during the period.

---

## Tables Dropped

| Table | Reason |
|---|---|
| `T_FUND_DETAILS` | Decomposed into `T_SUBSIDY_UPLOAD` + `T_WALLET` + `T_PERIOD_SETTLEMENT` |
| `T_EMP_TRANS_SUMMARY` | Redundant snapshot; replaced by `V_PERIOD_SUMMARY` view |
| `MEAL_TRANSACTIONRECORDS` | Redundant snapshot; replaced by `V_PERIOD_FULL` view |
| `MEAL_TRAN_SUMCOUNT` | Low-value counter; moved to application layer |
| `T_EMP_MEAL_ALLOWANCE` | Ticket fields absorbed into `T_SUBSIDY_UPLOAD` |
| `MEAL_EMP_MASTER` | Already unused legacy table |

## Tables Added

| Table | Purpose |
|---|---|
| `T_SUBSIDY_UPLOAD` | Immutable HR template upload per employee per period. UQ(GID, CUTOFF_ID). Contains TRANCODE, TOTAL_MEAL_SUBSIDY, CO_BANK_PREV, OTHER_FUND, EFFECTIVE_EARNED (virtual), EARNED_DATE, REMARKS, TICKET_AMOUNT, TICKET_COUNT. |
| `T_WALLET` | Live wallet balance per employee per period. CURR_BALANCE default 3000. Trigger-decremented on POS swipe, trigger-restored on void. UQ(GID, CUTOFF_ID). |
| `T_PERIOD_SETTLEMENT` | Written once at period close. Stores DEDUCTION, CO_APPLIED, NET_DEDUCTION, EXCESS_FUND. CONSUMPTION is not stored — computed at close time from T_EMP_TRANSACTION. UQ(GID, CUTOFF_ID). |

## Tables Modified

| Table | Change |
|---|---|
| `T_EMP_MASTER_LIST` | Added `PAYGROUP VARCHAR2(64)` and `JOBCLASS VARCHAR2(64)`. Updated by application on each subsidy upload. |
| `T_EMP_TRANSACTION` | `CUTOFF_ID` changed from `DEFAULT 0` nullable to `NOT NULL` with FK to `T_CUTOFF_DATE`. |

## Key Trigger Changes

| Trigger | Change |
|---|---|
| `TRG_T_EMP_TRANSACTION_NRM` | Now `RAISE_APPLICATION_ERROR(-20010)` on no period match. No longer defaults to 0. Closes orphan-transaction bug. |
| `TRG_T_EMP_TRANS_WALLET_DEC` | Renamed `TRG_T_WALLET_DEC`. Target changed to `T_WALLET.CURR_BALANCE`. |
| `TRG_T_EMP_TRANS_WALLET_VOID` | Renamed `TRG_T_WALLET_VOID`. Target changed to `T_WALLET.CURR_BALANCE`. |
| `TRG_T_SUBSIDY_UPLOAD_AUDIT` | New. Guards CREATED_DATE and CREATED_BY immutability. |
| `TRG_T_PERIOD_SETTLEMENT_AUDIT` | New. Guards SETTLED_DATE and SETTLED_BY immutability. |

## Views Changed

| View | Change |
|---|---|
| `V_ACTIVE_SUBSIDIES` | Rebuilt to read `T_SUBSIDY_UPLOAD`. PAYGROUP/JOBCLASS from `T_EMP_MASTER_LIST`. |
| `V_ACTIVE_TRANSACTIONRECORDS` | Dropped (source table dropped). |
| `V_EMP_FUND_SUMMARY` | Rebuilt. Joins `T_SUBSIDY_UPLOAD` + `T_WALLET` + `T_PERIOD_SETTLEMENT`. |
| `V_PERIOD_SUMMARY` | New. Replaces `T_EMP_TRANS_SUMMARY`. Live CONSUMPTION from `T_EMP_TRANSACTION`. |
| `V_PERIOD_FULL` | New. Replaces `MEAL_TRANSACTIONRECORDS`. Line-item drill-down per transaction. |

---

## Business Logic Preserved

All formulas from ConsumptionPlan.md preserved, enforced at application layer at period close:

```
EFFECTIVE_EARNED  = TOTAL_MEAL_SUBSIDY + CO_BANK_PREV + OTHER_FUND   (virtual, DB-enforced)
CONSUMPTION       = SUM(TTL_CONSUMPTION - VOID_CONSUMPTION)           (computed at close, never stored)
DEDUCTION         = max(0, CONSUMPTION - TOTAL_MEAL_SUBSIDY)
CO_APPLIED        = min(DEDUCTION, CO_BANK_PREV)
NET_DEDUCTION     = DEDUCTION - CO_APPLIED
EXCESS_FUND       = max(0, EFFECTIVE_EARNED - CONSUMPTION)
CHK_SETTLE_DED_SPLIT: CO_APPLIED + NET_DEDUCTION = DEDUCTION          (CHECK on T_PERIOD_SETTLEMENT)
```

CO bank carry-forward: Period N EXCESS_FUND → T_EXCESS_FUND.FUND → Period N+1 T_SUBSIDY_UPLOAD.CO_BANK_PREV.

---

## Migration Steps Summary

See `schema_v4.0.sql` Section 14 for full step-by-step migration with SQL statements, validation queries, and rollback procedure.

High-level order:
1. Freeze uploads + period close
2. Add PAYGROUP/JOBCLASS to T_EMP_MASTER_LIST + backfill from T_FUND_DETAILS
3. Create T_SUBSIDY_UPLOAD + migrate from T_FUND_DETAILS
4. Create T_WALLET + migrate CURR_WALLET_BALANCE
5. Create T_PERIOD_SETTLEMENT + migrate closed-period settlement fields
6. Fix T_EMP_TRANSACTION.CUTOFF_ID (NOT NULL + FK, orphan cleanup)
7. Drop: T_FUND_DETAILS, T_EMP_TRANS_SUMMARY, MEAL_TRANSACTIONRECORDS, MEAL_TRAN_SUMCOUNT, T_EMP_MEAL_ALLOWANCE, MEAL_EMP_MASTER
8. Apply new triggers, DDL guard, audit trail, views
9. Backfill ROW_HASH via CryptoVault.signRecord
10. Update application services
11. Reinstall DDL guard
12. Full regression test suite

Rollback is safe up to and including step 6 (all destructive DROPs happen in step 7).

---

## Application Layer Impact

Services that must be updated before deploying v4.0:

- `FundDetailsService` → split into `SubsidyUploadService`, `WalletService`, `PeriodSettlementService`
- All `T_FUND_DETAILS` queries → update join structure to three-table model
- All `T_EMP_TRANS_SUMMARY` queries → use `V_PERIOD_SUMMARY`
- All `MEAL_TRANSACTIONRECORDS` queries → use `V_PERIOD_FULL`
- HR upload handler → UPDATE `T_EMP_MASTER_LIST.PAYGROUP/JOBCLASS` before INSERT into `T_SUBSIDY_UPLOAD`
- Wallet seeding → INSERT into `T_WALLET` (GID, CUTOFF_ID, CURR_BALANCE=3000) on subsidy upload
- Period close → compute CONSUMPTION from `T_EMP_TRANSACTION`, write `T_PERIOD_SETTLEMENT`, write `T_EXCESS_FUND`
- Remove all `CUTOFF_ID = 0` guards (no longer reachable)
