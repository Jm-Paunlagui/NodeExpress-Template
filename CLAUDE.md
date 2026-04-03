# 🚀 FINAL PROMPT — Oracle MongoDB-Style Wrapper Library (Node.js)

---

You are an expert Node.js and OracleDB developer. Build a **production-grade, fully tested, reusable OracleDB wrapper library** written in Node.js using the `oracledb` npm package. The library must mirror MongoDB's core API as closely as possible while leveraging the full power of Oracle SQL.

---

## ⚠️ ARCHITECTURE CONSTRAINT — READ FIRST BEFORE WRITING ANY CODE

This library is being built **inside an existing Express/OracleDB backend project** that already has a production-grade connection pool manager. **Do not reimplement pool management.** Instead, integrate with the existing system as described below.

### Existing Infrastructure

The project already provides these files (do not recreate them):

```
src/config/adapters/oracle.js   ← Pool manager: withConnection, withTransaction,
                                   withBatchConnection, closeAll, getPoolStats,
                                   health monitoring, retry logic, graceful shutdown
src/config/database.js          ← Connection registry: named connections mapped
                                   to credentials + connect strings
src/config/index.js             ← Adapter factory barrel — re-exports everything
                                   from oracle.js + database.js
```

The existing adapter exposes this API:

```js
const {
  withConnection,       // withConnection(connectionName, async (conn) => result)
  withTransaction,      // withTransaction(connectionName, async (conn) => result)
  withBatchConnection,  // withBatchConnection(connectionName, operations[])
  closeAll,             // graceful pool shutdown
  getPoolStats,         // pool monitoring snapshot
  isPoolHealthy,        // isPoolHealthy(connectionName) → boolean
  oracledb,             // raw oracledb driver reference
} = require('./src/config');
```

Named connections registered in `database.js` (examples):
- `'userAccount'` — main application schema
- `'unitInventory'` — inventory schema (dev/prod configs differ)

### How `db.js` Must Be Implemented

`db.js` is **not** a pool manager. It is a **thin factory adapter** that binds a named connection to the wrapper classes. It must delegate entirely to `src/config`.

```js
// db.js — thin adapter. DO NOT reimplement pool management here.
'use strict';

const config = require('./src/config');

/**
 * Creates a db interface bound to a named connection from database.js.
 * Pass this instance to OracleCollection, OracleSchema, OracleDCL, etc.
 *
 * @param {string} connectionName - Key from src/config/database.js registry
 * @returns {DbInterface}
 */
function createDb(connectionName = 'userAccount') {
  if (!connectionName || typeof connectionName !== 'string') {
    throw new TypeError('createDb: connectionName must be a non-empty string');
  }

  return {
    connectionName,

    /**
     * Run a callback with a managed connection. The connection is automatically
     * released after the callback resolves or rejects. Health monitoring,
     * slow-op warnings, and retry logic are all handled by the underlying adapter.
     * @param {Function} callback - async (conn) => result
     */
    withConnection: (callback) => config.withConnection(connectionName, callback),

    /**
     * Run a callback inside a BEGIN/COMMIT/ROLLBACK transaction.
     * On error, rollback is automatic before rethrowing.
     * @param {Function} callback - async (conn) => result
     */
    withTransaction: (callback) => config.withTransaction(connectionName, callback),

    /**
     * Run multiple operations on one shared connection.
     * @param {Function[]} operations - array of async (conn) => result
     */
    withBatchConnection: (operations) => config.withBatchConnection(connectionName, operations),

    /**
     * Graceful shutdown of ALL pools. Call once on process exit.
     * Delegates to the existing adapter's closeAll().
     */
    closePool: () => config.closeAll(),

    /** Pool stats snapshot for monitoring. */
    getPoolStats: () => config.getPoolStats(),

    /** Health check for this named connection's pool. */
    isHealthy: () => config.isPoolHealthy(connectionName),

    /** Raw oracledb driver — needed for BIND_OUT, OUT_FORMAT_OBJECT, etc. */
    oracledb: config.oracledb,
  };
}

module.exports = { createDb };
```

### How All Wrapper Classes Must Use `db`

**Every method in OracleCollection, OracleSchema, OracleDCL, Transaction, etc. must use `db.withConnection()` — never call `db.oracledb.getPool()` or manage connections manually.**

```js
// ✅ CORRECT — connection lifecycle fully managed by the adapter
async findOne(filter, options = {}) {
  return this.db.withConnection(async (conn) => {
    const { whereClause, binds } = parseFilter(filter);
    const sql = `SELECT * FROM "${this.tableName}" ${whereClause} FETCH FIRST 1 ROW ONLY`;
    try {
      const result = await conn.execute(sql, binds, { outFormat: this.db.oracledb.OUT_FORMAT_OBJECT });
      return result.rows[0] ?? null;
    } catch (err) {
      throw new Error(`[OracleCollection.findOne] ${err.message}\nSQL: ${sql}`);
    }
  });
}

// ❌ WRONG — never do this; leaks connections, bypasses health monitoring
async findOne(filter, options = {}) {
  let conn;
  try {
    conn = await this.db.oracledb.getPool().getConnection(); // NEVER
    // ...
  } finally {
    if (conn) await conn.close();
  }
}
```

**For `bulkWrite`, `insertMany`, and any multi-step atomic operations, use `db.withTransaction()`:**

```js
async bulkWrite(operations) {
  return this.db.withTransaction(async (conn) => {
    // all operations share `conn` — commit/rollback handled automatically
    const results = [];
    for (const op of operations) {
      // ... execute each op on `conn`
      results.push(result);
    }
    return { acknowledged: true, results };
  });
}
```

**For `Transaction.js` sessions with savepoints, use `db.withTransaction()` as the outer scope and call `SAVEPOINT`/`ROLLBACK TO SAVEPOINT` directly on `conn`:**

```js
// Transaction.js withTransaction wrapper
async withTransaction(fn) {
  return this.db.withTransaction(async (conn) => {
    const session = new Session(conn, this.db);
    return fn(session);
  });
}
```

### Usage Pattern (Replaces `db.initPool(config)`)

```js
// Old prompt pattern — DO NOT USE
const { db } = require('./oracle-mongo-wrapper');
await db.initPool({ user: '...', password: '...', connectString: '...' });

// ✅ Correct pattern for this project
const { createDb } = require('./oracle-mongo-wrapper');
const { OracleCollection, OracleSchema, OracleDCL } = require('./oracle-mongo-wrapper');

// Bind to the named connection registered in src/config/database.js
const db      = createDb('userAccount');
const users   = new OracleCollection('users', db);
const orders  = new OracleCollection('orders', db);
const schema  = new OracleSchema(db);
const dcl     = new OracleDCL(db);
// Pool is already initialized by src/config — no initPool() needed
```

### `withCTE`, `withRecursiveCTE`, `insertFromQuery`, `updateFromJoin`, `performance`

These top-level helpers in the original prompt were referenced as `db.withCTE(...)`, `db.performance.explainPlan(...)`, etc. In this architecture, expose them as standalone exports from the barrel `index.js`, accepting a `db` instance as first argument:

```js
// index.js exports
const { withCTE, withRecursiveCTE } = require('./cteBuilder');
const { insertFromQuery, updateFromJoin } = require('./OracleCollection');
const { createPerformance } = require('./performanceUtils');

// Usage
const cteBuilder  = withCTE(db, { active_users: users.find({ status: 'active' }) });
const performance = createPerformance(db);
await performance.explainPlan(users.find({ status: 'active' }));
```

---

## 📁 FILE STRUCTURE

```
/oracle-mongo-wrapper
  ├── advanced/
  │   ├── oracleAdvanced.js       ← CONNECT BY, PIVOT, UNPIVOT, FOR UPDATE,
  │   │                              RETURNING, AS OF, LATERAL JOIN, TABLESAMPLE
  │   └── performanceUtils.js     ← EXPLAIN PLAN, ANALYZE, MATERIALIZED VIEW
  │
  ├── core/
  │   ├── OracleCollection.js     ← Core CRUD + all query methods
  │   └── QueryBuilder.js         ← Chainable cursor returned by find()
  │
  ├── joins/
  │   ├── joinBuilder.js          ← Translates $lookup (all join types) → SQL JOIN clauses
  │   └── setOperations.js        ← UNION, UNION ALL, INTERSECT, MINUS
  │
  ├── parsers/
  │   ├── filterParser.js         ← Translates MongoDB filter object → SQL WHERE clause
  │   └── updateParser.js         ← Translates MongoDB update operators → SQL SET clause
  │
  ├── pipeline/
  │   ├── aggregatePipeline.js    ← Translates pipeline array → full SQL query
  │   ├── cteBuilder.js           ← Builds WITH ... AS CTEs (regular + recursive)
  │   ├── subqueryBuilder.js      ← Builds scalar, inline, correlated, EXISTS subqueries
  │   └── windowFunctions.js      ← Translates $window expressions → SQL analytic functions
  │
  ├── schema/
  │   ├── OracleDCL.js            ← DCL: grant, revoke
  │   └── OracleSchema.js         ← DDL: createTable, alterTable, createView, etc.
  │
  ├── db.js                       ← Thin adapter factory (createDb) — NO pool management
  ├── index.js                    ← Main export (barrel file)
  ├── README.md
  ├── Transaction.js              ← Transactions + Savepoints
  └── utils.js                    ← Shared helpers: bindParams, typeMapping, rowToDoc, etc.
```

---

## 📦 GENERAL IMPLEMENTATION RULES

- All methods must be `async/await`
- **Never manage connection lifecycle manually** — always use `db.withConnection()` or `db.withTransaction()`
- Always use **bind variables** (`:varName`) for all values — **never string interpolation**
- Return results in MongoDB-style format:
  ```js
  // Insert: { acknowledged: true, insertedId: '...' }
  // Update: { acknowledged: true, matchedCount: 1, modifiedCount: 1 }
  // Delete: { acknowledged: true, deletedCount: 1 }
  ```
- All errors must be caught and rethrown with descriptive messages including the SQL that failed:
  ```js
  throw new Error(`[OracleCollection.methodName] ${err.message}\nSQL: ${sql}`)
  ```
- Write **JSDoc comments** on every method explaining params, return value, and the SQL it generates
- Produce a `README.md` with usage examples for every method
- Produce a `test.js` end-to-end example file

---

## 🔍 CATEGORY 1 — Query / Read Operations

Implement on `OracleCollection`:

### `find(filter, options)` → returns `QueryBuilder`
- Translates filter → `WHERE` clause
- `options.sort` → `ORDER BY`
- `options.limit` → `FETCH FIRST n ROWS ONLY`
- `options.skip` → `OFFSET n ROWS`
- `options.projection` → `SELECT col1, col2` or `SELECT *`
- `options.forUpdate` → appends `FOR UPDATE`, `FOR UPDATE NOWAIT`, or `FOR UPDATE SKIP LOCKED`
- Returns a `QueryBuilder` instance for chaining (see Category 8)

### `findOne(filter, options)` → `Object | null`
- Same as `find()` but appends `FETCH FIRST 1 ROW ONLY`
- Returns a single document or `null`

### `findOneAndUpdate(filter, update, options)` → `Object | null`
- Uses `SELECT ... FOR UPDATE` then `UPDATE` on the same `conn` inside `db.withConnection()`
- `options.returnDocument: 'before' | 'after'` — return doc before or after update
- `options.upsert: true` — insert if no match
- Runs atomically within a single connection (not a transaction)

### `findOneAndDelete(filter)` → `Object | null`
- Fetches the matching row first, then deletes it on the same `conn`
- Returns the deleted document

### `findOneAndReplace(filter, replacement, options)` → `Object | null`
- Replaces entire row (except primary key) after SELECT FOR UPDATE
- `options.returnDocument: 'before' | 'after'`

### `countDocuments(filter)` → `Number`
- `SELECT COUNT(*) FROM table WHERE ...`

### `estimatedDocumentCount()` → `Number`
- Fast: `SELECT NUM_ROWS FROM USER_TABLES WHERE TABLE_NAME = UPPER(:name)`

### `distinct(field, filter)` → `Array`
- `SELECT DISTINCT <field> FROM table WHERE ...`

---

### Filter Operators (in `filterParser.js`)
Translate a filter object into a parameterized `WHERE` clause + bind object.

| MongoDB Filter | SQL Translation |
|---|---|
| `{ field: value }` | `field = :field` |
| `{ field: { $eq: v } }` | `field = :field` |
| `{ field: { $ne: v } }` | `field <> :field` |
| `{ field: { $gt: v } }` | `field > :field` |
| `{ field: { $gte: v } }` | `field >= :field` |
| `{ field: { $lt: v } }` | `field < :field` |
| `{ field: { $lte: v } }` | `field <= :field` |
| `{ field: { $in: [a,b] } }` | `field IN (:v0, :v1)` |
| `{ field: { $nin: [a,b] } }` | `field NOT IN (:v0, :v1)` |
| `{ field: { $between: [min, max] } }` | `field BETWEEN :min AND :max` |
| `{ field: { $notBetween: [min, max] } }` | `field NOT BETWEEN :min AND :max` |
| `{ field: { $exists: true } }` | `field IS NOT NULL` |
| `{ field: { $exists: false } }` | `field IS NULL` |
| `{ field: { $regex: 'pat' } }` | `REGEXP_LIKE(field, :pat)` |
| `{ field: { $like: 'pat%' } }` | `field LIKE :pat` |
| `{ field: { $any: [a,b] } }` | `field = ANY(:v0, :v1)` |
| `{ field: { $all: [a,b] } }` | `field = ALL(:v0, :v1)` |
| `{ $and: [{...},{...}] }` | `(cond1 AND cond2)` |
| `{ $or: [{...},{...}] }` | `(cond1 OR cond2)` |
| `{ $nor: [{...},{...}] }` | `NOT (cond1 OR cond2)` |
| `{ $not: { field: v } }` | `NOT (field = :v)` |
| `{ field: { $case: [{when, then}], $else: v } }` | `CASE WHEN ... THEN ... ELSE ... END` |
| `{ field: { $coalesce: [f1, f2, fallback] } }` | `COALESCE(f1, f2, :fallback)` |
| `{ field: { $nullif: [f1, f2] } }` | `NULLIF(f1, :f2)` |

**Rules for filterParser.js:**
- Bind variable names must be unique — use a counter suffix (`:field_0`, `:field_1`) when the same field appears multiple times
- Return `{ whereClause: 'WHERE ...', binds: { field_0: value } }`
- Return `{ whereClause: '', binds: {} }` if filter is empty or `{}`
- Throw a descriptive error for unsupported operators

---

## ✏️ CATEGORY 2 — Insert Operations

### `insertOne(document, options)` → `{ acknowledged, insertedId, returning? }`
- Auto-generate `_id` using `SYS_GUID()` if document has no `id` field
- `INSERT INTO table (col1, col2, ...) VALUES (:v1, :v2, ...)`
- Use `RETURNING id INTO :outId` to capture the generated ID
- `options.returning: ['col']` — return additional columns via `RETURNING ... INTO`

### `insertMany(documents)` → `{ acknowledged, insertedCount, insertedIds[] }`
- Use `connection.executeMany()` for batch performance
- All rows inserted in a single round-trip inside `db.withTransaction()`
- Rollback all rows if any insertion fails (atomic batch)
- Pass `{ autoCommit: false, bindDefs: {...} }` to `executeMany` — transaction handles commit

---

## 🔄 CATEGORY 3 — Update Operations

### `updateOne(filter, update, options)` → `{ acknowledged, matchedCount, modifiedCount, returning? }`
- Updates the first matching row
- Use `WHERE ROWID = (SELECT ROWID FROM table WHERE ... AND ROWNUM = 1)` to target single row
- `options.upsert: true` — insert if no rows matched
- `options.returning: ['col']` — return values after update via `RETURNING ... INTO`

### `updateMany(filter, update, options)` → `{ acknowledged, matchedCount, modifiedCount, returning? }`
- Updates all matching rows
- `options.returning: ['col']` supported

### `replaceOne(filter, replacement, options)` → `{ acknowledged, matchedCount, modifiedCount }`
- Replaces all columns (except `id`/primary key)
- Builds `UPDATE table SET col1=:v1, col2=:v2 ... WHERE ...`

### `bulkWrite(operations)` → `{ acknowledged, results[] }`
- Accepts array of operation objects:
  ```js
  [
    { insertOne: { document: {...} } },
    { updateOne: { filter: {...}, update: {...} } },
    { updateMany: { filter: {...}, update: {...} } },
    { deleteOne: { filter: {...} } },
    { deleteMany: { filter: {...} } },
    { replaceOne: { filter: {...}, replacement: {...} } }
  ]
  ```
- Executes all operations within `db.withTransaction()` — all succeed or all rollback

---

### Update Operators (in `updateParser.js`)
Translate update object into a parameterized `SET` clause.

| MongoDB Operator | SQL Translation |
|---|---|
| `$set: { field: v }` | `field = :v` |
| `$unset: { field: '' }` | `field = NULL` |
| `$inc: { field: n }` | `field = field + :n` |
| `$mul: { field: n }` | `field = field * :n` |
| `$min: { field: v }` | `field = LEAST(field, :v)` |
| `$max: { field: v }` | `field = GREATEST(field, :v)` |
| `$currentDate: { field: true }` | `field = SYSDATE` |
| `$rename: { old: new }` | Throw error: "Use ALTER TABLE to rename columns" |

**Rules for updateParser.js:**
- Return `{ setClause: 'SET col1=:v1, col2=:v2', binds: { v1: ..., v2: ... } }`
- Merge binds from both `updateParser` and `filterParser` — ensure no key collisions by prefixing update binds with `upd_`
- Throw if update object is empty

---

## 🗑️ CATEGORY 4 — Delete Operations

### `deleteOne(filter, options)` → `{ acknowledged, deletedCount, returning? }`
- Deletes first matching row using `WHERE ROWID = (SELECT ROWID FROM table WHERE ... AND ROWNUM = 1)`
- `options.returning: ['col']` — capture deleted row values via `RETURNING ... INTO`

### `deleteMany(filter)` → `{ acknowledged, deletedCount }`
- Deletes all matching rows
- Returns `rowsAffected` as `deletedCount`

### `drop()` → `{ acknowledged }`
- `DROP TABLE <tableName> CASCADE CONSTRAINTS`
- Throws descriptive error if table does not exist

---

## 📊 CATEGORY 5 — Aggregation Pipeline

### `aggregate(pipeline)` → `Array`
Translates a MongoDB-style pipeline array into a single SQL query using CTEs and subqueries.

**Pipeline stages supported:**

| Stage | SQL Translation |
|---|---|
| `$match` | `WHERE ...` (uses filterParser) |
| `$group` | `GROUP BY` with `$sum`, `$avg`, `$min`, `$max`, `$count`, `$first`, `$last` |
| `$project` | `SELECT col1, col2, expr AS alias` |
| `$sort` | `ORDER BY col ASC/DESC` |
| `$limit` | `FETCH FIRST n ROWS ONLY` |
| `$skip` | `OFFSET n ROWS` |
| `$count` | `SELECT COUNT(*) AS field` |
| `$addFields` | Additional computed columns in SELECT |
| `$lookup` | JOIN (see Category 9) |
| `$unwind` | Requires JSON_TABLE or note: Oracle arrays via XMLTABLE/JSON_TABLE |
| `$replaceRoot` | Rewrite SELECT to use sub-document fields |
| `$facet` | Multiple sub-pipelines as CTEs, merged with UNION ALL |
| `$bucket` | `CASE WHEN` range grouping |
| `$out` | `INSERT INTO targetTable SELECT ...` |
| `$merge` | `MERGE INTO targetTable USING (SELECT ...) ON (...)` |
| `$having` | `HAVING` clause after GROUP BY |

**Aggregation expression operators:**

| Expression | SQL |
|---|---|
| `$sum: '$field'` | `SUM(field)` |
| `$avg: '$field'` | `AVG(field)` |
| `$min: '$field'` | `MIN(field)` |
| `$max: '$field'` | `MAX(field)` |
| `$count: '*'` | `COUNT(*)` |
| `$first: '$field'` | `MIN(field)` (Oracle workaround) |
| `$last: '$field'` | `MAX(field)` (Oracle workaround) |
| `$concat: ['$f1','$f2']` | `f1 \|\| f2` |
| `$toUpper: '$field'` | `UPPER(field)` |
| `$toLower: '$field'` | `LOWER(field)` |
| `$substr: ['$f', start, len]` | `SUBSTR(field, start, len)` |
| `$dateToString: { format, date }` | `TO_CHAR(date, format)` |
| `$cond: { if, then, else }` | `CASE WHEN ... THEN ... ELSE ... END` |
| `$ifNull: ['$f', default]` | `COALESCE(field, :default)` |
| `$size: '$arrayField'` | `JSON_ARRAY_LENGTH(field)` |

**Rules for aggregatePipeline.js:**
- Each pipeline stage wraps the previous as a CTE for clean chaining:
  ```sql
  WITH stage_0 AS (SELECT * FROM table WHERE ...),
       stage_1 AS (SELECT ..., SUM(col) FROM stage_0 GROUP BY ...),
       stage_2 AS (SELECT * FROM stage_1 ORDER BY ...)
  SELECT * FROM stage_2 FETCH FIRST :limit ROWS ONLY OFFSET :skip ROWS
  ```
- Optimize: collapse adjacent `$match` stages into one WHERE
- Throw descriptive errors for unsupported stage combinations

---

## 🗂️ CATEGORY 6 — Index Operations

### `createIndex(fields, options)` → `{ acknowledged, indexName }`
- `fields`: `{ colName: 1 }` (1 = ASC, -1 = DESC)
- `options.unique: true` → `CREATE UNIQUE INDEX`
- `options.name` → custom index name; auto-generate as `idx_<table>_<cols>` if not provided
- `options.type: 'bitmap'` → `CREATE BITMAP INDEX` (Oracle-specific)

### `createIndexes(indexSpecs[])` → `{ acknowledged, indexNames[] }`
- Loops `createIndex()` for each spec

### `dropIndex(indexName)` → `{ acknowledged }`
- `DROP INDEX <name>`

### `dropIndexes()` → `{ acknowledged, dropped[] }`
- Query `USER_INDEXES` for all non-primary indexes on this table
- Drop each one

### `getIndexes()` → `Array`
- Query `USER_INDEXES` joined with `USER_IND_COLUMNS`
- Return array of `{ indexName, columns, unique, type }`

### `reIndex()` → `{ acknowledged }`
- `ALTER INDEX <name> REBUILD` for all indexes on this table

---

## 🔐 CATEGORY 7 — Transaction Operations (in `Transaction.js`)

**Important:** The underlying commit/rollback/connection lifecycle is handled by `db.withTransaction()` from the existing adapter. `Transaction.js` wraps that to expose a MongoDB-style session API with savepoint support.

### `Session` class (internal)
- Holds a reference to the raw `conn` passed by `db.withTransaction()`
- Exposes `collection(tableName)` — returns an `OracleCollection` bound to this session's `conn`
- All collection operations on a session reuse the **same `conn`** — no new connections acquired

### `withTransaction(fn)` → any
```js
await db.withTransaction(async (session) => {
  await session.collection('orders').insertOne({ item: 'pen', qty: 5 })
  await session.collection('inventory').updateOne(
    { item: 'pen' },
    { $inc: { qty: -5 } }
  )
})
```
- Delegates to `db.withTransaction(async (conn) => { ... })` from the existing adapter
- On success: adapter auto-commits
- On any error: adapter auto-rollbacks, then rethrows

### `savepoint(name)` → void
- `await conn.execute('SAVEPOINT ' + name)`
- Called on the session's `conn` directly

### `rollbackTo(name)` → void
- `await conn.execute('ROLLBACK TO SAVEPOINT ' + name)`

### `releaseSavepoint(name)` → void
- Not natively supported in Oracle — implement as no-op with console warning

**Session-aware OracleCollection:**

When `OracleCollection` is instantiated from a session, it must skip calling `db.withConnection()` and instead execute directly on the provided `conn`. Implement via an internal `_conn` override:

```js
class OracleCollection {
  constructor(tableName, db, _conn = null) {
    this.tableName = tableName;
    this.db = db;
    this._conn = _conn; // set when used inside a transaction session
  }

  async _execute(fn) {
    if (this._conn) {
      // Already inside a transaction — use the shared conn directly
      return fn(this._conn);
    }
    // Normal path — acquire a managed connection
    return this.db.withConnection(fn);
  }

  async findOne(filter, options = {}) {
    return this._execute(async (conn) => {
      // ... build and execute SQL on conn
    });
  }
  // ... all other methods use this._execute(async (conn) => { ... })
}
```

**Full savepoint example:**
```js
await transactionManager.withTransaction(async (session) => {
  await session.collection('orders').insertOne({ item: 'pen' })
  await session.savepoint('after_order')
  try {
    await session.collection('payments').insertOne({ amount: -999 })
  } catch (err) {
    await session.rollbackTo('after_order')
  }
  await session.collection('logs').insertOne({ event: 'order_created' })
})
```

---

## 🛠️ CATEGORY 8 — QueryBuilder (Cursor Chaining)

`find()` returns a `QueryBuilder` instance. All methods are chainable and lazy — SQL is only executed when a terminal method is called. Terminal methods call `db.withConnection()` (or use `_conn` if inside a session).

```js
const results = await users
  .find({ status: 'active' })
  .sort({ name: 1, age: -1 })
  .skip(20)
  .limit(10)
  .project({ name: 1, email: 1 })
  .toArray()
```

| Method | SQL Effect | Terminal? |
|---|---|---|
| `.sort(obj)` | `ORDER BY col ASC/DESC` | No |
| `.limit(n)` | `FETCH FIRST n ROWS ONLY` | No |
| `.skip(n)` | `OFFSET n ROWS` | No |
| `.project(obj)` | `SELECT col1, col2` | No |
| `.forUpdate(mode)` | `FOR UPDATE [NOWAIT\|SKIP LOCKED]` | No |
| `.toArray()` | Execute → return all rows as array | ✅ Yes |
| `.forEach(fn)` | Execute → call fn for each row | ✅ Yes |
| `.next()` | Execute → return first row | ✅ Yes |
| `.hasNext()` | Execute → return boolean | ✅ Yes |
| `.count()` | `SELECT COUNT(*) ...` | ✅ Yes |
| `.explain()` | Return SQL string (dry run, no execution) | ✅ Yes |

**Rules:**
- Calling `.sort()` after `.toArray()` must throw: "Cannot chain after terminal method"
- `.skip()` without `.limit()` must still work (Oracle supports `OFFSET` alone)
- `.project({ field: 0 })` means exclude — translate to SELECT all other columns
- `QueryBuilder` must hold a reference to `db` and `_conn` (for session use) — terminal methods call `db.withConnection()` or `_conn` accordingly

---

## 🔗 CATEGORY 9 — JOINs and Set Operations

### JOINs (in `joinBuilder.js`)

Used inside `aggregate()` pipeline as a `$lookup` stage.

```js
await orders.aggregate([
  {
    $lookup: {
      from: 'customers',
      localField: 'customerId',
      foreignField: 'id',
      as: 'customerInfo',
      joinType: 'left'  // 'left' | 'right' | 'full' | 'inner' | 'cross'
    }
  }
])
```

| `joinType` | SQL |
|---|---|
| `'left'` (default) | `LEFT OUTER JOIN customers c ON o.customerId = c.id` |
| `'right'` | `RIGHT OUTER JOIN customers c ON o.customerId = c.id` |
| `'full'` | `FULL OUTER JOIN customers c ON o.customerId = c.id` |
| `'inner'` | `INNER JOIN customers c ON o.customerId = c.id` |
| `'cross'` | `CROSS JOIN customers c` |
| `'self'` | Self-join: `table t1 INNER JOIN table t2 ON t1.id = t2.parentId` |
| `'natural'` | `NATURAL JOIN table` |

**Multi-condition joins:**
```js
$lookup: {
  from: 'inventory',
  as: 'stock',
  joinType: 'inner',
  on: [
    { localField: 'productId', foreignField: 'id' },
    { localField: 'warehouseId', foreignField: 'warehouseId' }
  ]
}
```
→ `INNER JOIN inventory ON t.productId = inventory.id AND t.warehouseId = inventory.warehouseId`

**Self-join example:**
```js
$lookup: {
  from: 'employees',
  as: 'manager',
  joinType: 'self',
  localField: 'managerId',
  foreignField: 'id'
}
```

---

### Set Operations (in `setOperations.js`)

Top-level static methods on `OracleCollection`:

```js
// UNION — combine, remove duplicates
await OracleCollection.union(
  users.find({ city: 'Manila' }),
  users.find({ city: 'Cebu' })
)

// UNION ALL — combine, keep duplicates
await OracleCollection.union(
  users.find({ city: 'Manila' }),
  users.find({ city: 'Cebu' }),
  { all: true }
)

// INTERSECT — rows in BOTH queries
await OracleCollection.intersect(
  users.find({ role: 'admin' }),
  users.find({ status: 'active' })
)

// MINUS — rows in first but NOT in second
await OracleCollection.minus(
  users.find({ role: 'admin' }),
  users.find({ status: 'inactive' })
)
```

**Rules:**
- Both QueryBuilder instances must target the same number of projected columns — validate before executing, throw if mismatch
- All set operations return a `QueryBuilder`-like object supporting `.sort()`, `.limit()`, `.skip()`, `.toArray()`
- Chained `.sort()` wraps the set operation: `SELECT * FROM (query1 UNION query2) ORDER BY col`
- Set operation execution uses `db.withConnection()` from the first QueryBuilder's `db` reference

---

## 🏗️ CATEGORY 10 — DDL Operations (in `OracleSchema.js`)

### `createTable(tableName, columns, options)`
```js
await schema.createTable('products', {
  id:         { type: 'NUMBER',       primaryKey: true, autoIncrement: true },
  name:       { type: 'VARCHAR2(200)', notNull: true },
  price:      { type: 'NUMBER(10,2)', default: 0 },
  category:   { type: 'VARCHAR2(100)' },
  createdAt:  { type: 'DATE',         default: 'SYSDATE' },
  status:     { type: 'VARCHAR2(20)', check: "status IN ('active','inactive')" },
  userId:     { type: 'NUMBER',       references: { table: 'users', column: 'id' } }
}, { ifNotExists: true })
```
→ `CREATE TABLE products ( id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY, ... )`

### `alterTable(tableName, operation)`
```js
await schema.alterTable('products', { addColumn:    { discountPct: 'NUMBER(5,2)' } })
await schema.alterTable('products', { dropColumn:   'discountPct' })
await schema.alterTable('products', { modifyColumn: { price: 'NUMBER(12,2) NOT NULL' } })
await schema.alterTable('products', { renameColumn: { from: 'name', to: 'productName' } })
await schema.alterTable('products', { addConstraint: { type: 'UNIQUE', columns: ['name'] } })
await schema.alterTable('products', { dropConstraint: 'UK_PRODUCTS_NAME' })
```

### `dropTable(tableName, options)`
- `options.cascade: true` → `DROP TABLE ... CASCADE CONSTRAINTS PURGE`
- `options.ifExists: true` → wrap in existence check using `USER_TABLES`

### `truncateTable(tableName)` → `TRUNCATE TABLE <name>`

### `renameTable(oldName, newName)` → `RENAME oldName TO newName`

### `createView(viewName, queryBuilderOrSQL, options)`
- `options.orReplace: true` → `CREATE OR REPLACE VIEW`
- `options.force: true` → `CREATE FORCE VIEW`
```js
await schema.createView('active_users',
  users.find({ status: 'active' }).project({ id: 1, name: 1, email: 1 }),
  { orReplace: true }
)
```

### `dropView(viewName, options)`
- `options.ifExists: true` → check `USER_VIEWS` before dropping

### `createSequence(name, options)`
```js
await schema.createSequence('order_seq', {
  startWith: 1, incrementBy: 1,
  maxValue: 9999999, cycle: false, cache: 20
})
```
→ `CREATE SEQUENCE order_seq START WITH 1 INCREMENT BY 1 MAXVALUE 9999999 NOCYCLE CACHE 20`

### `createSchema(schemaName)` → `CREATE SCHEMA AUTHORIZATION <name>`

---

## 🔀 CATEGORY 11 — MERGE / UPSERT (in `OracleCollection.js`)

### `merge(sourceData, matchCondition, options)`
```js
await employees.merge(
  { id: 5, name: 'Maria', salary: 55000 },
  { localField: 'id', foreignField: 'id' },
  {
    whenMatched:    { $set: { name: 'Maria', salary: 55000 } },
    whenNotMatched: 'insert',
    whenMatchedDelete: { salary: { $lt: 0 } }
  }
)
```

Translates to:
```sql
MERGE INTO employees tgt
USING (SELECT :id AS id, :name AS name, :salary AS salary FROM DUAL) src
ON (tgt.id = src.id)
WHEN MATCHED THEN
  UPDATE SET tgt.name = src.name, tgt.salary = src.salary
  DELETE WHERE tgt.salary < 0
WHEN NOT MATCHED THEN
  INSERT (id, name, salary) VALUES (src.id, src.name, src.salary)
```

**Also support merging from another table:**
```js
await employees.mergeFrom('salary_updates',
  { localField: 'id', foreignField: 'empId' },
  { whenMatched: { $set: { salary: '$src.newSalary' } } }
)
```

---

## 📋 CATEGORY 13 — Subqueries (in `subqueryBuilder.js`)

### Scalar Subquery (in SELECT projection):
```js
users.find({}, {
  projection: {
    name: 1,
    orderCount: { $subquery: { collection: 'orders', fn: 'count', filter: { userId: '$id' } } }
  }
})
```
→ `SELECT name, (SELECT COUNT(*) FROM orders WHERE userId = u.id) AS orderCount FROM users u`

### Inline View (subquery in FROM):
```js
const subq = orders.aggregate([
  { $group: { _id: '$userId', total: { $sum: '$amount' } } }
])
await users.find({}, { from: { subquery: subq, as: 'order_totals' } })
```
→ `SELECT * FROM (SELECT userId, SUM(amount) total FROM orders GROUP BY userId) order_totals`

### Correlated Subquery:
```js
users.find({
  salary: {
    $gt: {
      $subquery: {
        collection: 'employees',
        field: 'salary',
        aggregate: '$avg',
        where: { deptId: '$outer.deptId' }
      }
    }
  }
})
```
→ `WHERE salary > (SELECT AVG(salary) FROM employees WHERE deptId = u.deptId)`

### EXISTS / NOT EXISTS:
```js
users.find({ $exists:    { collection: 'orders', match: { userId: '$id' } } })
users.find({ $notExists: { collection: 'orders', match: { userId: '$id' } } })
```
→ `WHERE EXISTS (SELECT 1 FROM orders WHERE userId = u.id)`
→ `WHERE NOT EXISTS (SELECT 1 FROM orders WHERE userId = u.id)`

### IN (SELECT ...):
```js
users.find({ id: { $inSelect: orders.distinct('userId', { status: 'active' }) } })
```
→ `WHERE id IN (SELECT DISTINCT userId FROM orders WHERE status = 'active')`

### ANY / ALL with subquery:
```js
users.find({ salary: { $gtAny: { collection: 'managers', field: 'salary' } } })
users.find({ salary: { $gtAll: { collection: 'managers', field: 'salary' } } })
```
→ `WHERE salary > ANY (SELECT salary FROM managers)`
→ `WHERE salary > ALL (SELECT salary FROM managers)`

---

## 📋 CATEGORY 14 — CTEs (in `cteBuilder.js`)

**Exposed as a standalone `withCTE(db, namedQueryBuilders)` function, not as `db.withCTE()`.**

### Regular CTE:
```js
const { withCTE } = require('./oracle-mongo-wrapper');

const result = await withCTE(db, {
  active_users:  users.find({ status: 'active' }),
  recent_orders: orders.find({ createdAt: { $gte: '2024-01-01' } })
})
.from('active_users')
.join({
  from: 'recent_orders',
  localField: 'id',
  foreignField: 'userId',
  joinType: 'inner'
})
.toArray()
```
→
```sql
WITH active_users AS (SELECT * FROM users WHERE status = :s0),
     recent_orders AS (SELECT * FROM orders WHERE createdAt >= :d0)
SELECT * FROM active_users
INNER JOIN recent_orders ON active_users.id = recent_orders.userId
```

### Recursive CTE (for hierarchies/trees):
```js
const { withRecursiveCTE } = require('./oracle-mongo-wrapper');

await withRecursiveCTE(db, 'org_tree', {
  anchor:    employees.find({ managerId: null }),
  recursive: {
    collection: 'employees',
    joinOn: { managerId: '$org_tree.id' }
  }
}).toArray()
```
→
```sql
WITH org_tree (id, name, managerId, lvl) AS (
  SELECT id, name, managerId, 1 AS lvl FROM employees WHERE managerId IS NULL
  UNION ALL
  SELECT e.id, e.name, e.managerId, o.lvl + 1
  FROM employees e
  JOIN org_tree o ON e.managerId = o.id
)
SELECT * FROM org_tree
```

### Multiple Chained CTEs:
- `withCTE()` accepts an object of named QueryBuilders
- CTEs are ordered topologically (later CTEs can reference earlier ones)
- Execution uses `db.withConnection()` from the provided `db` argument

---

## 📐 CATEGORY 15 — Window Functions (in `windowFunctions.js`)

Used inside `$addFields` or `$project` pipeline stages:

```js
await orders.aggregate([
  {
    $addFields: {
      rowNum:    { $window: { fn: 'ROW_NUMBER', partitionBy: 'customerId', orderBy: { date: -1 } } },
      rnk:       { $window: { fn: 'RANK',       partitionBy: 'customerId', orderBy: { amount: -1 } } },
      denseRnk:  { $window: { fn: 'DENSE_RANK', partitionBy: 'region',    orderBy: { sales: -1 } } },
      quartile:  { $window: { fn: 'NTILE', n: 4, orderBy: { salary: 1 } } },
      prevAmt:   { $window: { fn: 'LAG',         field: 'amount', offset: 1, partitionBy: 'customerId' } },
      nextAmt:   { $window: { fn: 'LEAD',        field: 'amount', offset: 1, partitionBy: 'customerId' } },
      firstVal:  { $window: { fn: 'FIRST_VALUE', field: 'amount', partitionBy: 'customerId', orderBy: { date: 1 } } },
      lastVal:   { $window: { fn: 'LAST_VALUE',  field: 'amount', partitionBy: 'customerId', orderBy: { date: 1 } } },
      nthVal:    { $window: { fn: 'NTH_VALUE',   field: 'amount', n: 3, orderBy: { date: 1 } } },
      runSum:    { $window: { fn: 'SUM',   field: 'amount', partitionBy: 'customerId', orderBy: { date: 1 } } },
      movingAvg: { $window: { fn: 'AVG',   field: 'amount', partitionBy: 'region',    orderBy: { date: 1 } } },
      runCount:  { $window: { fn: 'COUNT', field: '*',      partitionBy: 'region' } }
    }
  }
])
```

**Frame clause support:**
```js
{ fn: 'SUM', field: 'amount', frame: 'ROWS BETWEEN 2 PRECEDING AND CURRENT ROW' }
{ fn: 'AVG', field: 'amount', frame: 'RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW' }
```

Translates to:
```sql
ROW_NUMBER()    OVER (PARTITION BY customerId ORDER BY date DESC)
RANK()          OVER (PARTITION BY customerId ORDER BY amount DESC)
LAG(amount, 1)  OVER (PARTITION BY customerId)
SUM(amount)     OVER (PARTITION BY customerId ORDER BY date ASC)
SUM(amount)     OVER (PARTITION BY customerId ORDER BY date ASC ROWS BETWEEN 2 PRECEDING AND CURRENT ROW)
```

**Rules:**
- `partitionBy` is optional (omit → no PARTITION BY clause)
- `orderBy` is required for ranking/navigation functions — throw if missing
- `fn: 'COUNT', field: '*'` → `COUNT(*) OVER (...)`

---

## 📊 CATEGORY 16 — Advanced Grouping

Extend `$group` stage in `aggregatePipeline.js`:

### `$rollup`:
```js
{ $group: { _id: { $rollup: ['region', 'product'] }, total: { $sum: '$amount' } } }
```
→ `GROUP BY ROLLUP(region, product)`

### `$cube`:
```js
{ $group: { _id: { $cube: ['region', 'product', 'quarter'] }, total: { $sum: '$amount' } } }
```
→ `GROUP BY CUBE(region, product, quarter)`

### `$groupingSets`:
```js
{ $group: { _id: { $groupingSets: [['region', 'product'], ['region'], []] }, total: { $sum: '$amount' } } }
```
→ `GROUP BY GROUPING SETS((region, product), (region), ())`

### Standalone `$having`:
```js
await sales.aggregate([
  { $group: { _id: '$region', total: { $sum: '$amount' } } },
  { $having: { total: { $gt: 10000 } } }
])
```
→ `HAVING SUM(amount) > :v0`

---

## 🔐 CATEGORY 17 — DCL Operations (in `OracleDCL.js`)

### `grant(privileges[], on, to)`
```js
await dcl.grant(['SELECT', 'INSERT', 'UPDATE'], 'orders', 'app_user')
await dcl.grant(['EXECUTE'], 'my_procedure', 'app_role')
```
→ `GRANT SELECT, INSERT, UPDATE ON orders TO app_user`

### `revoke(privileges[], on, from)`
```js
await dcl.revoke(['DELETE', 'UPDATE'], 'orders', 'app_user')
```
→ `REVOKE DELETE, UPDATE ON orders FROM app_user`

---

## 🔶 CATEGORY 19 — Oracle Advanced Features (in `oracleAdvanced.js`)

### CONNECT BY (Hierarchical Queries):
```js
await employees.connectBy({
  startWith:     { managerId: null },
  connectBy:     { managerId: '$PRIOR id' },
  orderSiblings: { name: 1 },
  maxLevel:      10,
  includeLevel:  true,
  includePath:   true
})
```
→
```sql
SELECT LEVEL, SYS_CONNECT_BY_PATH(name, '/') AS path, e.*
FROM employees e
START WITH managerId IS NULL
CONNECT BY NOCYCLE PRIOR id = managerId
ORDER SIBLINGS BY name ASC
```

### PIVOT:
```js
await sales.pivot({
  value:       { $sum: '$amount' },
  pivotOn:     'quarter',
  pivotValues: ['Q1', 'Q2', 'Q3', 'Q4'],
  groupBy:     'region'
})
```
→
```sql
SELECT * FROM (SELECT region, quarter, amount FROM sales)
PIVOT (SUM(amount) FOR quarter IN ('Q1' AS Q1,'Q2' AS Q2,'Q3' AS Q3,'Q4' AS Q4))
```

### UNPIVOT:
```js
await salesPivoted.unpivot({
  valueColumn:  'amount',
  nameColumn:   'quarter',
  columns:      ['Q1', 'Q2', 'Q3', 'Q4'],
  includeNulls: false
})
```
→ `SELECT * FROM sales_pivoted UNPIVOT EXCLUDE NULLS (amount FOR quarter IN (Q1,Q2,Q3,Q4))`

### FOR UPDATE (Row Locking):
```js
await users.find({ status: 'active' }, { forUpdate: true }).toArray()
await users.find({ id: 5 }, { forUpdate: 'nowait' }).toArray()
await users.find({ id: 5 }, { forUpdate: 'skip locked' }).toArray()
```
→ `FOR UPDATE` / `FOR UPDATE NOWAIT` / `FOR UPDATE SKIP LOCKED`

### RETURNING Clause:
```js
await users.insertOne({ name: 'Ana' }, { returning: ['id', 'createdAt'] })
await users.updateOne({ id: 5 }, { $set: { name: 'Ana' } }, { returning: ['name', 'updatedAt'] })
await users.deleteOne({ id: 5 }, { returning: ['id', 'name'] })
```
→ `INSERT INTO users (...) VALUES (...) RETURNING id, createdAt INTO :out_id, :out_createdAt`
- Returned values come back in `result.returning` object

### AS OF — Flashback / Temporal Queries:
```js
await orders.find({ status: 'pending' }, { asOf: { scn: 1234567 } })
await orders.find({ status: 'pending' }, { asOf: { timestamp: '2024-06-01 10:00:00' } })
```
→ `SELECT * FROM orders AS OF SCN 1234567 WHERE ...`
→ `SELECT * FROM orders AS OF TIMESTAMP TO_TIMESTAMP(:ts, 'YYYY-MM-DD HH24:MI:SS') WHERE ...`

### LATERAL JOIN:
```js
await users.aggregate([
  {
    $lateralJoin: {
      subquery: orders.find({ userId: '$outer.id' }).sort({ date: -1 }).limit(3),
      as: 'recentOrders'
    }
  }
])
```
→
```sql
SELECT u.*, ro.*
FROM users u,
LATERAL (
  SELECT * FROM orders WHERE userId = u.id ORDER BY date DESC FETCH FIRST 3 ROWS ONLY
) ro
```

### TABLESAMPLE:
```js
await users.find({}, { sample: { percentage: 10 } })
await users.find({}, { sample: { percentage: 5, seed: 42 } })
```
→ `SELECT * FROM users SAMPLE(10)` / `SELECT * FROM users SAMPLE(5) SEED(42)`

---

## ⚡ CATEGORY 20 — Performance Utilities (in `performanceUtils.js`)

**Exposed as `createPerformance(db)` factory, not as `db.performance`.**

```js
const { createPerformance } = require('./oracle-mongo-wrapper');
const performance = createPerformance(db);
```

### `performance.explainPlan(queryBuilderOrSQL)` → `Array`
```js
await performance.explainPlan(users.find({ status: 'active' }).sort({ name: 1 }))
```
→
```sql
EXPLAIN PLAN FOR <generated SQL>;
SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY('PLAN_TABLE', NULL, 'ALL'));
```

### `performance.analyze(tableName)` → `void`
```js
await performance.analyze('orders')
```
→ `DBMS_STATS.GATHER_TABLE_STATS(USER, 'ORDERS', CASCADE => TRUE)`

### `performance.createMaterializedView(name, queryBuilderOrSQL, options)` → `{ acknowledged }`
```js
await performance.createMaterializedView('mv_sales_summary',
  sales.aggregate([{ $group: { _id: '$region', total: { $sum: '$amount' } } }]),
  {
    refreshMode: 'fast',      // 'fast' | 'complete' | 'force'
    refreshOn:   'commit',    // 'commit' | 'demand'
    buildMode:   'immediate', // 'immediate' | 'deferred'
    orReplace:   true
  }
)
```

### `performance.refreshMaterializedView(name, mode)` → `void`
```js
await performance.refreshMaterializedView('mv_sales_summary', 'complete')
```
→ `DBMS_MVIEW.REFRESH('MV_SALES_SUMMARY', 'C')`

### `performance.dropMaterializedView(name)` → `{ acknowledged }`
→ `DROP MATERIALIZED VIEW <name>`

---

## 📤 CATEGORY 21 — INSERT INTO ... SELECT (in `OracleCollection.js`)

### `insertFromQuery(targetTable, queryBuilder, options)` → `{ acknowledged, insertedCount }`
```js
await users.insertFromQuery('archive_orders',
  orders.find({ status: 'completed', year: 2023 })
)
```
→ `INSERT INTO archive_orders SELECT * FROM orders WHERE status = :s0 AND year = :y0`

**With column mapping:**
```js
await users.insertFromQuery('summary',
  orders.aggregate([{ $group: { _id: '$region', total: { $sum: '$amount' } } }]),
  { columns: ['region', 'total_sales'] }
)
```
→ `INSERT INTO summary (region, total_sales) SELECT region, SUM(amount) FROM orders GROUP BY region`

---

## 🔁 CATEGORY 22 — UPDATE ... JOIN (in `OracleCollection.js`)

### `updateFromJoin(options)` → `{ acknowledged, modifiedCount }`
```js
await users.updateFromJoin({
  target: 'employees',
  join: {
    table: 'salary_adjustments',
    on:    { 'employees.id': 'salary_adjustments.empId' },
    type:  'inner'
  },
  set:   { 'employees.salary': '$salary_adjustments.newSalary' },
  where: { 'salary_adjustments.approved': 1 }
})
```
→
```sql
UPDATE (
  SELECT e.salary AS old_salary, s.newSalary AS new_salary
  FROM employees e
  INNER JOIN salary_adjustments s ON e.id = s.empId
  WHERE s.approved = :v0
)
SET old_salary = new_salary
```

> Note: Oracle does not support `UPDATE ... FROM JOIN` directly. Use the updateable inline view pattern shown above. If the join is not key-preserved (Oracle ORA-01779), fall back to a correlated UPDATE subquery and document this clearly.

---

## ✅ CRITICAL IMPLEMENTATION RULES

1. **Never use string interpolation for user values** — always bind variables
2. **Never manage connection lifecycle manually** — always use `db.withConnection()` or `db.withTransaction()`. The existing adapter handles release, health monitoring, slow-op logging, and retries.
3. **Connection pattern inside every method:**
   ```js
   async someMethod(filter, options = {}) {
     return this._execute(async (conn) => {
       const sql = `...`;
       try {
         const result = await conn.execute(sql, binds, {
           outFormat: this.db.oracledb.OUT_FORMAT_OBJECT,
           autoCommit: false  // let the adapter or transaction handle commit
         });
         return result;
       } catch (err) {
         throw new Error(`[OracleCollection.someMethod] ${err.message}\nSQL: ${sql}`);
       }
     });
   }
   ```
4. **Bind variable naming** — use unique suffixed names to avoid collisions:
   - Filter binds: `where_field_0`, `where_field_1`
   - Update binds: `upd_field_0`
   - Output binds: `out_field_0`
5. **Oracle reserved words** — wrap all column and table names in double quotes: `"tableName"."columnName"`
6. **Case sensitivity** — always use `UPPER()` when querying system tables like `USER_TABLES`, `USER_INDEXES`
7. **Empty results** — `findOne` and `findOneAndDelete` return `null` (not `undefined`) when no rows match
8. **Row counts** — use `result.rowsAffected` from oracledb for `modifiedCount`/`deletedCount`
9. **Date handling** — always bind JavaScript `Date` objects directly (oracledb handles conversion). For string dates, use `TO_DATE` or `TO_TIMESTAMP` in SQL
10. **Number precision** — Oracle `NUMBER` columns return JavaScript strings for large numbers. Add a `utils.convertTypes()` helper that coerces them back to `Number`
11. **`executeMany` options** — always pass `{ autoCommit: false, bindDefs: {...} }` — commit is handled by `db.withTransaction()`
12. **`autoCommit`** — set `autoCommit: false` on all `conn.execute()` calls inside `withTransaction()`. For standalone reads, `autoCommit` does not matter but set it to `true` for clarity.

---

## 📌 COMPLETE USAGE EXAMPLE

```js
const {
  createDb,
  OracleCollection,
  OracleSchema,
  OracleDCL,
  Transaction,
  withCTE,
  withRecursiveCTE,
  createPerformance,
} = require('./oracle-mongo-wrapper');

// Bind to named connections from src/config/database.js
// Pool is already initialized by the existing adapter — no initPool() needed
const db          = createDb('userAccount');
const inventoryDb = createDb('unitInventory');

const users     = new OracleCollection('users',     db);
const orders    = new OracleCollection('orders',    db);
const employees = new OracleCollection('employees', db);
const sales     = new OracleCollection('sales',     db);
const schema    = new OracleSchema(db);
const dcl       = new OracleDCL(db);
const txManager = new Transaction(db);
const perf      = createPerformance(db);

// --- DDL ---
await schema.createTable('users', {
  id:        { type: 'NUMBER',        primaryKey: true, autoIncrement: true },
  name:      { type: 'VARCHAR2(200)', notNull: true },
  email:     { type: 'VARCHAR2(300)', notNull: true },
  status:    { type: 'VARCHAR2(20)',  default: "'active'" },
  createdAt: { type: 'DATE',          default: 'SYSDATE' }
});

// --- Insert ---
await users.insertOne({ name: 'Juan', email: 'juan@email.com', status: 'active' });
await users.insertMany([
  { name: 'Maria', email: 'maria@email.com' },
  { name: 'Pedro', email: 'pedro@email.com' }
]);

// --- Find with chaining ---
const activeUsers = await users
  .find({ status: 'active', age: { $gte: 18 } })
  .sort({ name: 1 })
  .skip(0)
  .limit(10)
  .project({ name: 1, email: 1 })
  .toArray();

// --- Update ---
await users.updateOne({ name: 'Juan' }, {
  $set:         { status: 'premium' },
  $inc:         { loginCount: 1 },
  $currentDate: { updatedAt: true }
});

// --- Delete ---
await users.deleteOne({ status: 'inactive' });

// --- Aggregation with window function ---
const report = await orders.aggregate([
  { $match:     { status: 'completed' } },
  { $group:     { _id: '$region', total: { $sum: '$amount' }, count: { $count: '*' } } },
  { $addFields: { rank: { $window: { fn: 'RANK', orderBy: { total: -1 } } } } },
  { $sort:      { total: -1 } },
  { $limit:     5 }
]);

// --- JOIN ---
const orderDetails = await orders.aggregate([
  { $match: { status: 'active' } },
  { $lookup: { from: 'customers', localField: 'customerId', foreignField: 'id', as: 'customer', joinType: 'left' } },
  { $lookup: { from: 'products',  localField: 'productId',  foreignField: 'id', as: 'product',  joinType: 'inner' } }
]);

// --- UNION ---
const allVipUsers = await OracleCollection.union(
  users.find({ tier: 'gold' }),
  users.find({ tier: 'platinum' }),
  { all: false }
);

// --- CTE ---
const cteResult = await withCTE(db, {
  high_value_orders: orders.find({ amount: { $gte: 1000 } }),
  vip_customers:     users.find({ tier: 'platinum' })
})
.from('high_value_orders')
.join({ from: 'vip_customers', localField: 'customerId', foreignField: 'id', joinType: 'inner' })
.toArray();

// --- Transaction with savepoint ---
await txManager.withTransaction(async (session) => {
  const u = session.collection('users');
  const o = session.collection('orders');

  await u.updateOne({ id: 5 }, { $set: { balance: 500 } });
  await session.savepoint('after_balance');

  try {
    await o.insertOne({ userId: 5, amount: 999, status: 'pending' });
  } catch (err) {
    await session.rollbackTo('after_balance');
  }
});

// --- Oracle Advanced: CONNECT BY ---
const orgTree = await employees.connectBy({
  startWith:     { managerId: null },
  connectBy:     { managerId: '$PRIOR id' },
  orderSiblings: { name: 1 },
  includeLevel:  true,
  includePath:   true
});

// --- PIVOT ---
const pivotResult = await sales.pivot({
  value:       { $sum: '$amount' },
  pivotOn:     'quarter',
  pivotValues: ['Q1', 'Q2', 'Q3', 'Q4'],
  groupBy:     'region'
});

// --- Explain Plan ---
await perf.explainPlan(
  users.find({ status: 'active' }).sort({ createdAt: -1 }).limit(100)
);

// --- DCL ---
await dcl.grant(['SELECT', 'INSERT'], 'orders', 'app_user');
await dcl.revoke(['DELETE'], 'orders', 'app_user');

// --- Merge ---
await employees.merge(
  { id: 10, name: 'Ana', salary: 60000 },
  { localField: 'id', foreignField: 'id' },
  {
    whenMatched:    { $set: { salary: 60000 } },
    whenNotMatched: 'insert'
  }
);

// Shutdown — delegates to the existing adapter's closeAll()
await db.closePool();
```

---

## 📄 DELIVERABLES

Generate all of the following files in dependency order:

1. `db.js` — thin adapter factory (`createDb`) only — no pool management
2. `utils.js` — shared helpers: `convertTypes`, `rowToDoc`, `quoteIdentifier`, `mergeBinds`
3. `filterParser.js`
4. `updateParser.js`
5. `QueryBuilder.js`
6. `Transaction.js` — Session class with `_conn` override pattern
7. `OracleCollection.js` — all CRUD + advanced methods using `this._execute()`
8. `OracleSchema.js`
9. `OracleDCL.js`
10. `aggregatePipeline.js`
11. `windowFunctions.js`
12. `joinBuilder.js`
13. `setOperations.js`
14. `cteBuilder.js` — exports `withCTE(db, cteDefs)` and `withRecursiveCTE(db, name, def)`
15. `subqueryBuilder.js`
16. `oracleAdvanced.js`
17. `performanceUtils.js` — exports `createPerformance(db)`
18. `index.js` — barrel file re-exporting everything
19. `package.json` — add `mocha` and `chai` as devDependencies; `oracledb` is already in the parent project
20. `README.md` — one usage example per category
21. `test.js` — end-to-end tests using `mocha` + `chai`, using `createDb('userAccount')`
22. `CHANGELOG.md` — version 1.0.0 listing all implemented features

# Final note: Ensure all SQL queries are properly parameterized and tested against an actual Oracle database to validate syntax and behavior. Pay special attention to edge cases, such as empty results, null values, and complex joins.

## END OF SPECIFICATION

## Testing and Validation



