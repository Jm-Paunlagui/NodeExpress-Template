# Oracle MongoDB-Style Wrapper — Final Build Specification (Node.js)

You are an expert Node.js + OracleDB engineer. Build a **production-grade, reusable OracleDB wrapper library** in Node.js using the `oracledb` package that mirrors MongoDB's core API while leveraging full Oracle SQL capability.

---

## ⚠️ PART 1 — GLOBAL CONSTRAINTS
> Read this section fully before writing a single line of code. Every rule here applies to every file in the project without exception.

### 1.1 — No Pool Management

This library lives inside an existing Express/OracleDB backend. The pool manager already exists at:

```
src/config/adapters/oracle.js  ← withConnection, withTransaction, withBatchConnection,
                                  closeAll, getPoolStats, isPoolHealthy, retry, shutdown
src/config/database.js         ← Named connection registry ('userAccount', 'unitInventory', …)
src/config/index.js            ← Barrel re-export of the above
```

**Never recreate, wrap, or shadow any of these files.**

The adapter exposes:
```js
const { withConnection, withTransaction, withBatchConnection,
        closeAll, getPoolStats, isPoolHealthy, oracledb } = require('./src/config');
```

### 1.2 — Connection Dispatch Rules

Define this dispatcher **once** inside `OracleCollection` and reuse it everywhere:

```js
_execute(fn) {
  return this._conn ? fn(this._conn) : this.db.withConnection(fn);
}
```

| Scenario | Required call |
|---|---|
| Single read or write | `this._execute(async (conn) => { … })` |
| Multi-step atomic op (`insertMany`, `bulkWrite`) | `this.db.withTransaction(async (conn) => { … })` |
| Inside a `Transaction` session | `this._conn` is set — `_execute` routes there automatically |
| **Never** | `oracledb.getPool().getConnection()` or manual `conn.close()` |

`QueryBuilder`, `OracleSchema`, `OracleDCL`, `cteBuilder`, `performanceUtils`, and `setOperations` all call `db.withConnection()` directly (they have no `_conn` override).

### 1.3 — SQL Safety Rules

These are non-negotiable and apply to every SQL string in every file:

1. **Bind variables only** — never string-interpolate user values. No exceptions.
2. **Unique bind names** — use counter-suffixed names scoped by role:
   - Filter binds: `where_<field>_0`, `where_<field>_1`, …
   - Update binds: `upd_<field>_0`, …
   - Output binds: `out_<field>_0`, …
3. **Quote all identifiers** — `"TABLE_NAME"."COLUMN_NAME"` (double-quoted, uppercase).
4. **System table queries** — always `UPPER(:bind)` for `USER_TABLES`, `USER_INDEXES`, etc.
5. **`autoCommit`** — `false` inside any transaction scope; `true` for standalone reads.
6. **`outFormat`** — always `this.db.oracledb.OUT_FORMAT_OBJECT`.
7. **`executeMany`** — always supply explicit `bindDefs`; always `autoCommit: false`.
8. **Dates** — bind JS `Date` objects directly; wrap string dates in `TO_DATE`/`TO_TIMESTAMP`.
9. **Large numbers** — Oracle returns `NUMBER` as strings for large values; `convertTypes()` in `utils.js` coerces them back to `Number`.
10. **Empty filter** — `{}` or `null` → omit `WHERE` entirely. Never emit `WHERE 1=1`.

### 1.4 — Error Format

Every `catch` block must rethrow with this exact shape — **no exceptions**:

```js
throw new Error(`[ClassName.methodName] ${err.message}\nSQL: ${sql}\nBinds: ${JSON.stringify(binds)}`);
```

### 1.5 — Return Shapes

| Operation | Shape |
|---|---|
| Insert | `{ acknowledged: true, insertedId, insertedCount?, returning? }` |
| Update | `{ acknowledged: true, matchedCount, modifiedCount, returning? }` |
| Delete | `{ acknowledged: true, deletedCount, returning? }` |
| `findOne` / `findOneAnd*` | `document \| null` — never `undefined` |
| Row counts | `result.rowsAffected` from oracledb |

### 1.6 — Documentation

Every public method must have a JSDoc block with: `@param` types, `@returns` type + shape, and `@example` showing the SQL it generates.

---

## ⚡ PART 2 — PERFORMANCE REQUIREMENTS

These are design targets, not afterthoughts. Implement them from the start.

### 2.1 — Time Complexity Targets

| Operation | Target | Implementation mandate |
|---|---|---|
| `findOne` | O(1) w/ index | `FETCH FIRST 1 ROW ONLY` — never fetch-all-then-slice |
| `insertMany(n)` | O(n) | `executeMany()` in chunks of 500 — never loop `insertOne` |
| `bulkWrite(n)` | O(n) | Single `withTransaction`, sequential execution, no N+1 |
| `aggregate` pipeline | O(n) per stage | CTE-chain — one SQL round-trip, Oracle optimizes the plan |
| `deleteOne` / `updateOne` | O(1) w/ index | Target via `ROWID` subquery, not full-table scan |
| `distinct` | O(n) | Single `SELECT DISTINCT` — no JS-side dedup |
| `getIndexes` | O(1) | Single `JOIN` of `USER_INDEXES` + `USER_IND_COLUMNS` — no N+1 |
| `estimatedDocumentCount` | O(1) | `USER_TABLES.NUM_ROWS` — never `COUNT(*)` |
| `filterParser` / `updateParser` | O(k) | k = key count — single-pass recursive descent, no re-scans |
| CTE construction | O(s) | s = stage count — one SQL string build pass, no intermediate arrays |

### 2.2 — Space Complexity Targets

| Concern | Rule |
|---|---|
| `forEach` | Use `conn.queryStream()` + async iterator — O(1) memory regardless of result size |
| `toArray()` | May buffer — add a JSDoc warning for large result sets |
| `insertMany` batches | `chunkArray(docs, 500)` from `utils.js` — never load all rows into a single bind array |
| Bind object construction | Build a single accumulator object per query; use `mergeBinds()` — never `Object.assign` spread chains |
| CTE chain | Each stage appends O(1) SQL text — no JS arrays between stages |
| `executeMany` bindDefs | Infer once from the first document via `buildBindDefs()` — never re-infer per row |

### 2.3 — Query Optimization Rules

These must be applied inside `aggregatePipeline.js` automatically, without the caller requesting them:

- **Collapse adjacent `$match` stages** — merge into one `WHERE` before building CTEs.
- **Projection pushdown** — apply `SELECT col1, col2` at the earliest CTE stage, not the final wrapper.
- **No pass-through CTEs** — never emit `WITH s1 AS (SELECT * FROM s0)` with no transformation. Merge it into the prior stage.
- **Skip empty stages** — if `$sort`, `$limit`, `$skip`, or `$project` have no meaningful value, omit their SQL clause.
- **Index hint passthrough** — `options.hint` injects `/*+ INDEX("t" "idx_name") */` as a SQL comment only. Never interpolate user values into hint strings.

---

## 📁 PART 3 — FILE STRUCTURE

```
oracle-mongo-wrapper/
├── advanced/
│   ├── oracleAdvanced.js       ← CONNECT BY, PIVOT, UNPIVOT, AS OF, LATERAL, TABLESAMPLE
│   └── performanceUtils.js     ← EXPLAIN PLAN, ANALYZE, MATERIALIZED VIEW
├── core/
│   ├── OracleCollection.js     ← All CRUD + advanced methods via _execute()
│   └── QueryBuilder.js         ← Lazy chainable cursor; SQL built only at terminal call
├── joins/
│   ├── joinBuilder.js          ← $lookup → SQL JOIN (all join types)
│   └── setOperations.js        ← UNION, UNION ALL, INTERSECT, MINUS
├── parsers/
│   ├── filterParser.js         ← MongoDB filter → parameterized WHERE clause
│   └── updateParser.js         ← MongoDB update operators → parameterized SET clause
├── pipeline/
│   ├── aggregatePipeline.js    ← Pipeline array → CTE-chained SQL (single round-trip)
│   ├── cteBuilder.js           ← withCTE / withRecursiveCTE standalone exports
│   ├── subqueryBuilder.js      ← Scalar, inline, correlated, EXISTS subqueries
│   └── windowFunctions.js      ← $window → SQL analytic OVER() expressions
├── schema/
│   ├── OracleDCL.js            ← GRANT, REVOKE
│   └── OracleSchema.js         ← CREATE/ALTER/DROP TABLE, VIEW, SEQUENCE, SCHEMA
├── db.js                       ← Thin createDb() factory — delegates to src/config
├── index.js                    ← Barrel re-export
├── Transaction.js              ← Transaction class + Session class + savepoints
└── utils.js                    ← quoteIdentifier, mergeBinds, convertTypes,
                                   rowToDoc, chunkArray, buildBindDefs
```

---

## PART 4 — `db.js` — Canonical Implementation (do not modify)

```js
'use strict';
const config = require('./src/config');

/**
 * Creates a db interface bound to a named connection from src/config/database.js.
 * This is a thin adapter only — all pool logic lives in src/config.
 * @param {string} connectionName
 * @returns {DbInterface}
 */
function createDb(connectionName = 'userAccount') {
  if (!connectionName || typeof connectionName !== 'string')
    throw new TypeError('createDb: connectionName must be a non-empty string');
  return {
    connectionName,
    withConnection:     (cb)  => config.withConnection(connectionName, cb),
    withTransaction:    (cb)  => config.withTransaction(connectionName, cb),
    withBatchConnection:(ops) => config.withBatchConnection(connectionName, ops),
    closePool:          ()    => config.closeAll(),
    getPoolStats:       ()    => config.getPoolStats(),
    isHealthy:          ()    => config.isPoolHealthy(connectionName),
    oracledb:           config.oracledb,
  };
}

module.exports = { createDb };
```

---

## PART 5 — `utils.js` — Required Exports

```js
// All functions must be pure (no side effects, no DB calls).

quoteIdentifier(name)           // "NAME" — uppercase, double-quoted, O(1)
mergeBinds(...objects)          // Merge bind objects into one accumulator, throw on collision, O(n keys)
convertTypes(row)               // Coerce Oracle NUMBER strings → JS Number, O(k columns)
rowToDoc(row)                   // camelCase keys, strip Oracle metadata columns, O(k)
chunkArray(arr, size = 500)     // Split array into size-capped sub-arrays, O(n)
buildBindDefs(sampleDoc, db)    // Build oracledb bindDefs from first document, O(k)
```

---

## PART 6 — CATEGORY 1: Query / Read (`OracleCollection`)

### Methods

**`find(filter, options)`** → `QueryBuilder` (lazy — no SQL executed here)
Options: `sort`, `limit`, `skip`, `projection`, `forUpdate`, `asOf`, `hint`, `sample`

**`findOne(filter, options)`** → `Object | null`
Single `FETCH FIRST 1 ROW ONLY` — never fetches more.

**`findOneAndUpdate(filter, update, options)`** → `Object | null`
`SELECT … FOR UPDATE` then `UPDATE` on the same `conn` inside `_execute()`.
Options: `returnDocument: 'before' | 'after'`, `upsert: true`

**`findOneAndDelete(filter)`** → `Object | null`
Fetch then delete on the same `conn`. Returns the deleted doc.

**`findOneAndReplace(filter, replacement, options)`** → `Object | null`
Replaces all columns except primary key. Options: `returnDocument: 'before' | 'after'`

**`countDocuments(filter)`** → `Number` — `SELECT COUNT(*) … WHERE …`

**`estimatedDocumentCount()`** → `Number` — `SELECT NUM_ROWS FROM USER_TABLES WHERE TABLE_NAME = UPPER(:t)` — **O(1), no table scan**

**`distinct(field, filter)`** → `Array` — single `SELECT DISTINCT` — no JS dedup

### `filterParser.js` — Single-Pass Recursive Descent

**Input:** MongoDB filter object
**Output:** `{ whereClause: 'WHERE …', binds: {} }` — or `{ whereClause: '', binds: {} }` for empty/null filter
**Error:** throw descriptive message for any unsupported operator

| MongoDB | SQL | Bind naming |
|---|---|---|
| `{ field: value }` / `$eq` | `"field" = :where_field_0` | counter-suffixed |
| `$ne` / `$gt` / `$gte` / `$lt` / `$lte` | `<> / > / >= / < / <=` | same |
| `$in: [a,b]` | `"field" IN (:in_field_0, :in_field_1)` | indexed per element |
| `$nin` | `NOT IN (…)` | same |
| `$between: [min,max]` | `BETWEEN :btw_field_min AND :btw_field_max` | |
| `$notBetween` | `NOT BETWEEN …` | |
| `$exists: true/false` | `IS NOT NULL` / `IS NULL` | no bind |
| `$regex` | `REGEXP_LIKE("field", :rx_field_0)` | |
| `$like` | `"field" LIKE :lk_field_0` | |
| `$any` / `$all` | `= ANY(…)` / `= ALL(…)` | |
| `$and` / `$or` | `(a AND b)` / `(a OR b)` | recurse |
| `$nor` | `NOT (a OR b)` | recurse |
| `$not` | `NOT (…)` | recurse |
| `$case` | `CASE WHEN … THEN … ELSE … END` | |
| `$coalesce` | `COALESCE(f1, f2, :val)` | |
| `$nullif` | `NULLIF(f1, :val)` | |

---

## PART 7 — CATEGORY 2: Insert (`OracleCollection`)

**`insertOne(document, options)`** → `{ acknowledged, insertedId, returning? }`
- Auto-assign `_id` via `SYS_GUID()` if absent
- `RETURNING "id" INTO :out_id` to capture generated ID
- `options.returning: ['col1', …]` → multi-column `RETURNING … INTO`

**`insertMany(documents)`** → `{ acknowledged, insertedCount, insertedIds[] }`
- `chunkArray(documents, 500)` — loop chunks inside `db.withTransaction()`
- Each chunk: `conn.executeMany(sql, bindRows, { autoCommit: false, bindDefs })`
- `buildBindDefs` called once on `documents[0]`, reused for all chunks
- Atomic: any chunk failure rolls back all chunks

---

## PART 8 — CATEGORY 3: Update (`OracleCollection`)

**`updateOne(filter, update, options)`** → `{ acknowledged, matchedCount, modifiedCount, returning? }`
Target via: `WHERE ROWID = (SELECT ROWID FROM "t" WHERE … AND ROWNUM = 1)` — O(1) w/ index
Options: `upsert: true`, `returning: ['col']`

**`updateMany(filter, update, options)`** → `{ acknowledged, matchedCount, modifiedCount, returning? }`

**`replaceOne(filter, replacement, options)`** → `{ acknowledged, matchedCount, modifiedCount }`
`UPDATE "t" SET col1=:v1, col2=:v2 … WHERE …` — all columns except primary key

**`bulkWrite(operations[])`** → `{ acknowledged, results[] }`
All ops inside a single `db.withTransaction()`. Supported: `insertOne`, `updateOne`, `updateMany`, `deleteOne`, `deleteMany`, `replaceOne`

### `updateParser.js` — Single-Pass

**Output:** `{ setClause: 'SET "col"=:upd_col_0, …', binds: {} }` — all binds prefixed `upd_`
**Error:** throw if update object is empty

| Operator | SQL |
|---|---|
| `$set` | `"field" = :upd_field_0` |
| `$unset` | `"field" = NULL` |
| `$inc` | `"field" = "field" + :upd_field_0` |
| `$mul` | `"field" = "field" * :upd_field_0` |
| `$min` / `$max` | `LEAST("field", :v)` / `GREATEST("field", :v)` |
| `$currentDate` | `"field" = SYSDATE` — no bind |
| `$rename` | **Throw:** `"Use ALTER TABLE to rename columns"` |

---

## PART 9 — CATEGORY 4: Delete (`OracleCollection`)

**`deleteOne(filter, options)`** → `{ acknowledged, deletedCount, returning? }`
Target via `ROWID` subquery (same as `updateOne`) — O(1) w/ index

**`deleteMany(filter)`** → `{ acknowledged, deletedCount }`
`result.rowsAffected` → `deletedCount`

**`drop()`** → `{ acknowledged }`
`DROP TABLE "tableName" CASCADE CONSTRAINTS`
Throw descriptively if table does not exist.

---

## PART 10 — CATEGORY 5: Aggregation Pipeline (`aggregatePipeline.js`)

### Architecture — One SQL Round-Trip

```sql
WITH stage_0 AS (SELECT "col1","col2" FROM "table" WHERE …),      -- $match (collapsed)
     stage_1 AS (SELECT …, SUM("col") total FROM stage_0 GROUP BY …), -- $group
     stage_2 AS (SELECT *, RANK() OVER (…) rnk FROM stage_1)      -- $addFields
SELECT * FROM stage_2 ORDER BY total DESC
FETCH FIRST :lim ROWS ONLY OFFSET :skip ROWS
```

**Mandatory optimizations (automatic, not caller-triggered):**
1. Collapse all adjacent `$match` stages before building.
2. Push `$project` / `$addFields` columns to the earliest stage that produces them.
3. Never emit a CTE stage that is `SELECT * FROM prev` with no transformation — fold it.
4. Place `ORDER BY`, `FETCH FIRST`, `OFFSET` on the final outer `SELECT`, never inside a CTE.

### Supported Stages

| Stage | SQL | Notes |
|---|---|---|
| `$match` | `WHERE` (filterParser) | Collapse adjacent |
| `$group` | `GROUP BY` | `$sum,$avg,$min,$max,$count,$first,$last` |
| `$project` | `SELECT` cols / exprs | Pushdown |
| `$addFields` | Extra computed cols in SELECT | |
| `$sort` | `ORDER BY` | Final outer SELECT only |
| `$limit` / `$skip` | `FETCH FIRST` / `OFFSET` | Final outer SELECT only |
| `$count` | `SELECT COUNT(*) AS field` | |
| `$lookup` | JOIN (joinBuilder) | |
| `$unwind` | `JSON_TABLE` or documented limitation | |
| `$replaceRoot` | Rewrite SELECT to sub-doc fields | |
| `$facet` | Multiple CTEs + `UNION ALL` | |
| `$bucket` | `CASE WHEN` range grouping | |
| `$out` | `INSERT INTO target SELECT …` | |
| `$merge` | `MERGE INTO target USING (…) ON (…)` | |
| `$having` | `HAVING` after GROUP BY | |
| `$rollup` | `GROUP BY ROLLUP(…)` | |
| `$cube` | `GROUP BY CUBE(…)` | |
| `$groupingSets` | `GROUP BY GROUPING SETS(…)` | |

### Expression Operators

| Expression | SQL |
|---|---|
| `$sum/$avg/$min/$max/$count` | `SUM/AVG/MIN/MAX/COUNT` |
| `$first/$last` | `MIN/MAX` (Oracle workaround — document it) |
| `$concat` | `f1 \|\| f2` |
| `$toUpper/$toLower` | `UPPER/LOWER` |
| `$substr` | `SUBSTR(f, start, len)` |
| `$dateToString` | `TO_CHAR(date, format)` |
| `$cond` | `CASE WHEN … THEN … ELSE … END` |
| `$ifNull` | `COALESCE(f, :default)` |
| `$size` | `JSON_ARRAY_LENGTH(f)` |

---

## PART 11 — CATEGORY 6: Index Operations (`OracleCollection`)

**`createIndex(fields, options)`** → `{ acknowledged, indexName }`
`fields`: `{ col: 1 }` (1=ASC, -1=DESC). Auto-name: `idx_<table>_<cols>`.
`options.unique` → `UNIQUE`. `options.type: 'bitmap'` → `BITMAP`.

**`createIndexes(specs[])`** — loops `createIndex()`. Returns `{ acknowledged, indexNames[] }`.

**`dropIndex(name)`** → `{ acknowledged }` — `DROP INDEX "name"`

**`dropIndexes()`** → `{ acknowledged, dropped[] }`
Single query to `USER_INDEXES`, then loop drops. No N+1.

**`getIndexes()`** → `Array<{ indexName, columns, unique, type }>`
Single `USER_INDEXES JOIN USER_IND_COLUMNS` query — **O(1) db round-trip**.

**`reIndex()`** → `{ acknowledged }` — `ALTER INDEX "name" REBUILD` per index.

---

## PART 12 — CATEGORY 7: Transactions (`Transaction.js`)

`db.withTransaction()` owns commit/rollback. `Transaction.js` adds a MongoDB-style session API with savepoint support on top of it.

```js
class Session {
  constructor(conn, db) { this.conn = conn; this.db = db; }
  collection(tableName)    { return new OracleCollection(tableName, this.db, this.conn); }
  savepoint(name)          { return this.conn.execute(`SAVEPOINT "${name}"`); }
  rollbackTo(name)         { return this.conn.execute(`ROLLBACK TO SAVEPOINT "${name}"`); }
  releaseSavepoint(name)   { /* Oracle no-op — log console.warn */ }
}

class Transaction {
  constructor(db) { this.db = db; }
  withTransaction(fn) {
    return this.db.withTransaction(async (conn) => fn(new Session(conn, this.db)));
  }
}
```

**`OracleCollection` constructor:** `(tableName, db, _conn = null)`
When `_conn` is set (session context), `_execute(fn)` calls `fn(this._conn)` directly — no new connection acquired.

---

## PART 13 — CATEGORY 8: QueryBuilder — Lazy Cursor (`core/QueryBuilder.js`)

All chainable methods mutate internal state and return `this`. **No SQL is built or executed until a terminal method is called.**

**Non-terminal (chainable):**

| Method | SQL effect |
|---|---|
| `.sort(obj)` | `ORDER BY "col" ASC/DESC` |
| `.limit(n)` | `FETCH FIRST n ROWS ONLY` |
| `.skip(n)` | `OFFSET n ROWS` (valid without limit) |
| `.project(obj)` | `SELECT col1, col2` — `{ field: 0 }` = exclude (introspect `USER_TAB_COLUMNS`) |
| `.forUpdate(mode)` | `FOR UPDATE [NOWAIT \| SKIP LOCKED]` |
| `.asOf(opt)` | `AS OF SCN :v` or `AS OF TIMESTAMP TO_TIMESTAMP(:v, …)` |
| `.hint(str)` | `/*+ str */` injected as SQL comment only |

**Terminal (executes SQL):**

| Method | Behavior | Complexity |
|---|---|---|
| `.toArray()` | Buffer all rows — JSDoc warn for large sets | O(n) |
| `.forEach(fn)` | `conn.queryStream()` async iterator | O(1) memory |
| `.next()` | `FETCH FIRST 1 ROW ONLY` | O(1) |
| `.hasNext()` | Boolean — first row exists | O(1) |
| `.count()` | `SELECT COUNT(*) …` | O(n) w/ index |
| `.explain()` | Return SQL string only — no db call | O(1) |

**Rules:**
- Calling any non-terminal method after a terminal method → throw `"Cannot chain after terminal method"`.
- `QueryBuilder` holds references to `db` and `_conn` (for session routing). Terminal methods call `_execute` on the parent collection — or if constructed standalone, call `db.withConnection()` directly.

---

## PART 14 — CATEGORY 9: JOINs and Set Operations

### `joinBuilder.js` — `$lookup` → SQL JOIN

Supports single and multi-condition joins via `on: [{ localField, foreignField }, …]`.

| `joinType` | SQL clause |
|---|---|
| `left` (default) | `LEFT OUTER JOIN` |
| `right` | `RIGHT OUTER JOIN` |
| `full` | `FULL OUTER JOIN` |
| `inner` | `INNER JOIN` |
| `cross` | `CROSS JOIN` (no ON clause) |
| `self` | `"table" t1 INNER JOIN "table" t2 ON t1."id" = t2."parentId"` |
| `natural` | `NATURAL JOIN` |

### `setOperations.js` — Static methods on `OracleCollection`

`union(qb1, qb2, { all })`, `intersect(qb1, qb2)`, `minus(qb1, qb2)`

- Validate matching projected column counts before execution — throw on mismatch.
- Return a `SetOperationBuilder` supporting `.sort()`, `.limit()`, `.skip()`, `.toArray()`.
- `.sort()` wraps: `SELECT * FROM (q1 UNION q2) ORDER BY col` — no intermediate buffer.
- Execution uses `db.withConnection()` from `qb1.db`.

---

## PART 15 — CATEGORY 10: DDL (`schema/OracleSchema.js`)

**`createTable(tableName, columns, options)`**
Column options: `type`, `primaryKey`, `autoIncrement` (→ `GENERATED ALWAYS AS IDENTITY`), `notNull`, `default`, `check`, `references`.
`options.ifNotExists` → check `USER_TABLES` first.

**`alterTable(tableName, operation)`**
One operation object per call: `addColumn`, `dropColumn`, `modifyColumn`, `renameColumn`, `addConstraint`, `dropConstraint`.

**`dropTable(tableName, options)`** — `cascade` → `CASCADE CONSTRAINTS PURGE`, `ifExists` → check `USER_TABLES`

**`truncateTable(tableName)`** — `TRUNCATE TABLE "name"`

**`renameTable(old, new)`** — `RENAME "old" TO "new"`

**`createView(name, queryBuilderOrSQL, options)`** — `orReplace`, `force`
Accepts a `QueryBuilder` instance (calls `.explain()` to extract SQL) or a raw SQL string.

**`dropView(name, options)`** — `ifExists` → check `USER_VIEWS`

**`createSequence(name, options)`** — `startWith`, `incrementBy`, `maxValue`, `cycle`, `cache`

**`createSchema(name)`** — `CREATE SCHEMA AUTHORIZATION "name"`

---

## PART 16 — CATEGORY 11: MERGE / UPSERT (`OracleCollection`)

**`merge(sourceData, matchCondition, options)`**

```sql
MERGE INTO "employees" tgt
USING (SELECT :id AS "id", :name AS "name" FROM DUAL) src
ON (tgt."id" = src."id")
WHEN MATCHED THEN
  UPDATE SET tgt."name" = src."name"
  DELETE WHERE tgt."salary" < 0
WHEN NOT MATCHED THEN
  INSERT ("id","name") VALUES (src."id", src."name")
```

Options: `whenMatched` (update spec), `whenNotMatched: 'insert'`, `whenMatchedDelete` (filter)

**`mergeFrom(sourceTable, matchCondition, options)`** — source is a table, not `DUAL`

---

## PART 17 — CATEGORY 13: Subqueries (`pipeline/subqueryBuilder.js`)

| Type | Input | Output SQL |
|---|---|---|
| Scalar | `{ $subquery: { collection, fn, filter } }` in projection | `(SELECT COUNT(*) FROM "orders" WHERE …) AS alias` |
| Inline view | `options.from: { subquery: QueryBuilder, as }` | `FROM (SELECT …) alias` |
| Correlated | `where: { field: '$outer.field' }` in subquery | `WHERE f > (SELECT AVG(f) … WHERE x = outer.x)` |
| EXISTS | `{ $exists: { collection, match } }` | `WHERE EXISTS (SELECT 1 FROM … WHERE …)` |
| NOT EXISTS | `{ $notExists: … }` | `WHERE NOT EXISTS …` |
| IN SELECT | `{ $inSelect: QueryBuilder }` | `WHERE "id" IN (SELECT …)` |
| ANY / ALL | `{ $gtAny/$gtAll: { collection, field } }` | `> ANY/ALL (SELECT …)` |

---

## PART 18 — CATEGORY 14: CTEs (`pipeline/cteBuilder.js`)

Exported as **standalone functions** — not methods on `db`.

**`withCTE(db, { name: QueryBuilder, … })`** → `CTEBuilder`
- Chains: `.from(cteName)`, `.join(…)`, `.where(filter)`, `.project(…)`, `.sort(…)`, `.limit(n)`, `.toArray()`
- CTEs ordered topologically — later ones may reference earlier ones.
- SQL built once at terminal call — O(s) where s = CTE count.
- Execution: `db.withConnection()`.

```sql
WITH "active_users" AS (SELECT * FROM "users" WHERE "status" = :s0),
     "recent_orders" AS (SELECT * FROM "orders" WHERE "createdAt" >= :d0)
SELECT * FROM "active_users"
INNER JOIN "recent_orders" ON "active_users"."id" = "recent_orders"."userId"
```

**`withRecursiveCTE(db, name, { anchor: QueryBuilder, recursive: { collection, joinOn } })`**

```sql
WITH "org_tree" ("id","name","managerId","lvl") AS (
  SELECT "id","name","managerId", 1 AS "lvl" FROM "employees" WHERE "managerId" IS NULL
  UNION ALL
  SELECT e."id", e."name", e."managerId", o."lvl" + 1
  FROM "employees" e JOIN "org_tree" o ON e."managerId" = o."id"
)
SELECT * FROM "org_tree"
```

---

## PART 19 — CATEGORY 15: Window Functions (`pipeline/windowFunctions.js`)

Used inside `$addFields` / `$project` via `{ $window: { … } }` expressions.

```js
{ fn: 'ROW_NUMBER', partitionBy: 'customerId', orderBy: { date: -1 } }
{ fn: 'LAG', field: 'amount', offset: 1, partitionBy: 'customerId' }
{ fn: 'SUM', field: 'amount', partitionBy: 'region', orderBy: { date: 1 },
  frame: 'ROWS BETWEEN 2 PRECEDING AND CURRENT ROW' }
{ fn: 'COUNT', field: '*', partitionBy: 'region' }
```

Supported functions: `ROW_NUMBER, RANK, DENSE_RANK, NTILE, LAG, LEAD, FIRST_VALUE, LAST_VALUE, NTH_VALUE, SUM, AVG, COUNT, MIN, MAX`

**Rules:**
- `partitionBy` optional — omit `PARTITION BY` clause if absent.
- `orderBy` required for all ranking and navigation functions — throw with function name if missing.
- `COUNT` with `field: '*'` → `COUNT(*) OVER (…)`.
- Build the entire `fn(…) OVER (PARTITION BY … ORDER BY … frame)` in a single O(1) pass.

---

## PART 20 — CATEGORY 17: DCL (`schema/OracleDCL.js`)

**`grant(privileges[], on, to)`** → `GRANT SELECT, INSERT ON "table" TO "user"`

**`revoke(privileges[], on, from)`** → `REVOKE DELETE ON "table" FROM "user"`

Privileges and object names are sanitized via allowlist or `quoteIdentifier` — never interpolated raw.

---

## PART 21 — CATEGORY 19: Oracle Advanced Features (`advanced/oracleAdvanced.js`)

Methods on `OracleCollection` unless noted.

**`connectBy(options)`**
Options: `startWith` (filter), `connectBy` (relation), `orderSiblings` (sort), `maxLevel`, `includeLevel`, `includePath`
```sql
SELECT LEVEL, SYS_CONNECT_BY_PATH("name", '/') AS "path", t.*
FROM "employees" t
START WITH "managerId" IS NULL
CONNECT BY NOCYCLE PRIOR "id" = "managerId"
ORDER SIBLINGS BY "name" ASC
```

**`pivot(options)`** — `value`, `pivotOn`, `pivotValues[]`, `groupBy`
```sql
SELECT * FROM (SELECT "region","quarter","amount" FROM "sales")
PIVOT (SUM("amount") FOR "quarter" IN ('Q1' AS Q1,'Q2' AS Q2,'Q3' AS Q3,'Q4' AS Q4))
```

**`unpivot(options)`** — `valueColumn`, `nameColumn`, `columns[]`, `includeNulls`
→ `UNPIVOT [INCLUDE|EXCLUDE] NULLS ("amount" FOR "quarter" IN (Q1,Q2,Q3,Q4))`

`FOR UPDATE` and `AS OF` are surfaced via `find()` options (`forUpdate`, `asOf`) and `QueryBuilder` methods — not standalone methods.

**Lateral join** is surfaced via `$lateralJoin` in `aggregate()`:
```sql
SELECT u.*, ro.* FROM "users" u,
LATERAL (SELECT * FROM "orders" WHERE "userId" = u."id" ORDER BY "date" DESC FETCH FIRST 3 ROWS ONLY) ro
```

**`TABLESAMPLE`** is surfaced via `find({}, { sample: { percentage, seed? } })`:
→ `SELECT * FROM "users" SAMPLE(:pct) [SEED(:seed)]`

---

## PART 22 — CATEGORY 20: Performance Utilities (`advanced/performanceUtils.js`)

Exported as `createPerformance(db)` factory — not as `db.performance`.

**`explainPlan(queryBuilderOrSQL)`** → `Array`
Calls `.explain()` on `QueryBuilder` to get SQL, then:
```sql
EXPLAIN PLAN FOR <sql>;
SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY('PLAN_TABLE', NULL, 'ALL'));
```

**`analyze(tableName)`** → `void`
`DBMS_STATS.GATHER_TABLE_STATS(USER, UPPER(:t), CASCADE => TRUE)`

**`createMaterializedView(name, queryBuilderOrSQL, options)`** → `{ acknowledged }`
Options: `refreshMode ('fast'|'complete'|'force')`, `refreshOn ('commit'|'demand')`, `buildMode ('immediate'|'deferred')`, `orReplace`

**`refreshMaterializedView(name, mode)`** → `void`
`DBMS_MVIEW.REFRESH(UPPER(:n), :m)`

**`dropMaterializedView(name)`** → `{ acknowledged }` — `DROP MATERIALIZED VIEW "name"`

---

## PART 23 — CATEGORY 21: INSERT INTO … SELECT (`OracleCollection`)

**`insertFromQuery(targetTable, queryBuilder, options)`** → `{ acknowledged, insertedCount }`
Calls `queryBuilder.explain()` to get source SQL — **no JS buffering, pure SQL passthrough**.
`options.columns[]` → `INSERT INTO "target" ("col1","col2") SELECT …`
`result.rowsAffected` → `insertedCount`

---

## PART 24 — CATEGORY 22: UPDATE … JOIN (`OracleCollection`)

**`updateFromJoin(options)`** → `{ acknowledged, modifiedCount }`

Oracle's updateable inline view pattern:
```sql
UPDATE (
  SELECT e."salary" AS old_sal, s."newSalary" AS new_sal
  FROM "employees" e
  INNER JOIN "salary_adjustments" s ON e."id" = s."empId"
  WHERE s."approved" = :v0
) SET old_sal = new_sal
```

If the join is not key-preserved (ORA-01779), fall back to a correlated `UPDATE` subquery and document the fallback clearly in both code and README.

---

## PART 25 — `index.js` — Canonical Barrel

```js
'use strict';
module.exports = {
  // Factory
  createDb:            require('./db').createDb,
  // Core
  OracleCollection:    require('./core/OracleCollection').OracleCollection,
  QueryBuilder:        require('./core/QueryBuilder').QueryBuilder,
  // Schema
  OracleSchema:        require('./schema/OracleSchema').OracleSchema,
  OracleDCL:           require('./schema/OracleDCL').OracleDCL,
  // Transactions
  Transaction:         require('./Transaction').Transaction,
  // Pipeline helpers (standalone, accept db as first arg)
  withCTE:             require('./pipeline/cteBuilder').withCTE,
  withRecursiveCTE:    require('./pipeline/cteBuilder').withRecursiveCTE,
  // Performance (factory, accepts db)
  createPerformance:   require('./advanced/performanceUtils').createPerformance,
};
```

---

## PART 26 — DELIVERABLES (in dependency order)

| # | File | Key exports |
|---|---|---|
| 1 | `db.js` | `createDb` |
| 2 | `utils.js` | `quoteIdentifier, mergeBinds, convertTypes, rowToDoc, chunkArray, buildBindDefs` |
| 3 | `parsers/filterParser.js` | `parseFilter(filter) → { whereClause, binds }` |
| 4 | `parsers/updateParser.js` | `parseUpdate(update) → { setClause, binds }` |
| 5 | `core/QueryBuilder.js` | `QueryBuilder` |
| 6 | `Transaction.js` | `Transaction`, `Session` |
| 7 | `core/OracleCollection.js` | `OracleCollection` |
| 8 | `schema/OracleSchema.js` | `OracleSchema` |
| 9 | `schema/OracleDCL.js` | `OracleDCL` |
| 10 | `pipeline/aggregatePipeline.js` | `buildPipeline(stages, tableName, db)` |
| 11 | `pipeline/windowFunctions.js` | `buildWindowExpr(expr)` |
| 12 | `joins/joinBuilder.js` | `buildJoin(lookup)` |
| 13 | `joins/setOperations.js` | `SetOperationBuilder` |
| 14 | `pipeline/cteBuilder.js` | `withCTE`, `withRecursiveCTE` |
| 15 | `pipeline/subqueryBuilder.js` | `buildSubquery(spec, alias)` |
| 16 | `advanced/oracleAdvanced.js` | `connectBy`, `pivot`, `unpivot` |
| 17 | `advanced/performanceUtils.js` | `createPerformance` |
| 18 | `index.js` | All public exports |
| 19 | `package.json` | devDeps: `mocha`, `chai` — `oracledb` inherited from parent |
| 20 | `README.md` | One working example per category, including SQL output |
| 21 | `test.js` | End-to-end mocha + chai tests using `createDb('userAccount')` |
| 22 | `CHANGELOG.md` | v1.0.0 with full feature list |

---

## PART 27 — PRE-SUBMISSION CHECKLIST

Before outputting any file, verify every item:

**SQL Safety**
- [ ] Zero string-interpolated user values — every value is a bind variable
- [ ] All identifiers are `"DOUBLE_QUOTED"` and uppercase
- [ ] `UPPER(:bind)` used on all system table queries
- [ ] `autoCommit: false` inside transactions; `true` for standalone reads
- [ ] `outFormat: OUT_FORMAT_OBJECT` on every `conn.execute()` call

**Performance**
- [ ] `insertMany` uses `executeMany` with `chunkArray(docs, 500)` — never loops `insertOne`
- [ ] `forEach` uses `conn.queryStream()` — never buffers
- [ ] `estimatedDocumentCount` queries `USER_TABLES.NUM_ROWS`, not `COUNT(*)`
- [ ] `getIndexes` uses a single JOIN query — no N+1
- [ ] Adjacent `$match` stages are collapsed before CTE construction
- [ ] No pass-through CTE stages (`SELECT * FROM prev` with no transformation)
- [ ] `buildBindDefs` called once per `executeMany` batch, not per row
- [ ] `mergeBinds()` used for all bind merging — no `Object.assign` spread chains

**Error Handling**
- [ ] Every `catch` rethrows `[ClassName.methodName] msg\nSQL: …\nBinds: …`
- [ ] `findOne` / `findOneAnd*` return `null` on no match — never `undefined`

**Architecture**
- [ ] Every method uses `_execute()`, `db.withConnection()`, or `db.withTransaction()` — no manual pool calls
- [ ] `bulkWrite` and `insertMany` use `db.withTransaction()` — all ops or nothing
- [ ] Session-bound `OracleCollection` (`_conn` set) skips `withConnection()` entirely
- [ ] JSDoc on every public method: params, return type, SQL example