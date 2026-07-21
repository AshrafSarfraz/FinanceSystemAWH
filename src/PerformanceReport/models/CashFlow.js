const mongoose = require("mongoose");

const CashFlowAmountSchema = new mongoose.Schema(
  {
    month: Number,
    year: Number,
    Amount: { type: Number, default: 0 },
    company: String,
    component: { type: String, default: "" },
    subComponent: { type: String, default: "" },
  },
  { collection: "CashFlowAmount" }
);

module.exports = mongoose.model("CashFlow", CashFlowAmountSchema);
