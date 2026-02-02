// routes/budgetRoutes.js

const express = require("express");
const router = express.Router();

const {
  getAllBudgets
} = require("../controllers/budgtedAmount");

// GET All Budgets
router.get("/", getAllBudgets);

module.exports = router;
