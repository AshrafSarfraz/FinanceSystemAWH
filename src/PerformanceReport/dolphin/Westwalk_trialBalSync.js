// controllers/syncTrialBalanceWithMP.controller.js
const mongoose = require("mongoose");

let fetchFn = global.fetch;
if (!fetchFn) fetchFn = require("node-fetch");

const { westwalkAccountSet } = require("../utils/typeP_Accounts");
const accountMetaMap = require("../utils/accountMaping");

// ================= CONFIG =================
const BASE_URL = process.env.BASE_URL;
const FIXED_USERNAME = "MagedS";
const FIXED_CMPSEQ = 15;
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

const MP_COMPONENT_NAME = "Man Power / Salaries";

const MP_SPLIT_PERCENTAGES = {
  "West Walk Real Estate": 0.22,
  "Assets Services Company": 0.6851,
  "West Walk Advertisement": 0.0949,
};

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
const sumArr = (arr) => (arr || []).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);

/**
 * ✅ MP row detection: ONLY by accountno list
 */
function isMpSalaryRow(d) {
  return MP_SALARY_ACCOUNTS.has(String(d.accountno));
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

      // ✅ SIGN: You flip -1 here already.
      // We'll NOT flip again later.
      return {
        ...picked,
        balanceFirst: Number(picked.balanceFirst) * -1,
        company: meta.company || "Unknown",
        component: meta.component || "Unknown",
        accountType: meta.type || "Unknown", // "Revenue" | "Cost"
        auxcode: picked.auxcode ? String(picked.auxcode) : "",
        cc3: picked.cc3 ? String(picked.cc3) : "",
        syncedAt: new Date(),
      };
    });
}

// ================= MP CLUB (MONTHLY SUM) + SPLIT =================
function buildMpMonthlySplitRows(mpRows) {
  const totalsByYm = new Map(); // key "YYYY-MM" => {year, month, total}

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
      out.push({
        year,
        month,
        typeR: "P",
        accountno: MP_SUM_ACCOUNTNO,
        auxcode: "",
        cc2: "",
        cc3: "",
        company: companyName,
        component: MP_COMPONENT_NAME,
        accountType: "Cost",
        balanceFirst: round2(total * pct),
        syncedAt: now,
      });
    }
  }

  return out;
}

// ================= ✅ COST FRONTEND-LIKE AGG (SAVE IN SAME COLLECTION) =================
/**
 * EXACT frontend COST calc (minus UI groupcollapse):
 * - year-wise aggregation
 * - group by accountno||auxcode
 * - totalBalances[12] month-wise sums
 * - totalSum = sum(totalBalances)
 * - merge empty-aux rows by component (month-wise)
 *
 * Output docs:
 * - month = 0  (IMPORTANT: so it never collides with real month 1..12)
 * - viewType = "YEARLY_COST_VIEW"
 * - accountType = "Cost"
 * - balanceFirst = totalSum (for convenience)
 * - totalBalances = [12] (same as frontend)
 */
function buildCostYearlyAggRows(costRowsOnly) {
  // Step 1: group by year+company+accountno+auxcode
  const byKey = new Map(); // key = year||company||accountno||auxcode

  for (const r of costRowsOnly) {
    const year = Number(r.year);
    const month = Number(r.month);
    if (!year || !isValidMonth(month)) continue;

    const company = String(r.company || "").trim();
    const component = String(r.component || "").trim();
    const accountno = String(r.accountno || "").trim();
    const auxcode = String(r.auxcode || "").trim(); // can be ""

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

    // ✅ already signed value (we DO NOT multiply -1 here)
    obj.balances[month - 1] += Number(r.balanceFirst) || 0;
  }

  // Step 2: split into withAux and emptyAux merge-by-component
  const withAux = [];
  const emptyAuxByComp = new Map(); // mkey = year||company||component

  for (const obj of byKey.values()) {
    const component = String(obj.component || "").trim();
    const total = sumArr(obj.balances);

    if (obj.auxcode) {
      withAux.push({
        viewType: COST_YEARLY_VIEW_TYPE,
        typeR: "P",
        year: obj.year,
        month: 0, // ✅ yearly view doc
        company: obj.company,
        component,
        accountType: "Cost",
        accountno: obj.accountno,
        auxcode: obj.auxcode,
        cc2: "",
        cc3: "",
        totalBalances: obj.balances.map((x) => round2(x)),
        totalSum: round2(total),
        // for compatibility (some code may read balanceFirst)
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

// ================= SAVE TO DB (SAME COLLECTION) =================
async function saveDirectToDB(data) {
  const db = mongoose.connection.db;
  const collection = db.collection("westwalk_trialBal");

  if (!data || data.length === 0) return 0;

  await collection.bulkWrite(
    data.map((d) => {
      const isMp =
        String(d.component).trim().toLowerCase() ===
        String(MP_COMPONENT_NAME).trim().toLowerCase();

      const isCostYearlyView =
        String(d.viewType || "") === COST_YEARLY_VIEW_TYPE &&
        Number(d.month) === 0 &&
        String(d.accountType).toLowerCase() === "cost";

      // base key always has year+month+accountno
      let filterKey = { year: d.year, month: d.month, accountno: d.accountno };

      if (isCostYearlyView) {
        // ✅ yearly cost view uniqueness (must include company/component/auxcode)
        filterKey.viewType = COST_YEARLY_VIEW_TYPE;
        filterKey.company = d.company;
        filterKey.component = d.component;
        filterKey.auxcode = d.auxcode || "";
      } else if (isMp) {
        // ✅ MP monthly split uniqueness
        filterKey.company = d.company;
        filterKey.component = d.component;
        // no aux/cc3 dependency
      } else {
        // ✅ Normal rows: keep your old uniqueness logic
        if (String(d.accountType).toLowerCase() === "revenue") {
          filterKey.cc3 = d.cc3;
        } else {
          filterKey.auxcode = d.auxcode;
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

// ================= FIX (SAFE UPDATE ONLY) =================
function applyFixToRow(r) {
  if (
    r.accountType === "Revenue" &&
    String(r.accountno) === "41112" &&
    r.cc2 === "Residential Rental"
  ) {
    return { ...r, component: "Residential", accountno: "41111" };
  }
  return r;
}

async function fixAndSaveTrialBalanceSafely() {
  const db = mongoose.connection.db;
  const collection = db.collection("westwalk_trialBal");

  const target = await collection
    .find({
      accountType: "Revenue",
      accountno: "41112",
      cc2: "Residential Rental",
    })
    .toArray();

  if (!target.length) return 0;

  const ops = target.map((r) => {
    const fixed = applyFixToRow(r);
    return {
      updateOne: {
        filter: {
          year: r.year,
          month: r.month,
          accountno: r.accountno,
          cc3: r.cc3,
        },
        update: { $set: fixed },
      },
    };
  });

  await collection.bulkWrite(ops);
  return ops.length;
}

// ================= MAIN SYNC FUNCTION =================
async function syncTrialBalance() {
  const { authkey, cookie } = await dolphinLogin();
  const rows = await fetchTrialBalance(authkey, cookie);

  const enriched = filterAndEnrich(rows);

  // ✅ split enriched into MP rows and normal rows
  const mpRows = enriched.filter(isMpSalaryRow);
  const normalOnly = enriched.filter((d) => !isMpSalaryRow(d));

  // ✅ MP: club monthly then split (same)
  const mpFinalRows = buildMpMonthlySplitRows(mpRows);

  // ✅ Separate normal into revenue + cost
  const normalRevenue = normalOnly.filter(
    (r) => String(r.accountType).toLowerCase() === "revenue"
  );

  const normalCost = normalOnly.filter(
    (r) => String(r.accountType).toLowerCase() === "cost"
  );

  // ✅ COST FIX: build frontend-like yearly cost view rows (month=0) BUT SAVE SAME collection
  const costYearlyAgg = buildCostYearlyAggRows(normalCost);

  // ✅ Save:
  // - revenue monthly rows
  // - MP monthly split rows
  // - cost yearly aggregated rows (month=0)
  const savedRevenue = await saveDirectToDB(normalRevenue);
  const savedMp = await saveDirectToDB(mpFinalRows);
  const savedCostYearly = await saveDirectToDB(costYearlyAgg);

  // ✅ Apply revenue fix
  const fixedCount = await fixAndSaveTrialBalanceSafely();

  console.log(
    `Sync done. enriched=${enriched.length} revSaved=${savedRevenue} mpOriginal=${mpRows.length} mpSplitSaved=${savedMp} costMonthlyInInput=${normalCost.length} costYearlyRows=${costYearlyAgg.length} costYearlySaved=${savedCostYearly} fixed=${fixedCount}`
  );

  return {
    totalFetched: enriched.length,
    savedRevenue,
    mpRowsOriginal: mpRows.length,
    mpRowsAfterClubAndSplit: mpFinalRows.length,
    savedMpSplit: savedMp,
    costMonthlyRowsInput: normalCost.length,
    costYearlyAggRows: costYearlyAgg.length,
    savedCostYearlyAgg: savedCostYearly,
    fixedCount,
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
  fixAndSaveTrialBalanceSafely,
};
