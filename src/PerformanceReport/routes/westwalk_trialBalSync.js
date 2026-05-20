const router = require("express").Router();
const service = require("../dolphin/Westwalk_trialBalSync");
const { getTrialBalanceData } = require("../controllers/TB_Map_Budget");

// Manual API trigger
router.post("/sync", async (req, res) => {
  try {
    const count = await service.syncTrialBalance();
    res.json({ message: "Synced Successfully", count });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Fetch raw trial balance
router.post("/", async (req, res) => {
  try {
    const { authkey, cookie } = await service.dolphinLogin();
    const rows = await service.fetchTrialBalance(authkey, cookie);
    const data = service.filterAndEnrich(rows);

    res.json({
      username: service.FIXED_USERNAME,
      fkcmpseq: service.FIXED_CMPSEQ,
      count: data.length,
      data,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});


// GET /api/trial-balance?year=2023&month=1&accountType=Cost
router.get("/mongo", getTrialBalanceData);



module.exports = router;






// Raw Data 

// const express = require("express");
// const router = express.Router();

// const {
//   getRawTrialBalance,
// } = require("../dolphin/Westwalk_trialBalSync");

// router.get("/raw-trial-balance", getRawTrialBalance);

// module.exports = router;