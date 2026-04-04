# CLAUDE.md — oracle-mongo-wrapper

> **What this file is for:** This configures Claude to act as a Senior Software Engineer
> when working inside `src/utils/oracle-mongo-wrapper/`. It documents the full architecture,
> coding conventions, and design decisions so Claude (and any developer) understands how
> every part fits together before writing a single line of code.

---

## 🗺️ What This Library Does

`oracle-mongo-wrapper` is a **translation layer** — it lets you write MongoDB-style JavaScript
(like `collection.find({ status: "active" }).sort({ name: 1 }).limit(10).toArray()`) and it
converts that into valid Oracle SQL behind the scenes.

**The mental model:** You write MongoDB. The library writes Oracle SQL. You never write raw SQL.

```
Your JS Code (MongoDB style)
        ↓
oracle-mongo-wrapper (this library)
        ↓
Oracle SQL with bind variables
        ↓
OracleDB driver (node-oracledb)
        ↓
Oracle Database
```

---

## 📁 File Map

```
oracle-mongo-wrapper/
│
├── index.js                    ← Barrel file: re-exports EVERYTHING from here
├── db.js                       ← createDb() factory — the entry point for all DB access
├── Transaction.js              ← Wraps db.withTransaction() with a Session + savepoints
│
├── core/
│   ├── OracleCollection.js     ← The main class: find, insert, update, delete, aggregate, etc.
│   └── QueryBuilder.js         ← Chainable cursor returned by .find() — SQL built lazily
│
├── parsers/
│   ├── filterParser.js         ← Converts { status: 'active', age: { $gte: 18 } } → WHERE clause
│   └── updateParser.js         ← Converts { $set: {...}, $inc: {...} } → SET clause
│
├── pipeline/
│   ├── aggregatePipeline.js    ← Converts aggregate([...]) stages → Oracle WITH...AS CTE chain
│   ├── windowFunctions.js      ← Converts $window expressions → OVER() analytic SQL
│   ├── cteBuilder.js           ← withCTE() and withRecursiveCTE() helpers
│   └── subqueryBuilder.js      ← EXISTS, IN (SELECT), scalar subquery helpers
│
├── joins/
│   ├── joinBuilder.js          ← Converts $lookup → JOIN SQL
│   └── setOperations.js        ← UNION, INTERSECT, MINUS via SetResultBuilder
│
├── advanced/
│   ├── oracleAdvanced.js       ← Oracle-only: CONNECT BY, PIVOT, UNPIVOT
│   └── performanceUtils.js     ← EXPLAIN PLAN, ANALYZE, materialized views
│
├── schema/
│   ├── OracleSchema.js         ← DDL: CREATE/ALTER/DROP TABLE, VIEW, SEQUENCE
│   └── OracleDCL.js            ← DCL: GRANT / REVOKE
│
├── utils.js                    ← Shared helpers: quoteIdentifier, mergeBinds, buildOrderBy, etc.
└── README.md                   ← Quick-start guide and full $ operator reference
```

---

## 🏗️ Architecture: How the Pieces Connect

### The Entry Point: `createDb()`

Every collection, schema, and transaction starts here. It binds a named database connection
(from `src/config/database.js`) to the wrapper API.

```js
// db.js — the "glue" that connects the library to the real database pool
const db = createDb("userAccount");
// db.withConnection(fn)    — borrow a connection, run fn, release it
// db.withTransaction(fn)   — like withConnection, but wrapped in a commit/rollback
// db.oracledb              — raw oracledb driver (needed for type constants)
```

Pass `db` to every class. **Never create raw connections manually** — always go through
`db.withConnection()` or `db.withTransaction()`.

---

### The Core Class: `OracleCollection`

This is the heart of the library. It mirrors MongoDB's Collection API.

```
OracleCollection
  ├── find()                    → returns QueryBuilder (lazy — no SQL yet)
  ├── findOne()                 → SELECT ... FETCH FIRST 1 ROW ONLY
  ├── findOneAndUpdate()        → SELECT + UPDATE in one call (optional upsert)
  ├── findOneAndDelete()        → SELECT + DELETE in one call
  ├── findOneAndReplace()       → SELECT + full UPDATE (except PK) in one call
  ├── insertOne()               → INSERT with RETURNING ID INTO
  ├── insertMany()              → executeMany() bulk insert inside a transaction
  ├── updateOne()               → UPDATE ... WHERE ROWID = (subquery ROWNUM=1)
  ├── updateMany()              → UPDATE ... WHERE <filter>
  ├── replaceOne()              → Full UPDATE (except ID column) on first match
  ├── bulkWrite()               → Multiple operations in a single transaction
  ├── deleteOne()               → DELETE ... WHERE ROWID = (subquery ROWNUM=1)
  ├── deleteMany()              → DELETE ... WHERE <filter>
  ├── countDocuments()          → SELECT COUNT(*) ...
  ├── estimatedDocumentCount()  → fast count from USER_TABLES metadata
  ├── distinct()                → SELECT DISTINCT <field> ...
  ├── aggregate()               → Full pipeline → CTE-chained Oracle SQL
  ├── createIndex()             → CREATE [UNIQUE] INDEX ...
  ├── dropIndex()               → DROP INDEX ...
  ├── getIndexes()              → Query USER_INDEXES + USER_IND_COLUMNS
  ├── merge()                   → MERGE INTO ... USING DUAL ...
  ├── mergeFrom()               → MERGE INTO ... USING <table> ...
  ├── connectBy()               → SELECT ... START WITH ... CONNECT BY ...
  ├── pivot()                   → SELECT * FROM (...) PIVOT (...)
  ├── unpivot()                 → SELECT * FROM (...) UNPIVOT (...)
  ├── insertFromQuery()         → INSERT INTO <target> SELECT ...
  ├── updateFromJoin()          → UPDATE ... SET ... WHERE EXISTS (...)
  ├── drop()                    → DROP TABLE ... CASCADE CONSTRAINTS
  └── static:
       ├── union()              → SetResultBuilder with UNION
       ├── intersect()          → SetResultBuilder with INTERSECT
       └── minus()              → SetResultBuilder with MINUS
```

**Connection management inside `OracleCollection`:** Every method calls `this._execute(fn)`.
This checks: if `this._conn` exists (we're inside a transaction/session), use it directly.
Otherwise, borrow a connection via `db.withConnection()`. This is how the same collection class
works in both standalone calls and inside transactions — without separate code paths.

```js
// Standalone (auto-manages connection)
const users = new OracleCollection("users", db);
await users.findOne({ id: 1 });

// Inside a transaction (reuses the transaction's connection)
await txManager.withTransaction(async (session) => {
    const users = session.collection("users"); // same class, different _conn
    await users.insertOne({ name: "Ana" });
});
```

---

### The Lazy Cursor: `QueryBuilder`

`find()` does NOT run SQL immediately. It returns a `QueryBuilder` that accumulates options
through chaining. SQL is only built and executed when a **terminal method** is called.

```
find({ status: "active" })    ← creates QueryBuilder, no SQL yet
  .sort({ name: 1 })          ← sets _sort, still no SQL
  .skip(10)                   ← sets _skip, still no SQL
  .limit(10)                  ← sets _limit, still no SQL
  .project({ name: 1 })       ← sets _projection, still no SQL
  .toArray()                  ← TERMINAL → builds SQL → executes → returns rows
```

**Terminal methods** (these are the ones that actually run the SQL):

| Method | What it does |
|--------|-------------|
| `.toArray()` | Returns all matching rows as an array |
| `.forEach(fn)` | Streams rows via `queryStream` — O(1) memory, safe for huge result sets |
| `.next()` | Returns the first row only (adds `FETCH FIRST 1 ROW ONLY`) |
| `.hasNext()` | Returns `true` if any row matches the filter |
| `.count()` | Runs `SELECT COUNT(*)` — ignores sort/limit/skip |
| `.explain()` | Returns the SQL string without executing (use for debugging) |

`QueryBuilder` is also **thenable** — `await find(...)` works without `.toArray()` because
it has a `.then()` method that internally delegates to `.toArray()`.

---

### The Parsers: `filterParser` and `updateParser`

These are pure functions that translate MongoDB operator objects into SQL strings + bind
variables. They are the most critical piece of the library — every WHERE and SET clause
flows through them.

#### `filterParser.js` — MongoDB filter → Oracle WHERE

```js
// Input
{ status: "active", age: { $gte: 18 }, $or: [{ city: "Manila" }, { city: "Cebu" }] }

// Output
{
  whereClause: 'WHERE "status" = :where_status_0 AND "age" >= :where_age_1 AND ("city" = :where_city_2 OR "city" = :where_city_3)',
  binds: { where_status_0: "active", where_age_1: 18, where_city_2: "Manila", where_city_3: "Cebu" }
}
```

**Key design detail — per-call bind counters:** Each call to `parseFilter()` creates its own
counter (`_createCounter()`). This means parallel calls never collide on bind variable names,
even under high concurrency. The counter is passed down and shared across recursive calls
(for `$and`/`$or`/`$not`), but scoped to one top-level `parseFilter()` invocation.

#### `updateParser.js` — MongoDB update operators → Oracle SET

```js
// Input
{ $set: { status: "premium" }, $inc: { loginCount: 1 }, $currentDate: { updatedAt: true } }

// Output
{
  setClause: 'SET "status" = :upd_status_0, "loginCount" = "loginCount" + :upd_loginCount_1, "updatedAt" = SYSDATE',
  binds: { upd_status_0: "premium", upd_loginCount_1: 1 }
}
```

---

### The Pipeline: `aggregatePipeline.js`

The aggregate pipeline is translated into a **chain of Oracle CTEs** (Common Table Expressions
using `WITH ... AS`). Each stage becomes one CTE that receives its input from the previous stage.

```js
// Input
aggregate([
  { $match: { status: "completed" } },
  { $group: { _id: "$region", total: { $sum: "$amount" } } },
  { $sort: { total: -1 } },
  { $limit: 5 }
])

// Generated SQL
WITH "stage_0" AS (SELECT * FROM "orders" WHERE "status" = :match_status_0),
     "stage_1" AS (SELECT "region", SUM("amount") AS TOTAL FROM "stage_0" GROUP BY "region"),
     "stage_2" AS (SELECT * FROM "stage_1" ORDER BY TOTAL DESC)
SELECT * FROM "stage_2" FETCH FIRST 5 ROWS ONLY
```

**Special behavior — `$having`:** `$having` is not a real pipeline stage. A pre-scan detects
it and attaches it to the preceding `$group` as `_having`, so the HAVING clause is generated
inside the same CTE as the GROUP BY. Oracle requires this — HAVING cannot live in a separate
CTE from its GROUP BY.

---

## 🔑 The `$` Prefix Rule

This is the single most important syntax rule in the library:

| Syntax | Meaning | Example |
|--------|---------|---------|
| `'$amount'` — string starting with `$` | Reference a column's current value | `{ $sum: '$amount' }` → `SUM(amount)` |
| `$set`, `$gte`, `$group` — object key | A MongoDB operator keyword | `{ $set: { name: 'Ana' } }` |
| `'N/A'` — plain string, no `$` | A literal string value | `{ $ifNull: ['$nick', 'N/A'] }` |
| `'$outer.col'` — string starting with `$outer.` | Correlated ref to the outer table | Used in lateral joins and correlated subqueries |

---

## 🔒 Bind Variables — The #1 Security Rule

**Never concatenate user input directly into an SQL string.** All user-supplied values must go
through Oracle's bind variable system (`:bindName`). The parsers enforce this automatically.

```js
// ✅ Safe — value goes into binds object, never into the SQL string
const { whereClause, binds } = parseFilter({ name: userInput });
// WHERE "name" = :where_name_0   ← the SQL is static; value is in binds

// ❌ Never do this — SQL injection risk
const sql = `SELECT * FROM users WHERE name = '${userInput}'`;
```

**Known, intentional exceptions** (documented and safe):

- **`PIVOT IN (...)`** — Oracle does not allow bind variables inside the PIVOT IN clause.
  Values are sanitized with `.replace(/'/g, "''")` before being interpolated.
- **DDL statements** (CREATE TABLE, DROP INDEX, etc.) — these never accept user data as values.

---

## ⚙️ Coding Conventions

### Identifier Quoting

Every table and column name goes through `quoteIdentifier()` from `utils.js`. This prevents
conflicts with Oracle reserved words and enforces consistent case handling.

```js
quoteIdentifier("status")  // → '"status"'
quoteIdentifier("ORDER")   // → '"ORDER"'
```

**Rule:** Call `quoteIdentifier()` on every table or column name you put into SQL.
Never manually wrap names in double quotes.

### Error Wrapping

All SQL execution is wrapped in `try/catch`. Errors are rethrown with context using
`MSG.wrapError(methodName, originalError, sql, binds)`. This ensures stack traces always
show the calling method name and the exact SQL that failed.

```js
try {
    const result = await conn.execute(sql, binds, { outFormat: db.oracledb.OUT_FORMAT_OBJECT });
    return result.rows;
} catch (err) {
    // Always wrap — never rethrow raw Oracle errors without context
    throw new Error(MSG.wrapError("OracleCollection.findOne", err, sql, binds));
}
```

### autoCommit

The `autoCommit` option follows one strict rule across the entire codebase:

```js
{ autoCommit: !this._conn }
// _conn is null (standalone call)      → autoCommit = true  (commit immediately)
// _conn is set  (inside transaction)   → autoCommit = false (transaction manages it)
```

**Never hardcode `autoCommit: true`** in a method that might be called from inside a transaction.

### Connection Reuse in Transactions

Inside a transaction, the raw `conn` from `db.withTransaction()` must be reused for every
operation. The `_execute()` pattern handles this transparently:

```js
async _execute(fn) {
    if (this._conn) return fn(this._conn);       // reuse the active transaction connection
    return this.db.withConnection(fn);            // borrow a fresh connection from the pool
}
```

---

## 🧪 How to Test a New Feature

When adding a new operator, stage, or method, always verify all five of these:

1. **The generated SQL is correct.** Use `.explain()` on a `QueryBuilder` or log the SQL
   string from `buildAggregateSQL()` before running it against the database.

2. **Bind variables are used for all values.** Reject any implementation that interpolates
   a variable directly into the SQL string.

3. **Error messages include context.** Wrap every `conn.execute()` in try/catch and use
   `MSG.wrapError()` to rethrow with the method name and failing SQL.

4. **It works inside a transaction.** Test both standalone (`new OracleCollection(table, db)`)
   and inside `txManager.withTransaction()` via `session.collection()`.

5. **Parallel calls don't collide on bind names.** If you introduce any counter or state,
   scope it per `parseFilter()` call using `_createCounter()`, not as a shared module variable.

---

## 🚫 What NOT to Do

```js
// ❌ Don't acquire raw connections manually
const conn = await oracledb.getConnection(...);
// Always use db.withConnection() or db.withTransaction()

// ❌ Don't hardcode autoCommit in methods used inside transactions
await conn.execute(sql, {}, { autoCommit: true });
// Use { autoCommit: !this._conn } instead

// ❌ Don't use a shared global bind counter (race condition under concurrency)
let globalCounter = 0;
// Use _createCounter() — creates a fresh counter scoped to each parseFilter() call

// ❌ Don't interpolate values into SQL strings
`WHERE name = '${name}'`
// Use bind variables: WHERE "name" = :where_name_0

// ❌ Don't forget to quote identifiers
`SELECT * FROM ${tableName}`
// Use: `SELECT * FROM ${quoteIdentifier(tableName)}`

// ❌ Don't swallow errors silently
try { ... } catch (err) { }
// Always rethrow with context: throw new Error(MSG.wrapError("MethodName", err, sql))

// ❌ Don't add a new export without updating index.js
module.exports = { myNewHelper };
// Also add it to index.js so callers can import from the barrel file
```

---

## 💡 Quick Lookup: Which File to Edit?

| What you want to add or change | File to edit |
|-------------------------------|-------------|
| A new filter operator (`$myOp`) | `parsers/filterParser.js` → `_parseFieldExpr()` |
| A new update operator (`$myOp`) | `parsers/updateParser.js` → `parseUpdate()` |
| A new pipeline stage (`$myStage`) | `pipeline/aggregatePipeline.js` → switch in `buildAggregateSQL()` |
| A new aggregate expression (`$myExpr`) | `pipeline/aggregatePipeline.js` → `_buildAggExpr()` |
| A new window function | `pipeline/windowFunctions.js` → switch in `buildWindowExpr()` |
| A new join type | `joins/joinBuilder.js` → `_resolveJoinType()` |
| A new DDL operation | `schema/OracleSchema.js` |
| A new DCL operation | `schema/OracleDCL.js` |
| A new Oracle-specific feature | `advanced/oracleAdvanced.js` |
| A new performance utility | `advanced/performanceUtils.js` |
| A new method on OracleCollection | `core/OracleCollection.js` |
| A new terminal method on find() | `core/QueryBuilder.js` |
| A new top-level export | `index.js` (barrel file) |
| Error message strings | `src/constants/messages.js` |

---

## 📖 Usage Summary

```js
const {
    createDb,
    OracleCollection,
    OracleSchema,
    OracleDCL,
    Transaction,
    withCTE,
} = require("./oracle-mongo-wrapper");

// 1. Create a db interface (binds to a named connection pool)
const db = createDb("userAccount");
const users = new OracleCollection("users", db);

// 2. Find with chaining
const results = await users
    .find({ status: "active", age: { $gte: 18 } })
    .sort({ name: 1 })
    .skip(0)
    .limit(10)
    .project({ name: 1, email: 1 })
    .toArray();

// 3. Insert
const { insertedId } = await users.insertOne({ name: "Ana", email: "ana@email.com" });

// 4. Update
await users.updateOne(
    { id: insertedId },
    { $set: { status: "premium" }, $inc: { loginCount: 1 } }
);

// 5. Delete
await users.deleteOne({ id: insertedId });

// 6. Aggregate pipeline
const report = await orders.aggregate([
    { $match: { status: "completed" } },
    { $group: { _id: "$region", total: { $sum: "$amount" } } },
    { $sort: { total: -1 } },
    { $limit: 5 },
]);

// 7. Transaction with savepoint
const txManager = new Transaction(db);
await txManager.withTransaction(async (session) => {
    await session.collection("orders").insertOne({ item: "pen", qty: 5 });
    await session.savepoint("after_order");
    try {
        await session.collection("payments").insertOne({ amount: -999 });
    } catch (err) {
        await session.rollbackTo("after_order");
    }
});

// 8. Debug: see the generated SQL without running it
const sql = await users
    .find({ status: "active" })
    .project({ name: 1, email: 1 })
    .explain();
console.log(sql);
// → SELECT "name", "email" FROM "users" t0 WHERE "status" = :where_status_0
```

---

*Keep this file updated whenever new operators, pipeline stages, or architectural patterns
are added. It is the single source of truth for how this library is built and should be extended.*