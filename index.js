

const express = require("express");
const mongoose = require("mongoose");
require("dotenv").config();


const trialBalSyncRoutes = require("./src/PerformanceReport/routes/westwalk_trialBalSync");
const otherCmpTrialBalance = require("./src/PerformanceReport/database/sqlconfig");
const budgetRoutes = require("./src/PerformanceReport/routes/budgtedAmount");



const app = express();
app.use(express.json());

// Mongo Connect
mongoose.connect(process.env.MONGO_URI);
console.log("MongoDB Connected");

// Load Trial Balance Service
app.use("/api/othercmp_trialbalance", otherCmpTrialBalance);
app.use("/api/trialbalance", trialBalSyncRoutes);
app.use("/api/budgted", budgetRoutes);


app.listen(process.env.PORT, () => console.log("Server running on 3000"));



