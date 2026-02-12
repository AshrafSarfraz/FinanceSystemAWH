// controllers/syncTrialBalanceWithMP.controller.js
const mongoose = require("mongoose");

let fetchFn = global.fetch;
if (!fetchFn) fetchFn = require("node-fetch");

const { westwalkAccountSet } = require("../utils/typeP_Accounts");
const accountMetaMap = require("../utils/accountMaping");

// ================= CONFIG =================
const BASE_URL = process.env.BASE_URL;
const FIXED_USERNAME = "MagedS";
const FIXED_CMPSEQ = 0;
const PAGEINDEX = process.env.DOLPH_PAGEINDEX;

// ✅ MP/SALARY accounts (ONLY MP depends on these)
const MP_SALARY_ACCOUNTS = new Set([
  "61101",
  "61103",
  "61104",
  "61105",
  "61106",
  "61115",
  "61116",
  "64101",
  "64105",
  "64121",
]);

const MP_SPLIT_PERCENTAGES = {
  "West Walk Real Estate": 0.22,
  "Assets Services Company": 0.6851,
  "West Walk Advertisement": 0.0949,
};

// ✅ Assets Services Company MP Sub-split (frontend-like)
const ASC_MP_SUBSPLIT = [
  { name: "HouseKeeping-MP", percent: 0.435 },
  { name: "Maintaince-MP", percent: 0.405 },
  { name: "Security-MP", percent: 0.12 },
  { name: "Store-MP", percent: 0.03 },
  { name: "Landscape", percent: 0.01 },
];

// synthetic MP monthly sum account
const MP_SUM_ACCOUNTNO = "MP_SUM";

// ✅ mark for cost yearly view docs INSIDE SAME collection
const COST_YEARLY_VIEW_TYPE = "YEARLY_COST_VIEW";

// ================= HELPERS =================
function pickTrialBalanceFields(r) {
  return {
    year: r.year,
    month: r.month,
    typeR: r.typeR,
    accountno: r.accountno,
    auxcode: r.auxcode,
    cc2: r.cc2,
    cc3: r.cc3,
    balanceFirst: r.balanceFirst,
  };
}

const round2 = (n) => Math.round(Number(n) * 100) / 100;
const isValidMonth = (m) => typeof m === "number" && m >= 1 && m <= 12;
const sumArr = (arr) =>
  (arr || []).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);

/**
 * ✅ MP row detection: ONLY by accountno list
 */
function isMpSalaryRow(d) {
  return MP_SALARY_ACCOUNTS.has(String(d.accountno));
}

// ================= ✅ REVENUE FIX (FRONTEND-LIKE) =================
// Apply BEFORE saving (so frontend/backend match)
function applyFixToRow(r) {
  const isRevenue =
    String(r.accountType || "").trim().toLowerCase() === "revenue";
  const acc = String(r.accountno || "").trim();
  const cc2 = String(r.cc2 || "").trim().toLowerCase();

  if (isRevenue && acc === "41112" && cc2 === "residential rental") {
    return { ...r, component: "Residential", accountno: "41111" };
  }
  return r;
}

// ================= DOLPHIN LOGIN =================
async function dolphinLogin() {
  const res = await fetchFn(`${BASE_URL}/Authentication/Dolph_Login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ pageindex: PAGEINDEX }),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(text);

  const data = JSON.parse(text);

  const rawCookie = res.headers.get("set-cookie");
  const cookie = rawCookie ? rawCookie.split(";")[0] : null;

  return { authkey: data.authkey, cookie };
}

// ================= FETCH TRIAL BALANCE =================
async function fetchTrialBalance(authkey, cookie) {
  const payload = {
    filter: " ",
    take: 0,
    skip: 0,
    sort: " ",
    parameters: {
      cmpseq: FIXED_CMPSEQ,
      accountno: "",
      year: 0,
      month: 0,
      cc3: "",
      cc2: "",
      typeR: "P",
    },
  };

  const res = await fetchFn(`${BASE_URL}/externaltrialbalance/gettrialbalance`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authentication: authkey,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(text);

  return JSON.parse(text);
}

// ================= FILTER + ENRICH =================
function filterAndEnrich(rows) {
  return rows
    .filter((r) => {
      const acc = Number(r.accountno);
      return (
        String(r.typeR).toUpperCase() === "P" &&
        Number(r.year) >= 2023 &&
        westwalkAccountSet.has(acc)
      );
    })
    .map((r) => {
      const picked = pickTrialBalanceFields(r);
      const meta = accountMetaMap[String(picked.accountno)] || {};

      return {
        ...picked,
        balanceFirst: Number(picked.balanceFirst) * -1, // ✅ flip
        company: meta.company || "Unknown",
        component: meta.component || "Unknown",
        accountType: meta.type || "Unknown", // "Revenue" | "Cost"
        auxcode: picked.auxcode ? String(picked.auxcode) : "",
        cc2: picked.cc2 ? String(picked.cc2) : "",
        cc3: picked.cc3 ? String(picked.cc3) : "",
        syncedAt: new Date(),
      };
    });
}

// ================= MP CLUB (MONTHLY SUM) + SPLIT =================
// ✅ Split total MP by company percentages
// ✅ AND for "Assets Services Company" split into sub-components
function buildMpMonthlySplitRows(mpRows) {
  const totalsByYm = new Map(); // "YYYY-MM" => {year, month, total}

  for (const r of mpRows) {
    const year = Number(r.year);
    const month = Number(r.month);
    if (!year || !isValidMonth(month)) continue;

    const key = `${year}-${month}`;
    const prev = totalsByYm.get(key) || { year, month, total: 0 };
    prev.total += Number(r.balanceFirst) || 0;
    totalsByYm.set(key, prev);
  }

  const now = new Date();
  const out = [];

  for (const { year, month, total } of totalsByYm.values()) {
    for (const [companyName, pct] of Object.entries(MP_SPLIT_PERCENTAGES)) {
      const companyTotal = (Number(total) || 0) * (Number(pct) || 0);

      // ✅ Assets Services Company: sub-split BUT keep component ManPower, put split-name in auxcode
      if (companyName === "Assets Services Company") {
        for (const s of ASC_MP_SUBSPLIT) {
          out.push({
            year,
            month,
            typeR: "P",
            accountno: MP_SUM_ACCOUNTNO,
            auxcode: s.name,          // ✅ HERE
            cc2: "",
            cc3: "",
            company: companyName,
            component: "ManPower",    // ✅ FIXED
            accountType: "Cost",
            balanceFirst: round2(companyTotal * (Number(s.percent) || 0)),
            syncedAt: now,
          });
        }
        continue;
      }

      // ✅ other companies: single row, auxcode empty
      out.push({
        year,
        month,
        typeR: "P",
        accountno: MP_SUM_ACCOUNTNO,
        auxcode: "",               // (or "ManPower" if you want)
        cc2: "",
        cc3: "",
        company: companyName,
        component: "ManPower",
        accountType: "Cost",
        balanceFirst: round2(companyTotal),
        syncedAt: now,
      });
    }
  }

  return out;
}


// ================= ✅ COST FRONTEND-LIKE AGG (month=0) =================
function buildCostYearlyAggRows(costRowsOnly) {
  const byKey = new Map();

  for (const r of costRowsOnly) {
    const year = Number(r.year);
    const month = Number(r.month);
    if (!year || !isValidMonth(month)) continue;

    const company = String(r.company || "").trim();
    const component = String(r.component || "").trim();
    const accountno = String(r.accountno || "").trim();
    const auxcode = String(r.auxcode || "").trim();

    const key = `${year}||${company}||${accountno}||${auxcode}`;

    if (!byKey.has(key)) {
      byKey.set(key, {
        year,
        company,
        component,
        accountno,
        auxcode,
        balances: Array(12).fill(0),
      });
    }

    const obj = byKey.get(key);
    if (!obj.component && component) obj.component = component;

    obj.balances[month - 1] += Number(r.balanceFirst) || 0;
  }

  const withAux = [];
  const emptyAuxByComp = new Map();

  for (const obj of byKey.values()) {
    const component = String(obj.component || "").trim();
    const total = sumArr(obj.balances);

    if (obj.auxcode) {
      withAux.push({
        viewType: COST_YEARLY_VIEW_TYPE,
        typeR: "P",
        year: obj.year,
        month: 0,
        company: obj.company,
        component,
        accountType: "Cost",
        accountno: obj.accountno,
        auxcode: obj.auxcode,
        cc2: "",
        cc3: "",
        totalBalances: obj.balances.map((x) => round2(x)),
        totalSum: round2(total),
        balanceFirst: round2(total),
        syncedAt: new Date(),
      });
    } else {
      const mkey = `${obj.year}||${obj.company}||${component}`;
      if (!emptyAuxByComp.has(mkey)) {
        emptyAuxByComp.set(mkey, {
          viewType: COST_YEARLY_VIEW_TYPE,
          typeR: "P",
          year: obj.year,
          month: 0,
          company: obj.company,
          component,
          accountType: "Cost",
          auxcode: "",
          cc2: "",
          cc3: "",
          totalBalances: Array(12).fill(0),
          mergedAccountnos: new Set(),
          syncedAt: new Date(),
        });
      }
      const m = emptyAuxByComp.get(mkey);
      for (let i = 0; i < 12; i++) m.totalBalances[i] += obj.balances[i];
      if (obj.accountno) m.mergedAccountnos.add(obj.accountno);
    }
  }

  const mergedEmptyAux = Array.from(emptyAuxByComp.values()).map((m) => {
    const mergedList = Array.from(m.mergedAccountnos).sort().join(", ");
    const balances = m.totalBalances.map((x) => round2(x));
    const total = round2(sumArr(balances));

    return {
      viewType: COST_YEARLY_VIEW_TYPE,
      typeR: "P",
      year: m.year,
      month: 0,
      company: m.company,
      component: m.component,
      accountType: "Cost",
      accountno: mergedList || "MERGED_EMPTYAUX",
      auxcode: "",
      cc2: "",
      cc3: "",
      totalBalances: balances,
      totalSum: total,
      balanceFirst: total,
      syncedAt: m.syncedAt,
    };
  });

  return [...withAux, ...mergedEmptyAux];
}

// ================= NEW: Expand cost yearly → 12 monthly rows =================
function expandCostYearlyToMonthly(costYearlyRows) {
  const out = [];

  for (const d of costYearlyRows) {
    if (
      String(d.accountType || "").toLowerCase() === "cost" &&
      Array.isArray(d.totalBalances) &&
      d.totalBalances.length === 12
    ) {
      for (let i = 0; i < 12; i++) {
        out.push({
          accountno: d.accountno,
          auxcode: d.auxcode || "",
          company: d.company,
          component: d.component,
          cc2: d.cc2 || "",
          cc3: d.cc3 || "",
          balanceFirst: Number(d.totalBalances[i]) || 0,
          year: Number(d.year),
          month: i + 1,
          accountType: "Cost",
          typeR: d.typeR || "P",
          syncedAt: new Date(),
        });
      }
    } else {
      out.push(d);
    }
  }

  return out;
}

// ================= SAVE TO DB =================
async function saveDirectToDB(data) {
  const db = mongoose.connection.db;
  const collection = db.collection("westwalk_trialBal");

  if (!data || data.length === 0) return 0;

  await collection.bulkWrite(
    data.map((d) => {
      // ✅ MP detection MUST be by accountno now
      const isMp = String(d.accountno) === MP_SUM_ACCOUNTNO;

      const isCostYearlyView =
        String(d.viewType || "") === COST_YEARLY_VIEW_TYPE &&
        Number(d.month) === 0 &&
        String(d.accountType).toLowerCase() === "cost";

      let filterKey = { year: d.year, month: d.month, accountno: d.accountno };

      if (isCostYearlyView) {
        filterKey.viewType = COST_YEARLY_VIEW_TYPE;
        filterKey.company = d.company;
        filterKey.component = d.component;
        filterKey.auxcode = d.auxcode || "";
      } else if (isMp) {
        filterKey.company = d.company;
        filterKey.component = d.component;
        filterKey.auxcode = d.auxcode || "";   // ✅ MUST
      } else {
        if (String(d.accountType).toLowerCase() === "revenue") {
          filterKey.cc3 = d.cc3 || "";
          filterKey.cc2 = d.cc2 || "";
        } else {
          filterKey.auxcode = d.auxcode || "";
        }
      }

      return {
        updateOne: {
          filter: filterKey,
          update: { $set: d },
          upsert: true,
        },
      };
    })
  );

  return data.length;
}

async function clearTrialBalanceCollection() {
  const db = mongoose.connection.db;
  const collection = db.collection("westwalk_trialBal");
  const res = await collection.deleteMany({});
  console.log(`🧹 Cleared old data: ${res.deletedCount} docs`);
}

// ================= MAIN SYNC FUNCTION =================
async function syncTrialBalance() {
  await clearTrialBalanceCollection();

  const { authkey, cookie } = await dolphinLogin();
  const rows = await fetchTrialBalance(authkey, cookie);

  // 1) Enrich
  const enriched = filterAndEnrich(rows);

  // 2) ✅ Apply revenue fix BEFORE saving (IMPORTANT)
  const enrichedFixed = enriched.map(applyFixToRow);

  // 3) Split MP vs normal
  const mpRows = enrichedFixed.filter(isMpSalaryRow);
  const normalOnly = enrichedFixed.filter((d) => !isMpSalaryRow(d));

  // 4) MP final rows (company split + ASC sub-split)
  const mpFinalRows = buildMpMonthlySplitRows(mpRows);

  // 5) Revenue + Cost
  const normalRevenue = normalOnly.filter(
    (r) => String(r.accountType).toLowerCase() === "revenue"
  );

  const normalCost = normalOnly.filter(
    (r) => String(r.accountType).toLowerCase() === "cost"
  );

  // 6) Build yearly cost aggregation, then expand into month=1..12
  const costYearlyAgg = buildCostYearlyAggRows(normalCost);
  const costMonthlyRows = expandCostYearlyToMonthly(costYearlyAgg);

  // 7) Save all
  const savedRevenue = await saveDirectToDB(normalRevenue);
  const savedMp = await saveDirectToDB(mpFinalRows);
  const savedCostMonthly = await saveDirectToDB(costMonthlyRows);

  console.log(
    `Sync done. enriched=${enrichedFixed.length} revSaved=${savedRevenue} mpOriginal=${mpRows.length} mpSplitSaved=${savedMp} costMonthlyInInput=${normalCost.length} costYearlyAggRows=${costYearlyAgg.length} costMonthlySaved=${savedCostMonthly}`
  );

  return {
    totalFetched: enrichedFixed.length,
    savedRevenue,
    mpRowsOriginal: mpRows.length,
    mpRowsAfterClubAndSplit: mpFinalRows.length,
    savedMpSplit: savedMp,
    costMonthlyRowsInput: normalCost.length,
    costYearlyAggRows: costYearlyAgg.length,
    savedCostMonthly,
  };
}

// ================= EXPORTS =================
module.exports = {
  FIXED_USERNAME,
  FIXED_CMPSEQ,
  dolphinLogin,
  fetchTrialBalance,
  filterAndEnrich,
  saveDirectToDB,
  syncTrialBalance,
};













// // controllers/syncTrialBalanceWithMP.controller.js
// const mongoose = require("mongoose");

// let fetchFn = global.fetch;
// if (!fetchFn) fetchFn = require("node-fetch");

// const { westwalkAccountSet } = require("../utils/typeP_Accounts");
// const accountMetaMap = require("../utils/accountMaping");

// // ================= CONFIG =================
// const BASE_URL = process.env.BASE_URL;
// const FIXED_USERNAME = "MagedS";
// const FIXED_CMPSEQ = 0;
// const PAGEINDEX = process.env.DOLPH_PAGEINDEX;

// // ✅ MP/SALARY accounts (ONLY MP depends on these)
// const MP_SALARY_ACCOUNTS = new Set([
//   "61101",
//   "61103",
//   "61104",
//   "61105",
//   "61106",
//   "61115",
//   "61116",
//   "64101",
//   "64105",
//   "64121",
// ]);

// const MP_COMPONENT_NAME = "Man Power / Salaries";

// const MP_SPLIT_PERCENTAGES = {
//   "West Walk Real Estate": 0.22,
//   "Assets Services Company": 0.6851,
//   "West Walk Advertisement": 0.0949,
// };

// const ASC_MP_SUBSPLIT = [
//   { name: "HouseKeeping-MP", percent: 0.435 },
//   { name: "Maintaince-MP",   percent: 0.405 },
//   { name: "Security-MP",     percent: 0.12  },
//   { name: "Store-MP",        percent: 0.03  },
//   { name: "Landscape",       percent: 0.01  },
// ];

// // synthetic MP monthly sum account
// const MP_SUM_ACCOUNTNO = "MP_SUM";

// // ✅ mark for cost yearly view docs INSIDE SAME collection
// const COST_YEARLY_VIEW_TYPE = "YEARLY_COST_VIEW";

// // ================= HELPERS =================
// function pickTrialBalanceFields(r) {
//   return {
//     year: r.year,
//     month: r.month,
//     typeR: r.typeR,
//     accountno: r.accountno,
//     auxcode: r.auxcode,
//     cc2: r.cc2,
//     cc3: r.cc3,
//     balanceFirst: r.balanceFirst,
//   };
// }

// const round2 = (n) => Math.round(Number(n) * 100) / 100;
// const isValidMonth = (m) => typeof m === "number" && m >= 1 && m <= 12;
// const sumArr = (arr) => (arr || []).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);

// /**
//  * ✅ MP row detection: ONLY by accountno list
//  */
// function isMpSalaryRow(d) {
//   return MP_SALARY_ACCOUNTS.has(String(d.accountno));
// }

// // ================= DOLPHIN LOGIN =================
// async function dolphinLogin() {
//   const res = await fetchFn(`${BASE_URL}/Authentication/Dolph_Login`, {
//     method: "POST",
//     headers: { "Content-Type": "application/json", Accept: "application/json" },
//     body: JSON.stringify({ pageindex: PAGEINDEX }),
//   });

//   const text = await res.text();
//   if (!res.ok) throw new Error(text);

//   const data = JSON.parse(text);

//   const rawCookie = res.headers.get("set-cookie");
//   const cookie = rawCookie ? rawCookie.split(";")[0] : null;

//   return { authkey: data.authkey, cookie };
// }

// // ================= FETCH TRIAL BALANCE =================
// async function fetchTrialBalance(authkey, cookie) {
//   const payload = {
//     filter: " ",
//     take: 0,
//     skip: 0,
//     sort: " ",
//     parameters: {
//       cmpseq: FIXED_CMPSEQ,
//       accountno: "",
//       year: 0,
//       month: 0,
//       cc3: "",
//       cc2: "",
//       typeR: "P",
//     },
//   };

//   const res = await fetchFn(`${BASE_URL}/externaltrialbalance/gettrialbalance`, {
//     method: "POST",
//     headers: {
//       "Content-Type": "application/json",
//       Accept: "application/json",
//       Authentication: authkey,
//       ...(cookie ? { Cookie: cookie } : {}),
//     },
//     body: JSON.stringify(payload),
//   });

//   const text = await res.text();
//   if (!res.ok) throw new Error(text);

//   return JSON.parse(text);
// }

// // ================= FILTER + ENRICH =================
// function filterAndEnrich(rows) {
//   return rows
//     .filter((r) => {
//       const acc = Number(r.accountno);
//       return (
//         String(r.typeR).toUpperCase() === "P" &&
//         Number(r.year) >= 2023 &&
//         westwalkAccountSet.has(acc)
//       );
//     })
//     .map((r) => {
//       const picked = pickTrialBalanceFields(r);
//       const meta = accountMetaMap[String(picked.accountno)] || {};

//       return {
//         ...picked,
//         balanceFirst: Number(picked.balanceFirst) * -1, // ✅ flip
//         company: meta.company || "Unknown",
//         component: meta.component || "Unknown",
//         accountType: meta.type || "Unknown", // "Revenue" | "Cost"
//         auxcode: picked.auxcode ? String(picked.auxcode) : "",
//         cc3: picked.cc3 ? String(picked.cc3) : "",
//         syncedAt: new Date(),
//       };
//     });
// }

// // ================= MP CLUB (MONTHLY SUM) + SPLIT =================
// // function buildMpMonthlySplitRows(mpRows) {
// //   const totalsByYm = new Map(); // key "YYYY-MM" => {year, month, total}

// //   for (const r of mpRows) {
// //     const year = Number(r.year);
// //     const month = Number(r.month);
// //     if (!year || !isValidMonth(month)) continue;

// //     const key = `${year}-${month}`;
// //     const prev = totalsByYm.get(key) || { year, month, total: 0 };
// //     prev.total += Number(r.balanceFirst) || 0;
// //     totalsByYm.set(key, prev);
// //   }

// //   const now = new Date();
// //   const out = [];

// //   for (const { year, month, total } of totalsByYm.values()) {
// //     for (const [companyName, pct] of Object.entries(MP_SPLIT_PERCENTAGES)) {
// //       out.push({
// //         year,
// //         month,
// //         typeR: "P",
// //         accountno: MP_SUM_ACCOUNTNO,
// //         auxcode: "",
// //         cc2: "",
// //         cc3: "",
// //         company: companyName,
// //         component: MP_COMPONENT_NAME,
// //         accountType: "Cost",
// //         balanceFirst: round2(total * pct),
// //         syncedAt: now,
// //       });
// //     }
// //   }

// //   return out;
// // }

// function buildMpMonthlySplitRows(mpRows) {
//   const totalsByYm = new Map(); // "YYYY-MM" => {year, month, total}

//   for (const r of mpRows) {
//     const year = Number(r.year);
//     const month = Number(r.month);
//     if (!year || !isValidMonth(month)) continue;

//     const key = `${year}-${month}`;
//     const prev = totalsByYm.get(key) || { year, month, total: 0 };
//     prev.total += Number(r.balanceFirst) || 0;
//     totalsByYm.set(key, prev);
//   }

//   const now = new Date();
//   const out = [];

//   for (const { year, month, total } of totalsByYm.values()) {
//     for (const [companyName, pct] of Object.entries(MP_SPLIT_PERCENTAGES)) {
//       const companyTotal = total * pct;

//       // ✅ Assets Services Company: split into sub-components
//       if (companyName === "Assets Services Company") {
//         for (const s of ASC_MP_SUBSPLIT) {
//           out.push({
//             year,
//             month,
//             typeR: "P",
//             accountno: MP_SUM_ACCOUNTNO,
//             auxcode: "",
//             cc2: "",
//             cc3: "",
//             company: companyName,
//             component: s.name,          // ✅ sub-component name
//             accountType: "Cost",
//             balanceFirst: round2(companyTotal * s.percent),
//             syncedAt: now,
//           });
//         }
//         continue;
//       }

//       // ✅ other companies: single MP row
//       out.push({
//         year,
//         month,
//         typeR: "P",
//         accountno: MP_SUM_ACCOUNTNO,
//         auxcode: "",
//         cc2: "",
//         cc3: "",
//         company: companyName,
//         component: "ManPower",         // (or keep MP_COMPONENT_NAME if you prefer)
//         accountType: "Cost",
//         balanceFirst: round2(companyTotal),
//         syncedAt: now,
//       });
//     }
//   }

//   return out;
// }


// // ================= ✅ COST FRONTEND-LIKE AGG (month=0) =================
// function buildCostYearlyAggRows(costRowsOnly) {
//   const byKey = new Map();

//   for (const r of costRowsOnly) {
//     const year = Number(r.year);
//     const month = Number(r.month);
//     if (!year || !isValidMonth(month)) continue;

//     const company = String(r.company || "").trim();
//     const component = String(r.component || "").trim();
//     const accountno = String(r.accountno || "").trim();
//     const auxcode = String(r.auxcode || "").trim();

//     const key = `${year}||${company}||${accountno}||${auxcode}`;

//     if (!byKey.has(key)) {
//       byKey.set(key, {
//         year,
//         company,
//         component,
//         accountno,
//         auxcode,
//         balances: Array(12).fill(0),
//       });
//     }

//     const obj = byKey.get(key);
//     if (!obj.component && component) obj.component = component;

//     obj.balances[month - 1] += Number(r.balanceFirst) || 0;
//   }

//   const withAux = [];
//   const emptyAuxByComp = new Map();

//   for (const obj of byKey.values()) {
//     const component = String(obj.component || "").trim();
//     const total = sumArr(obj.balances);

//     if (obj.auxcode) {
//       withAux.push({
//         viewType: COST_YEARLY_VIEW_TYPE,
//         typeR: "P",
//         year: obj.year,
//         month: 0,
//         company: obj.company,
//         component,
//         accountType: "Cost",
//         accountno: obj.accountno,
//         auxcode: obj.auxcode,
//         cc2: "",
//         cc3: "",
//         totalBalances: obj.balances.map((x) => round2(x)),
//         totalSum: round2(total),
//         balanceFirst: round2(total),
//         syncedAt: new Date(),
//       });
//     } else {
//       const mkey = `${obj.year}||${obj.company}||${component}`;
//       if (!emptyAuxByComp.has(mkey)) {
//         emptyAuxByComp.set(mkey, {
//           viewType: COST_YEARLY_VIEW_TYPE,
//           typeR: "P",
//           year: obj.year,
//           month: 0,
//           company: obj.company,
//           component,
//           accountType: "Cost",
//           auxcode: "",
//           cc2: "",
//           cc3: "",
//           totalBalances: Array(12).fill(0),
//           mergedAccountnos: new Set(),
//           syncedAt: new Date(),
//         });
//       }
//       const m = emptyAuxByComp.get(mkey);
//       for (let i = 0; i < 12; i++) m.totalBalances[i] += obj.balances[i];
//       if (obj.accountno) m.mergedAccountnos.add(obj.accountno);
//     }
//   }

//   const mergedEmptyAux = Array.from(emptyAuxByComp.values()).map((m) => {
//     const mergedList = Array.from(m.mergedAccountnos).sort().join(", ");
//     const balances = m.totalBalances.map((x) => round2(x));
//     const total = round2(sumArr(balances));

//     return {
//       viewType: COST_YEARLY_VIEW_TYPE,
//       typeR: "P",
//       year: m.year,
//       month: 0,
//       company: m.company,
//       component: m.component,
//       accountType: "Cost",
//       accountno: mergedList || "MERGED_EMPTYAUX",
//       auxcode: "",
//       cc2: "",
//       cc3: "",
//       totalBalances: balances,
//       totalSum: total,
//       balanceFirst: total,
//       syncedAt: m.syncedAt,
//     };
//   });

//   return [...withAux, ...mergedEmptyAux];
// }

// =
// function expandCostYearlyToMonthly(costYearlyRows) {
//   const out = [];

//   for (const d of costYearlyRows) {
//     if (
//       d.accountType === "Cost" &&
//       Array.isArray(d.totalBalances) &&
//       d.totalBalances.length === 12
//     ) {
//       // Start from month = 1
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
//           month: i + 1, // ✅ month starts at 1
//           accountType: "Cost",
//           typeR: d.typeR || "P",
//           syncedAt: new Date(),
//         });
//       }
//     } else {
//       out.push(d);
//     }
//   }

//   return out;
// }


// // ================= SAVE TO DB =================
// async function saveDirectToDB(data) {
//   const db = mongoose.connection.db;
//   const collection = db.collection("westwalk_trialBal");

//   if (!data || data.length === 0) return 0;

//   await collection.bulkWrite(
//     data.map((d) => {
//       // const isMp =
//       //   String(d.component).trim().toLowerCase() ===
//       //   String(MP_COMPONENT_NAME).trim().toLowerCase();
//       const isMp = String(d.accountno) === MP_SUM_ACCOUNTNO;

//       const isCostYearlyView =
//         String(d.viewType || "") === COST_YEARLY_VIEW_TYPE &&
//         Number(d.month) === 0 &&
//         String(d.accountType).toLowerCase() === "cost";

//       let filterKey = { year: d.year, month: d.month, accountno: d.accountno };

//       if (isCostYearlyView) {
//         filterKey.viewType = COST_YEARLY_VIEW_TYPE;
//         filterKey.company = d.company;
//         filterKey.component = d.component;
//         filterKey.auxcode = d.auxcode || "";
//       } else if (isMp) {
//         filterKey.company = d.company;
//         filterKey.component = d.component;
//       } else {
//         if (String(d.accountType).toLowerCase() === "revenue") {
//           filterKey.cc3 = d.cc3 || "";
//           filterKey.cc2 = d.cc2 || "";
//         } else {
//           filterKey.auxcode = d.auxcode;
//         }
//       }

//       return {
//         updateOne: {
//           filter: filterKey,
//           update: { $set: d },
//           upsert: true,
//         },
//       };
//     })
//   );

//   return data.length;
// }

// function applyFixToRow(r) {
//   const isRevenue = String(r.accountType || "").trim().toLowerCase() === "revenue";
//   const acc = String(r.accountno || "").trim();
//   const cc2 = String(r.cc2 || "").trim().toLowerCase();

//   if (isRevenue && acc === "41112" && cc2 === "residential rental") {
//     return { ...r, component: "Residential", accountno: "41111" };
//   }
//   return r;
// }


// async function fixAndSaveTrialBalanceSafely() {
//   const db = mongoose.connection.db;
//   const collection = db.collection("westwalk_trialBal");

//   const target = await collection
//     .find({
//       accountType: "Revenue",
//       accountno: "41112",
//       cc2: "Residential Rental",
//     })
//     .toArray();

//   if (!target.length) return 0;

//   const ops = target.map((r) => {
//     const fixed = applyFixToRow(r);
//     return {
//       updateOne: {
//         filter: {
//           year: r.year,
//           month: r.month,
//           accountno: r.accountno,
//           cc3: r.cc3,
//         },
//         update: { $set: fixed },
//       },
//     };
//   });

//   await collection.bulkWrite(ops);
//   return ops.length;
// }

// async function clearTrialBalanceCollection() {
//   const db = mongoose.connection.db;
//   const collection = db.collection("westwalk_trialBal");
//   const res = await collection.deleteMany({});
//   console.log(`🧹 Cleared old data: ${res.deletedCount} docs`);
// }

// // ================= MAIN SYNC FUNCTION =================
// async function syncTrialBalance() {
//   await clearTrialBalanceCollection();
//   const { authkey, cookie } = await dolphinLogin();
//   const rows = await fetchTrialBalance(authkey, cookie);

//   const enriched = filterAndEnrich(rows);

//   const mpRows = enriched.filter(isMpSalaryRow);
//   const normalOnly = enriched.filter((d) => !isMpSalaryRow(d));

//   const mpFinalRows = buildMpMonthlySplitRows(mpRows);

//   const normalRevenue = normalOnly.filter(
//     (r) => String(r.accountType).toLowerCase() === "revenue"
//   );

//   const normalCost = normalOnly.filter(
//     (r) => String(r.accountType).toLowerCase() === "cost"
//   );

//   // Build yearly cost aggregation
//   const costYearlyAgg = buildCostYearlyAggRows(normalCost);

//   // ✅ Expand month=0 yearly docs into 12 separate monthly rows
//   const costMonthlyRows = expandCostYearlyToMonthly(costYearlyAgg);

//   // Save all
//   const savedRevenue = await saveDirectToDB(normalRevenue);
//   const savedMp = await saveDirectToDB(mpFinalRows);
//   const savedCostMonthly = await saveDirectToDB(costMonthlyRows);

//   // Apply revenue fix
//   const fixedCount = await fixAndSaveTrialBalanceSafely();

//   console.log(
//     `Sync done. enriched=${enriched.length} revSaved=${savedRevenue} mpOriginal=${mpRows.length} mpSplitSaved=${savedMp} costMonthlyInInput=${normalCost.length} costYearlyAggRows=${costYearlyAgg.length} costMonthlySaved=${savedCostMonthly} fixed=${fixedCount}`
//   );

//   return {
//     totalFetched: enriched.length,
//     savedRevenue,
//     mpRowsOriginal: mpRows.length,
//     mpRowsAfterClubAndSplit: mpFinalRows.length,
//     savedMpSplit: savedMp,
//     costMonthlyRowsInput: normalCost.length,
//     costYearlyAggRows: costYearlyAgg.length,
//     savedCostMonthly: savedCostMonthly,
//     fixedCount,
//   };
// }

// // ================= EXPORTS =================
// module.exports = {
//   FIXED_USERNAME,
//   FIXED_CMPSEQ,
//   dolphinLogin,
//   fetchTrialBalance,
//   filterAndEnrich,
//   saveDirectToDB,
//   syncTrialBalance,
//   fixAndSaveTrialBalanceSafely,
// };









// // controllers/syncTrialBalanceWithMP.controller.js
// const mongoose = require("mongoose");

// let fetchFn = global.fetch;
// if (!fetchFn) fetchFn = require("node-fetch");

// const { westwalkAccountSet } = require("../utils/typeP_Accounts");
// const accountMetaMap = require("../utils/accountMaping");

// // ================= CONFIG =================
// const BASE_URL = process.env.BASE_URL;
// const FIXED_USERNAME = "MagedS";
// const FIXED_CMPSEQ = 0;
// const PAGEINDEX = process.env.DOLPH_PAGEINDEX;

// // ✅ MP/SALARY accounts (ONLY MP depends on these)
// const MP_SALARY_ACCOUNTS = new Set([
//   "61101",
//   "61103",
//   "61104",
//   "61105",
//   "61106",
//   "61115",
//   "61116",
//   "64101",
//   "64105",
//   "64121",
// ]);

// const MP_COMPONENT_NAME = "Man Power / Salaries";

// const MP_SPLIT_PERCENTAGES = {
//   "West Walk Real Estate": 0.22,
//   "Assets Services Company": 0.6851,
//   "West Walk Advertisement": 0.0949,
// };

// // synthetic MP monthly sum account
// const MP_SUM_ACCOUNTNO = "MP_SUM";

// // ✅ mark for cost yearly view docs INSIDE SAME collection
// const COST_YEARLY_VIEW_TYPE = "YEARLY_COST_VIEW";

// // ================= HELPERS =================
// function pickTrialBalanceFields(r) {
//   return {
//     year: r.year,
//     month: r.month,
//     typeR: r.typeR,
//     accountno: r.accountno,
//     auxcode: r.auxcode,
//     cc2: r.cc2,
//     cc3: r.cc3,
//     balanceFirst: r.balanceFirst,
//   };
// }

// const round2 = (n) => Math.round(Number(n) * 100) / 100;
// const isValidMonth = (m) => typeof m === "number" && m >= 1 && m <= 12;
// const sumArr = (arr) => (arr || []).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);

// /**
//  * ✅ MP row detection: ONLY by accountno list
//  */
// function isMpSalaryRow(d) {
//   return MP_SALARY_ACCOUNTS.has(String(d.accountno));
// }

// // ================= DOLPHIN LOGIN =================
// async function dolphinLogin() {
//   const res = await fetchFn(`${BASE_URL}/Authentication/Dolph_Login`, {
//     method: "POST",
//     headers: { "Content-Type": "application/json", Accept: "application/json" },
//     body: JSON.stringify({ pageindex: PAGEINDEX }),
//   });

//   const text = await res.text();
//   if (!res.ok) throw new Error(text);

//   const data = JSON.parse(text);

//   const rawCookie = res.headers.get("set-cookie");
//   const cookie = rawCookie ? rawCookie.split(";")[0] : null;

//   return { authkey: data.authkey, cookie };
// }

// // ================= FETCH TRIAL BALANCE =================
// async function fetchTrialBalance(authkey, cookie) {
//   const payload = {
//     filter: " ",
//     take: 0,
//     skip: 0,
//     sort: " ",
//     parameters: {
//       cmpseq: FIXED_CMPSEQ,
//       accountno: "",
//       year: 0,
//       month: 0,
//       cc3: "",
//       cc2: "",
//       typeR: "P",
//     },
//   };

//   const res = await fetchFn(`${BASE_URL}/externaltrialbalance/gettrialbalance`, {
//     method: "POST",
//     headers: {
//       "Content-Type": "application/json",
//       Accept: "application/json",
//       Authentication: authkey,
//       ...(cookie ? { Cookie: cookie } : {}),
//     },
//     body: JSON.stringify(payload),
//   });

//   const text = await res.text();
//   if (!res.ok) throw new Error(text);

//   return JSON.parse(text);
// }

// // ================= FILTER + ENRICH =================
// function filterAndEnrich(rows) {
//   return rows
//     .filter((r) => {
//       const acc = Number(r.accountno);
//       return (
//         String(r.typeR).toUpperCase() === "P" &&
//         Number(r.year) >= 2023 &&
//         westwalkAccountSet.has(acc)
//       );
//     })
//     .map((r) => {
//       const picked = pickTrialBalanceFields(r);
//       const meta = accountMetaMap[String(picked.accountno)] || {};

//       // ✅ SIGN: You flip -1 here already.
//       // We'll NOT flip again later.
//       return {
//         ...picked,
//         balanceFirst: Number(picked.balanceFirst) * -1,
//         company: meta.company || "Unknown",
//         component: meta.component || "Unknown",
//         accountType: meta.type || "Unknown", // "Revenue" | "Cost"
//         auxcode: picked.auxcode ? String(picked.auxcode) : "",
//         cc3: picked.cc3 ? String(picked.cc3) : "",
//         syncedAt: new Date(),
//       };
//     })
    
//     // .map(applyFixToRow); // ✅ add this
 
// }

// // ================= MP CLUB (MONTHLY SUM) + SPLIT =================
// function buildMpMonthlySplitRows(mpRows) {
//   const totalsByYm = new Map(); // key "YYYY-MM" => {year, month, total}

//   for (const r of mpRows) {
//     const year = Number(r.year);
//     const month = Number(r.month);
//     if (!year || !isValidMonth(month)) continue;

//     const key = `${year}-${month}`;
//     const prev = totalsByYm.get(key) || { year, month, total: 0 };
//     prev.total += Number(r.balanceFirst) || 0;
//     totalsByYm.set(key, prev);
//   }

//   const now = new Date();
//   const out = [];

//   for (const { year, month, total } of totalsByYm.values()) {
//     for (const [companyName, pct] of Object.entries(MP_SPLIT_PERCENTAGES)) {
//       out.push({
//         year,
//         month,
//         typeR: "P",
//         accountno: MP_SUM_ACCOUNTNO,
//         auxcode: "",
//         cc2: "",
//         cc3: "",
//         company: companyName,
//         component: MP_COMPONENT_NAME,
//         accountType: "Cost",
//         balanceFirst: round2(total * pct),
//         syncedAt: now,
//       });
//     }
//   }

//   return out;
// }

// // ================= ✅ COST FRONTEND-LIKE AGG (SAVE IN SAME COLLECTION) =================
// /**
//  * EXACT frontend COST calc (minus UI groupcollapse):
//  * - year-wise aggregation
//  * - group by accountno||auxcode
//  * - totalBalances[12] month-wise sums
//  * - totalSum = sum(totalBalances)
//  * - merge empty-aux rows by component (month-wise)
//  *
//  * Output docs:
//  * - month = 0  (IMPORTANT: so it never collides with real month 1..12)
//  * - viewType = "YEARLY_COST_VIEW"
//  * - accountType = "Cost"
//  * - balanceFirst = totalSum (for convenience)
//  * - totalBalances = [12] (same as frontend)
//  */
// function buildCostYearlyAggRows(costRowsOnly) {
//   // Step 1: group by year+company+accountno+auxcode
//   const byKey = new Map(); // key = year||company||accountno||auxcode

//   for (const r of costRowsOnly) {
//     const year = Number(r.year);
//     const month = Number(r.month);
//     if (!year || !isValidMonth(month)) continue;

//     const company = String(r.company || "").trim();
//     const component = String(r.component || "").trim();
//     const accountno = String(r.accountno || "").trim();
//     const auxcode = String(r.auxcode || "").trim(); // can be ""

//     const key = `${year}||${company}||${accountno}||${auxcode}`;

//     if (!byKey.has(key)) {
//       byKey.set(key, {
//         year,
//         company,
//         component,
//         accountno,
//         auxcode,
//         balances: Array(12).fill(0),
//       });
//     }

//     const obj = byKey.get(key);
//     if (!obj.component && component) obj.component = component;

//     // ✅ already signed value (we DO NOT multiply -1 here)
//     obj.balances[month - 1] += Number(r.balanceFirst) || 0;
//   }

//   // Step 2: split into withAux and emptyAux merge-by-component
//   const withAux = [];
//   const emptyAuxByComp = new Map(); // mkey = year||company||component

//   for (const obj of byKey.values()) {
//     const component = String(obj.component || "").trim();
//     const total = sumArr(obj.balances);

//     if (obj.auxcode) {
//       withAux.push({
//         viewType: COST_YEARLY_VIEW_TYPE,
//         typeR: "P",
//         year: obj.year,
//         month: 0, // ✅ yearly view doc
//         company: obj.company,
//         component,
//         accountType: "Cost",
//         accountno: obj.accountno,
//         auxcode: obj.auxcode,
//         cc2: "",
//         cc3: "",
//         totalBalances: obj.balances.map((x) => round2(x)),
//         totalSum: round2(total),
//         // for compatibility (some code may read balanceFirst)
//         balanceFirst: round2(total),
//         syncedAt: new Date(),
//       });
//     } else {
//       const mkey = `${obj.year}||${obj.company}||${component}`;
//       if (!emptyAuxByComp.has(mkey)) {
//         emptyAuxByComp.set(mkey, {
//           viewType: COST_YEARLY_VIEW_TYPE,
//           typeR: "P",
//           year: obj.year,
//           month: 0,
//           company: obj.company,
//           component,
//           accountType: "Cost",
//           auxcode: "",
//           cc2: "",
//           cc3: "",
//           totalBalances: Array(12).fill(0),
//           mergedAccountnos: new Set(),
//           syncedAt: new Date(),
//         });
//       }
//       const m = emptyAuxByComp.get(mkey);
//       for (let i = 0; i < 12; i++) m.totalBalances[i] += obj.balances[i];
//       if (obj.accountno) m.mergedAccountnos.add(obj.accountno);
//     }
//   }

//   const mergedEmptyAux = Array.from(emptyAuxByComp.values()).map((m) => {
//     const mergedList = Array.from(m.mergedAccountnos).sort().join(", ");
//     const balances = m.totalBalances.map((x) => round2(x));
//     const total = round2(sumArr(balances));

//     return {
//       viewType: COST_YEARLY_VIEW_TYPE,
//       typeR: "P",
//       year: m.year,
//       month: 0,
//       company: m.company,
//       component: m.component,
//       accountType: "Cost",
//       accountno: mergedList || "MERGED_EMPTYAUX",
//       auxcode: "",
//       cc2: "",
//       cc3: "",
//       totalBalances: balances,
//       totalSum: total,
//       balanceFirst: total,
//       syncedAt: m.syncedAt,
//     };
//   });

//   return [...withAux, ...mergedEmptyAux];
// }

// // ================= SAVE TO DB (SAME COLLECTION) =================
// async function saveDirectToDB(data) {
//   const db = mongoose.connection.db;
//   const collection = db.collection("westwalk_trialBal");

//   if (!data || data.length === 0) return 0;

//   await collection.bulkWrite(
//     data.map((d) => {
//       const isMp =
//         String(d.component).trim().toLowerCase() ===
//         String(MP_COMPONENT_NAME).trim().toLowerCase();

//       const isCostYearlyView =
//         String(d.viewType || "") === COST_YEARLY_VIEW_TYPE &&
//         Number(d.month) === 0 &&
//         String(d.accountType).toLowerCase() === "cost";

//       // base key always has year+month+accountno
//       let filterKey = { year: d.year, month: d.month, accountno: d.accountno };

//       if (isCostYearlyView) {
//         // ✅ yearly cost view uniqueness (must include company/component/auxcode)
//         filterKey.viewType = COST_YEARLY_VIEW_TYPE;
//         filterKey.company = d.company;
//         filterKey.component = d.component;
//         filterKey.auxcode = d.auxcode || "";
//       } else if (isMp) {
//         // ✅ MP monthly split uniqueness
//         filterKey.company = d.company;
//         filterKey.component = d.component;
//         // no aux/cc3 dependency
//       } else {
//         // ✅ Normal rows: keep your old uniqueness logic
        
//           if (String(d.accountType).toLowerCase() === "revenue") {
//             filterKey.cc3 = d.cc3 || "";
//             filterKey.cc2 = d.cc2 || "";
//           }
//           else {
//           filterKey.auxcode = d.auxcode;
//         }
//       }

//       return {
//         updateOne: {
//           filter: filterKey,
//           update: { $set: d },
//           upsert: true,
//         },
//       };
//     })
//   );

//   return data.length;
// }

// // ================= FIX (SAFE UPDATE ONLY) =================
// function applyFixToRow(r) {
//   if (
//     r.accountType === "Revenue" &&
//     String(r.accountno) === "41112" &&
//     r.cc2 === "Residential Rental"
//   ) {
//     return { ...r, component: "Residential", accountno: "41111" };
//   }
//   return r;
// }

// async function fixAndSaveTrialBalanceSafely() {
//   const db = mongoose.connection.db;
//   const collection = db.collection("westwalk_trialBal");

//   const target = await collection
//     .find({
//       accountType: "Revenue",
//       accountno: "41112",
//       cc2: "Residential Rental",
//     })
//     .toArray();

//   if (!target.length) return 0;

//   const ops = target.map((r) => {
//     const fixed = applyFixToRow(r);
//     return {
//       updateOne: {
//         filter: {
//           year: r.year,
//           month: r.month,
//           accountno: r.accountno,
//           cc3: r.cc3,
//         },
//         update: { $set: fixed },
//       },
//     };
//   });

//   await collection.bulkWrite(ops);
//   return ops.length;
// }


// async function clearTrialBalanceCollection() {
//   const db = mongoose.connection.db;
//   const collection = db.collection("westwalk_trialBal");
//   const res = await collection.deleteMany({});
//   console.log(`🧹 Cleared old data: ${res.deletedCount} docs`);
// }

// // ================= MAIN SYNC FUNCTION =================
// async function syncTrialBalance() {
//   await clearTrialBalanceCollection(); // <-- ye line add karo
//   const { authkey, cookie } = await dolphinLogin();
//   const rows = await fetchTrialBalance(authkey, cookie);

//   const enriched = filterAndEnrich(rows);

//   // ✅ split enriched into MP rows and normal rows
//   const mpRows = enriched.filter(isMpSalaryRow);
//   const normalOnly = enriched.filter((d) => !isMpSalaryRow(d));

//   // ✅ MP: club monthly then split (same)
//   const mpFinalRows = buildMpMonthlySplitRows(mpRows);

//   // ✅ Separate normal into revenue + cost
//   const normalRevenue = normalOnly.filter(
//     (r) => String(r.accountType).toLowerCase() === "revenue"
//   );

//   const normalCost = normalOnly.filter(
//     (r) => String(r.accountType).toLowerCase() === "cost"
//   );

//   // ✅ COST FIX: build frontend-like yearly cost view rows (month=0) BUT SAVE SAME collection
//   const costYearlyAgg = buildCostYearlyAggRows(normalCost);

//   // ✅ Save:
//   // - revenue monthly rows
//   // - MP monthly split rows
//   // - cost yearly aggregated rows (month=0)
//   const savedRevenue = await saveDirectToDB(normalRevenue);
//   const savedMp = await saveDirectToDB(mpFinalRows);
//   const savedCostYearly = await saveDirectToDB(costYearlyAgg);

//   // ✅ Apply revenue fix
//   const fixedCount = await fixAndSaveTrialBalanceSafely();

//   console.log(
//     `Sync done. enriched=${enriched.length} revSaved=${savedRevenue} mpOriginal=${mpRows.length} mpSplitSaved=${savedMp} costMonthlyInInput=${normalCost.length} costYearlyRows=${costYearlyAgg.length} costYearlySaved=${savedCostYearly} fixed=${fixedCount}`
//   );

//   return {
//     totalFetched: enriched.length,
//     savedRevenue,
//     mpRowsOriginal: mpRows.length,
//     mpRowsAfterClubAndSplit: mpFinalRows.length,
//     savedMpSplit: savedMp,
//     costMonthlyRowsInput: normalCost.length,
//     costYearlyAggRows: costYearlyAgg.length,
//     savedCostYearlyAgg: savedCostYearly,
//     fixedCount,
//   };
// }

// // ================= EXPORTS =================
// module.exports = {
//   FIXED_USERNAME,
//   FIXED_CMPSEQ,
//   dolphinLogin,
//   fetchTrialBalance,
//   filterAndEnrich,
//   saveDirectToDB,
//   syncTrialBalance,
//   fixAndSaveTrialBalanceSafely,
// };
