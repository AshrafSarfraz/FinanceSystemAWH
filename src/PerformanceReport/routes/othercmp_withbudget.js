const {
    getOtherCompaniesTrialBalanceWithBudget,
  } = require("../controllers/othercmp_withBudget");
  

  router.get("/mongo-with-budget", getOtherCompaniesTrialBalanceWithBudget);