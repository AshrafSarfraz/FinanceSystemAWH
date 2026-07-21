const multer = require("multer");
const Papa = require("papaparse");
const fs = require("fs");
const CashFlow = require("../models/CashFlow"); // ✅ tumhara model

const upload = multer({ dest: "uploads/" });

exports.uploadCashFlowCSV = [
  upload.single("file"),
  async (req, res) => {
    let filePath;

    try {
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
        .filter((row) => row && row.company && row.year)
        .map((row) => ({
          month: Number(row.month) || 0,
          year: Number(row.year),
          Amount: Number(row.Amount) || 0,
          company: row.company || "",
          component: row.component || "",
          subComponent: row.subComponent || "",
        }));

      if (!dataArray.length) {
        return res.status(400).json({
          success: false,
          message: "No valid data found in CSV",
        });
      }

      // ✅ Delete old data for same company + year
      const uniqueCompanyYears = [
        ...new Set(dataArray.map((item) => `${item.company}_${item.year}`)),
      ];

      for (const key of uniqueCompanyYears) {
        const [company, year] = key.split("_");
        await CashFlow.deleteMany({ company, year: Number(year) });
      }

      // ✅ Insert new data
      await CashFlow.insertMany(dataArray);

      fs.unlinkSync(filePath);

      return res.status(200).json({
        success: true,
        message: `${dataArray.length} records uploaded successfully`,
      });

    } catch (error) {
      console.error(error);
      if (filePath && fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch {}
      }
      return res.status(500).json({
        success: false,
        message: "CSV upload failed",
      });
    }
  },
];

// ✅ GET CashFlow data
exports.getCashFlowData = async (req, res) => {
  try {
    const { company, year, month, component, subComponent } = req.query;

    const filter = {};
    if (company) filter.company = company;
    if (year) filter.year = Number(year);
    if (month) filter.month = Number(month);
    if (component) filter.component = component;
    if (subComponent) filter.subComponent = subComponent;

    const data = await CashFlow.find(filter).lean();

    return res.status(200).json({
      success: true,
      total: data.length,
      data,
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch cashflow data",
    });
  }
};