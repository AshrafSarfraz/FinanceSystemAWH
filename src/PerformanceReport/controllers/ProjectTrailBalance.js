const ProjectsTrailBalance = require("../models/ProjectTrailBalance");


// ✅ CREATE
exports.create = async (req, res) => {
  try {
    const data = await ProjectsTrailBalance.create(req.body);
    res.json(data);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
};


// ✅ GET ALL
exports.getAll = async (req, res) => {
  try {
    const data = await ProjectsTrailBalance.find();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};


// ✅ GET ONE
exports.getOne = async (req, res) => {
  try {
    const data = await ProjectsTrailBalance.findById(req.params.id);

    if (!data)
      return res.status(404).json({ error: "Not found" });

    res.json(data);

  } catch (e) {
    res.status(400).json({ error: e.message });
  }
};


// ✅ UPDATE
exports.update = async (req, res) => {
  try {

    const data = await ProjectsTrailBalance.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );

    if (!data)
      return res.status(404).json({ error: "Not found" });

    res.json(data);

  } catch (e) {
    res.status(400).json({ error: e.message });
  }
};


// ✅ DELETE
exports.remove = async (req, res) => {
  try {

    const data = await ProjectsTrailBalance.findByIdAndDelete(
      req.params.id
    );

    if (!data)
      return res.status(404).json({ error: "Not found" });

    res.json({ message: "Deleted successfully" });

  } catch (e) {
    res.status(400).json({ error: e.message });
  }
};