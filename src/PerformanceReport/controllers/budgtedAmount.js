// controllers/budgetController.js

// controllers/budgetController.js
const multer = require("multer");
const Papa = require("papaparse");
const fs = require("fs");

// Multer setup for file upload
const upload = multer({ dest: "uploads/" });

exports.uploadBudgetCSV = [
  upload.single("file"), // "file" = name of input field
  async (req, res) => {
    try {
      const db = req.app.locals.db;
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

      const filePath = req.file.path;

      // 1️⃣ Read CSV file
      const csvText = fs.readFileSync(filePath, "utf8");

      // 2️⃣ Parse CSV
      const parsed = Papa.parse(csvText, {
        header: true,
        skipEmptyLines: true,
      });

      const dataArray = parsed.data.map((row) => ({
        accountno: row.accountno,
        cc3: row.cc3 || null,
        month: Number(row.month),
        year: Number(row.year),
        TypeR: row.TypeR || "P",
        accountType: row.accountType || "Other",
        auxcode: row.auxcode || null,
        balanceFirst: Number(row.balanceFirst) || 0,
        cc2: row.cc2 || null,
        company: row.company || company,
        component: row.component || "",

        // optional: remove code prefix from component
        component: row.component
          ? row.component.replace(/^\d+\s*-\s*/, "")
          : "",
      }));

      // 3️⃣ Delete existing data for that company + year
      await db.collection("BudgtedAmount").deleteMany({
        company,
        year: Number(year),
      });

      // 4️⃣ Insert new data
      if (dataArray.length) {
        await db.collection("BudgtedAmount").insertMany(dataArray);
      }

      // 5️⃣ Cleanup uploaded file
      fs.unlinkSync(filePath);

      res.status(200).json({
        success: true,
        message: `${dataArray.length} records uploaded successfully for ${company} (${year})`,
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({
        success: false,
        message: "CSV upload failed",
      });
    }
  },
];


// exports.getAllBudgets = async (req, res) => {
//     try {
//       const db = req.app.locals.db; // existing DB connection
  
//       const data = await db
//         .collection("BudgtedAmount") // 👈 apna collection name
//         .find({})
//         .toArray();
  
//       res.status(200).json({
//         success: true,
//         data
//       });
  
//     } catch (error) {
//       console.log(error);
  
//       res.status(500).json({
//         success: false,
//         message: "Data fetch failed"
//       });
//     }
//   };
  

  