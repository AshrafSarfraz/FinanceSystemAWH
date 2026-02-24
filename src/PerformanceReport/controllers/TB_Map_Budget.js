// controllers/trialBalance.controller.js
const mongoose = require("mongoose");

/**
 * Normalize any string field so mapping ignores:
 * - leading/trailing spaces
 * - all internal whitespace
 * - case differences
 */
function normalize(v) {
  return String(v ?? "")
    .trim()
    .replace(/\s+/g, "") // remove ALL whitespace
    .toLowerCase();
}

/**
 * ✅ FIXED KEY:
 * - cc2 ignored
 * - typeR ignored
 * - all string fields normalized (spaces/case ignored)
 */
function makeKey(x) {
  return [
    Number(x.year),
    Number(x.month),
    normalize(x.accountno),
    normalize(x.company),
    normalize(x.component),
    normalize(x.cc3),
    normalize(x.auxcode),
    normalize(x.accountType),
  ].join("|");
}

async function getTrialBalanceData(req, res) {
  try {
    const db = mongoose.connection.db;
    const collection = db.collection("TrailBalance");
    const budgetCol = db.collection("BudgtedAmount");

    const {
      year,
      month,
      company,
      accountType,
      accountno,
      component,
      auxcode,
      cc2, // optional filter
      cc3,
      typeR, // optional filter
      limit = 5000,
      skip = 0,
    } = req.query;

    const safeLimit = Math.min(Math.max(Number(limit) || 5000, 1), 50000);
    const safeSkip = Math.max(Number(skip) || 0, 0);

    // Base filters for TrialBalance
    const base = {};
    if (year !== undefined && year !== "") base.year = Number(year);
    if (company) base.company = String(company);
    if (accountType) base.accountType = String(accountType);
    if (component) base.component = String(component);
    if (accountno) base.accountno = String(accountno);
    if (auxcode !== undefined) base.auxcode = String(auxcode);
    if (cc2 !== undefined && cc2 !== "") base.cc2 = String(cc2);
    if (cc3 !== undefined && cc3 !== "") base.cc3 = String(cc3);
    if (typeR) base.typeR = String(typeR);

    const monthNum = month !== undefined && month !== "" ? Number(month) : null;
    const dbQuery = { ...base };
    if (monthNum) dbQuery.month = monthNum;

    // Fetch TrialBalance rows
    const trialRows = await collection
      .find(dbQuery)
      .skip(safeSkip)
      .limit(safeLimit)
      .toArray();

    // Fetch Budget rows
    const budgetMatch = { ...base };
    if (monthNum) budgetMatch.month = monthNum;
    const budgets = await budgetCol.find(budgetMatch).toArray();

    // Build key map for exact match
    const budgetMap = new Map();
    for (const b of budgets) {
      const key = makeKey({
        year: b.year,
        month: b.month,
        accountno: b.accountno,
        company: b.company,
        component: b.component,
        cc3: b.cc3 || "",
        auxcode: b.auxcode || "",
        accountType: b.accountType,
      });
      const prev = budgetMap.get(key) || 0;
      budgetMap.set(key, prev + (Number(b.budgetedAmount) || 0));
    }

    // Attach budget to trial rows (exact match)
    const withBudget = trialRows.map((x) => {
      const key = makeKey(x);
      return {
        ...x,
        budgetedAmount: Number(budgetMap.get(key) || 0),
      };
    });

    // ✅ Handle unmatched budgets
    for (const b of budgets) {
      const exactKey = makeKey(b);
      // Skip if already attached
      if (budgetMap.has(exactKey) && withBudget.some(x => makeKey(x) === exactKey)) continue;

      // Partial match: company + accountType + component + year + month
      const partialRow = withBudget.find(
        x =>
          x.company === b.company &&
          x.accountType === b.accountType &&
          x.component === b.component &&
          x.year === b.year &&
          x.month === b.month
      );

      if (partialRow) {
        // Attach budget to partial match row
        partialRow.budgetedAmount += Number(b.budgetedAmount || 0);
      } else {
        // No match at all → create new row
        withBudget.push({
          year: b.year,
          month: b.month,
          accountno: b.accountno || "Unknown",
          company: b.company,
          component: b.component,
          accountType: b.accountType,
          cc2: b.cc2 || "",
          cc3: b.cc3 || "",
          auxcode: b.auxcode || "",
          balanceFirst: 0,
          budgetedAmount: Number(b.budgetedAmount || 0),
          note: "Added from budget only",
        });
      }
    }

    // Sort final result
    withBudget.sort((a, b) => {
      const ay = Number(a.year) || 0;
      const by = Number(b.year) || 0;
      if (ay !== by) return by - ay;

      const am = Number(a.month) || 0;
      const bm = Number(b.month) || 0;
      if (am !== bm) return bm - am;

      return String(a.accountno ?? "").localeCompare(String(b.accountno ?? ""));
    });

    return res.json({
      success: true,
      count: withBudget.length,
      data: withBudget,
    });
  } catch (err) {
    console.error("getTrialBalanceData error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Server error",
    });
  }
}

module.exports = { getTrialBalanceData };


// // controllers/trialBalance.controller.js
// const mongoose = require("mongoose");

// /**
//  * Normalize any string field so mapping ignores:
//  * - leading/trailing spaces
//  * - all internal whitespace
//  * - case differences
//  */
// function normalize(v) {
//   return String(v ?? "")
//     .trim()
//     .replace(/\s+/g, "") // remove ALL whitespace
//     .toLowerCase();
// }

// /**
//  * ✅ FIXED KEY:
//  * - cc2 ignored
//  * - typeR ignored
//  * - all string fields normalized (spaces/case ignored)
//  */
// function makeKey(x) {
//   return [
//     Number(x.year),
//     Number(x.month),
//     normalize(x.accountno),
//     normalize(x.company),
//     normalize(x.component),
//     normalize(x.cc3),
//     normalize(x.auxcode),
//     normalize(x.accountType),
//   ].join("|");
// }

// async function getTrialBalanceData(req, res) {
//   try {
//     const db = mongoose.connection.db;
//     const collection = db.collection("TrailBalance");
//     const budgetCol = db.collection("BudgtedAmount");

//     const {
//       year,
//       month,
//       company,
//       accountType,
//       accountno,
//       component,
//       auxcode,
//       cc2, // accepted as filter if you want, but NOT used in mapping key
//       cc3,
//       typeR, // accepted as filter if you want, but NOT used in mapping key
//       limit = 5000,
//       skip = 0,
//     } = req.query;

//     const safeLimit = Math.min(Math.max(Number(limit) || 5000, 1), 50000);
//     const safeSkip = Math.max(Number(skip) || 0, 0);

//     // ✅ Base filters (for DB query)
//     const base = {};
//     if (year !== undefined && year !== "") base.year = Number(year);
//     if (company) base.company = String(company);
//     if (accountType) base.accountType = String(accountType);
//     // if (accountno) base.accountno = String(accountno);
//     if (component) base.component = String(component);
//     if (auxcode !== undefined) base.auxcode = String(auxcode);
//     if (cc2 !== undefined && cc2 !== "") base.cc2 = String(cc2); // optional filter
//     if (cc3 !== undefined && cc3 !== "") base.cc3 = String(cc3);
//     if (typeR) base.typeR = String(typeR); // optional filter

//     const monthNum = month !== undefined && month !== "" ? Number(month) : null;

//     // ✅ Trial Balance query
//     const dbQuery = { ...base };
//     if (monthNum) dbQuery.month = monthNum;

//     const docs = await collection
//       .find(dbQuery)
//       .skip(safeSkip)
//       .limit(safeLimit)
//       .toArray();

//     // ✅ Budget query (same filters)
//     const budgetMatch = { ...base };
//     if (monthNum) budgetMatch.month = monthNum;

//     const budgets = await budgetCol.find(budgetMatch).toArray();

//     // ✅ Build budget map (sum duplicates)
//     const budgetMap = new Map();

//     for (const b of budgets) {
//       const key = makeKey({
//         year: b.year,
//         month: b.month,
//         accountno: b.accountno,
//         company: b.company,
//         component: b.component,
//         cc3: b.cc3 || "",
//         auxcode: b.auxcode || "",
//         accountType: b.accountType,
//         // cc2 ignored
//         // typeR ignored
//       });

//       const prev = budgetMap.get(key) || 0;
//       budgetMap.set(key, prev + (Number(b.budgetedAmount) || 0));
//     }

//     // ✅ Attach budget to each trial row
//     const withBudget = docs.map((x) => {
//       const key = makeKey(x);
//       return {
//         ...x,
//         budgetedAmount: Number(budgetMap.get(key) || 0),
//       };
//     });

//     // ✅ Sort
//     withBudget.sort((a, b) => {
//       const ay = Number(a.year) || 0;
//       const by = Number(b.year) || 0;
//       if (ay !== by) return by - ay;

//       const am = Number(a.month) || 0;
//       const bm = Number(b.month) || 0;
//       if (am !== bm) return bm - am;

//       return String(a.accountno ?? "").localeCompare(String(b.accountno ?? ""));
//     });

//     return res.json({
//       success: true,
//       count: withBudget.length,
//       data: withBudget,
//     });
//   } catch (err) {
//     console.error("getTrialBalanceData error:", err);
//     return res.status(500).json({
//       success: false,
//       message: err.message || "Server error",
//     });
//   }
// }

// module.exports = { getTrialBalanceData };