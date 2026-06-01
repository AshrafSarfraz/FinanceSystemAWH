const express = require("express");
const router = express.Router();
const pdfController = require("../controllers/DailyReport");

// POST   /api/pdf/upload   → Upload new PDF (auto deletes previous)
router.post("/upload", pdfController.uploadPdf);

// GET    /api/pdf           → Get PDF by category
router.get("/", pdfController.getPdf);

// GET    /api/pdf/all       → Get all PDFs
router.get("/all", pdfController.getAllPdfs);

// DELETE /api/pdf           → Manually delete PDF by category
router.delete("/", pdfController.deletePdf);

module.exports = router;