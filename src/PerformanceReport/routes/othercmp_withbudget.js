const {
    getOtherCompaniesTrialBalanceWithBudget,
  } = require("../controllers/othercmp_withBudget");
  

  router.get("/othercmp-with-budget", getOtherCompaniesTrialBalanceWithBudget);