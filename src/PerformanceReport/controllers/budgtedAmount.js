// controllers/budgtedAmount.js

const mongoose = require("mongoose");

exports.getAllBudgets = async (req, res) => {
  try {
    // ✅ Get native db from mongoose
    const db = mongoose.connection.db;

    if (!db) {
      return res.status(500).json({
        success: false,
        message: "DB not connected"
      });
    }

    const data = await db
      .collection("BudgtedAmount") // exact collection name
      .find({})
      .toArray();

    res.status(200).json({
      success: true,
      data
    });

  } catch (error) {
    console.error("Budget Error:", error);

    res.status(500).json({
      success: false,
      message: "Data fetch failed"
    });
  }
};
