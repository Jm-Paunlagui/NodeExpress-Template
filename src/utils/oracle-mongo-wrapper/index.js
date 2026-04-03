"use strict";

/**
 * @fileoverview Barrel file — re-exports everything from the oracle-mongo-wrapper library.
 */

const { createDb } = require("./db");
const { OracleCollection } = require("./core/OracleCollection");
const { OracleSchema } = require("./schema/OracleSchema");
const { OracleDCL } = require("./schema/OracleDCL");
const { QueryBuilder } = require("./core/QueryBuilder");
const { Transaction } = require("./Transaction");
const { parseFilter } = require("./parsers/filterParser");
const { parseUpdate } = require("./parsers/updateParser");
const { buildAggregateSQL } = require("./pipeline/aggregatePipeline");
const { buildWindowExpr } = require("./pipeline/windowFunctions");
const { buildJoinSQL } = require("./joins/joinBuilder");
const { SetResultBuilder } = require("./joins/setOperations");
const { withCTE, withRecursiveCTE } = require("./pipeline/cteBuilder");
const {
    buildScalarSubquery,
    buildExistsSubquery,
    buildNotExistsSubquery,
    buildCorrelatedSubquery,
    buildInSelectSubquery,
    buildAnyAllSubquery,
} = require("./pipeline/subqueryBuilder");
const {
    buildConnectBy,
    buildPivot,
    buildUnpivot,
} = require("./advanced/oracleAdvanced");
const { createPerformance } = require("./advanced/performanceUtils");
const {
    quoteIdentifier,
    convertTypes,
    rowToDoc,
    mergeBinds,
    buildOrderBy,
    buildProjection,
} = require("./utils");

module.exports = {
    // Core
    createDb,
    OracleCollection,
    OracleSchema,
    OracleDCL,
    QueryBuilder,
    Transaction,

    // Parsers
    parseFilter,
    parseUpdate,

    // Aggregation
    buildAggregateSQL,
    buildWindowExpr,

    // Joins & Set Operations
    buildJoinSQL,
    SetResultBuilder,

    // CTEs
    withCTE,
    withRecursiveCTE,

    // Subqueries
    buildScalarSubquery,
    buildExistsSubquery,
    buildNotExistsSubquery,
    buildCorrelatedSubquery,
    buildInSelectSubquery,
    buildAnyAllSubquery,

    // Oracle Advanced
    buildConnectBy,
    buildPivot,
    buildUnpivot,

    // Performance
    createPerformance,

    // Utils
    quoteIdentifier,
    convertTypes,
    rowToDoc,
    mergeBinds,
    buildOrderBy,
    buildProjection,
};
