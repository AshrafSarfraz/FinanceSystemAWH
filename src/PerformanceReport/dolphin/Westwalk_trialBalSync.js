// controllers/syncTrialBalanceWithMP.controller.js
const mongoose = require("mongoose");

let fetchFn = global.fetch;
if (!fetchFn) fetchFn = require("node-fetch");

const { westwalkAccountSet } = require("../utils/typeP_Accounts");
const accountMetaMap = require("../utils/accountMaping");

// ================= CONFIG =================
// ✅ Keep secrets in env
const BASE_URL = process.env.BASE_URL; // e.g. https://your-server/api
const PAGEINDEX = process.env.DOLPH_PAGEINDEX; // base64 string (keep in env)
const FIXED_USERNAME = process.env.DOLPH_USERNAME || "MagedS"; // placeholder
const FIXED_CMPSEQ = 0;

// ✅ Companies
const C_RE = "West Walk Real Estate";
const C_ADV = "West Walk Advertisement";
const C_ASSETS = "Assets Services Company";

// ✅ MP/SALARY accounts (ONLY MP depends on these)
const MP_SALARY_ACCOUNTS = new Set([
  "61101", "61103", "61104", "61105", "61106",
  "61115", "61116", "64101", "64105", "64121",
]);

// ✅ PROFESSIONAL FEES (Cost grouping)
const PROFESSIONAL_FEES_ACCOUNTS = new Set([
  "64106", "64114", "64130"
]);

const MP_SPLIT_PERCENTAGES = {
  [C_RE]: 0.22,
  [C_ASSETS]: 0.6851,
  [C_ADV]: 0.0949,
};

// ✅ Assets Services Company MP Sub-split
const ASC_MP_SUBSPLIT = [
  { name: "HouseKeeping", percent: 0.435 },
  { name: "Maintaince", percent: 0.405 },
  { name: "Security", percent: 0.12 },
  { name: "Store-MP", percent: 0.03 },
  { name: "Landscape", percent: 0.01 },
];

// synthetic MP monthly sum account
const MP_SUM_ACCOUNTNO =
  "61101, 61103, 61104, 61105, 61106, 61115, 61116, 64101, 64105, 64121";

// ✅ mark for cost yearly view docs INSIDE SAME collection
const COST_YEARLY_VIEW_TYPE = "YEARLY_COST_VIEW";

// ================= ✅ NEW: MA MONTHLY SUM =================
// ✅ 5 accounts to club into 1 monthly row
const MA_ACCOUNTS = new Set(["44104", "44107", "44122", "44124", "44125"]);

// ✅ synthetic MA monthly sum "accountno"
const MA_SUM_ACCOUNTNO = "44104, 44107, 44122, 44124, 44125";

// ✅ component name required by you
const MA_COMPONENT_NAME = "Tenant Variation Request";

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

/**
 * ✅ MA row detection: ONLY by accountno list
 */
function isMaRow(d) {
  return MA_ACCOUNTS.has(String(d.accountno));
}

// ================= ✅ WestWalk RE Revenue: Component ONLY from cc2 =================
// ✅ Only for West Walk Real Estate + Revenue
// ✅ component decided ONLY by cc2 (Residential / Commercial)
function applyReRevenueComponentFromCc2(r) {
  const company = String(r.company || "").trim();
  const isRevenue =
    String(r.accountType || "").trim().toLowerCase() === "revenue";

  if (company !== C_RE || !isRevenue) return r;

  const cc2Raw = String(r.cc2 || "").trim();
  const cc2 = cc2Raw.toLowerCase();

  if (cc2.includes("residential")) {
    return { ...r, component: "Residential", cc2: "Residential" };
  }
  if (cc2.includes("commercial")) {
    return { ...r, component: "Commercial", cc2: "Commercial" };
  }

  return r;
}

// ================= ✅ PROFESSIONAL FEES GROUPING =================
// ✅ Only Cost rows
// ✅ If accountno is in PROFESSIONAL_FEES_ACCOUNTS => set component "Professional Fees"
function applyProfessionalFeesGrouping(r) {
  const isCost = String(r.accountType || "").toLowerCase() === "cost";
  if (!isCost) return r;

  const acc = String(r.accountno || "").trim();
  if (!PROFESSIONAL_FEES_ACCOUNTS.has(acc)) return r;

  return {
    ...r,
    component: "Professional Fees",
  };
}

// ================= ✅ REVENUE FIX (FRONTEND-LIKE) =================
// ✅ Apply ONLY for West Walk Real Estate
// ✅ allowed to use cc2 here for conversion logic
function applyFixToRow(r) {
  const company = String(r.company || "").trim();
  if (company !== C_RE) return r;

  const isRevenue =
    String(r.accountType || "").trim().toLowerCase() === "revenue";
  const acc = String(r.accountno || "").trim();
  const cc2 = String(r.cc2 || "").trim().toLowerCase();

  // works with original cc2 "Residential Rental" OR normalized "Residential"
  if (isRevenue && acc === "41112" && cc2.includes("residential")) {
    return { ...r, component: "Residential", accountno: "41111" };
  }

  return r;
}

// ================= ✅ NEW: Aggregate Revenue Monthly (ALL companies) =================
// ✅ key = year + month + accountno + cc3
// ✅ cc2 is NOT used in grouping
function aggregateRevenueMonthlyByCc3Account(rows) {
  const map = new Map();

  for (const r of rows || []) {
    const year = Number(r.year);
    const month = Number(r.month);
    if (!year || !isValidMonth(month)) continue;

    const accountno = String(r.accountno || "").trim();
    const cc3 = String(r.cc3 || "").trim(); // cc3 included in key
    const key = `${year}||${month}||${accountno}||${cc3}`;

    const prev = map.get(key);
    if (!prev) {
      map.set(key, { ...r, balanceFirst: Number(r.balanceFirst) || 0 });
    } else {
      prev.balanceFirst =
        (Number(prev.balanceFirst) || 0) + (Number(r.balanceFirst) || 0);

      // keep a stable component if mixed; you can change if needed
      if (String(prev.component || "") !== String(r.component || "")) {
        prev.component = prev.component || r.component || "Residential";
      }
    }
  }

  // round at end
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
      if (companyName === C_ASSETS) {
        for (const s of ASC_MP_SUBSPLIT) {
          out.push({
            year,
            month,
            typeR: "P",
            accountno: MP_SUM_ACCOUNTNO,
            auxcode: s.name,
            cc2: "",
            cc3: "",
            company: companyName,
            component: "ManPower",
            accountType: "Cost",
            balanceFirst: round2(companyTotal * (Number(s.percent) || 0)),
            syncedAt: now,
          });
        }
        continue;
      }

      out.push({
        year,
        month,
        typeR: "P",
        accountno: MP_SUM_ACCOUNTNO,
        auxcode: "",
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

// ================= ✅ NEW: MA CLUB (MONTHLY SUM) =================
// ✅ Sums 5 accounts into 1 monthly row per (year, month, company, accountType)
function buildMaMonthlySumRows(maRows) {
  const map = new Map(); // key => {year, month, company, accountType, total}

  const now = new Date();
  const out = [];

  for (const r of maRows || []) {
    const year = Number(r.year);
    const month = Number(r.month);
    if (!year || !isValidMonth(month)) continue;

    const company = String(r.company || "").trim();
    const accountType = String(r.accountType || "").trim() || "Unknown";

    // keep company-wise + type-wise, so revenue/cost won't mix
    const key = `${year}||${month}||${company}||${accountType}`;

    const prev = map.get(key) || { year, month, company, accountType, total: 0 };
    prev.total += Number(r.balanceFirst) || 0;
    map.set(key, prev);
  }

  for (const v of map.values()) {
    out.push({
      year: v.year,
      month: v.month,
      typeR: "P",
      accountno: MA_SUM_ACCOUNTNO,
      auxcode: "", // keep empty
      cc2: "",
      cc3: "",
      company: v.company,
      component: MA_COMPONENT_NAME, // ✅ "Tenant Variation Request"
      accountType: v.accountType,   // keep original type (Revenue/Cost)
      balanceFirst: round2(v.total),
      syncedAt: now,
    });
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
      const companyName = String(d.company || "").trim();
      const isRevenue = String(d.accountType || "").toLowerCase() === "revenue";

      // ✅ non-RE revenue: do not store cc2
      if (isRevenue && companyName !== C_RE) {
        d.cc2 = "";
      }

      // ✅ synthetic detection by accountno string
      const isMp = String(d.accountno) === MP_SUM_ACCOUNTNO;
      const isMa = String(d.accountno) === MA_SUM_ACCOUNTNO;

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
      } else if (isMp || isMa) {
        // ✅ MP/MA: keep 1 doc per company/component/auxcode per month
        filterKey.company = d.company;
        filterKey.component = d.component;
        filterKey.auxcode = d.auxcode || "";
        // (optional) if you want different doc per revenue/cost:
        filterKey.accountType = d.accountType;
      } else {
        if (isRevenue) {
          // ✅ MONTHLY revenue grouping: ONLY cc3 + accountno (NO cc2 for ANY company)
          filterKey.cc3 = d.cc3 || "";
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

  // 2) ✅ WestWalk RE: use cc2 ONLY for component conversion logic
  // 3) ✅ Professional Fees: cost component override for specified accounts
  const enrichedFixed = enriched
    .map(applyReRevenueComponentFromCc2)
    .map(applyFixToRow)
    .map(applyProfessionalFeesGrouping);

  // 4) Split MP vs normal
  const mpRows = enrichedFixed.filter(isMpSalaryRow);
  const normalAfterMp = enrichedFixed.filter((d) => !isMpSalaryRow(d));

  // ✅ NEW: Split MA from remaining normal
  const maRows = normalAfterMp.filter(isMaRow);
  const normalOnly = normalAfterMp.filter((d) => !isMaRow(d));

  // 5) MP final rows (company split + ASC sub-split)
  const mpFinalRows = buildMpMonthlySplitRows(mpRows);

  // ✅ NEW: MA final rows (monthly sum) with component "Tenant Variation Request"
  const maFinalRows = buildMaMonthlySumRows(maRows);

  // 6) Revenue + Cost (excluding MP + MA)
  const normalRevenueRaw = normalOnly.filter(
    (r) => String(r.accountType).toLowerCase() === "revenue"
  );

  const normalCost = normalOnly.filter(
    (r) => String(r.accountType).toLowerCase() === "cost"
  );

  // ✅ 6.1) Aggregate monthly revenue for ALL companies by (year, month, accountno, cc3)
  // ✅ cc2 is NOT used in sum/grouping
  const normalRevenue = aggregateRevenueMonthlyByCc3Account(normalRevenueRaw);

  // 7) Build yearly cost aggregation, then expand into month=1..12
  const costYearlyAgg = buildCostYearlyAggRows(normalCost);
  const costMonthlyRows = expandCostYearlyToMonthly(costYearlyAgg);

  // 8) Save all
  const savedRevenue = await saveDirectToDB(normalRevenue);
  const savedMp = await saveDirectToDB(mpFinalRows);
  const savedMa = await saveDirectToDB(maFinalRows);
  const savedCostMonthly = await saveDirectToDB(costMonthlyRows);

  console.log(
    `Sync done. enriched=${enrichedFixed.length} revIn=${normalRevenueRaw.length} revAgg=${normalRevenue.length} revSaved=${savedRevenue} mpOriginal=${mpRows.length} mpSplitSaved=${savedMp} maOriginal=${maRows.length} maSaved=${savedMa} costMonthlyInInput=${normalCost.length} costYearlyAggRows=${costYearlyAgg.length} costMonthlySaved=${savedCostMonthly}`
  );

  return {
    totalFetched: enrichedFixed.length,
    revenueRowsInput: normalRevenueRaw.length,
    revenueRowsAfterAgg: normalRevenue.length,
    savedRevenue,
    mpRowsOriginal: mpRows.length,
    mpRowsAfterClubAndSplit: mpFinalRows.length,
    savedMpSplit: savedMp,
    maRowsOriginal: maRows.length,
    maRowsAfterMonthlySum: maFinalRows.length,
    savedMaMonthly: savedMa,
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
// // ✅ Keep secrets in env
// const BASE_URL = process.env.BASE_URL; // e.g. https://your-server/api
// const PAGEINDEX = process.env.DOLPH_PAGEINDEX; // base64 string (keep in env)
// const FIXED_USERNAME = process.env.DOLPH_USERNAME || "MagedS"; // placeholder
// const FIXED_CMPSEQ = 0;

// // ✅ Companies
// const C_RE = "West Walk Real Estate";
// const C_ADV = "West Walk Advertisement";
// const C_ASSETS = "Assets Services Company";

// // ✅ MP/SALARY accounts (ONLY MP depends on these)
// const MP_SALARY_ACCOUNTS = new Set([
//   "61101", "61103", "61104", "61105", "61106",
//   "61115", "61116", "64101", "64105", "64121",
// ]);

// // ✅ PROFESSIONAL FEES (Cost grouping)
// const PROFESSIONAL_FEES_ACCOUNTS = new Set([
//   "64106", "64114", "64130"
// ]);

// const MP_SPLIT_PERCENTAGES = {
//   [C_RE]: 0.22,
//   [C_ASSETS]: 0.6851,
//   [C_ADV]: 0.0949,
// };

// // ✅ Assets Services Company MP Sub-split
// const ASC_MP_SUBSPLIT = [
//   { name: "HouseKeeping", percent: 0.435 },
//   { name: "Maintaince", percent: 0.405 },
//   { name: "Security", percent: 0.12 },
//   { name: "Store-MP", percent: 0.03 },
//   { name: "Landscape", percent: 0.01 },
// ];

// // synthetic MP monthly sum account
// const MP_SUM_ACCOUNTNO =
//   "61101, 61103, 61104, 61105, 61106, 61115, 61116, 64101, 64105, 64121";

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
// const sumArr = (arr) =>
//   (arr || []).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);

// /**
//  * ✅ MP row detection: ONLY by accountno list
//  */
// function isMpSalaryRow(d) {
//   return MP_SALARY_ACCOUNTS.has(String(d.accountno));
// }

// // ================= ✅ WestWalk RE Revenue: Component ONLY from cc2 =================
// // ✅ Only for West Walk Real Estate + Revenue
// // ✅ component decided ONLY by cc2 (Residential / Commercial)
// // ✅ normalize cc2 => "Residential" | "Commercial" (optional but helpful)
// function applyReRevenueComponentFromCc2(r) {
//   const company = String(r.company || "").trim();
//   const isRevenue =
//     String(r.accountType || "").trim().toLowerCase() === "revenue";

//   if (company !== C_RE || !isRevenue) return r;

//   const cc2Raw = String(r.cc2 || "").trim();
//   const cc2 = cc2Raw.toLowerCase();

//   if (cc2.includes("residential")) {
//     return { ...r, component: "Residential", cc2: "Residential" };
//   }
//   if (cc2.includes("commercial")) {
//     return { ...r, component: "Commercial", cc2: "Commercial" };
//   }

//   return r;
// }

// // ================= ✅ PROFESSIONAL FEES GROUPING =================
// // ✅ Only Cost rows
// // ✅ If accountno is in PROFESSIONAL_FEES_ACCOUNTS => set component "Professional Fees"
// function applyProfessionalFeesGrouping(r) {
//   const isCost = String(r.accountType || "").toLowerCase() === "cost";
//   if (!isCost) return r;

//   const acc = String(r.accountno || "").trim();
//   if (!PROFESSIONAL_FEES_ACCOUNTS.has(acc)) return r;

//   return {
//     ...r,
//     component: "Professional Fees",
//   };
// }

// // ================= ✅ REVENUE FIX (FRONTEND-LIKE) =================
// // ✅ Apply ONLY for West Walk Real Estate
// // ✅ allowed to use cc2 here for conversion logic
// function applyFixToRow(r) {
//   const company = String(r.company || "").trim();
//   if (company !== C_RE) return r;

//   const isRevenue =
//     String(r.accountType || "").trim().toLowerCase() === "revenue";
//   const acc = String(r.accountno || "").trim();
//   const cc2 = String(r.cc2 || "").trim().toLowerCase();

//   // works with original cc2 "Residential Rental" OR normalized "Residential"
//   if (isRevenue && acc === "41112" && cc2.includes("residential")) {
//     return { ...r, component: "Residential", accountno: "41111" };
//   }

//   return r;
// }

// // ================= ✅ NEW: Aggregate Revenue Monthly (ALL companies) =================
// // ✅ key = year + month + accountno + cc3
// // ✅ cc2 is NOT used in grouping
// function aggregateRevenueMonthlyByCc3Account(rows) {
//   const map = new Map();

//   for (const r of rows || []) {
//     const year = Number(r.year);
//     const month = Number(r.month);
//     if (!year || !isValidMonth(month)) continue;

//     const accountno = String(r.accountno || "").trim();
//     const cc3 = String(r.cc3 || "").trim(); // cc3 included in key
//     const key = `${year}||${month}||${accountno}||${cc3}`;

//     const prev = map.get(key);
//     if (!prev) {
//       map.set(key, { ...r, balanceFirst: Number(r.balanceFirst) || 0 });
//     } else {
//       prev.balanceFirst =
//         (Number(prev.balanceFirst) || 0) + (Number(r.balanceFirst) || 0);

//       // optional: if component differs due to cc2 logic, mark Mixed (to avoid lying)
//       if (String(prev.component || "") !== String(r.component || "")) {
//         prev.component = "Residential";
//       }
//     }
//   }

//   // round at end
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
//         cc2: picked.cc2 ? String(picked.cc2) : "",
//         cc3: picked.cc3 ? String(picked.cc3) : "",
//         syncedAt: new Date(),
//       };
//     });
// }

// // ================= MP CLUB (MONTHLY SUM) + SPLIT =================
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
//       const companyTotal = (Number(total) || 0) * (Number(pct) || 0);

//       // ✅ Assets Services Company: sub-split BUT keep component ManPower, put split-name in auxcode
//       if (companyName === C_ASSETS) {
//         for (const s of ASC_MP_SUBSPLIT) {
//           out.push({
//             year,
//             month,
//             typeR: "P",
//             accountno: MP_SUM_ACCOUNTNO,
//             auxcode: s.name,
//             cc2: "",
//             cc3: "",
//             company: companyName,
//             component: "ManPower",
//             accountType: "Cost",
//             balanceFirst: round2(companyTotal * (Number(s.percent) || 0)),
//             syncedAt: now,
//           });
//         }
//         continue;
//       }

//       out.push({
//         year,
//         month,
//         typeR: "P",
//         accountno: MP_SUM_ACCOUNTNO,
//         auxcode: "",
//         cc2: "",
//         cc3: "",
//         company: companyName,
//         component: "ManPower",
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

// // ================= NEW: Expand cost yearly → 12 monthly rows =================
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
//       const isRevenue = String(d.accountType || "").toLowerCase() === "revenue";

//       // ✅ non-RE revenue: do not store cc2
//       if (isRevenue && companyName !== C_RE) {
//         d.cc2 = "";
//       }

//       // ✅ MP detection MUST be by accountno now
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
//         filterKey.auxcode = d.auxcode || "";
//       } else {
//         if (isRevenue) {
//           // ✅ MONTHLY revenue grouping: ONLY cc3 + accountno (NO cc2 for ANY company)
//           filterKey.cc3 = d.cc3 || "";
//         } else {
//           filterKey.auxcode = d.auxcode || "";
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

//   // 1) Enrich
//   const enriched = filterAndEnrich(rows);

//   // 2) ✅ WestWalk RE: use cc2 ONLY for component conversion logic
//   // 3) ✅ Professional Fees: cost component override for specified accounts
//   const enrichedFixed = enriched
//     .map(applyReRevenueComponentFromCc2)
//     .map(applyFixToRow)
//     .map(applyProfessionalFeesGrouping);

//   // 4) Split MP vs normal
//   const mpRows = enrichedFixed.filter(isMpSalaryRow);
//   const normalOnly = enrichedFixed.filter((d) => !isMpSalaryRow(d));

//   // 5) MP final rows (company split + ASC sub-split)
//   const mpFinalRows = buildMpMonthlySplitRows(mpRows);

//   // 6) Revenue + Cost
//   const normalRevenueRaw = normalOnly.filter(
//     (r) => String(r.accountType).toLowerCase() === "revenue"
//   );

//   const normalCost = normalOnly.filter(
//     (r) => String(r.accountType).toLowerCase() === "cost"
//   );

//   // ✅ 6.1) Aggregate monthly revenue for ALL companies by (year, month, accountno, cc3)
//   // ✅ cc2 is NOT used in sum/grouping
//   const normalRevenue = aggregateRevenueMonthlyByCc3Account(normalRevenueRaw);

//   // 7) Build yearly cost aggregation, then expand into month=1..12
//   const costYearlyAgg = buildCostYearlyAggRows(normalCost);
//   const costMonthlyRows = expandCostYearlyToMonthly(costYearlyAgg);

//   // 8) Save all
//   const savedRevenue = await saveDirectToDB(normalRevenue);
//   const savedMp = await saveDirectToDB(mpFinalRows);
//   const savedCostMonthly = await saveDirectToDB(costMonthlyRows);

//   console.log(
//     `Sync done. enriched=${enrichedFixed.length} revIn=${normalRevenueRaw.length} revAgg=${normalRevenue.length} revSaved=${savedRevenue} mpOriginal=${mpRows.length} mpSplitSaved=${savedMp} costMonthlyInInput=${normalCost.length} costYearlyAggRows=${costYearlyAgg.length} costMonthlySaved=${savedCostMonthly}`
//   );

//   return {
//     totalFetched: enrichedFixed.length,
//     revenueRowsInput: normalRevenueRaw.length,
//     revenueRowsAfterAgg: normalRevenue.length,
//     savedRevenue,
//     mpRowsOriginal: mpRows.length,
//     mpRowsAfterClubAndSplit: mpFinalRows.length,
//     savedMpSplit: savedMp,
//     costMonthlyRowsInput: normalCost.length,
//     costYearlyAggRows: costYearlyAgg.length,
//     savedCostMonthly,
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


