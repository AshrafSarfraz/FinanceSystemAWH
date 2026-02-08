const multer = require("multer");
const Papa = require("papaparse");
const fs = require("fs");
const BudgtedAmount = require("../models/budgtedAmount");

const upload = multer({ dest: "uploads/" });

exports.uploadBudgetCSV = [
  upload.single("file"),
  async (req, res) => {
    let filePath;

    try {
      const { company, year } = req.body;

      if (!company || !year) {
        return res.status(400).json({
          success: false,
          message: "Company and year must be provided",
        });
      }

      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "CSV file is required",
        });
      }

      filePath = req.file.path;

      const csvText = fs.readFileSync(filePath, "utf8");

      const parsed = Papa.parse(csvText, {
        header: true,
        skipEmptyLines: true,
      });

      const dataArray = parsed.data
        .filter((row) => row && (row.accountno || row.month || row.year)) // basic safety
        .map((row) => ({
          accountno: row.accountno ?? "",
          cc3: row.cc3 || null,
          month: Number(row.month) || 0,
          year: Number(row.year) || Number(year),
          TypeR: row.TypeR || "P",
          accountType: row.accountType || "Other",
          auxcode: row.auxcode || null,
          balanceFirst: Number(row.balanceFirst) || 0,
          cc2: row.cc2 || null,
          company: row.company || company,
          component: row.component
            ? row.component.replace(/^\d+\s*-\s*/, "")
            : "",
        }));

      // delete old by company+year (year from request)
      await BudgtedAmount.deleteMany({ company, year: Number(year) });

      if (dataArray.length) {
        await BudgtedAmount.insertMany(dataArray);
      }

      fs.unlinkSync(filePath);

      return res.status(200).json({
        success: true,
        message: `${dataArray.length} records uploaded successfully for ${company} (${year})`,
      });
    } catch (error) {
      console.error(error);

      // cleanup if something failed
      if (filePath && fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch {}
      }

      return res.status(500).json({
        success: false,
        message: "CSV upload failed",
      });
    }
  },
];
