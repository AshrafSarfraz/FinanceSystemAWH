const mongoose = require("mongoose");

const schema = new mongoose.Schema(
  {
    // typeR: { type: String, default: "P" },
    Project: { type: String, default: "" },
    accountType: {
      type: String,
      required: true,
      enum: ["NetProfit", "Cost"],
    },
    component: { type: String, default: "" },
    year: { type: Number, required: true },
    Amount: { type: Number, default: 0 },
    PRwithFinance: { type: Number, default: 0 },
    PRwithoutFinance: { type: Number, default: 0 },
  
    // accountno: { type: String, default: "" },
    // auxcode: { type: String, default: "" },
    // cc2: { type: String, default: "" },
    // cc3: { type: String, default: "" },
  },
  {
    timestamps: true,
    collection: "CapexBalance",
  }
);

module.exports = mongoose.model("CapexBalance", schema);