
// const dns = require("dns");
// dns.setServers(["8.8.8.8", "1.1.1.1"]);

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
require("dotenv").config();
const cron = require("node-cron");

const { runNightlySync } = require("./src/PerformanceReport/cron/automaticCallApi");

// ✅ app must be created BEFORE using it
const app = express();

// Port (define before listen)
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());

app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "http://127.0.0.1:5173",
      "https://financesystemawh-rtjt.onrender.com",
    ],
    credentials: true,
  })
);

// Routes
const trialBalSyncRoutes = require("./src/PerformanceReport/routes/westwalk_trialBalSync");
const {router: otherCmpTrialBalance }= require("./src/PerformanceReport/database/sqlconfig");
const UploadBudget = require("./src/PerformanceReport/routes/uploadBudget");
const trialBalanceMergeRoutes = require("./src/PerformanceReport/routes/mergeData");
const ProjectsTrailBalanceRoutes =require("./src/PerformanceReport/routes/ProjectTrailBalance");
const CapexBalance =require("./src/PerformanceReport/routes/CapexBalance");
const tenant =require("./src/PerformanceReport/routes/tenant");
const DailyReport = require("./src/PerformanceReport/routes/DailyReport");
const CashFlow = require("./src/PerformanceReport/routes/CashFlow");



app.use("/api/othercmp_trialbalance", otherCmpTrialBalance);
app.use("/api/trialbalance", trialBalSyncRoutes);
app.use("/api/cashFlow", CashFlow);
app.use("/budgets", UploadBudget);
app.use("/api/trialbalance", trialBalanceMergeRoutes);
app.use("/ProjectsTrailBalance", ProjectsTrailBalanceRoutes);
app.use("/CapexBalance", CapexBalance);
app.use("/api/tenant", tenant);
app.use("/api/dailyReport", DailyReport);



// MongoDB Connect
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB Connected ✅"))
  .catch((err) => console.log("Mongo Error ❌", err));

// ✅ Schedule nightly at 4 AM Qatar time
cron.schedule(
  "0 9 * * *",
  async () => {
    await runNightlySync();
  },
  { timezone: "Asia/Qatar" }
);

console.log("⏰ Nightly sync scheduled at 4:00 AM Asia/Qatar");

// ✅ ONLY ONE listen
app.listen(PORT, () => {
  console.log("Server running on port:", PORT);

  // ✅ OPTIONAL: manual test (run once on startup)
  // runNightlySync();
});
