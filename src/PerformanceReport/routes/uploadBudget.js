const express = require("express");
const router = express.Router();

const { uploadBudgetCSV,  getAllBudgetedData, } = require("../controllers/budgtedAmount");

router.post("/upload-csv", uploadBudgetCSV);
router.get("/getdata", getAllBudgetedData);

module.exports = router;
