const mongoose = require("mongoose");

const BudgtedAmountSchema = new mongoose.Schema(
  {
    accountno: String,
    cc3: { type: String, default: null },
    month: Number,
    year: Number,
    TypeR: { type: String, default: "P" },
    accountType: { type: String, default: "Other" },
    auxcode: { type: String, default: null },
    balanceFirst: { type: Number, default: 0 },
    cc2: { type: String, default: null },
    company: String,
    component: { type: String, default: "" },
  },
  { collection: "BudgtedAmount" }
);

module.exports = mongoose.model("BudgtedAmount", BudgtedAmountSchema);
