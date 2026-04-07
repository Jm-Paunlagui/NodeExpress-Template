"use strict";

const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

// ─── Wrapper imports ──────────────────────────────────────────────────────────
const { createDb } = require("../../src/utils/oracle-mongo-wrapper/db");
const {
    OracleCollection,
} = require("../../src/utils/oracle-mongo-wrapper/core/OracleCollection");

// ─── Table Column Schemas ─────────────────────────────────────────────────────

const SAPBook = {
    table: "INV_BOOK",
    columns: [
        "ID",
        "DIVISION",
        "YEAR",
        "MONTH",
        "MATERIALID",
        "SAP_BOOK_QUANTITY",
        "SLOC",
        "CREATEDBY",
        "MODIFIEDBY",
        "DELETEDBY",
        "CREATEDDATE",
        "MODIFIEDDATE",
        "DELETEDDATE",
        "REASON",
        "ACTION",
    ],
};

const StorageLocation = {
    table: "INV_LOCATION",
    columns: [
        "ID",
        "DIVISION",
        "YEAR",
        "MONTH",
        "SLOC",
        "PSA",
        "TERMINAL",
        "TYPE",
        "TOTAL_TAG_GENERATED",
        "CREATEDBY",
        "MODIFIEDBY",
        "DELETEDBY",
        "CREATEDDATE",
        "MODIFIEDDATE",
        "DELETEDDATE",
        "REASON",
        "ACTION",
    ],
};

const UnlockedInventoryByMonth = {
    table: "INV_LOCK",
    columns: ["ID", "MONTH", "LAST_CHANGE_BY", "AUTO_GR", "ACTIVE"],
};

const MaterialMaster = {
    table: "INV_MATMAS",
    columns: [
        "ID",
        "DIVISION",
        "YEAR",
        "MONTH",
        "MATERIALID",
        "DESCRIPTION",
        "TYPE",
        "STANDARDPRICE",
        "MRP",
        "CREATEDBY",
        "MODIFIEDBY",
        "DELETEDBY",
        "CREATEDDATE",
        "MODIFIEDDATE",
        "DELETEDDATE",
        "REASON",
        "ACTION",
    ],
};

const InventoryStocks = {
    table: "INV_STOCKS",
    columns: [
        "ID",
        "DIVISION",
        "YEAR",
        "MONTH",
        "MATERIALID",
        "BATCHID",
        "QUANTITY",
        "PARTQTY",
        "CATEGORY",
        "SLOC",
        "ID_LOC",
        "TAGNUM",
        "USERNAME",
        "GR_SU",
        "PACKAGE_ID",
        "CREATEDBY",
        "MODIFIEDBY",
        "DELETEDBY",
        "CREATEDDATE",
        "MODIFIEDDATE",
        "DELETEDDATE",
        "REASON",
        "ACTION",
    ],
};

const InventoryUnit = {
    table: "INV_UNIT",
    columns: [
        "ID",
        "DIVISION",
        "YEAR",
        "MONTH",
        "BATCHID",
        "UNITID",
        "UNITIDTYPE",
        "UNITSTATUS",
        "LOCATION",
        "ORDERNAME",
        "MATERIALNUMBER",
        "CURRENTOPERATION",
        "ITEMSPASSED",
        "ITEMSFAILED",
        "ITEMSSCRAP",
        "CREATEDBY",
        "MODIFIEDBY",
        "DELETEDBY",
        "CREATEDDATE",
        "MODIFIEDDATE",
        "DELETEDDATE",
        "REASON",
        "ACTION",
    ],
};

// ─── DB binding ───────────────────────────────────────────────────────────────
const inventoryDB = createDb("unitInventory");

// ─── Collection handles ───────────────────────────────────────────────────────
const devBook = new OracleCollection(SAPBook.table, inventoryDB);
const devLock = new OracleCollection(
    UnlockedInventoryByMonth.table,
    inventoryDB,
);
const devMaterial = new OracleCollection(MaterialMaster.table, inventoryDB);
const devStocks = new OracleCollection(InventoryStocks.table, inventoryDB);

// ─── Formatting helpers ───────────────────────────────────────────────────────
const NUM = (v) => (v == null ? 0 : Number(v));
const FMT = (v) =>
    NUM(v).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
const PAD = (s, w) => String(s).padEnd(w);
const PADR = (s, w) => String(s).padStart(w);
const SEP = (ch, w) => ch.repeat(w);

// ═════════════════════════════════════════════════════════════════════════════
//  INVENTORY VALUATION REPORT
//  Book Value (SAP) vs Stock Value (Physical) with Variance — by SLOC
//  Pricing sourced from Material Master (STANDARDPRICE)
// ═════════════════════════════════════════════════════════════════════════════

// ─── Report Parameters ────────────────────────────────────────────────────────
const REPORT_YEAR = 2026;
const REPORT_MONTH = 2;
const REPORT_DIVISION = "ADAS";

async function generateInventoryReport() {
    console.log(
        `\n  Loading data from Oracle — YEAR: ${REPORT_YEAR}, MONTH: ${REPORT_MONTH}, DIVISION: ${REPORT_DIVISION}...\n`,
    );

    // ── 1. Fetch book quantities by SLOC + MATERIALID ─────────────────────
    //    Filtered by YEAR, MONTH, DIVISION
    //    Uses aggregate: $match → GROUP BY SLOC, MATERIALID → SUM(SAP_BOOK_QUANTITY)
    const bookBySlocMat = await devBook.aggregate([
        {
            $match: {
                YEAR: REPORT_YEAR,
                MONTH: REPORT_MONTH,
                DIVISION: REPORT_DIVISION,
            },
        },
        {
            $group: {
                _id: { SLOC: "$SLOC", MATERIALID: "$MATERIALID" },
                BOOK_QTY: { $sum: "$SAP_BOOK_QUANTITY" },
            },
        },
        { $sort: { SLOC: 1, MATERIALID: 1 } },
    ]);

    // ── 2. Fetch stock (physical) quantities by SLOC + MATERIALID ─────────
    //    Filtered by YEAR, MONTH, DIVISION
    //    Uses aggregate: $match → GROUP BY SLOC, MATERIALID → SUM(QUANTITY)
    const stockBySlocMat = await devStocks.aggregate([
        {
            $match: {
                YEAR: REPORT_YEAR,
                MONTH: REPORT_MONTH,
                DIVISION: REPORT_DIVISION,
            },
        },
        {
            $group: {
                _id: { SLOC: "$SLOC", MATERIALID: "$MATERIALID" },
                STOCK_QTY: { $sum: "$QUANTITY" },
            },
        },
        { $sort: { SLOC: 1, MATERIALID: 1 } },
    ]);

    // ── 3. Fetch pricing from Material Master ─────────────────────────────
    //    Filtered by YEAR, MONTH, DIVISION — one price per MATERIALID
    const materials = await devMaterial
        .find(
            {
                YEAR: REPORT_YEAR,
                MONTH: REPORT_MONTH,
                DIVISION: REPORT_DIVISION,
            },
            {
                projection: {
                    MATERIALID: 1,
                    DESCRIPTION: 1,
                    TYPE: 1,
                    STANDARDPRICE: 1,
                },
            },
        )
        .toArray();

    // ── 4. Build a price lookup map ───────────────────────────────────────
    const priceMap = {}; // MATERIALID → { price, description, type }
    for (const m of materials) {
        const mid = String(m.MATERIALID);
        priceMap[mid] = {
            price: NUM(m.STANDARDPRICE),
            description: m.DESCRIPTION || "",
            type: m.TYPE || "",
        };
    }

    // ── 5. Build book lookup:  SLOC|MATERIALID → qty ──────────────────────
    const bookMap = {};
    for (const row of bookBySlocMat) {
        const key = `${row.SLOC}|${row.MATERIALID}`;
        bookMap[key] = NUM(row.BOOK_QTY);
    }

    // ── 6. Build stock lookup:  SLOC|MATERIALID → qty ─────────────────────
    const stockMap = {};
    for (const row of stockBySlocMat) {
        const key = `${row.SLOC}|${row.MATERIALID}`;
        stockMap[key] = NUM(row.STOCK_QTY);
    }

    // ── 7. Merge all keys to produce the full report rows ─────────────────
    const allKeys = new Set([
        ...Object.keys(bookMap),
        ...Object.keys(stockMap),
    ]);
    const detailRows = [];
    const slocTotals = {}; // SLOC → { bookVal, stockVal, variance }

    for (const key of allKeys) {
        const [sloc, matId] = key.split("|");
        const bookQty = bookMap[key] || 0;
        const stockQty = stockMap[key] || 0;
        const pricing = priceMap[String(matId)] || {
            price: 0,
            description: "N/A",
            type: "N/A",
        };
        const bookVal = bookQty * pricing.price;
        const stockVal = stockQty * pricing.price;
        const variance = bookVal - stockVal;
        const variancePct = bookVal !== 0 ? (variance / bookVal) * 100 : 0;

        detailRows.push({
            sloc,
            matId,
            description: pricing.description,
            type: pricing.type,
            price: pricing.price,
            bookQty,
            stockQty,
            qtyVariance: bookQty - stockQty,
            bookVal,
            stockVal,
            variance,
            variancePct,
        });

        if (!slocTotals[sloc]) {
            slocTotals[sloc] = {
                bookVal: 0,
                stockVal: 0,
                bookQty: 0,
                stockQty: 0,
                items: 0,
            };
        }
        slocTotals[sloc].bookVal += bookVal;
        slocTotals[sloc].stockVal += stockVal;
        slocTotals[sloc].bookQty += bookQty;
        slocTotals[sloc].stockQty += stockQty;
        slocTotals[sloc].items++;
    }

    // Sort detail rows by SLOC then MATERIALID
    detailRows.sort(
        (a, b) =>
            a.sloc.localeCompare(b.sloc) ||
            String(a.matId).localeCompare(String(b.matId)),
    );

    // ── 8. Grand totals ───────────────────────────────────────────────────
    let grandBookVal = 0,
        grandStockVal = 0,
        grandBookQty = 0,
        grandStockQty = 0;
    for (const t of Object.values(slocTotals)) {
        grandBookVal += t.bookVal;
        grandStockVal += t.stockVal;
        grandBookQty += t.bookQty;
        grandStockQty += t.stockQty;
    }
    const grandVariance = grandBookVal - grandStockVal;
    const grandVariancePct =
        grandBookVal !== 0 ? (grandVariance / grandBookVal) * 100 : 0;

    // ── 9. Additional context queries (filtered) ─────────────────────────
    const reportFilter = {
        YEAR: REPORT_YEAR,
        MONTH: REPORT_MONTH,
        DIVISION: REPORT_DIVISION,
    };
    const totalBookRows = await devBook.countDocuments(reportFilter);
    const totalStockRows = await devStocks.countDocuments(reportFilter);
    const totalMaterials = materials.length;
    const distinctSlocs = [...new Set(detailRows.map((r) => r.sloc))].sort();
    const lockedMonths = await devLock.find({ ACTIVE: 1 }).toArray();

    // ═══════════════════════════════════════════════════════════════════════
    //  FORMAT & PRINT REPORT
    // ═══════════════════════════════════════════════════════════════════════

    const W = 140; // total width
    const now = new Date();
    const lines = [];
    const L = (s = "") => lines.push(s);

    L(SEP("═", W));
    L("  INVENTORY VALUATION REPORT — Book Value vs Physical Stock Value");
    L(`  Generated: ${now.toISOString()}`);
    L(`  Data Source: Oracle (unitInventory)`);
    L(
        `  Division:  ${REPORT_DIVISION}   |   Year: ${REPORT_YEAR}   |   Month: ${REPORT_MONTH}`,
    );
    L(SEP("═", W));
    L();

    // ── Data Summary ──────────────────────────────────────────────────────
    L("  DATA SUMMARY");
    L(SEP("─", W));
    L(`  SAP Book Records (DEV_BOOK):       ${PADR(totalBookRows, 8)}`);
    L(`  Physical Stock Records (DEV_STOCKS):${PADR(totalStockRows, 8)}`);
    L(`  Material Master Records:           ${PADR(totalMaterials, 8)}`);
    L(
        `  Distinct SLOCs in Report:          ${PADR(distinctSlocs.length, 8)}   [${distinctSlocs.join(", ")}]`,
    );
    L(`  Unique Material-SLOC Combinations: ${PADR(detailRows.length, 8)}`);
    if (lockedMonths.length > 0) {
        L(
            `  Locked Months (ACTIVE=1):          ${lockedMonths.map((r) => r.MONTH).join(", ")}`,
        );
    }
    L();

    // ── SLOC Summary ──────────────────────────────────────────────────────
    L("  VALUATION SUMMARY BY SLOC");
    L(SEP("─", W));
    L(
        `  ${PAD("SLOC", 10)} ${PADR("Items", 7)} ${PADR("Book Qty", 12)} ${PADR("Stock Qty", 12)} ${PADR("Qty Var", 12)} ${PADR("Book Value", 18)} ${PADR("Stock Value", 18)} ${PADR("Variance", 18)} ${PADR("Var %", 8)}`,
    );
    L(
        `  ${SEP("─", 10)} ${SEP("─", 7)} ${SEP("─", 12)} ${SEP("─", 12)} ${SEP("─", 12)} ${SEP("─", 18)} ${SEP("─", 18)} ${SEP("─", 18)} ${SEP("─", 8)}`,
    );

    for (const sloc of Object.keys(slocTotals).sort()) {
        const t = slocTotals[sloc];
        const variance = t.bookVal - t.stockVal;
        const varPct = t.bookVal !== 0 ? (variance / t.bookVal) * 100 : 0;
        L(
            `  ${PAD(sloc, 10)} ${PADR(t.items, 7)} ${PADR(FMT(t.bookQty), 12)} ${PADR(FMT(t.stockQty), 12)} ${PADR(FMT(t.bookQty - t.stockQty), 12)} ${PADR(FMT(t.bookVal), 18)} ${PADR(FMT(t.stockVal), 18)} ${PADR(FMT(variance), 18)} ${PADR(varPct.toFixed(1) + "%", 8)}`,
        );
    }

    L(
        `  ${SEP("═", 10)} ${SEP("═", 7)} ${SEP("═", 12)} ${SEP("═", 12)} ${SEP("═", 12)} ${SEP("═", 18)} ${SEP("═", 18)} ${SEP("═", 18)} ${SEP("═", 8)}`,
    );
    L(
        `  ${PAD("GRAND", 10)} ${PADR(detailRows.length, 7)} ${PADR(FMT(grandBookQty), 12)} ${PADR(FMT(grandStockQty), 12)} ${PADR(FMT(grandBookQty - grandStockQty), 12)} ${PADR(FMT(grandBookVal), 18)} ${PADR(FMT(grandStockVal), 18)} ${PADR(FMT(grandVariance), 18)} ${PADR(grandVariancePct.toFixed(1) + "%", 8)}`,
    );
    L();

    // ── Detail by SLOC → Material ─────────────────────────────────────────
    L("  DETAIL — Book vs Stock per Material per SLOC");
    L(SEP("─", W));

    let currentSloc = null;
    for (const r of detailRows) {
        if (r.sloc !== currentSloc) {
            if (currentSloc !== null) L();
            currentSloc = r.sloc;
            L(`  ┌─ SLOC: ${r.sloc} ${"─".repeat(W - 15 - r.sloc.length)}┐`);
            L(
                `  │ ${PAD("Material ID", 14)} ${PAD("Description", 30)} ${PAD("Type", 8)} ${PADR("Price", 12)} ${PADR("Book Qty", 10)} ${PADR("Stock Qty", 10)} ${PADR("Qty Var", 10)} ${PADR("Book Val", 16)} ${PADR("Stock Val", 16)} ${PADR("Variance", 16)}`,
            );
            L(
                `  │ ${SEP("─", 14)} ${SEP("─", 30)} ${SEP("─", 8)} ${SEP("─", 12)} ${SEP("─", 10)} ${SEP("─", 10)} ${SEP("─", 10)} ${SEP("─", 16)} ${SEP("─", 16)} ${SEP("─", 16)}`,
            );
        }

        const varMark = r.variance > 0 ? " ▲" : r.variance < 0 ? " ▼" : "  ";
        L(
            `  │ ${PAD(r.matId, 14)} ${PAD(r.description.substring(0, 28), 30)} ${PAD(r.type, 8)} ${PADR(FMT(r.price), 12)} ${PADR(FMT(r.bookQty), 10)} ${PADR(FMT(r.stockQty), 10)} ${PADR(FMT(r.qtyVariance), 10)} ${PADR(FMT(r.bookVal), 16)} ${PADR(FMT(r.stockVal), 16)} ${PADR(FMT(r.variance), 16)}${varMark}`,
        );
    }
    if (currentSloc !== null) {
        L(`  └${"─".repeat(W - 3)}┘`);
    }
    L();

    // ── Variance Flags ────────────────────────────────────────────────────
    const overages = detailRows
        .filter((r) => r.variance > 0)
        .sort((a, b) => b.variance - a.variance);
    const shortages = detailRows
        .filter((r) => r.variance < 0)
        .sort((a, b) => a.variance - b.variance);

    if (overages.length > 0) {
        L("  TOP OVERAGES (Book > Stock — potential write-downs)");
        L(SEP("─", W));
        L(
            `  ${PAD("SLOC", 10)} ${PAD("Material", 14)} ${PAD("Description", 30)} ${PADR("Book Qty", 10)} ${PADR("Stock Qty", 10)} ${PADR("Variance", 16)}`,
        );
        for (const r of overages.slice(0, 10)) {
            L(
                `  ${PAD(r.sloc, 10)} ${PAD(r.matId, 14)} ${PAD(r.description.substring(0, 28), 30)} ${PADR(FMT(r.bookQty), 10)} ${PADR(FMT(r.stockQty), 10)} ${PADR(FMT(r.variance), 16)}`,
            );
        }
        L();
    }

    if (shortages.length > 0) {
        L("  TOP SHORTAGES (Stock > Book — potential unrecorded receipts)");
        L(SEP("─", W));
        L(
            `  ${PAD("SLOC", 10)} ${PAD("Material", 14)} ${PAD("Description", 30)} ${PADR("Book Qty", 10)} ${PADR("Stock Qty", 10)} ${PADR("Variance", 16)}`,
        );
        for (const r of shortages.slice(0, 10)) {
            L(
                `  ${PAD(r.sloc, 10)} ${PAD(r.matId, 14)} ${PAD(r.description.substring(0, 28), 30)} ${PADR(FMT(r.bookQty), 10)} ${PADR(FMT(r.stockQty), 10)} ${PADR(FMT(r.variance), 16)}`,
            );
        }
        L();
    }

    // ── Materials with no price ───────────────────────────────────────────
    const noPriceRows = detailRows.filter((r) => r.price === 0);
    if (noPriceRows.length > 0) {
        L("  WARNING — Materials with no Standard Price in Material Master");
        L(SEP("─", W));
        for (const r of noPriceRows) {
            L(
                `    SLOC: ${r.sloc}  Material: ${r.matId}  Book Qty: ${r.bookQty}  Stock Qty: ${r.stockQty}`,
            );
        }
        L();
    }

    L(SEP("═", W));
    L("  END OF INVENTORY VALUATION REPORT");
    L(SEP("═", W));

    // ── Print to console ──────────────────────────────────────────────────
    const output = lines.join("\n");
    console.log(output);

    // ── Save to file ──────────────────────────────────────────────────────
    const d = now;
    const yr = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, "0");
    const dy = String(d.getDate()).padStart(2, "0");
    const dir = path.join(__dirname, "logs", String(yr), mo, dy);
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `inventory-report-${Date.now()}.txt`);
    fs.writeFileSync(filePath, output, "utf8");
    console.log(`\n  Report saved to: ${filePath}\n`);
}

// ─── Run ──────────────────────────────────────────────────────────────────────
generateInventoryReport()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error("Report failed:", err);
        process.exit(1);
    });
