const express = require("express");
const router = express.Router();
const sql = require("mssql");
const mongoose = require("mongoose");
require("dotenv").config();

// SQL Config
const sqlConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: "10.1.1.101",
  database: process.env.DB_NAME,
  options: { encrypt: false, trustServerCertificate: true },
};

// Collection
const trialBalSchema = new mongoose.Schema(
  {},
  { collection: "othercompanies_TrailBal", strict: false }
);

const TrialBal =
  mongoose.models.TrialBal || mongoose.model("TrialBal", trialBalSchema);




// 🔹 Pick only required fields

function pickFields(r) {
  const acc = String(r.accountno || "");

  let normalizedType = "Other";

  if (acc.startsWith("4")) {
    normalizedType = "Revenue";
  } else if (acc.startsWith("5") || acc.startsWith("6")) {
    normalizedType = "Cost";
  }

  return {
    year: r.year,
    month: r.month,
    accountno: r.accountno,
    cc2: r.cc2,
    cc3: r.cc3,
    auxcode: r.auxcode,

    // sign fix
    balanceFirst: Number(r.balanceFirst) * -1,

    company: r.cmp_name,
    TypeR: r.TypeR,
    component: r.lvl5,

    // ✅ normalized
    accountType: normalizedType,
  };
}


// Sync SQL → Mongo (ONLY TypeR = 'P')
async function syncTrialBalance() {
  const pool = await sql.connect(sqlConfig);

  // 1) ✅ Delete previous stored data (only for 2023+ and TypeR=P)
  await TrialBal.deleteMany({ TypeR: "P", year: { $gte: 2023 } });

  // 2) ✅ Fetch only 2023+ from SQL
  const result = await pool.request().query(`
    SELECT *
    FROM dbo.wvfn_costcenteranalysistrialbalance
    WHERE TypeR = 'P'
      AND year >= 2023
  `);

  const cleaned = result.recordset.map(pickFields);

  if (!cleaned.length) {
    console.log("ℹ️ No TypeR='P' records found for year >= 2023");
    return;
  }

  // 3) ✅ Upsert so it clubs monthly on cc3+accountno
  await TrialBal.bulkWrite(
    cleaned.map((d) => ({
      updateOne: {
        filter: {
          year: d.year,
          month: d.month,
          accountno: d.accountno,
          cc3: d.cc3,
        },
        update: { $set: d },
        upsert: true,
      },
    }))
  );

  console.log(`✅ Synced ${cleaned.length} records (TypeR=P, year>=2023)`);
}


// Routes
router.get("/", async (req, res) => {
  const pool = await sql.connect(sqlConfig);
  const result = await pool.request().query(`
    SELECT *
    FROM dbo.wvfn_costcenteranalysistrialbalance
    WHERE TypeR = 'P'
  `);
  res.json(result.recordset);
});

router.get("/mongo", async (req, res) => {
  const docs = await TrialBal.find({ TypeR: "P" }).lean();
  res.json(docs);
});

router.post("/sync", async (req, res) => {
  await syncTrialBalance();
  res.send("✅ Manual sync complete (TypeR = P)");
});

module.exports = router;
