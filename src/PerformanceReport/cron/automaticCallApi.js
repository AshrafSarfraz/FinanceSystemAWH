require("dotenv").config();
const mongoose = require("mongoose");

// ✅ import both sync functions
const {
  syncTrialBalance: syncWestwalkTrialBalance,
} = require("../dolphin/Westwalk_trialBalSync");

const {
  syncTrialBalance: syncOtherCompaniesTrialBalance,
} = require("../database/sqlconfig"); 
// NOTE: yeh file agar router export kar rahi hai, to controller function export karna hoga.
// (Agar yeh Express router hai, mujhe batao, main controller separate karwa dunga.)

async function ensureMongoConnected() {
  if (mongoose.connection.readyState === 1) return;

  if (mongoose.connection.readyState === 2) {
    await new Promise((resolve, reject) => {
      mongoose.connection.once("connected", resolve);
      mongoose.connection.once("error", reject);
    });
    return;
  }

  await mongoose.connect(process.env.MONGO_URI);
}

async function runNightlySync() {
  console.log("🕓 Nightly sync started:", new Date().toISOString());

  try {
    await ensureMongoConnected();

    console.log("Running WestWalk sync...");
    const westwalkRes = await syncWestwalkTrialBalance();

    console.log("Running Other Companies sync...");
    await syncOtherCompaniesTrialBalance();

    console.log("✅ Nightly sync done.");
    console.log("WestWalk result:", westwalkRes);
  } catch (err) {
    console.error("❌ Nightly sync failed:", err);
  }
}

module.exports = { runNightlySync };
