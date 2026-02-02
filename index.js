const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
require("dotenv").config();

const app = express(); // ✅ Sab se pehle app

// Routes
const trialBalSyncRoutes = require("./src/PerformanceReport/routes/westwalk_trialBalSync");
const otherCmpTrialBalance = require("./src/PerformanceReport/database/sqlconfig");
const budgetRoutes = require("./src/PerformanceReport/routes/budgtedAmount");

// Middleware
app.use(express.json());

app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "https://al-wessilholding.com",
      "https://halab-saudi.vercel.app",
      "https://financesystemawh.onrender.com",
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

// Port
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port:", PORT);
});
