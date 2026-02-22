const express = require("express");

const router = express.Router();

const {
  mergeAllIntoTrialBalance,
  getTrailBalance
} = require("../controllers/mergeData");


// sync + combine + save
router.post("/sync-all", mergeAllIntoTrialBalance);


// get saved data
router.get("/", getTrailBalance);


module.exports = router;