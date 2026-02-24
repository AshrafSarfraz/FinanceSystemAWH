const mongoose = require("mongoose");

const { syncTrialBalance: syncWestWalk } = require("../dolphin/Westwalk_trialBalSync");
const { syncTrialBalance: syncOtherCompanies } = require("../database/sqlconfig");


// ✅ combine only
// ✅ combine 3 sources
function combineRows(westwalk = [], other = [], projects = []) {
  const ww = (westwalk || []).map((r) => ({ ...r, source: "westwalk" }));
  const oc = (other || []).map((r) => ({ ...r, source: "otherCompanies" }));
  const pr = (projects || []).map((r) => ({ ...r, source: "projects" }));

  return [...ww, ...oc, ...pr];
}

// ✅ fetch from both collections
// ✅ fetch from 3 collections
async function fetchAllFromMongo({ yearGte = 2023 } = {}) {
  const db = mongoose.connection.db;

  const westwalk = await db
    .collection("westwalk_trialBal")
    .find({ typeR: "P", year: { $gte: yearGte } })
    .toArray();

  const other = await db
    .collection("othercompanies_TrailBal")
    .find({ TypeR: "P", year: { $gte: yearGte } })
    .toArray();

  const projects = await db
    .collection("ProjectsTrailBalance")
    .find({ typeR: "P", year: { $gte: yearGte } })
    .toArray();

  // normalize othercompanies -> same keys
  const otherNormalized = other.map((r) => ({
    year: r.year,
    month: r.month,
    typeR: "P",
    accountno: r.accountno,
    cc2: r.cc2 || "",
    cc3: r.cc3 || "",
    auxcode: r.auxcode || "",
    balanceFirst: r.balanceFirst,
    company: r.company,
    component: r.component || "Unknown",
    accountType: r.accountType || "Other",
    syncedAt: r.syncedAt || null,
  }));

  // normalize projects -> same keys
  const projectsNormalized = projects.map((r) => ({
    year: r.year,
    month: r.month,
    typeR: r.typeR || "P",
    accountno: r.accountno || "",
    cc2: r.cc2 || "",
    cc3: r.cc3code || "", // ⚠️ projects me cc3code hai
    auxcode: r.auxcode || "",
    balanceFirst: r.balanceFirst || 0,
    company: r.company || "others",
    component: r.component || "",
    accountType: r.accountType || "Other",
    budgetedAmount: r.budgetedAmount || 0,
    syncedAt: r.updatedAt || r.createdAt || null,
  }));

  return { westwalk, other: otherNormalized, projects: projectsNormalized };
}



// ✅ POST API (ONLY ONE)
async function mergeAllIntoTrialBalance(req, res) {
  try {
    const yearGte = Number(req.body?.yearGte) || 2023;

    await Promise.all([syncWestWalk(), syncOtherCompanies()]);

    const { westwalk, other, projects } = await fetchAllFromMongo({ yearGte });

    const combined = combineRows(westwalk, other, projects);

    const savedCount = await saveIntoTrailBalanceCollection(combined);

    return res.json({
      ok: true,
      counts: {
        westwalk: westwalk.length,
        otherCompanies: other.length,
        projects: projects.length,
        combined: combined.length,
        saved: savedCount,
      },
      message: "Data combined (3 collections) and saved into TrailBalance collection",
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: String(err.message),
    });
  }
}




// ✅ GET combined from TrailBalance
async function getTrailBalance(req, res) {
  try {
    const db = mongoose.connection.db;

    const data = await db
      .collection("TrailBalance")
      .find({})
      .toArray();
    res.json({
      ok: true,
      total: data.length,
      data,
    });

  } catch (err) {

    res.status(500).json({
      ok: false,
      error: err.message,
    });

  }

}



module.exports = {

  mergeAllIntoTrialBalance,
  getTrailBalance,

};













// const mongoose = require("mongoose");

// const { syncTrialBalance: syncWestWalk } = require("../dolphin/Westwalk_trialBalSync");
// const { syncTrialBalance: syncOtherCompanies } = require("../database/sqlconfig");


// // ✅ combine only
// function combineRows(westwalk = [], other = []) {
//   const ww = (westwalk || []).map((r) => ({
//     ...r,
//     source: "westwalk",
//   }));

//   const oc = (other || []).map((r) => ({
//     ...r,
//     source: "otherCompanies",
//   }));

//   return [...ww, ...oc];
// }


// // ✅ fetch from both collections
// async function fetchBothFromMongo({ yearGte = 2023 } = {}) {

//   const db = mongoose.connection.db;

//   const westwalk = await db
//     .collection("westwalk_trialBal")
//     .find({ typeR: "P", year: { $gte: yearGte } })
//     .toArray();

//   const other = await db
//     .collection("othercompanies_TrailBal")
//     .find({ TypeR: "P", year: { $gte: yearGte } })
//     .toArray();

//   const otherNormalized = other.map((r) => ({
//     year: r.year,
//     month: r.month,
//     typeR: "P",
//     accountno: r.accountno,
//     cc2: r.cc2 || "",
//     cc3: r.cc3 || "",
//     auxcode: r.auxcode || "",
//     balanceFirst: r.balanceFirst,
//     company: r.company,
//     component: r.component || "Unknown",
//     accountType: r.accountType || "Other",
//     syncedAt: r.syncedAt || null,
//   }));

//   return { westwalk, other: otherNormalized };
// }



// // ✅ save into TrailBalance collection
// async function saveIntoTrailBalanceCollection(data = []) {

//   const db = mongoose.connection.db;
//   const collection = db.collection("TrailBalance");

//   if (!data.length) return 0;

//   // optional: clear old data
//   await collection.deleteMany({});

//   await collection.insertMany(data);

//   return data.length;
// }




// // ✅ POST API
// async function mergeAllIntoTrialBalance(req, res) {
//   try {
//     const yearGte = Number(req.body?.yearGte) || 2023;
//     // sync both
//     await Promise.all([
//       syncWestWalk(),
//       syncOtherCompanies(),
//     ]);
//     // fetch
//     const { westwalk, other } = await fetchBothFromMongo({ yearGte });
//     // combine
//     const combined = combineRows(westwalk, other);
//     // save into TrailBalance
//     const savedCount = await saveIntoTrailBalanceCollection(combined);

//     return res.json({
//      ok: true,
//       counts: {
//         westwalk: westwalk.length,
//         otherCompanies: other.length,
//         combined: combined.length,
//         saved: savedCount,
//       },
//       message: "Data combined and saved into TrailBalance collection",

//     });
//   } catch (err) {
//     return res.status(500).json({
//       ok: false,
//       error: String(err.message),
//     });

//   }

// }



// // ✅ GET combined from TrailBalance
// async function getTrailBalance(req, res) {
//   try {
//     const db = mongoose.connection.db;

//     const data = await db
//       .collection("TrailBalance")
//       .find({})
//       .toArray();
//     res.json({
//       ok: true,
//       total: data.length,
//       data,
//     });

//   } catch (err) {

//     res.status(500).json({
//       ok: false,
//       error: err.message,
//     });

//   }

// }



// module.exports = {

//   mergeAllIntoTrialBalance,
//   getTrailBalance,

// };
