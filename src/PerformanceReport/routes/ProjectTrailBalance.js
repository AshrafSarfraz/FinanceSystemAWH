const router = require("express").Router();

const controller =
require("../controllers/ProjectTrailBalance");

// CREATE
router.post("/", controller.create);
router.get("/", controller.getAll);
router.put("/:id", controller.update);
router.delete("/:id", controller.remove);


module.exports = router;