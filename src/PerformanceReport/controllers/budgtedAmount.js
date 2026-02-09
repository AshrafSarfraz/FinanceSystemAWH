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
          budgetedAmount: Number(row.budgetedAmount) || 0,
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

exports.getAllBudgetedData = async (req, res) => {
  try {
    const {
      company,
      year,
      month,
      accountType,
      accountno,
      cc2,
      cc3,
      auxcode,
      TypeR,
      component,

      page = 1,
      limit = 500, // default
      sortBy = "year",
      sortOrder = "desc",
    } = req.query;

    // build filter object only from provided params
    const filter = {};

    if (company) filter.company = company;
    if (year) filter.year = Number(year);
    if (month) filter.month = Number(month);
    if (accountType) filter.accountType = accountType;
    if (accountno) filter.accountno = accountno;
    if (cc2) filter.cc2 = cc2;
    if (cc3) filter.cc3 = cc3;
    if (auxcode) filter.auxcode = auxcode;
    if (TypeR) filter.TypeR = TypeR;

    // partial match for component (optional)
    if (component) filter.component = { $regex: component, $options: "i" };

    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(5000, Math.max(1, Number(limit) || 500)); // safety
    const skip = (pageNum - 1) * limitNum;

    const sort = { [sortBy]: sortOrder === "asc" ? 1 : -1 };

    const [total, data] = await Promise.all([
      BudgtedAmount.countDocuments(filter),
      BudgtedAmount.find(filter)
        .sort(sort)
        .skip(skip)
        .limit(limitNum)
        .lean(),
    ]);

    return res.status(200).json({
      success: true,
      total,
      page: pageNum,
      limit: limitNum,
      data,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch budgeted data",
    });
  }
};
