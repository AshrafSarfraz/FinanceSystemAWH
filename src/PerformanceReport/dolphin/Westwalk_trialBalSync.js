// // controllers/syncTrialBalanceWithMP.controller.js
// const mongoose = require("mongoose");

// let fetchFn = global.fetch;
// if (!fetchFn) fetchFn = require("node-fetch");

// // ================= CONFIG =================
// // ✅ Keep secrets in env
// const BASE_URL = process.env.BASE_URL; // e.g. https://your-server/api
// const PAGEINDEX = process.env.DOLPH_PAGEINDEX; // base64 string keep in env
// const FIXED_USERNAME = process.env.DOLPH_USERNAME || "MagedS";
// const FIXED_CMPSEQ = 0;

// // ✅ Companies
// const C_RE = "West Walk Real Estate";

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

// const isValidMonth = (m) =>
//   typeof m === "number" && m >= 1 && m <= 12;

// const sumArr = (arr) =>
//   (arr || []).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);

// function getAccountTypeFromAccountNo(accountno) {
//   const acc = String(accountno || "").trim();

//   // ✅ 4 series = Revenue
//   if (acc.startsWith("4")) return "Revenue";

//   // ✅ 5 and 6 series = Cost
//   if (acc.startsWith("5") || acc.startsWith("6")) return "Cost";

//   return "Unknown";
// }

// function getComponentFromApi(r) {
//   const accountNoName =
//     String(r.accountnoname || "").trim() ||
//     String(r.accountNoName || "").trim() ||
//     String(r.accountnoName || "").trim();

//   // ✅ Example:
//   // "44136 - Digital Display Advertising Fee"
//   // becomes:
//   // "Digital Display Advertising Fee"
//   if (accountNoName) {
//     const cleaned = accountNoName.replace(/^\s*\d+\s*-\s*/, "").trim();
//     if (cleaned) return cleaned;
//   }

//   // fallback only if accountnoname is missing
//   const debitType = String(r.actypeDebit || "").trim();
//   const creditType = String(r.actypeCredit || "").trim();

//   return debitType || creditType || "Unknown";
// }

// // ================= ✅ WestWalk RE Revenue: Component ONLY from cc2 =================
// // ✅ Only for West Walk Real Estate + Revenue
// // ✅ component decided ONLY by cc2 Residential / Commercial
// function applyReRevenueComponentFromCc2(r) {
//   const company = String(r.company || "").trim();

//   const isRevenue =
//     String(r.accountType || "").trim().toLowerCase() === "revenue";

//   if (company !== C_RE || !isRevenue) return r;

//   const cc2Raw = String(r.cc2 || "").trim();

//   const cc2 = cc2Raw
//     .toLowerCase()
//     .replace(/\s+/g, " ");

//   // Residential Rental
//   if (cc2.includes("residential rental")) {
//     return {
//       ...r,
//       accountno: "41111",
//       component: "Residential",
//       cc2: "Residential",
//     };
//   }

//   // Commercial Rental
//   if (cc2.includes("commercial rental")) {
//     return {
//       ...r,
//       accountno: "41112",
//       component: "Commercial",
//       cc2: "Commercial",
//     };
//   }

//   return r;
// }



// // ================= ✅ Aggregate Revenue Monthly ALL companies =================
// // ✅ key = year + month + company + accountno + cc3
// // ✅ company added, so companies will NOT overwrite each other
// // ✅ cc2 is NOT used in grouping
// function aggregateRevenueMonthlyByCompanyCc3Account(rows) {
//   const map = new Map();

//   for (const r of rows || []) {
//     const year = Number(r.year);
//     const month = Number(r.month);

//     if (!year || !isValidMonth(month)) continue;

//     const company = String(r.company || "").trim();
//     const component = String(r.component || "").trim();
//     const accountno = String(r.accountno || "").trim();
//     const cc3 = String(r.cc3 || "").trim();

//     const key = `${year}||${month}||company:${company}||component:${component}||account:${accountno}||cc3:${cc3}`;

//     const prev = map.get(key);

//     if (!prev) {
//       map.set(key, {
//         ...r,
//         company,
//         component,
//         accountno,
//         cc3,
//         balanceFirst: Number(r.balanceFirst) || 0,
//       });
//     } else {
//       prev.balanceFirst =
//         (Number(prev.balanceFirst) || 0) + (Number(r.balanceFirst) || 0);
//     }
//   }

//   return Array.from(map.values()).map((x) => ({
//     ...x,
//     balanceFirst: round2(x.balanceFirst),
//     syncedAt: new Date(),
//   }));
// }

// // ================= DOLPHIN LOGIN =================
// async function dolphinLogin() {
//   if (!BASE_URL) throw new Error("BASE_URL missing in env");
//   if (!PAGEINDEX) throw new Error("DOLPH_PAGEINDEX missing in env");

//   const res = await fetchFn(`${BASE_URL}/Authentication/Dolph_Login`, {
//     method: "POST",
//     headers: {
//       "Content-Type": "application/json",
//       Accept: "application/json",
//     },
//     body: JSON.stringify({
//       pageindex: PAGEINDEX,
//     }),
//   });

//   const text = await res.text();

//   if (!res.ok) {
//     throw new Error(text);
//   }

//   const data = JSON.parse(text);

//   const rawCookie = res.headers.get("set-cookie");
//   const cookie = rawCookie ? rawCookie.split(";")[0] : null;

//   return {
//     authkey: data.authkey,
//     cookie,
//   };
// }

// // ================= FETCH TRIAL BALANCE =================
// async function fetchTrialBalance(authkey, cookie) {
//   if (!BASE_URL) throw new Error("BASE_URL missing in env");

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

//   if (!res.ok) {
//     throw new Error(text);
//   }

//   return JSON.parse(text);
// }

// // ================= FILTER + ENRICH =================
// function filterAndEnrich(rows) {
//   return rows
//     .filter((r) => {
//       return (
//         String(r.typeR).toUpperCase() === "P" &&
//         Number(r.year) >= 2026
//       );
//     })
//     .map((r) => {
//       const picked = pickTrialBalanceFields(r);

//       return {
//         ...picked,

//         // ✅ amount * -1
//         balanceFirst: Number(picked.balanceFirst) * -1,

//         // ✅ company direct from API cmpname
//         company: String(r.cmpname || "").trim() || "Unknown",

//         // ✅ component direct from API debit/credit type
//         component: getComponentFromApi(r),

//         // ✅ 4 = Revenue, 5/6 = Cost
//         accountType: getAccountTypeFromAccountNo(picked.accountno),

//         auxcode: picked.auxcode ? String(picked.auxcode) : "",
//         cc2: picked.cc2 ? String(picked.cc2) : "",
//         cc3: picked.cc3 ? String(picked.cc3) : "",

//         syncedAt: new Date(),
//       };
//     });
// }

// // ================= ✅ COST FRONTEND-LIKE AGG month=0 =================
// // ✅ key = year + company + component + accountno + auxcode
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

//     const key = `${year}||company:${company}||component:${component}||account:${accountno}||aux:${auxcode}`;

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
//       // ✅ Empty aux rows merge by year + company + component
//       const mkey = `${obj.year}||company:${obj.company}||component:${component}`;

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

//       for (let i = 0; i < 12; i++) {
//         m.totalBalances[i] += obj.balances[i];
//       }

//       if (obj.accountno) {
//         m.mergedAccountnos.add(obj.accountno);
//       }
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

// // ================= Expand cost yearly → 12 monthly rows =================
// function expandCostYearlyToMonthly(costYearlyRows) {
//   const out = [];

//   for (const d of costYearlyRows) {
//     if (
//       String(d.accountType || "").toLowerCase() === "cost" &&
//       Array.isArray(d.totalBalances) &&
//       d.totalBalances.length === 12
//     ) {
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
//       const companyName = String(d.company || "").trim();

//       const isRevenue =
//         String(d.accountType || "").toLowerCase() === "revenue";

//       const isCost =
//         String(d.accountType || "").toLowerCase() === "cost";

//       // ✅ non-RE revenue: do not store cc2
//       if (isRevenue && companyName !== C_RE) {
//         d.cc2 = "";
//       }

//       const isCostYearlyView =
//         String(d.viewType || "") === COST_YEARLY_VIEW_TYPE &&
//         Number(d.month) === 0 &&
//         isCost;

//       let filterKey = {
//         year: d.year,
//         month: d.month,
//         accountno: d.accountno,
//       };

//       if (isCostYearlyView) {
//         // ✅ yearly cost view unique by company/component/auxcode
//         filterKey.viewType = COST_YEARLY_VIEW_TYPE;
//         filterKey.company = d.company;
//         filterKey.component = d.component;
//         filterKey.auxcode = d.auxcode || "";
//       } else if (isRevenue) {
//         // ✅ Revenue must include company, otherwise companies overwrite each other
//         filterKey.company = d.company;
//         filterKey.component = d.component;
//         filterKey.cc3 = d.cc3 || "";
//       } else if (isCost) {
//         // ✅ Cost must include company also
//         filterKey.company = d.company;
//         filterKey.component = d.component;
//         filterKey.auxcode = d.auxcode || "";
//       } else {
//         // ✅ Unknown account type fallback
//         filterKey.company = d.company;
//         filterKey.component = d.component;
//         filterKey.auxcode = d.auxcode || "";
//         filterKey.cc3 = d.cc3 || "";
//         filterKey.accountType = d.accountType || "Unknown";
//       }

//       return {
//         updateOne: {
//           filter: filterKey,
//           update: {
//             $set: d,
//           },
//           upsert: true,
//         },
//       };
//     })
//   );

//   return data.length;
// }

// // async function clearTrialBalanceCollection() {
// //   const db = mongoose.connection.db;
// //   const collection = db.collection("westwalk_trialBal");

// //   const res = await collection.deleteMany({});
// //   console.log(`🧹 Cleared old data: ${res.deletedCount} docs`);
// // }

// async function clearTrialBalanceCollection() {
//   const db = mongoose.connection.db;
//   const collection = db.collection("westwalk_trialBal");

//   const res = await collection.deleteMany({ 
//     year: { $gte: 2026 } 
//   });
  
//   console.log(`🧹 Cleared old data: ${res.deletedCount} docs`);
// }

// // ================= MAIN SYNC FUNCTION =================
// async function syncTrialBalance() {
//   await clearTrialBalanceCollection();

//   const { authkey, cookie } = await dolphinLogin();
//   const rows = await fetchTrialBalance(authkey, cookie);

//   // 1) Enrich direct from API
//   const enriched = filterAndEnrich(rows);

//   // 2) Only keep required RE revenue fixes
//   const enrichedFixed = enriched
//     .map(applyReRevenueComponentFromCc2)


//   // 3) Revenue rows
//   const revenueRaw = enrichedFixed.filter(
//     (r) => String(r.accountType || "").toLowerCase() === "revenue"
//   );

//   // 4) Cost rows
//   const costRaw = enrichedFixed.filter(
//     (r) => String(r.accountType || "").toLowerCase() === "cost"
//   );

//   // 5) Unknown rows, for checking only
//   const unknownRows = enrichedFixed.filter(
//     (r) =>
//       String(r.accountType || "").toLowerCase() !== "revenue" &&
//       String(r.accountType || "").toLowerCase() !== "cost"
//   );

//   // 6) Aggregate monthly revenue by company + account + cc3
//   const revenueRows = aggregateRevenueMonthlyByCompanyCc3Account(revenueRaw);

//   // 7) Build yearly cost aggregation then expand to monthly rows
//   const costYearlyAgg = buildCostYearlyAggRows(costRaw);
//   const costMonthlyRows = expandCostYearlyToMonthly(costYearlyAgg);

//   // 8) Save all
//   const savedRevenue = await saveDirectToDB(revenueRows);
//   const savedCostMonthly = await saveDirectToDB(costMonthlyRows);
//   const savedUnknown = await saveDirectToDB(unknownRows);

//   console.log(
//     `Sync done. enriched=${enrichedFixed.length} revenueInput=${revenueRaw.length} revenueAgg=${revenueRows.length} revenueSaved=${savedRevenue} costInput=${costRaw.length} costYearlyAggRows=${costYearlyAgg.length} costMonthlySaved=${savedCostMonthly} unknownSaved=${savedUnknown}`
//   );

//   return {
//     totalFetched: enrichedFixed.length,

//     revenueRowsInput: revenueRaw.length,
//     revenueRowsAfterAgg: revenueRows.length,
//     savedRevenue,

//     costRowsInput: costRaw.length,
//     costYearlyAggRows: costYearlyAgg.length,
//     savedCostMonthly,

//     unknownRows: unknownRows.length,
//     savedUnknown,
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
// };




// controllers/syncTrialBalanceWithMP.controller.js
const mongoose = require("mongoose");
let fetchFn = global.fetch;
if (!fetchFn) fetchFn = require("node-fetch");
// ================= CONFIG =================
// ✅ Keep secrets in env
const BASE_URL = process.env.BASE_URL; // e.g. https://your-server/api
const PAGEINDEX = process.env.DOLPH_PAGEINDEX; // base64 string keep in env
const FIXED_USERNAME = process.env.DOLPH_USERNAME || "MagedS";
const FIXED_CMPSEQ = 0;
// ✅ Companies
const C_RE = "West Walk Real Estate";
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
const isValidMonth = (m) =>
  typeof m === "number" && m >= 1 && m <= 12;
const sumArr = (arr) =>
  (arr || []).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
function getAccountTypeFromAccountNo(accountno) {
  const acc = String(accountno || "").trim();
  // ✅ 4 series = Revenue
  if (acc.startsWith("4")) return "Revenue";
  // ✅ 5 and 6 series = Cost
  if (acc.startsWith("5") || acc.startsWith("6")) return "Cost";
  return "Unknown";
}
function getComponentFromApi(r) {
  const accountNoName =
    String(r.accountnoname || "").trim() ||
    String(r.accountNoName || "").trim() ||
    String(r.accountnoName || "").trim();
  // ✅ Example:
  // "44136 - Digital Display Advertising Fee"
  // becomes:
  // "Digital Display Advertising Fee"
  if (accountNoName) {
    const cleaned = accountNoName.replace(/^\s*\d+\s*-\s*/, "").trim();
    if (cleaned) return cleaned;
  }
  // fallback only if accountnoname is missing
  const debitType = String(r.actypeDebit || "").trim();
  const creditType = String(r.actypeCredit || "").trim();
  return debitType || creditType || "Unknown";
}
// ================= ✅ WestWalk RE Revenue: Component ONLY from cc2 =================
// ✅ Only for West Walk Real Estate + Revenue
// ✅ component decided ONLY by cc2 Residential / Commercial
function applyReRevenueComponentFromCc2(r) {
  const company = String(r.company || "").trim();
  const isRevenue =
    String(r.accountType || "").trim().toLowerCase() === "revenue";
  if (company !== C_RE || !isRevenue) return r;
  const cc2Raw = String(r.cc2 || "").trim();
  const cc2 = cc2Raw
    .toLowerCase()
    .replace(/\s+/g, " ");
  // Residential Rental
  if (cc2.includes("residential rental")) {
    return {
      ...r,
      accountno: "41111",
      component: "Residential",
      cc2: "Residential",
    };
  }
  // Commercial Rental
  if (cc2.includes("commercial rental")) {
    return {
      ...r,
      accountno: "41112",
      component: "Commercial",
      cc2: "Commercial",
    };
  }
  return r;
}
// ================= ✅ Aggregate Revenue Monthly ALL companies =================
// ✅ key = year + month + company + accountno + cc3
// ✅ company added, so companies will NOT overwrite each other
// ✅ cc2 is NOT used in grouping
function aggregateRevenueMonthlyByCompanyCc3Account(rows) {
  const map = new Map();
  for (const r of rows || []) {
    const year = Number(r.year);
    const month = Number(r.month);
    if (!year || !isValidMonth(month)) continue;
    const company = String(r.company || "").trim();
    const component = String(r.component || "").trim();
    const accountno = String(r.accountno || "").trim();
    const cc3 = String(r.cc3 || "").trim();
    const key = `${year}||${month}||company:${company}||component:${component}||account:${accountno}||cc3:${cc3}`;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, {
        ...r,
        company,
        component,
        accountno,
        cc3,
        balanceFirst: Number(r.balanceFirst) || 0,
      });
    } else {
      prev.balanceFirst =
        (Number(prev.balanceFirst) || 0) + (Number(r.balanceFirst) || 0);
    }
  }
  return Array.from(map.values()).map((x) => ({
    ...x,
    balanceFirst: round2(x.balanceFirst),
    syncedAt: new Date(),
  }));
}
// ================= DOLPHIN LOGIN =================
async function dolphinLogin() {
  if (!BASE_URL) throw new Error("BASE_URL missing in env");
  if (!PAGEINDEX) throw new Error("DOLPH_PAGEINDEX missing in env");
  const res = await fetchFn(`${BASE_URL}/Authentication/Dolph_Login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      pageindex: PAGEINDEX,
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(text);
  }
  const data = JSON.parse(text);
  const rawCookie = res.headers.get("set-cookie");
  const cookie = rawCookie ? rawCookie.split(";")[0] : null;
  return {
    authkey: data.authkey,
    cookie,
  };
}
// ================= FETCH TRIAL BALANCE =================
async function fetchTrialBalance(authkey, cookie) {
  if (!BASE_URL) throw new Error("BASE_URL missing in env");
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
  if (!res.ok) {
    throw new Error(text);
  }
  return JSON.parse(text);
}
// ================= FILTER + ENRICH =================
function filterAndEnrich(rows) {
  return rows
    .filter((r) => {
      return (
        String(r.typeR).toUpperCase() === "P" &&
        Number(r.year) >= 2026
      );
    })
    .map((r) => {
      const picked = pickTrialBalanceFields(r);
      return {
        ...picked,
        // ✅ amount * -1
        balanceFirst: Number(picked.balanceFirst) * -1,
        // ✅ company direct from API cmpname
        company: String(r.cmpname || "").trim() || "Unknown",
        // ✅ component direct from API debit/credit type
        component: getComponentFromApi(r),
        // ✅ 4 = Revenue, 5/6 = Cost
        accountType: getAccountTypeFromAccountNo(picked.accountno),
        auxcode: picked.auxcode ? String(picked.auxcode) : "",
        cc2: picked.cc2 ? String(picked.cc2) : "",
        cc3: picked.cc3 ? String(picked.cc3) : "",
        syncedAt: new Date(),
      };
    });
}
// ================= ✅ COST FRONTEND-LIKE AGG month=0 =================
// ✅ key = year + company + component + accountno + auxcode
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
    const key = `${year}||company:${company}||component:${component}||account:${accountno}||aux:${auxcode}`;
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
      // ✅ Empty aux rows merge by year + company + component
      const mkey = `${obj.year}||company:${obj.company}||component:${component}`;
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
      for (let i = 0; i < 12; i++) {
        m.totalBalances[i] += obj.balances[i];
      }
      if (obj.accountno) {
        m.mergedAccountnos.add(obj.accountno);
      }
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
// ================= Expand cost yearly → 12 monthly rows =================
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
      const companyName = String(d.company || "").trim();
      const isRevenue =
        String(d.accountType || "").toLowerCase() === "revenue";
      const isCost =
        String(d.accountType || "").toLowerCase() === "cost";
      // ✅ FINAL West Walk RE revenue account number before saving
      if (isRevenue && companyName === C_RE) {
        const componentName = String(d.component || "")
          .trim()
          .toLowerCase();
        if (componentName === "residential") {
          d.accountno = "41111";
        } else if (componentName === "commercial") {
          d.accountno = "41112";
        }
      }
      // ✅ non-RE revenue: do not store cc2
      if (isRevenue && companyName !== C_RE) {
        d.cc2 = "";
      }
      const isCostYearlyView =
        String(d.viewType || "") === COST_YEARLY_VIEW_TYPE &&
        Number(d.month) === 0 &&
        isCost;
      let filterKey = {
        year: d.year,
        month: d.month,
        accountno: d.accountno,
      };
      if (isCostYearlyView) {
        // ✅ yearly cost view unique by company/component/auxcode
        filterKey.viewType = COST_YEARLY_VIEW_TYPE;
        filterKey.company = d.company;
        filterKey.component = d.component;
        filterKey.auxcode = d.auxcode || "";
      } else if (isRevenue) {
        // ✅ Revenue must include company, otherwise companies overwrite each other
        filterKey.company = d.company;
        filterKey.component = d.component;
        filterKey.cc3 = d.cc3 || "";
      } else if (isCost) {
        // ✅ Cost must include company also
        filterKey.company = d.company;
        filterKey.component = d.component;
        filterKey.auxcode = d.auxcode || "";
      } else {
        // ✅ Unknown account type fallback
        filterKey.company = d.company;
        filterKey.component = d.component;
        filterKey.auxcode = d.auxcode || "";
        filterKey.cc3 = d.cc3 || "";
        filterKey.accountType = d.accountType || "Unknown";
      }
      return {
        updateOne: {
          filter: filterKey,
          update: {
            $set: d,
          },
          upsert: true,
        },
      };
    })
  );
  return data.length;
}
// async function clearTrialBalanceCollection() {
//   const db = mongoose.connection.db;
//   const collection = db.collection("westwalk_trialBal");
//   const res = await collection.deleteMany({});
//   console.log(`🧹 Cleared old data: ${res.deletedCount} docs`);
// }
async function clearTrialBalanceCollection() {
  const db = mongoose.connection.db;
  const collection = db.collection("westwalk_trialBal");
  const res = await collection.deleteMany({ 
    year: { $gte: 2026 } 
  });
  console.log(`🧹 Cleared old data: ${res.deletedCount} docs`);
}
// ================= MAIN SYNC FUNCTION =================
async function syncTrialBalance() {
  await clearTrialBalanceCollection();
  const { authkey, cookie } = await dolphinLogin();
  const rows = await fetchTrialBalance(authkey, cookie);
  // 1) Enrich direct from API
  const enriched = filterAndEnrich(rows);
  // 2) Only keep required RE revenue fixes
  const enrichedFixed = enriched
    .map(applyReRevenueComponentFromCc2)
  // 3) Revenue rows
  const revenueRaw = enrichedFixed.filter(
    (r) => String(r.accountType || "").toLowerCase() === "revenue"
  );
  // 4) Cost rows
  const costRaw = enrichedFixed.filter(
    (r) => String(r.accountType || "").toLowerCase() === "cost"
  );
  // 5) Unknown rows, for checking only
  const unknownRows = enrichedFixed.filter(
    (r) =>
      String(r.accountType || "").toLowerCase() !== "revenue" &&
      String(r.accountType || "").toLowerCase() !== "cost"
  );
  // 6) Aggregate monthly revenue by company + account + cc3
  const revenueRows = aggregateRevenueMonthlyByCompanyCc3Account(revenueRaw);
  // 7) Build yearly cost aggregation then expand to monthly rows
  const costYearlyAgg = buildCostYearlyAggRows(costRaw);
  const costMonthlyRows = expandCostYearlyToMonthly(costYearlyAgg);
  // 8) Save all
  const savedRevenue = await saveDirectToDB(revenueRows);
  const savedCostMonthly = await saveDirectToDB(costMonthlyRows);
  const savedUnknown = await saveDirectToDB(unknownRows);
  console.log(
    `Sync done. enriched=${enrichedFixed.length} revenueInput=${revenueRaw.length} revenueAgg=${revenueRows.length} revenueSaved=${savedRevenue} costInput=${costRaw.length} costYearlyAggRows=${costYearlyAgg.length} costMonthlySaved=${savedCostMonthly} unknownSaved=${savedUnknown}`
  );
  return {
    totalFetched: enrichedFixed.length,
    revenueRowsInput: revenueRaw.length,
    revenueRowsAfterAgg: revenueRows.length,
    savedRevenue,
    costRowsInput: costRaw.length,
    costYearlyAggRows: costYearlyAgg.length,
    savedCostMonthly,
    unknownRows: unknownRows.length,
    savedUnknown,
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


