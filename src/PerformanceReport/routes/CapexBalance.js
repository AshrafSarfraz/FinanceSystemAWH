const express = require("express");
const router = express.Router();
const capexController = require("../controllers/CapexBalance");

router.post("/", capexController.create);
router.get("/", capexController.getAll);
router.get("/:id", capexController.getOne);
router.put("/:id", capexController.update);
router.delete("/:id", capexController.remove);

module.exports = router;