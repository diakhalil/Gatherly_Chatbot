import { Router } from "express";
import db from "../config/db.js";
import { verifyToken, isAdmin, isUser, isUserOrAdmin, requireActiveHost } from "../middleware/auth.js";

const router = Router();



//validate required fields
function validateRequiredFields(body, requiredFields) {
  const missingFields = requiredFields.filter(
    (field) => !body[field] || body[field].toString().trim() === ""
  );

  if (missingFields.length > 0) {
    return {
      ok: false,
      status: 400,
      body: {
        message: "Missing required fields",
        missing: missingFields,
      },
    };
  }

  return { ok: true };
}

//validate date and time
function validateDateAndTime(date, startTime, endTime) {

  const dateOnly = typeof date === "string" ? date.split("T")[0] : "";
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

  if (!dateRegex.test(dateOnly)) {
    return {
      ok: false,
      status: 400,
      body: { message: "Date must be in format YYYY-MM-DD" },
    };
  }

  const trainingDate = new Date(dateOnly);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (trainingDate < today) {
    return {
      ok: false,
      status: 400,
      body: { message: "Training date is invalid" },
    };
  }

//validate time format HH:MM:SS
  const timeRegex = /^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/;

  if (!timeRegex.test(startTime)) {
    return {
      ok: false,
      status: 400,
      body: { message: "Start time must be in format HH:MM:SS" },
    };
  }

  if (!timeRegex.test(endTime)) {
    return {
      ok: false,
      status: 400,
      body: { message: "End time must be in format HH:MM:SS" },
    };
  }

  const toSeconds = (t) => {
    const [h, m, s] = t.split(":").map(Number);
    return h * 3600 + m * 60 + s;
  };

  if (toSeconds(startTime) >= toSeconds(endTime)) {
    return {
      ok: false,
      status: 400,
      body: { message: "Start time must be before end time" },
    };
  }

  // all good
  return {
    ok: true,
    dateOnly, // cleaned date to insert/update in DB
  };
}


//GET all trainings (user/admin)
router.get("/", verifyToken, isUserOrAdmin, async (_req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT t.*,
              COUNT(tr.userId) AS enrolledCount
         FROM TRAINING t
    LEFT JOIN TRAINEES tr ON tr.trainingId = t.trainingId
     GROUP BY t.trainingId
     ORDER BY t.date DESC, t.startTime DESC`
    );
    res.json(
      rows.map((row) => ({
        ...row,
        enrolledCount: Number(row.enrolledCount || 0),
      }))
    );
  } catch (err) {
    console.error("Failed to fetch training", err);
    res.status(500).json({ message: "Failed to fetch trainings" });
  }
});

// GET training by id
router.get("/:id", verifyToken, isUserOrAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await db.query(
      "SELECT * FROM TRAINING WHERE trainingId = ?",
      [id]
    );
    if (!rows.length) {
      return res.status(404).json({ message: "Training not found" });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error("Failed to fetch training", err);
    res.status(500).json({ message: "Failed to fetch training" });
  }
});

// apply to a training (host/user)
router.post("/:id/apply", verifyToken, requireActiveHost, async (req, res) => {
  const trainingId = parseInt(req.params.id, 10);
  if (Number.isNaN(trainingId)) {
    return res.status(400).json({ message: "Invalid training id" });
  }

  try {
    // make sure training exists
    const [trainingRows] = await db.query("SELECT trainingId FROM TRAINING WHERE trainingId = ?", [trainingId]);
    if (!trainingRows.length) {
      return res.status(404).json({ message: "Training not found" });
    }

    await db.query(
      "INSERT INTO TRAINEES (userId, trainingId) VALUES (?, ?)",
      [req.user.id, trainingId]
    );

    res.status(201).json({ message: "Applied to training" });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "Already applied to this training" });
    }
    console.error("Failed to apply to training", err);
    res.status(500).json({ message: "Failed to apply to training" });
  }
});

// CREATE training (admin only)
router.post("/", verifyToken, isAdmin, async (req, res) => {
  const requiredFields = [
    "title",
    "type",
    "description",
    "startTime",
    "endTime",
    "location",
    "date",
  ];

  //required fields
  const reqCheck = validateRequiredFields(req.body, requiredFields);
  if (!reqCheck.ok) {
    return res.status(reqCheck.status).json(reqCheck.body);
  }

  const { title, type, description, startTime, endTime, location, date } = req.body;

  //date & time
  const dtCheck = validateDateAndTime(date, startTime, endTime);
  if (!dtCheck.ok) {
    return res.status(dtCheck.status).json(dtCheck.body);
  }

  const { dateOnly } = dtCheck;

  // CREATE
  try {
    const [result] = await db.query(
      `INSERT INTO TRAINING (title, type, description, startTime, endTime, location, date)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [title, type, description, startTime, endTime, location, dateOnly]
    );

    res
      .status(201)
      .json({ trainingId: result.insertId, message: "Training created" });
  } catch (err) {
    console.error("Failed to create training", err);
    res.status(500).json({ message: "Failed to create training" });
  }
});

// UPDATE training (admin only)
router.put("/:id", verifyToken, isAdmin, async (req, res) => {
  const requiredFields = [
    "title",
    "type",
    "description",
    "startTime",
    "endTime",
    "location",
    "date",
  ];

  //required fields
  const reqCheck = validateRequiredFields(req.body, requiredFields);
  if (!reqCheck.ok) {
    return res.status(reqCheck.status).json(reqCheck.body);
  }

  const { id } = req.params;
  const { title, type, description, startTime, endTime, location, date } = req.body;

  //date & time
  const dtCheck = validateDateAndTime(date, startTime, endTime);
  if (!dtCheck.ok) {
    return res.status(dtCheck.status).json(dtCheck.body);
  }

  const { dateOnly } = dtCheck;

  //update
  try {
    const [result] = await db.query(
      `UPDATE TRAINING
       SET title = ?, type = ?, description = ?, startTime = ?, endTime = ?, location = ?, date = ?
       WHERE trainingId = ?`,
      [title, type, description, startTime, endTime, location, dateOnly, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Training not found" });
    }

    res.json({ message: "Training updated" });
  } catch (err) {
    console.error("Failed to update training", err);
    res.status(500).json({ message: "Failed to update training" });
  }
});

// DELETE training (admin only)
router.delete("/:id", verifyToken, isAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const [result] = await db.query(
      "DELETE FROM TRAINING WHERE trainingId = ?",
      [id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Training not found" });
    }
    res.json({ message: "Training deleted" });
  } catch (err) {
    console.error("Failed to delete training", err);
    res.status(500).json({ message: "Failed to delete training" });
  }
});

//list attendees for a training (admin only)
router.get("/:id/attendees", verifyToken, isAdmin, async (req, res) => {
  const trainingId = parseInt(req.params.id, 10);
  if (Number.isNaN(trainingId)) {
    return res.status(400).json({ message: "Invalid training id" });
  }

  try {
    const [rows] = await db.query(
      `SELECT tr.userId,
              u.fName,
              u.lName,
              u.email,
              u.phoneNb,
              u.clothingSize,
              tr.trainingId
         FROM TRAINEES tr
         JOIN USERS u ON u.userId = tr.userId
        WHERE tr.trainingId = ?
     ORDER BY u.fName, u.lName`,
      [trainingId]
    );
    res.json(rows);
  } catch (err) {
    console.error("Failed to fetch training attendees", err);
    res.status(500).json({ message: "Failed to fetch attendees" });
  }
});

export default router;
