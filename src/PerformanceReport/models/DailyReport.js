const mongoose = require("mongoose");

const pdfRecordSchema = new mongoose.Schema(
  {
    category: {
      type: String,
      required: true,
      default: "general",
      // Examples: "general", "salary_slip", "invoice", "report"
      // One PDF per category — new upload replaces old one
    },
    fileName: {
      type: String,
      required: true,
    },
    fileUrl: {
      type: String,
      required: true, // Public Firebase URL
    },
    firebasePath: {
      type: String,
      required: true, // Path inside Firebase bucket e.g. "pdfs/general/1234_file.pdf"
    },
    size: {
      type: Number, // File size in bytes
    },
    uploadedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

// One PDF per category (unique constraint)
pdfRecordSchema.index({ category: 1 }, { unique: true });

module.exports = mongoose.model("Dailyreport", pdfRecordSchema);