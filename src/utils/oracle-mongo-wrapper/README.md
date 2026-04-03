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

## License

ISC
