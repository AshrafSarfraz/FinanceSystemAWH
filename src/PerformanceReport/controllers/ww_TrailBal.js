// controllers/trialBalance.controller.js
const mongoose = require("mongoose");

const COST_YEARLY_VIEW_TYPE = "YEARLY_COST_VIEW";

function makeKey(x) {
  // stable key (includes year)
  return [
    Number(x.year),
    Number(x.month),
    String(x.accountno ?? ""),
    String(x.company ?? ""),
    String(x.component ?? ""),
    String(x.cc2 ?? ""),
    String(x.cc3 ?? ""),
    String(x.auxcode ?? ""),
    String(x.accountType ?? ""),
    String(x.typeR ?? "P"),
  ].join("|");
}

// same key but WITHOUT year (for grouping same entry across years)
function makeKeyNoYear(x) {
  return [
    Number(x.month),
    String(x.accountno ?? ""),
    String(x.company ?? ""),
    String(x.component ?? ""),
    String(x.cc2 ?? ""),
    String(x.cc3 ?? ""),
    String(x.auxcode ?? ""),
    String(x.accountType ?? ""),
    String(x.typeR ?? "P"),
  ].join("|");
}

async function getTrialBalanceData(req, res) {
  try {
    const db = mongoose.connection.db;
    const collection = db.collection("westwalk_trialBal");
    const budgetCol = db.collection("BudgtedAmount");

    const {
      year,
      month,
      company,
      accountType,
      accountno,
      component,
      auxcode,
      cc2,
      cc3,
      typeR,
      limit = 5000,
      skip = 0,
    } = req.query;

    const safeLimit = Math.min(Math.max(Number(limit) || 5000, 1), 50000);
    const safeSkip = Math.max(Number(skip) || 0, 0);

    const base = {};
    if (company) base.company = String(company);
    if (accountType) base.accountType = String(accountType);
    if (accountno) base.accountno = String(accountno);
    if (component) base.component = String(component);
    if (auxcode !== undefined) base.auxcode = String(auxcode);
    if (cc2 !== undefined && cc2 !== "") base.cc2 = String(cc2);
    if (cc3 !== undefined && cc3 !== "") base.cc3 = String(cc3);
    if (typeR) base.typeR = String(typeR);

    const monthNum = month !== undefined && month !== "" ? Number(month) : null;

    // ✅ year handling: fetch current year + previous year
    const currYear = year !== undefined && year !== "" ? Number(year) : null;
    const prevYear = currYear !== null ? currYear - 1 : null;

    const yearsToFetch = [];
    if (currYear !== null) yearsToFetch.push(currYear);
    if (prevYear !== null) yearsToFetch.push(prevYear);

    const dbQuery = {
      ...base,
      ...(yearsToFetch.length ? { year: { $in: yearsToFetch } } : {}),
      $or: [
        { month: { $gte: 1, $lte: 12 } },
        { month: 0, viewType: COST_YEARLY_VIEW_TYPE, accountType: "Cost" },
      ],
    };

    const docs = await collection
      .find(dbQuery)
      .skip(safeSkip)
      .limit(safeLimit)
      .toArray();

    const out = [];

    for (const d of docs) {
      const isCostYearly =
        d &&
        d.accountType === "Cost" &&
        d.month === 0 &&
        d.viewType === COST_YEARLY_VIEW_TYPE &&
        Array.isArray(d.totalBalances) &&
        d.totalBalances.length === 12;

      if (!isCostYearly) {
        out.push({
          accountno: d.accountno,
          auxcode: d.auxcode || "",
          company: d.company,
          component: d.component,
          cc2: d.cc2 ?? "", // keep null/"" consistent if you want
          cc3: d.cc3 ?? "",
          balanceFirst: Number(d.balanceFirst) || 0,
          year: Number(d.year),
          month: Number(d.month),
          accountType: d.accountType,
          typeR: d.typeR || "P",
        });
        continue;
      }

      // expand cost yearly
      for (let i = 0; i < 12; i++) {
        out.push({
          accountno: d.accountno,
          auxcode: d.auxcode || "",
          company: d.company,
          component: d.component,
          cc2: d.cc2 ?? "",
          cc3: d.cc3 ?? "",
          balanceFirst: Number(d.totalBalances[i]) || 0,
          year: Number(d.year),
          month: i + 1,
          accountType: "Cost",
          typeR: d.typeR || "P",
        });
      }
    }

    // month filter after expansion
    const filtered = monthNum ? out.filter((x) => x.month === monthNum) : out;

    // ✅ show only current year rows in output (like you want)
    const currentRows =
      currYear !== null ? filtered.filter((x) => Number(x.year) === currYear) : filtered;

    // ---------------------------
    // ✅ Build map for previous year balanceFirst
    // key: (month + dims WITHOUT year) + year => easiest by using makeKey() on prev-row
    // We'll build a map from full key (including year) -> balanceFirst
    // ---------------------------
    const balanceByYearKey = new Map();
    for (const r of filtered) {
      // full key includes year
      const k = makeKey(r);
      balanceByYearKey.set(k, (balanceByYearKey.get(k) || 0) + (Number(r.balanceFirst) || 0));
    }

    // ---- ✅ Budget fetch + map (same filters, fetch both years too)
    const budgetMatch = {
      ...base,
      ...(yearsToFetch.length ? { year: { $in: yearsToFetch } } : {}),
    };
    if (monthNum) budgetMatch.month = monthNum;

    const budgets = await budgetCol.find(budgetMatch).toArray();

    const budgetMap = new Map();
    for (const b of budgets) {
      const key = makeKey({
        year: b.year,
        month: b.month,
        accountno: b.accountno,
        company: b.company,
        component: b.component,
        cc2: b.cc2 ?? "",
        cc3: b.cc3 ?? "",
        auxcode: b.auxcode ?? "",
        accountType: b.accountType,
        typeR: b.typeR || "P",
      });

      const prev = budgetMap.get(key) || 0;
      budgetMap.set(key, prev + (Number(b.budgetedAmount) || 0));
    }

    // attach budget + prevYearMonthBalanceFirst
    const withBudget = currentRows.map((x) => {
      const key = makeKey(x);

      // previous year same month same entry:
      const prevKey = makeKey({ ...x, year: Number(x.year) - 1 });

      return {
        ...x,
        budgetedAmount: Number(budgetMap.get(key) || 0),

        // ✅ THIS is what you asked
        previousyearmonthbalanceFirst: Number(balanceByYearKey.get(prevKey) || 0),

        // (optional) if you also want prevYear budget:
        // previousyearmonthbudgetedAmount: Number(budgetMap.get(prevKey) || 0),
      };
    });

    // Sort
    withBudget.sort((a, b) => {
      if (a.year !== b.year) return b.year - a.year;
      if (a.month !== b.month) return a.month - b.month;
      return String(a.accountno).localeCompare(String(b.accountno));
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

// const COST_YEARLY_VIEW_TYPE = "YEARLY_COST_VIEW";

// function makeKey(x) {
//   // budget match karne ke liye stable key
//   return [
//     Number(x.year),
//     Number(x.month),
//     String(x.accountno ?? ""),
//     String(x.company ?? ""),
//     String(x.component ?? ""),
//     String(x.cc2 ?? ""),
//     String(x.cc3 ?? ""),
//     String(x.auxcode ?? ""),
//     String(x.accountType ?? ""),
//     String(x.typeR ?? "P"),
//   ].join("|");
// }

// async function getTrialBalanceData(req, res) {
//   try {
//     const db = mongoose.connection.db;
//     const collection = db.collection("westwalk_trialBal");
//     const budgetCol = db.collection("BudgtedAmount");

//     const {
//       year,
//       month,
//       company,
//       accountType,
//       accountno,
//       component,
//       auxcode,
//       cc2,
//       cc3,
//       typeR,
//       limit = 5000,
//       skip = 0,
//     } = req.query;

//     const safeLimit = Math.min(Math.max(Number(limit) || 5000, 1), 50000);
//     const safeSkip = Math.max(Number(skip) || 0, 0);

//     const base = {};
//     if (year !== undefined && year !== "") base.year = Number(year);
//     if (company) base.company = String(company);
//     if (accountType) base.accountType = String(accountType);
//     if (accountno) base.accountno = String(accountno);
//     if (component) base.component = String(component);
//     if (auxcode !== undefined) base.auxcode = String(auxcode);
//     if (cc2 !== undefined && cc2 !== "") base.cc2 = String(cc2);
//     if (cc3 !== undefined && cc3 !== "") base.cc3 = String(cc3);
//     if (typeR) base.typeR = String(typeR);

//     const monthNum = month !== undefined && month !== "" ? Number(month) : null;

//     const dbQuery = {
//       ...base,
//       $or: [
//         { month: { $gte: 1, $lte: 12 } },
//         { month: 0, viewType: COST_YEARLY_VIEW_TYPE, accountType: "Cost" },
//       ],
//     };

//     const docs = await collection
//       .find(dbQuery)
//       .skip(safeSkip)
//       .limit(safeLimit)
//       .toArray();

//     const out = [];

//     for (const d of docs) {
//       const isCostYearly =
//         d &&
//         d.accountType === "Cost" &&
//         d.month === 0 &&
//         d.viewType === COST_YEARLY_VIEW_TYPE &&
//         Array.isArray(d.totalBalances) &&
//         d.totalBalances.length === 12;

//       if (!isCostYearly) {
//         out.push({
//           accountno: d.accountno,
//           auxcode: d.auxcode || "",
//           company: d.company,
//           component: d.component,
//           cc2: d.cc2 || "",
//           cc3: d.cc3 || "",
//           balanceFirst: Number(d.balanceFirst) || 0,
//           year: Number(d.year),
//           month: Number(d.month),
//           accountType: d.accountType,
//           typeR: d.typeR || "P",
//         });
//         continue;
//       }

//       // expand cost yearly
//       for (let i = 0; i < 12; i++) {
//         out.push({
//           accountno: d.accountno,
//           auxcode: d.auxcode || "",
//           company: d.company,
//           component: d.component,
//           cc2: d.cc2 || "",
//           cc3: d.cc3 || "",
//           balanceFirst: Number(d.totalBalances[i]) || 0,
//           year: Number(d.year),
//           month: i + 1,
//           accountType: "Cost",
//           typeR: d.typeR || "P",
//         });
//       }
//     }

//     // month filter after expansion
//     const filtered = monthNum ? out.filter((x) => x.month === monthNum) : out;

//     // ---- ✅ Budget fetch + map (same filters)
//     const budgetMatch = { ...base };
//     // BudgtedAmount me month string/number jo bhi hai, hum numeric handle karte
//     if (monthNum) budgetMatch.month = monthNum;

//     const budgets = await budgetCol.find(budgetMatch).toArray();

//     // build budget map (sum if duplicates)
//     const budgetMap = new Map();
//     for (const b of budgets) {
//       const key = makeKey({
//         year: b.year,
//         month: b.month,
//         accountno: b.accountno,
//         company: b.company,
//         component: b.component,
//         cc2: b.cc2 || "",
//         cc3: b.cc3 || "",
//         auxcode: b.auxcode || "",
//         accountType: b.accountType,
//         typeR: b.typeR || "P",
//       });

//       const prev = budgetMap.get(key) || 0;
//       budgetMap.set(key, prev + (Number(b.budgetedAmount) || 0));
//     }

//     // attach budget to each row
//     const withBudget = filtered.map((x) => {
//       const key = makeKey(x);
//       return {
//         ...x,
//         budgetedAmount: Number(budgetMap.get(key) || 0),
//         // agar tum "budget" naam chahte ho:
//         // budget: Number(budgetMap.get(key) || 0),
//       };
//     });

//     // Sort
//     withBudget.sort((a, b) => {
//       if (a.year !== b.year) return b.year - a.year;
//       if (a.month !== b.month) return a.month - b.month;
//       return String(a.accountno).localeCompare(String(b.accountno));
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
