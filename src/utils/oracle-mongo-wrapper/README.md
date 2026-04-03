# Oracle MongoDB-Style Wrapper Library

A production-grade OracleDB wrapper that mirrors MongoDB's core API while leveraging the full power of Oracle SQL.

## Installation

```bash
npm install oracledb  # peer dependency — should already be in parent project
```

## Quick Start

```js
const {
    createDb,
    OracleCollection,
    OracleSchema,
    OracleDCL,
    Transaction,
} = require("./oracle-mongo-wrapper");

const db = createDb("userAccount");
const users = new OracleCollection("users", db);
```

## Usage Examples

### DDL — Create Table

```js
const schema = new OracleSchema(db);
await schema.createTable("users", {
    id: { type: "NUMBER", primaryKey: true, autoIncrement: true },
    name: { type: "VARCHAR2(200)", notNull: true },
    email: { type: "VARCHAR2(300)", notNull: true },
    status: { type: "VARCHAR2(20)", default: "'active'" },
});
```

### Insert

```js
await users.insertOne({ name: "Juan", email: "juan@email.com" });
await users.insertMany([
    { name: "Maria", email: "maria@email.com" },
    { name: "Pedro", email: "pedro@email.com" },
]);
```

### Find with Chaining

```js
const results = await users
    .find({ status: "active", age: { $gte: 18 } })
    .sort({ name: 1 })
    .skip(0)
    .limit(10)
    .project({ name: 1, email: 1 })
    .toArray();
```

### Update

```js
await users.updateOne(
    { name: "Juan" },
    {
        $set: { status: "premium" },
        $inc: { loginCount: 1 },
        $currentDate: { updatedAt: true },
    },
);

await users.updateMany({ status: "trial" }, { $set: { status: "expired" } });
```

### Delete

```js
await users.deleteOne({ status: "inactive" });
await users.deleteMany({ status: "banned" });
```

### Aggregation Pipeline

```js
const report = await orders.aggregate([
    { $match: { status: "completed" } },
    {
        $group: {
            _id: "$region",
            total: { $sum: "$amount" },
            count: { $count: "*" },
        },
    },
    { $sort: { total: -1 } },
    { $limit: 5 },
]);
```

### Window Functions

```js
const ranked = await orders.aggregate([
    {
        $addFields: {
            rank: {
                $window: {
                    fn: "RANK",
                    partitionBy: "region",
                    orderBy: { amount: -1 },
                },
            },
        },
    },
]);
```

### JOINs via $lookup

```js
const orderDetails = await orders.aggregate([
    {
        $lookup: {
            from: "customers",
            localField: "customerId",
            foreignField: "id",
            as: "customer",
            joinType: "left",
        },
    },
]);
```

### Set Operations

```js
const allVip = await OracleCollection.union(
    users.find({ tier: "gold" }),
    users.find({ tier: "platinum" }),
);
```

### CTEs

```js
const { withCTE } = require("./oracle-mongo-wrapper");
const result = await withCTE(db, {
    active_users: users.find({ status: "active" }),
})
    .from("active_users")
    .toArray();
```

### Transactions with Savepoints

```js
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
```

### CONNECT BY (Hierarchical)

```js
const orgTree = await employees.connectBy({
    startWith: { managerId: null },
    connectBy: { managerId: "$PRIOR id" },
    includeLevel: true,
    includePath: true,
});
```

### PIVOT

```js
const pivotResult = await sales.pivot({
    value: { $sum: "$amount" },
    pivotOn: "quarter",
    pivotValues: ["Q1", "Q2", "Q3", "Q4"],
    groupBy: "region",
});
```

### MERGE / UPSERT

```js
await employees.merge(
    { id: 10, name: "Ana", salary: 60000 },
    { localField: "id", foreignField: "id" },
    { whenMatched: { $set: { salary: 60000 } }, whenNotMatched: "insert" },
);
```

### DCL — Grant / Revoke

```js
const dcl = new OracleDCL(db);
await dcl.grant(["SELECT", "INSERT"], "orders", "app_user");
await dcl.revoke(["DELETE"], "orders", "app_user");
```

### Performance Utilities

```js
const { createPerformance } = require("./oracle-mongo-wrapper");
const perf = createPerformance(db);
await perf.explainPlan(users.find({ status: "active" }));
await perf.analyze("orders");
```

### Index Operations

```js
await users.createIndex({ name: 1 }, { unique: true });
const indexes = await users.getIndexes();
await users.dropIndex("IDX_users_name");
```

## API Reference

See CLAUDE.md for the complete specification of all methods, operators, and options.

---

## `$` Operator Dictionary

> **Key rule:** `$` before a field name (like `'$amount'`) means "reference this column's value." `$` before an operator (like `$gte`, `$set`) means "use this special operation."

---

### Filter Operators

Used in `find()`, `findOne()`, `$match`, and anywhere a filter object is accepted. These build SQL `WHERE` clauses.

| Operator      | Meaning               | Example                                      | SQL Equivalent                     |
| ------------- | --------------------- | -------------------------------------------- | ---------------------------------- |
| `$eq`         | Equals                | `{ age: { $eq: 25 } }`                       | `age = 25`                         |
| `$ne`         | Not equal             | `{ status: { $ne: 'inactive' } }`            | `status <> 'inactive'`             |
| `$gt`         | Greater than          | `{ age: { $gt: 18 } }`                       | `age > 18`                         |
| `$gte`        | Greater than or equal | `{ age: { $gte: 18 } }`                      | `age >= 18`                        |
| `$lt`         | Less than             | `{ price: { $lt: 100 } }`                    | `price < 100`                      |
| `$lte`        | Less than or equal    | `{ price: { $lte: 100 } }`                   | `price <= 100`                     |
| `$in`         | Value in list         | `{ status: { $in: ['active', 'pending'] } }` | `status IN ('active','pending')`   |
| `$nin`        | Value NOT in list     | `{ role: { $nin: ['banned', 'deleted'] } }`  | `role NOT IN ('banned','deleted')` |
| `$between`    | Between two values    | `{ age: { $between: [18, 65] } }`            | `age BETWEEN 18 AND 65`            |
| `$notBetween` | Not between           | `{ score: { $notBetween: [0, 50] } }`        | `score NOT BETWEEN 0 AND 50`       |
| `$exists`     | Is (not) null         | `{ email: { $exists: true } }`               | `email IS NOT NULL`                |
| `$regex`      | Regex match           | `{ name: { $regex: '^J' } }`                 | `REGEXP_LIKE(name, '^J')`          |
| `$like`       | SQL LIKE pattern      | `{ name: { $like: 'J%' } }`                  | `name LIKE 'J%'`                   |
| `$any`        | Equals any value      | `{ dept: { $any: [1, 2] } }`                 | `dept = ANY(1, 2)`                 |
| `$all`        | Equals all values     | `{ score: { $all: [100] } }`                 | `score = ALL(100)`                 |

#### Logical Operators (combine conditions)

| Operator | Meaning                      | Example                                                   |
| -------- | ---------------------------- | --------------------------------------------------------- |
| `$and`   | All conditions must match    | `{ $and: [{ age: { $gte: 18 } }, { status: 'active' }] }` |
| `$or`    | Any condition can match      | `{ $or: [{ city: 'Manila' }, { city: 'Cebu' }] }`         |
| `$nor`   | None of the conditions match | `{ $nor: [{ status: 'banned' }, { status: 'deleted' }] }` |
| `$not`   | Negate a condition           | `{ $not: { status: 'inactive' } }`                        |

#### Filter Examples

```js
// Simple equality (no $ needed)
await users.find({ name: "Juan" }).toArray();

// With operators
await users
    .find({
        age: { $gte: 18, $lte: 65 },
        status: { $in: ["active", "premium"] },
    })
    .toArray();

// Logical combination
await users
    .find({
        $or: [{ city: "Manila" }, { age: { $gt: 30 } }],
    })
    .toArray();

// Null check
await users.find({ email: { $exists: true } }).toArray();

// Pattern matching
await users.find({ name: { $like: "J%" } }).toArray();

// Between range
await users.find({ salary: { $between: [30000, 80000] } }).toArray();
```

---

### Update Operators

Used in `updateOne()`, `updateMany()`, and `findOneAndUpdate()`. These tell the wrapper _how_ to modify fields.

| Operator       | Meaning                       | Example                                 | SQL Equivalent                            |
| -------------- | ----------------------------- | --------------------------------------- | ----------------------------------------- |
| `$set`         | Set field to a value          | `{ $set: { name: 'Ana' } }`             | `SET name = 'Ana'`                        |
| `$unset`       | Set field to NULL             | `{ $unset: { nickname: '' } }`          | `SET nickname = NULL`                     |
| `$inc`         | Increment by N                | `{ $inc: { loginCount: 1 } }`           | `SET loginCount = loginCount + 1`         |
| `$mul`         | Multiply by N                 | `{ $mul: { price: 1.1 } }`              | `SET price = price * 1.1`                 |
| `$min`         | Set to lesser of current/new  | `{ $min: { lowScore: 50 } }`            | `SET lowScore = LEAST(lowScore, 50)`      |
| `$max`         | Set to greater of current/new | `{ $max: { highScore: 99 } }`           | `SET highScore = GREATEST(highScore, 99)` |
| `$currentDate` | Set to current date/time      | `{ $currentDate: { updatedAt: true } }` | `SET updatedAt = SYSDATE`                 |
| `$rename`      | Rename column                 | `{ $rename: { old: 'new' } }`           | _(throws error — use ALTER TABLE)_        |

#### Update Examples

```js
// Set specific fields
await users.updateOne({ id: 1 }, { $set: { status: "premium", tier: "gold" } });

// Increment a counter and set current date
await users.updateOne(
    { id: 1 },
    { $inc: { loginCount: 1 }, $currentDate: { lastLogin: true } },
);

// Combine multiple update operators
await products.updateMany(
    { category: "electronics" },
    { $mul: { price: 0.9 }, $set: { onSale: "Y" } },
);

// Remove a field value (set to NULL)
await users.updateOne({ id: 1 }, { $unset: { temporaryNote: "" } });
```

---

### Aggregation Pipeline Stages

Used in `aggregate()`. Each `$stage` is a step that transforms the data. They run in order — each stage receives the output of the previous stage.

| Stage        | Meaning                   | What it does                                                  |
| ------------ | ------------------------- | ------------------------------------------------------------- |
| `$match`     | Filter rows               | Like `WHERE` — keeps only matching rows                       |
| `$group`     | Group + aggregate         | Like `GROUP BY` — groups rows and computes sums, counts, etc. |
| `$project`   | Pick/rename columns       | Like `SELECT col1, col2` — chooses which fields to return     |
| `$addFields` | Add computed columns      | Adds new fields without removing existing ones                |
| `$sort`      | Sort results              | Like `ORDER BY`                                               |
| `$limit`     | Cap row count             | Like `FETCH FIRST N ROWS ONLY`                                |
| `$skip`      | Skip rows                 | Like `OFFSET N ROWS`                                          |
| `$count`     | Count rows                | Returns `{ fieldName: count }`                                |
| `$lookup`    | Join tables               | Like `LEFT JOIN`, `INNER JOIN`, etc.                          |
| `$having`    | Filter after grouping     | Like SQL `HAVING` — filters grouped results                   |
| `$out`       | Write results to a table  | Like `INSERT INTO table SELECT ...`                           |
| `$merge`     | Upsert results to a table | Like SQL `MERGE INTO`                                         |
| `$bucket`    | Range grouping            | Groups values into defined ranges using `CASE WHEN`           |
| `$facet`     | Multiple sub-pipelines    | Runs several pipelines in parallel, returns all results       |

#### Pipeline Example

```js
// "Top 5 regions by total sales for completed orders"
const report = await orders.aggregate([
    { $match: { status: "completed" } }, // Step 1: filter
    { $group: { _id: "$region", total: { $sum: "$amount" } } }, // Step 2: group & sum
    { $sort: { total: -1 } }, // Step 3: sort descending
    { $limit: 5 }, // Step 4: top 5 only
]);

// With HAVING — only regions over 10000
await sales.aggregate([
    { $group: { _id: "$region", total: { $sum: "$amount" } } },
    { $having: { total: { $gt: 10000 } } },
    { $sort: { total: -1 } },
]);
```

---

### Aggregation Expression Operators

Used inside `$group`, `$project`, and `$addFields` to compute values.

| Operator        | Meaning              | Example                                                                  | SQL                                   |
| --------------- | -------------------- | ------------------------------------------------------------------------ | ------------------------------------- |
| `$sum`          | Sum values           | `{ total: { $sum: '$amount' } }`                                         | `SUM(amount)`                         |
| `$avg`          | Average              | `{ avgPrice: { $avg: '$price' } }`                                       | `AVG(price)`                          |
| `$min`          | Minimum              | `{ cheapest: { $min: '$price' } }`                                       | `MIN(price)`                          |
| `$max`          | Maximum              | `{ highest: { $max: '$price' } }`                                        | `MAX(price)`                          |
| `$count`        | Count rows           | `{ total: { $count: '*' } }`                                             | `COUNT(*)`                            |
| `$first`        | First value in group | `{ first: { $first: '$name' } }`                                         | `MIN(name)`                           |
| `$last`         | Last value in group  | `{ last: { $last: '$name' } }`                                           | `MAX(name)`                           |
| `$concat`       | Concatenate strings  | `{ full: { $concat: ['$first', '$last'] } }`                             | `first \|\| last`                     |
| `$toUpper`      | Uppercase            | `{ name: { $toUpper: '$name' } }`                                        | `UPPER(name)`                         |
| `$toLower`      | Lowercase            | `{ name: { $toLower: '$name' } }`                                        | `LOWER(name)`                         |
| `$substr`       | Substring            | `{ code: { $substr: ['$name', 1, 3] } }`                                 | `SUBSTR(name, 1, 3)`                  |
| `$cond`         | If/then/else         | `{ label: { $cond: { if: ..., then: ..., else: ... } } }`                | `CASE WHEN ... THEN ... ELSE ... END` |
| `$ifNull`       | Fallback for null    | `{ name: { $ifNull: ['$nickname', 'N/A'] } }`                            | `COALESCE(nickname, 'N/A')`           |
| `$dateToString` | Format date          | `{ d: { $dateToString: { format: 'YYYY-MM-DD', date: '$createdAt' } } }` | `TO_CHAR(createdAt, ...)`             |

> **`'$fieldName'`** (string starting with `$`) means "reference the value of this column." Without `$`, it's treated as a literal value.

#### Expression Examples

```js
// Group customers with multiple aggregations
await orders.aggregate([
    {
        $group: {
            _id: "$customerId",
            totalSpent: { $sum: "$amount" },
            orderCount: { $count: "*" },
            avgOrder: { $avg: "$amount" },
            biggest: { $max: "$amount" },
        },
    },
    { $sort: { totalSpent: -1 } },
]);

// Computed fields with $cond and $ifNull
await users.aggregate([
    {
        $project: {
            name: 1,
            displayName: { $ifNull: ["$nickname", "$name"] },
            tier: {
                $cond: {
                    if: { totalSpent: { $gte: 10000 } },
                    then: "VIP",
                    else: "Regular",
                },
            },
        },
    },
]);
```

---

### `$lookup` — JOIN Tables

Used inside `aggregate()` to join data from another table.

| Field          | Meaning                                                                    |
| -------------- | -------------------------------------------------------------------------- |
| `from`         | The other table to join                                                    |
| `localField`   | Column in the current table                                                |
| `foreignField` | Column in the other table                                                  |
| `as`           | Alias for the joined data                                                  |
| `joinType`     | `'left'`, `'right'`, `'inner'`, `'full'`, `'cross'`, `'self'`, `'natural'` |

#### Join Examples

```js
// Left join — all orders, with customer info if available
await orders.aggregate([
    {
        $lookup: {
            from: "customers",
            localField: "customerId",
            foreignField: "id",
            as: "customer",
            joinType: "left",
        },
    },
]);

// Inner join — only orders that have a matching customer
await orders.aggregate([
    {
        $lookup: {
            from: "customers",
            localField: "customerId",
            foreignField: "id",
            as: "customer",
            joinType: "inner",
        },
    },
    { $project: { orderId: 1, amount: 1, "customer.name": 1 } },
]);

// Multi-condition join
await orders.aggregate([
    {
        $lookup: {
            from: "inventory",
            as: "stock",
            joinType: "inner",
            on: [
                { localField: "productId", foreignField: "id" },
                { localField: "warehouseId", foreignField: "warehouseId" },
            ],
        },
    },
]);

// Self-join — employees with their managers
await employees.aggregate([
    {
        $lookup: {
            from: "employees",
            localField: "managerId",
            foreignField: "id",
            as: "manager",
            joinType: "self",
        },
    },
]);
```

---

### `$window` — Window / Analytic Functions

Used inside `$addFields` to add rankings, running totals, etc. **without collapsing rows** (unlike `$group`).

| `fn` value    | Meaning                         |
| ------------- | ------------------------------- |
| `ROW_NUMBER`  | Sequential number per partition |
| `RANK`        | Rank with gaps on ties          |
| `DENSE_RANK`  | Rank without gaps               |
| `NTILE`       | Split into N buckets            |
| `LAG`         | Previous row's value            |
| `LEAD`        | Next row's value                |
| `FIRST_VALUE` | First value in window           |
| `LAST_VALUE`  | Last value in window            |
| `NTH_VALUE`   | Nth value in window             |
| `SUM`         | Running sum                     |
| `AVG`         | Running average                 |
| `COUNT`       | Running count                   |

| Parameter     | Meaning                                                                 |
| ------------- | ----------------------------------------------------------------------- |
| `fn`          | The function name (see table above)                                     |
| `field`       | Column to operate on (for `LAG`, `LEAD`, `SUM`, etc.)                   |
| `partitionBy` | Group rows by this column (optional)                                    |
| `orderBy`     | Sort within partition (`{ col: 1 }` = ASC, `{ col: -1 }` = DESC)        |
| `offset`      | For `LAG`/`LEAD` — how many rows back/forward (default: 1)              |
| `n`           | For `NTILE` — number of buckets; for `NTH_VALUE` — which row            |
| `frame`       | Custom frame clause (e.g. `'ROWS BETWEEN 2 PRECEDING AND CURRENT ROW'`) |

#### Window Examples

```js
await orders.aggregate([
    {
        $addFields: {
            // Rank orders by amount within each region (highest first)
            rank: {
                $window: {
                    fn: "RANK",
                    partitionBy: "region",
                    orderBy: { amount: -1 },
                },
            },

            // Get the previous order's amount for the same customer
            prevAmount: {
                $window: {
                    fn: "LAG",
                    field: "amount",
                    offset: 1,
                    partitionBy: "customerId",
                },
            },

            // Running total per customer, ordered by date
            runningTotal: {
                $window: {
                    fn: "SUM",
                    field: "amount",
                    partitionBy: "customerId",
                    orderBy: { date: 1 },
                },
            },

            // 3-row moving average
            movingAvg: {
                $window: {
                    fn: "AVG",
                    field: "amount",
                    orderBy: { date: 1 },
                    frame: "ROWS BETWEEN 2 PRECEDING AND CURRENT ROW",
                },
            },
        },
    },
]);
```

---

### Advanced Grouping Operators

Used inside `$group` stage's `_id` field for Oracle-specific multi-level grouping.

| Operator        | Meaning                       | Example                                        | SQL                                    |
| --------------- | ----------------------------- | ---------------------------------------------- | -------------------------------------- |
| `$rollup`       | Subtotals + grand total       | `{ _id: { $rollup: ['region', 'product'] } }`  | `GROUP BY ROLLUP(region, product)`     |
| `$cube`         | All combinations of subtotals | `{ _id: { $cube: ['region', 'product'] } }`    | `GROUP BY CUBE(region, product)`       |
| `$groupingSets` | Custom grouping combos        | `{ _id: { $groupingSets: [['region'], []] } }` | `GROUP BY GROUPING SETS((region), ())` |

#### Advanced Grouping Examples

```js
// ROLLUP — subtotals per region, then grand total
await sales.aggregate([
    {
        $group: {
            _id: { $rollup: ["region", "product"] },
            total: { $sum: "$amount" },
        },
    },
]);

// CUBE — every combination of region × product subtotals
await sales.aggregate([
    {
        $group: {
            _id: { $cube: ["region", "product", "quarter"] },
            total: { $sum: "$amount" },
        },
    },
]);
```

---

### Special Filter Operators

These are less common operators for advanced use cases.

| Operator             | Meaning                   | Example                                                                                           | SQL                                        |
| -------------------- | ------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `$case`              | CASE expression           | `{ field: { $case: [{ when: ..., then: ... }], $else: v } }`                                      | `CASE WHEN ... THEN ... ELSE ... END`      |
| `$coalesce`          | First non-null value      | `{ field: { $coalesce: ['$f1', '$f2', 'fallback'] } }`                                            | `COALESCE(f1, f2, 'fallback')`             |
| `$nullif`            | NULL if values equal      | `{ field: { $nullif: ['$f1', '$f2'] } }`                                                          | `NULLIF(f1, f2)`                           |
| `$exists` (subquery) | Row exists in other table | `{ $exists: { collection: 'orders', match: { userId: '$id' } } }`                                 | `WHERE EXISTS (SELECT 1 FROM orders ...)`  |
| `$notExists`         | Row does NOT exist        | `{ $notExists: { collection: 'orders', match: { userId: '$id' } } }`                              | `WHERE NOT EXISTS (...)`                   |
| `$inSelect`          | Value in subquery result  | `{ id: { $inSelect: orders.distinct('userId') } }`                                                | `WHERE id IN (SELECT DISTINCT userId ...)` |
| `$subquery`          | Scalar subquery           | `{ orderCount: { $subquery: { collection: 'orders', fn: 'count', filter: { userId: '$id' } } } }` | `(SELECT COUNT(*) FROM orders WHERE ...)`  |

---

### Quick Cheat Sheet

```js
// FIND: "Active users over 18, sorted by name, page 2 (10 per page)"
await users
    .find({ status: "active", age: { $gt: 18 } })
    .sort({ name: 1 })
    .skip(10)
    .limit(10)
    .toArray();

// UPDATE: "Increment login count and mark last login for user 5"
await users.updateOne(
    { id: 5 },
    {
        $inc: { loginCount: 1 },
        $currentDate: { lastLogin: true },
    },
);

// AGGREGATE: "Total sales per region, only regions over 10000"
await sales.aggregate([
    { $group: { _id: "$region", total: { $sum: "$amount" } } },
    { $having: { total: { $gt: 10000 } } },
    { $sort: { total: -1 } },
]);

// JOIN: "Orders with customer names"
await orders.aggregate([
    {
        $lookup: {
            from: "customers",
            localField: "customerId",
            foreignField: "id",
            as: "cust",
            joinType: "left",
        },
    },
    { $project: { orderId: 1, amount: 1, "cust.name": 1 } },
]);

// WINDOW: "Rank employees by salary within each department"
await employees.aggregate([
    {
        $addFields: {
            rank: {
                $window: {
                    fn: "RANK",
                    partitionBy: "deptId",
                    orderBy: { salary: -1 },
                },
            },
        },
    },
]);

// MERGE/UPSERT: "Insert or update employee"
await employees.merge(
    { id: 10, name: "Ana", salary: 60000 },
    { localField: "id", foreignField: "id" },
    { whenMatched: { $set: { salary: 60000 } }, whenNotMatched: "insert" },
);
```

## License

ISC
