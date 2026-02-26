// controllers/trialBalance.controller.js

const mongoose = require("mongoose");

/**
 * Normalize string (used only for Budget mapping)
 */
function normalize(v) {
  return String(v ?? "")
    .trim()
    .replace(/\s+/g, "")
    .toLowerCase();
}

/**
 * Mapping key (Budget ↔ TrialBalance)
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

    const trialCol = db.collection("TrailBalance");
    const budgetCol = db.collection("BudgtedAmount");

    // ✅ NEW collection
    const projectCol = db.collection("ProjectsTrailBalance");


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


    // Base filter
    const base = {};

    if (year !== undefined && year !== "")
      base.year = Number(year);

    if (company)
      base.company = String(company);

    if (accountType)
      base.accountType = String(accountType);

    if (component)
      base.component = String(component);

    if (accountno)
      base.accountno = String(accountno);

    if (auxcode !== undefined)
      base.auxcode = String(auxcode);

    if (cc2 !== undefined && cc2 !== "")
      base.cc2 = String(cc2);

    if (cc3 !== undefined && cc3 !== "")
      base.cc3 = String(cc3);

    if (typeR)
      base.typeR = String(typeR);


    const monthNum =
      month !== undefined && month !== ""
        ? Number(month)
        : null;


    const dbQuery = { ...base };

    if (monthNum)
      dbQuery.month = monthNum;


    // =============================
    // 1. Fetch TrialBalance
    // =============================

    const trialRows = await trialCol
      .find(dbQuery)
      .skip(safeSkip)
      .limit(safeLimit)
      .toArray();



    // =============================
    // 2. Fetch Budget
    // =============================

    const budgetMatch = { ...base };

    if (monthNum)
      budgetMatch.month = monthNum;


    const budgets =
      await budgetCol.find(budgetMatch).toArray();



    // =============================
    // 3. Budget Mapping
    // =============================

    const budgetMap = new Map();


    for (const b of budgets) {

      const key = makeKey(b);

      const prev = budgetMap.get(key) || 0;

      budgetMap.set(
        key,
        prev + Number(b.budgetedAmount || 0)
      );

    }



    // Attach budget to TrialBalance

    const withBudget = trialRows.map((x) => {

      const key = makeKey(x);

      return {

        ...x,

        budgetedAmount:
          Number(budgetMap.get(key) || 0),

      };

    });



    // =============================
    // 4. Handle unmatched budgets
    // =============================

    for (const b of budgets) {

      const exactKey = makeKey(b);


      if (
        withBudget.some(
          x => makeKey(x) === exactKey
        )
      )
        continue;



      withBudget.push({

        year: b.year,

        month: b.month,

        accountno:
          b.accountno || "Unknown",

        company: b.company,

        component: b.component,

        accountType: b.accountType,

        auxcode: b.auxcode || "",

        cc2: b.cc2 || "",

        cc3: b.cc3 || "",

        balanceFirst: 0,

        budgetedAmount:
          Number(b.budgetedAmount || 0),

        note:
          "Added from budget only",

      });

    }



    // =============================
    // 5. ✅ Fetch ProjectsTrailBalance
    // =============================

    const projectMatch = { ...base };

    if (monthNum)
      projectMatch.month = monthNum;


    const projectRows =
      await projectCol
        .find(projectMatch)
        .toArray();




    // =============================
    // 6. ✅ Append Project Data
    // =============================

    for (const p of projectRows) {

      withBudget.push({

        ...p,

        source: "project",

        note:
          "Added from ProjectsTrailBalance",

      });

    }



    // =============================
    // 7. Sort Final Result
    // =============================

    withBudget.sort((a, b) => {

      const ay =
        Number(a.year) || 0;

      const by =
        Number(b.year) || 0;

      if (ay !== by)
        return by - ay;



      const am =
        Number(a.month) || 0;

      const bm =
        Number(b.month) || 0;

      if (am !== bm)
        return bm - am;



      return String(
        a.accountno ?? ""
      ).localeCompare(
        String(b.accountno ?? "")
      );

    });



    // =============================
    // 8. Return Response
    // =============================

    return res.json({

      success: true,

      count: withBudget.length,

      data: withBudget,

    });



  }
  catch (err) {

    console.error(
      "getTrialBalanceData error:",
      err
    );

    return res.status(500).json({

      success: false,

      message:
        err.message ||
        "Server error",

    });

  }
}


module.exports =
  { getTrialBalanceData };