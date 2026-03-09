const router = require("express").Router();

const controller =
require("../controllers/ProjectTrailBalance");


// CREATE
router.post("/", controller.create);


// GET ALL
router.get("/", controller.getAll);



// UPDATE
router.put("/:id", controller.update);


// DELETE
router.delete("/:id", controller.remove);


module.exports = router;