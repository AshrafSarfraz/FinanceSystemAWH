const express = require("express");
const router = express.Router(); 

const { uploadCashFlowCSV, getCashFlowData } = require("../controllers/cashflow");

router.post("/upload-csv", uploadCashFlowCSV);
router.get("/getdata", getCashFlowData);

module.exports = router;