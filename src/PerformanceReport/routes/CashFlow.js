const express = require("express");
const router = express.Router(); 

const { uploadCashFlowCSV, getCashFlowData } = require("../controllers/CashFlowAmount");

router.post("/upload-csv", uploadCashFlowCSV);
router.get("/getdata", getCashFlowData);

module.exports = router;