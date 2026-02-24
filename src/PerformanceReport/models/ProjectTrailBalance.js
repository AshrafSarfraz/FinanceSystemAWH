const mongoose = require("mongoose");

const schema = new mongoose.Schema(
  {
    month: { type: Number, required: true },
    year: { type: Number, required: true },

    typeR: { type: String, default: "" },

    accountType: {
      type: String,
      required: true,
      enum: ["Revenue", "Cost"],
    },

    budgetedAmount: { type: Number, default: 0 },
    balanceFirst: { type: Number, default: 0 },

    company: {
      type: String,
      default: "others", // ✅ default company
    },

    component: { type: String, default: "" },

    accountno: { type: String, default: "" },
    auxcode: { type: String, default: "" },
    cc2: { type: String, default: "" },
    cc3code: { type: String, default: "" },
  },
  {
    timestamps: true,
    collection: "ProjectsTrailBalance",
  }
);

module.exports = mongoose.model("ProjectsTrailBalance", schema);