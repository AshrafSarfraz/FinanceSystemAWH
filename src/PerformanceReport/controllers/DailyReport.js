const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { bucket } = require("../database/firebase");
const PdfRecord = require("../models/DailyReport");

// ─── Multer Config (local temp storage) ───────────────────────────────────────
const upload = multer({
  dest: "uploads/",
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "application/pdf") {
      cb(null, true);
    } else {
      cb(new Error("Only PDF files are allowed"), false);
    }
  },
  limits: { fileSize: 16 * 1024 * 1024 }, // 16MB max
});

// ─── Helper: Upload file to Firebase ──────────────────────────────────────────
const uploadToFirebase = (localPath, destFileName) => {
  return new Promise((resolve, reject) => {
    bucket.upload(localPath, {
      destination: destFileName,
      metadata: {
        contentType: "application/pdf",
      },
    }, async (err, file) => {
      if (err) return reject(err);

      // Make file publicly accessible
      await file.makePublic();

      // Public URL
      const publicUrl = `https://storage.googleapis.com/${bucket.name}/${destFileName}`;
      resolve(publicUrl);
    });
  });
};

// ─── Helper: Delete file from Firebase ────────────────────────────────────────
const deleteFromFirebase = async (fileUrl) => {
  try {
    // Extract file path from URL
    // URL format: https://storage.googleapis.com/BUCKET_NAME/path/to/file.pdf
    const bucketName = bucket.name;
    const prefix = `https://storage.googleapis.com/${bucketName}/`;
    const filePath = fileUrl.replace(prefix, "");

    await bucket.file(filePath).delete();
    console.log(`Deleted from Firebase: ${filePath}`);
  } catch (err) {
    // If file not found, ignore — don't crash the upload
    console.warn("Could not delete previous file from Firebase:", err.message);
  }
};

// ─── POST /api/pdf/upload ──────────────────────────────────────────────────────
// Upload a new PDF — previous PDF is auto-deleted from Firebase + MongoDB
exports.uploadPdf = [
  upload.single("file"),
  async (req, res) => {
    let localFilePath;

    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "PDF file is required",
        });
      }

      localFilePath = req.file.path;

      const { category } = req.body;
      // category is optional — use it if you want to group PDFs
      // e.g. "salary_slip", "invoice", "report"
      // If not provided, defaults to "general"
      const pdfCategory = category || "general";

      // ── STEP 1: Find previous PDF for this category ──────────────────────────
      const previousPdf = await PdfRecord.findOne({ category: pdfCategory });

      // ── STEP 2: Delete previous PDF from Firebase ────────────────────────────
      if (previousPdf && previousPdf.fileUrl) {
        await deleteFromFirebase(previousPdf.fileUrl);
      }

      // ── STEP 3: Upload new PDF to Firebase ───────────────────────────────────
      const timestamp = Date.now();
      const originalName = req.file.originalname.replace(/\s+/g, "_");
      const destFileName = `pdfs/${pdfCategory}/${timestamp}_${originalName}`;

      const fileUrl = await uploadToFirebase(localFilePath, destFileName);

      // ── STEP 4: Save/Update record in MongoDB ────────────────────────────────
      const pdfData = {
        category: pdfCategory,
        fileName: originalName,
        fileUrl,
        firebasePath: destFileName,
        uploadedAt: new Date(),
        size: req.file.size,
      };

      let savedPdf;

      if (previousPdf) {
        // Update existing record
        savedPdf = await PdfRecord.findByIdAndUpdate(
          previousPdf._id,
          pdfData,
          { new: true }
        );
      } else {
        // Create new record
        savedPdf = await PdfRecord.create(pdfData);
      }

      // ── STEP 5: Cleanup local temp file ──────────────────────────────────────
      fs.unlinkSync(localFilePath);

      return res.status(200).json({
        success: true,
        message: previousPdf
          ? "Previous PDF deleted and new PDF uploaded successfully"
          : "PDF uploaded successfully",
        data: savedPdf,
      });
    } catch (error) {
      console.error("PDF Upload Error:", error);

      // Cleanup local temp file on error
      if (localFilePath && fs.existsSync(localFilePath)) {
        try { fs.unlinkSync(localFilePath); } catch {}
      }

      return res.status(500).json({
        success: false,
        message: error.message || "PDF upload failed",
      });
    }
  },
];

// ─── GET /api/pdf ──────────────────────────────────────────────────────────────
// Get current PDF (by category)
exports.getPdf = async (req, res) => {
  try {
    const { category = "general" } = req.query;

    const pdf = await PdfRecord.findOne({ category }).lean();

    if (!pdf) {
      return res.status(404).json({
        success: false,
        message: "No PDF found for this category",
      });
    }

    return res.status(200).json({
      success: true,
      data: pdf,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch PDF",
    });
  }
};

// ─── GET /api/pdf/all ──────────────────────────────────────────────────────────
// Get all PDFs (all categories)
exports.getAllPdfs = async (req, res) => {
  try {
    const pdfs = await PdfRecord.find().lean();

    return res.status(200).json({
      success: true,
      total: pdfs.length,
      data: pdfs,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch PDFs",
    });
  }
};

// ─── DELETE /api/pdf ───────────────────────────────────────────────────────────
// Manually delete a PDF by category
exports.deletePdf = async (req, res) => {
  try {
    const { category = "general" } = req.query;

    const pdf = await PdfRecord.findOne({ category });

    if (!pdf) {
      return res.status(404).json({
        success: false,
        message: "No PDF found for this category",
      });
    }

    // Delete from Firebase
    await deleteFromFirebase(pdf.fileUrl);

    // Delete from MongoDB
    await PdfRecord.findByIdAndDelete(pdf._id);

    return res.status(200).json({
      success: true,
      message: "PDF deleted successfully",
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete PDF",
    });
  }
};