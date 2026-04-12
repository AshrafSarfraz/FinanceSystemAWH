const mongoose = require("mongoose");

const tenantSchema = new mongoose.Schema(
  {
    tenantName: {
      type: String,
      required: [true, "Tenant name is required"],
      trim: true,
    },
    percentage: {
      type: Number,
      required: [true, "Percentage is required"],
    },
    baseRent: {
      type: Number,
      required: [true, "Base rent is required"],
    },
    month: {
      type: String,
      required: [true, "Month is required"],
    },
    year: {
      type: Number,
      required: [true, "Year is required"],
    },
    totalRevenue: {
      type: Number,
      required: [true, "Total revenue is required"],
    },
    tor: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Tenant", tenantSchema);