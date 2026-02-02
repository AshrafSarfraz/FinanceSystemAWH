const router = require("express").Router();
const service = require("../dolphin/Westwalk_trialBalSync");

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




const { getTrialBalanceData } = require("../controllers/ww_TrailBal");

// GET /api/trial-balance?year=2023&month=1&accountType=Cost
router.get("/mongo", getTrialBalanceData);



module.exports = router;
