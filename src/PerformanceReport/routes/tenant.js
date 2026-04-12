const express = require("express");
const router = express.Router();
const {
  createTenant,
  getAllTenants,
  getTenantById,
  updateTenant,
  deleteTenant,
} = require("../controllers/Tenant");

router.post("/", createTenant);         // Create
router.get("/", getAllTenants);         // Get all
router.get("/:id", getTenantById);     // Get one
router.put("/:id", updateTenant);      // Update
router.delete("/:id", deleteTenant);   // Delete

module.exports = router;