const Tenant = require("../models/tenant");

// TOR Logic: (revenue * percentage) - baseRent > 0 ? result : 0
const calculateTOR = (totalRevenue, percentage, baseRent) => {
  const result = totalRevenue * (percentage / 100) - baseRent;
  return result > 0 ? parseFloat(result.toFixed(2)) : 0;
};

// ─────────────────────────────────────────
// POST /api/tenant — Create (sab kuch ek saath)
// ─────────────────────────────────────────
const createTenant = async (req, res) => {
  try {
    const { tenantName, percentage, baseRent, month, year, totalRevenue } = req.body;

    const tor = calculateTOR(totalRevenue, percentage, baseRent);

    const tenant = await Tenant.create({
      tenantName,
      percentage,
      baseRent,
      month,
      year,
      totalRevenue,
      tor,
    });

    res.status(201).json({
      success: true,
      message: "Tenant created successfully",
      data: tenant,
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getAllTenants = async (req, res) => {
  try {
    const tenants = await Tenant.find();

    // Agar TOR 0 hai to recalculate karo aur DB update bhi karo
    const updatedTenants = await Promise.all(
      tenants.map(async (tenant) => {
        if (tenant.tor === 0 || tenant.tor === null || tenant.tor === undefined) {
          const recalculated = calculateTOR(tenant.totalRevenue, tenant.percentage, tenant.baseRent);
          if (recalculated > 0) {
            tenant.tor = recalculated;
            await tenant.save(); // DB mein bhi fix ho jaye
          }
        }
        return tenant;
      })
    );

    res.status(200).json({
      success: true,
      count: updatedTenants.length,
      data: updatedTenants,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────
// GET /api/tenant/:id — Get single tenant
// ─────────────────────────────────────────
const getTenantById = async (req, res) => {
  try {
    const tenant = await Tenant.findById(req.params.id);
    if (!tenant) {
      return res.status(404).json({ success: false, message: "Tenant not found" });
    }

    // TOR 0 hai to recalculate
    if (tenant.tor === 0 || tenant.tor === null || tenant.tor === undefined) {
      const recalculated = calculateTOR(tenant.totalRevenue, tenant.percentage, tenant.baseRent);
      if (recalculated > 0) {
        tenant.tor = recalculated;
        await tenant.save();
      }
    }

    res.status(200).json({ success: true, data: tenant });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};


// ─────────────────────────────────────────
// PUT /api/tenant/:id — Update (TOR auto recalculate)
// ─────────────────────────────────────────
const updateTenant = async (req, res) => {
  try {
    const tenant = await Tenant.findById(req.params.id);
    if (!tenant) {
      return res.status(404).json({ success: false, message: "Tenant not found" });
    }

    const { tenantName, percentage, baseRent, month, year, totalRevenue } = req.body;

    // Update only fields that are provided
    if (tenantName) tenant.tenantName = tenantName;
    if (percentage) tenant.percentage = percentage;
    if (baseRent) tenant.baseRent = baseRent;
    if (month) tenant.month = month;
    if (year) tenant.year = year;
    if (totalRevenue !== undefined) tenant.totalRevenue = totalRevenue;

    // Recalculate TOR with latest values
    tenant.tor = calculateTOR(tenant.totalRevenue, tenant.percentage, tenant.baseRent);

    await tenant.save();

    res.status(200).json({
      success: true,
      message: "Tenant updated successfully",
      data: tenant,
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────
// DELETE /api/tenant/:id — Delete tenant
// ─────────────────────────────────────────
const deleteTenant = async (req, res) => {
  try {
    const tenant = await Tenant.findByIdAndDelete(req.params.id);
    if (!tenant) {
      return res.status(404).json({ success: false, message: "Tenant not found" });
    }
    res.status(200).json({
      success: true,
      message: "Tenant deleted successfully",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  createTenant,
  getAllTenants,
  getTenantById,
  updateTenant,
  deleteTenant,
};