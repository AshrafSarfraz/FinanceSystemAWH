// controllers/trialBalance.controller.js
const mongoose = require("mongoose");

const COST_YEARLY_VIEW_TYPE = "YEARLY_COST_VIEW";

/**
 * Returns data in SAME format for all:
 * - Revenue (normal monthly docs)
 * - MP (normal monthly docs)
 * - Cost (your stored yearly doc month=0 with totalBalances[12])
 *
 * For Cost yearly doc: it "expands" into 12 monthly rows:
 * - month: 1..12
 * - balanceFirst: totalBalances[month-1]
 * And removes yearly-only fields (totalBalances/totalSum/viewType/month=0 doc).
 */
async function getTrialBalanceData(req, res) {
  try {
    const db = mongoose.connection.db;
    const collection = db.collection("westwalk_trialBal");

    const {
      year,
      month, // if provided, we will return that month only
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

    // Base query (for monthly docs + cost yearly docs)
    const base = {};
    if (year !== undefined && year !== "") base.year = Number(year);
    if (company) base.company = String(company);
    if (accountType) base.accountType = String(accountType);
    if (accountno) base.accountno = String(accountno);
    if (component) base.component = String(component);
    if (auxcode !== undefined) base.auxcode = String(auxcode);
    if (cc2 !== undefined && cc2 !== "") base.cc2 = String(cc2);
    if (cc3 !== undefined && cc3 !== "") base.cc3 = String(cc3);
    if (typeR) base.typeR = String(typeR);

    // If month is asked, we still need to include COST yearly docs (month=0) to expand and then filter.
    // So we do NOT put month into DB query for cost; we filter after expansion.
    const monthNum =
      month !== undefined && month !== "" ? Number(month) : null;

    // Pull:
    // 1) normal monthly docs (month 1..12)
    // 2) cost yearly docs (month 0 + viewType YEARLY_COST_VIEW)
    const dbQuery = {
      ...base,
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
        // Normal monthly doc (Revenue/MP/any Cost monthly if exists)
        // Ensure output format is consistent (no extra fields needed)
        out.push({
          accountno: d.accountno,
          auxcode: d.auxcode || "",
          company: d.company,
          component: d.component,
          cc2: d.cc2 || "",
          cc3: d.cc3 || "",
          balanceFirst: Number(d.balanceFirst) || 0,
          year: Number(d.year),
          month: Number(d.month),
          accountType: d.accountType,
          typeR: d.typeR || "P",
        });
        continue;
      }

      // Expand cost yearly into 12 monthly rows
      for (let i = 0; i < 12; i++) {
        const m = i + 1;
        out.push({
          accountno: d.accountno,
          auxcode: d.auxcode || "",
          company: d.company,
          component: d.component,
          cc2: d.cc2 || "",
          cc3: d.cc3 || "",
          balanceFirst: Number(d.totalBalances[i]) || 0, // ✅ month-wise
          year: Number(d.year),
          month: m,
          accountType: "Cost",
          typeR: d.typeR || "P",
        });
      }
    }

    // If user requested a specific month, filter after expansion
    const filtered = monthNum ? out.filter((x) => x.month === monthNum) : out;

    // Sort year desc, month asc, then accountno
    filtered.sort((a, b) => {
      if (a.year !== b.year) return b.year - a.year;
      if (a.month !== b.month) return a.month - b.month;
      return String(a.accountno).localeCompare(String(b.accountno));
    });

    return res.json({
      success: true,
      count: filtered.length,
      data: filtered,
    });
  } catch (err) {
    console.error("getTrialBalanceData error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Server error",
    });
  }
}

module.exports = {
  getTrialBalanceData,
};
