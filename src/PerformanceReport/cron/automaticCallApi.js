require("dotenv").config();
const mongoose = require("mongoose");

const { mergeAllIntoTrialBalance } = require("../controllers/mergeData");

async function ensureMongoConnected() {
  if (mongoose.connection.readyState === 1) return;

  await mongoose.connect(process.env.MONGO_URI);
}

async function runNightlySync() {
  console.log("🕓 Nightly merge started:", new Date().toISOString());

  try {
    await ensureMongoConnected();

    // ✅ fake req, res
    const fakeReq = {
      body: {} // empty, so default 2023 use hoga
    };

    const fakeRes = {
      json: (data) => {
        console.log("✅ Merge result:", data);
      },
      status: (code) => ({
        json: (data) => {
          console.error("❌ Merge error:", code, data);
        }
      })
    };

    // ✅ direct same function call
    await mergeAllIntoTrialBalance(fakeReq, fakeRes);

    console.log("✅ Nightly merge finished");

  } catch (err) {
    console.error("❌ Nightly failed:", err);
  }
}

module.exports = { runNightlySync };