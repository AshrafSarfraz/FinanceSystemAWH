const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
require("dotenv").config();

const app = express(); // ✅ Sab se pehle app

// Routes
const trialBalSyncRoutes = require("./src/PerformanceReport/routes/westwalk_trialBalSync");
const otherCmpTrialBalance = require("./src/PerformanceReport/database/sqlconfig");
const budgetRoutes = require("./src/PerformanceReport/routes/budgtedAmount");
const UploadBudget = require("./src/PerformanceReport/routes/budgtedAmount");

// Middleware
app.use(express.json());

app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://localhost:3000",
      "http://l127.0.0.1:3000",
      "http://127.0.0.1:5173",
      "https://financesystemawh-rtjt.onrender.com",
    ],
    credentials: true,
  })
);

// MongoDB Connect
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB Connected ✅"))
  .catch((err) => console.log("Mongo Error ❌", err));

// Routes
app.use("/api/othercmp_trialbalance", otherCmpTrialBalance);
app.use("/api/trialbalance", trialBalSyncRoutes);
app.use("/api/budgted", budgetRoutes);
app.use("/budgets", UploadBudget);

// Port
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port:", PORT);
});
