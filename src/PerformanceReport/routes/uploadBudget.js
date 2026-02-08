const express = require("express");
const router = express.Router();

const { uploadBudgetCSV } = require("../controllers/budgtedAmount");

router.post("/upload-csv", uploadBudgetCSV);

module.exports = router;
