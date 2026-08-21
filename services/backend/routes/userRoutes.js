import { Router } from "express";
import db from "../config/db.js";
import { verifyToken, isAdmin, isUserOrAdmin } from "../middleware/auth.js";
import bcrypt from "bcryptjs";

const router = Router();

const validateUserPayload = (body, { requirePassword = true } = {}) => {
  const errors = [];
  const allowedGenders = ["M", "F", "Other"];
  const allowedClothingSizes = ["XS", "S", "M", "L", "XL"];

  const {
    fName,
    lName,
    email,
    password,
    phoneNb,
    age,
    gender,
    address,
    clothingSize,
    description,
    profilePic,
  } = body;

  if (!fName || !fName.trim()) errors.push("First name is required.");
  if (!lName || !lName.trim()) errors.push("Last name is required.");
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    errors.push("Valid email is required.");
  if (requirePassword && (!password || password.length < 6))
    errors.push("Password must be at least 6 characters.");
  if (!phoneNb || !phoneNb.trim()) errors.push("Phone number is required.");

  const ageValue = Number(age);
  if (
    Number.isNaN(ageValue) ||
    ageValue < 18 ||
    ageValue > 80
  ) {
    errors.push("Age must be between 18 and 80.");
  }

  const genderValue = gender?.trim();
  if (!genderValue) {
    errors.push("Gender is required.");
  } else if (!allowedGenders.includes(genderValue)) {
    errors.push("Gender must be M, F, or Other.");
  }

  if (!address || !address.trim()) errors.push("Address is required.");
  const clothingValue = clothingSize?.trim();
  if (!clothingValue) {
    errors.push("Clothing size is required.");
  } else if (!allowedClothingSizes.includes(clothingValue)) {
    errors.push("Clothing size must be one of XS, S, M, L, XL.");
  }
  if (!description || !description.trim())
    errors.push("Description is required.");

  return errors;
};

const handleDbError = (err, res, defaultMessage) => {
  if (err.code === "ER_DUP_ENTRY") {
    return res.status(409).json({ message: "Email already exists." });
  }
  console.error(defaultMessage, err);
  return res.status(500).json({ message: defaultMessage });
};

// GET /api/users - Fetch all users (hosts/hostesses)
// router.get("/", verifyToken, isAdmin, async (req, res) => {
//   try {
//     const [rows] = await db.query("SELECT * FROM USERS");
//     res.json(rows);
//   } catch (err) {
//     console.error("Failed to fetch users", err);
//     res.status(500).json({ message: "Failed to fetch users" });
//   }
// });

router.get("/", verifyToken, isAdmin, async (req, res) => {
  try {
    let query = "SELECT * FROM USERS";
    let params = [];

    if (req.query.eligibility) {
      query += " WHERE eligibility = ?";
      params.push(req.query.eligibility);
    }

    const [rows] = await db.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error("Failed to fetch users", err);
    res.status(500).json({ message: "Failed to fetch users" });
  }
});

// GET /api/users/:id/overview - Fetch profile summary with related data
router.get("/:id/overview", verifyToken, isUserOrAdmin, async (req, res) => {
  const requestedId = parseInt(req.params.id, 10);
  if (Number.isNaN(requestedId)) {
    return res.status(400).json({ message: "Invalid user id" });
  }

  if (req.user.role !== "admin" && req.user.id !== requestedId) {
    return res.status(403).json({ message: "Access denied" });
  }

  try {
    const [userRows] = await db.query(
      `SELECT userId, fName, lName, email, phoneNb, profilePic, age, gender,
              address, isActive, eligibility, clothingSize, description, createdAt, updatedAt
         FROM USERS
        WHERE userId = ?`,
      [requestedId]
    );

    if (!userRows.length) {
      return res.status(404).json({ message: "User not found" });
    }

    const profile = userRows[0];

    const [applications] = await db.query(
      `SELECT ea.eventAppId, ea.status, ea.requestedRole, ea.assignedRole, ea.notes, ea.sentAt,
              e.eventId, e.title, e.type, e.location, e.startsAt
         FROM EVENT_APP ea
         JOIN EVENTS e ON e.eventId = ea.eventId
        WHERE ea.senderId = ?
        ORDER BY ea.sentAt DESC`,
      [requestedId]
    );

    const [attended] = await db.query(
      `SELECT e.eventId, e.title, e.location, e.startsAt, e.endsAt,
              ea.assignedRole,
              IFNULL(CONCAT(c.fName, ' ', c.lName), NULL) AS clientName,
              r.starRating
         FROM EVENT_APP ea
         JOIN EVENTS e ON e.eventId = ea.eventId
    LEFT JOIN CLIENTS c ON c.clientId = e.clientId
    LEFT JOIN REVIEW r ON r.eventId = e.eventId AND r.reviewerId = ea.senderId
        WHERE ea.senderId = ?
          AND ea.status = 'accepted'
          AND e.endsAt <= NOW()
        ORDER BY e.startsAt DESC`,
      [requestedId]
    );

    const [trainingRows] = await db.query(
      `SELECT t.trainingId, t.title, t.type, t.description, t.startTime, t.endTime, t.location, t.date
         FROM TRAINEES tr
         JOIN TRAINING t ON tr.trainingId = t.trainingId
        WHERE tr.userId = ?
        ORDER BY t.date DESC, t.startTime DESC`,
      [requestedId]
    );

    const [clientRows] = await db.query(
      `SELECT c.clientId,
              CONCAT(c.fName, ' ', c.lName) AS name,
              COUNT(*) AS eventsWorked,
              MAX(e.endsAt) AS lastEvent,
              ROUND(AVG(r.starRating), 2) AS rating
         FROM EVENT_APP ea
         JOIN EVENTS e ON e.eventId = ea.eventId
         JOIN CLIENTS c ON c.clientId = e.clientId
    LEFT JOIN REVIEW r ON r.eventId = e.eventId AND r.reviewerId = ea.senderId
        WHERE ea.senderId = ? AND ea.status = 'accepted' AND c.clientId IS NOT NULL
        GROUP BY c.clientId
        ORDER BY lastEvent IS NULL, lastEvent DESC`,
      [requestedId]
    );

    const normalizeDates = (rows, fields) =>
      rows.map((row) => {
        const normalized = { ...row };
        fields.forEach((field) => {
          if (normalized[field] instanceof Date) {
            normalized[field] = normalized[field].toISOString();
          }
        });
        return normalized;
      });

    res.json({
      profile,
      appliedEvents: normalizeDates(applications, ["sentAt", "startsAt"]),
      attendedEvents: normalizeDates(attended, ["startsAt", "endsAt"]),
      trainings: normalizeDates(trainingRows, ["date"]),
      workedClients: normalizeDates(clientRows, ["lastEvent"]),
    });
  } catch (err) {
    console.error("Failed to fetch user overview", err);
    res.status(500).json({ message: "Failed to fetch user overview" });
  }
});

// GET /api/users/:id - Fetch a single user by ID
router.get("/:id", verifyToken, isUserOrAdmin, async (req, res) => {
  const requestedId = parseInt(req.params.id, 10);
  if (Number.isNaN(requestedId)) {
    return res.status(400).json({ message: "Invalid user id" });
  }

  if (req.user.role !== "admin" && req.user.id !== requestedId) {
    return res.status(403).json({ message: "Access denied" });
  }

  try {
    const [rows] = await db.query("SELECT * FROM USERS WHERE userId = ?", [
      requestedId,
    ]);
    if (!rows.length) {
      return res.status(404).json({ message: "User not found" });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error("Failed to fetch user", err);
    res.status(500).json({ message: "Failed to fetch user" });
  }
});

// POST /api/users - Create a new user
router.post("/", async (req, res) => {
  const validationErrors = validateUserPayload(req.body);
  if (validationErrors.length) {
    return res.status(400).json({
      message: "Validation failed",
      errors: validationErrors,
    });
  }

  const {
    fName,
    lName,
    email,
    password,
    phoneNb,
    age,
    gender,
    address,
    clothingSize,
    description,
    profilePic,
  } = req.body;

  try {
    const hashedPass = await bcrypt.hash(password, 10);
    const [result] = await db.query(
      `INSERT INTO USERS (fName, lName, email, password, phoneNb, age, gender, address, clothingSize, description, profilePic)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        fName.trim(),
        lName.trim(),
        email.trim(),
        hashedPass,
        phoneNb.trim(),
        Number(age),
          gender.trim(),
        address.trim(),
        clothingSize.trim(),
        description.trim(),
        profilePic?.trim() || null,
      ]
    );
    res.status(201).json({ userId: result.insertId, message: "User created" });
  } catch (err) {
    handleDbError(err, res, "Failed to create user");
  }
});

// PUT /api/users/:id - Update a user
router.put("/:id", verifyToken, isUserOrAdmin, async (req, res) => {
  const requestedId = parseInt(req.params.id, 10);
  if (Number.isNaN(requestedId)) {
    return res.status(400).json({ message: "Invalid user id" });
  }

  if (req.user.role !== "admin" && req.user.id !== requestedId) {
    return res.status(403).json({ message: "Access denied" });
  }

  try {
    const [existingRows] = await db.query(
      "SELECT * FROM USERS WHERE userId = ?",
      [requestedId]
    );
    if (!existingRows.length) {
      return res.status(404).json({ message: "User not found" });
    }

    const currentUser = existingRows[0];
    const payload = {
      fName: req.body.fName ?? currentUser.fName,
      lName: req.body.lName ?? currentUser.lName,
      email: req.body.email ?? currentUser.email,
      phoneNb: req.body.phoneNb ?? currentUser.phoneNb,
      age: req.body.age ?? currentUser.age,
      gender: req.body.gender ?? currentUser.gender,
      address: req.body.address ?? currentUser.address,
      clothingSize: req.body.clothingSize ?? currentUser.clothingSize,
      description: req.body.description ?? currentUser.description,
      profilePic: req.body.profilePic ?? currentUser.profilePic,
    };

    let updatedEligibility = currentUser.eligibility;
    if (typeof req.body.eligibility !== "undefined") {
      if (req.user.role !== "admin") {
        return res
          .status(403)
          .json({ message: "Only admins can change eligibility." });
      }
      const normalizedEligibility = String(req.body.eligibility).toLowerCase();
      const allowedEligibility = ["pending", "approved", "blocked"];
      if (!allowedEligibility.includes(normalizedEligibility)) {
        return res.status(400).json({
          message: "Validation failed",
          errors: ["Eligibility must be pending, approved, or blocked."],
        });
      }
      updatedEligibility = normalizedEligibility;
    }

    const validationErrors = validateUserPayload(payload, {
      requirePassword: false,
    });
    if (validationErrors.length) {
      return res.status(400).json({
        message: "Validation failed",
        errors: validationErrors,
      });
    }

    // Handle password separately
    let hashedPassword = currentUser.password;
    if (req.body.password) {
      if (req.body.password.length < 6) {
        return res.status(400).json({ message: "Password must be at least 6 characters." });
      }
      hashedPassword = await bcrypt.hash(req.body.password, 10);
    }

    const [result] = await db.query(
      `UPDATE USERS SET fName = ?, lName = ?, email = ?, password = ?, phoneNb = ?, age = ?, gender = ?, address = ?, clothingSize = ?, description = ?, eligibility = ?, profilePic = ?
       WHERE userId = ?`,
      [
        payload.fName.trim(),
        payload.lName.trim(),
        payload.email.trim(),
        hashedPassword,
        payload.phoneNb.trim(),
        Number(payload.age),
        payload.gender.trim(),
        payload.address.trim(),
        payload.clothingSize.trim(),
        payload.description.trim(),
        updatedEligibility,
        payload.profilePic?.trim() || null,
        requestedId,
      ]
    );

    res.json({ message: "User updated" });
  } catch (err) {
    handleDbError(err, res, "Failed to update user");
  }
});

// DELETE /api/users/:id - Delete a user
router.delete("/:id", verifyToken, isUserOrAdmin, async (req, res) => {
  const { id } = req.params;
  const requestedId = parseInt(id, 10);
  if (Number.isNaN(requestedId)) {
    return res.status(400).json({ message: "Invalid user id" });
  }

  if (req.user.role !== "admin" && req.user.id !== requestedId) {
    return res.status(403).json({ message: "Access denied" });
  }

  try {
    const [result] = await db.query("DELETE FROM USERS WHERE userId = ?", [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "User not found" });
    }
    res.json({ message: "User deleted" });
  } catch (err) {
    console.error("Failed to delete user", err);
    res.status(500).json({ message: "Failed to delete user" });
  }
});

export default router;
