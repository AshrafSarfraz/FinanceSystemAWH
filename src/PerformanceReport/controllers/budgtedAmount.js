// controllers/budgetController.js

exports.getAllBudgets = async (req, res) => {
    try {
      const db = req.app.locals.db; // existing DB connection
  
      const data = await db
        .collection("BudgtedAmount") // 👈 apna collection name
        .find({})
        .toArray();
  
      res.status(200).json({
        success: true,
        data
      });
  
    } catch (error) {
      console.log(error);
  
      res.status(500).json({
        success: false,
        message: "Data fetch failed"
      });
    }
  };
  

  