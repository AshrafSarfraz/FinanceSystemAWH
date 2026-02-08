// routes/budgetRoutes.js
const express = require("express");
const router = express.Router();
const budgetController = require("../controllers/budgtedAmount");

router.post("/upload-csv", budgetController.uploadBudgetCSV);

module.exports = router;
