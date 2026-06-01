const multer = require("multer");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid"); // npm install uuid
const { bucket } = require("../database/firebase");
const PdfRecord = require("../models/DailyReport");

// ─── Multer Config ─────────────────────────────────────────────────────────────
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
const uploadToFirebase = async (localPath, destFileName) => {
  const token = uuidv4(); // ✅ unique token generate karo

  await bucket.upload(localPath, {
    destination: destFileName,
    metadata: {
      contentType: "application/pdf",
      metadata: {
        firebaseStorageDownloadTokens: token, // ✅ token attach karo
      },
    },
  });

  // ✅ Firebase proper URL with token — direct accessible
  const encodedPath = encodeURIComponent(destFileName);
  const publicUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodedPath}?alt=media&token=${token}`;

  return publicUrl;
};

// ─── Helper: Delete file from Firebase ────────────────────────────────────────
const deleteFromFirebase = async (fileUrl) => {
  try {
    let filePath;

    // ✅ Dono URL formats handle karo (purana google URL + naya firebase URL)
    if (fileUrl.includes("firebasestorage.googleapis.com")) {
      // https://firebasestorage.googleapis.com/v0/b/BUCKET/o/ENCODED_PATH?alt=media&token=TOKEN
      const urlObj = new URL(fileUrl);
      filePath = decodeURIComponent(urlObj.pathname.split("/o/")[1]);
    } else {
      // https://storage.googleapis.com/BUCKET_NAME/path/to/file.pdf
      const prefix = `https://storage.googleapis.com/${bucket.name}/`;
      filePath = fileUrl.replace(prefix, "");
    }

    await bucket.file(filePath).delete();
    console.log(`Deleted from Firebase: ${filePath}`);
  } catch (err) {
    console.warn("Could not delete previous file from Firebase:", err.message);
  }
};

// ─── POST /api/pdf/upload ──────────────────────────────────────────────────────
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
      const pdfCategory = category || "general";

      // ✅ File name — agar original name nahi hai to "DailyReport" use karo
      const rawName = req.file.originalname
        ? req.file.originalname.replace(/\s+/g, "_")
        : "DailyReport.pdf";

      // ✅ Extension check — agar .pdf nahi hai to add karo
      const fileName = rawName.endsWith(".pdf") ? rawName : `${rawName}.pdf`;

      // ── STEP 1: Find previous PDF ────────────────────────────────────────────
      const previousPdf = await PdfRecord.findOne({ category: pdfCategory });

      // ── STEP 2: Delete previous from Firebase ────────────────────────────────
      if (previousPdf && previousPdf.fileUrl) {
        await deleteFromFirebase(previousPdf.fileUrl);
      }

      // ── STEP 3: Upload new PDF to Firebase ───────────────────────────────────
      const timestamp = Date.now();
      const destFileName = `pdfs/${pdfCategory}/${timestamp}_${fileName}`;
      const fileUrl = await uploadToFirebase(localFilePath, destFileName);

      // ── STEP 4: Save/Update MongoDB ──────────────────────────────────────────
      const pdfData = {
        category: pdfCategory,
        fileName,
        fileUrl,
        firebasePath: destFileName,
        uploadedAt: new Date(),
        size: req.file.size,
      };

      let savedPdf;
      if (previousPdf) {
        savedPdf = await PdfRecord.findByIdAndUpdate(
          previousPdf._id,
          pdfData,
          { new: true }
        );
      } else {
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

    return res.status(200).json({ success: true, data: pdf });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch PDF",
    });
  }
};

// ─── GET /api/pdf/all ──────────────────────────────────────────────────────────
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

    await deleteFromFirebase(pdf.fileUrl);
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