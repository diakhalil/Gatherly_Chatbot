import { Router } from "express";
import db from "../config/db.js";
import bcrypt from "bcryptjs";
import { verifyToken, isAdmin, isUser, isClient } from "../middleware/auth.js";

const router = Router();

const validateClientPayload = (body, { requirePassword = true } = {}) => {
  const errors = [];
  const allowedGenders = ["M", "F", "Other"];

  const {
    fName, lName, email, password, phoneNb, age, gender, address
  } = body;

  if (!fName || !fName.trim()) errors.push("First name is required.");
  if (!lName || !lName.trim()) errors.push("Last name is required.");
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    errors.push("Valid email is required.");
  if (requirePassword && (!password || password.length < 6))
    errors.push("Password must be at least 6 characters.");
  if (!phoneNb || !phoneNb.trim()) errors.push("Phone number is required.");

  const ageValue = Number(age);
  if (Number.isNaN(ageValue) || ageValue < 18 || ageValue > 100) {
    errors.push("Age must be between 18 and 100.");
  }

  const genderValue = gender?.trim();
  if (!genderValue) {
    errors.push("Gender is required.");
  } else if (!allowedGenders.includes(genderValue)) {
    errors.push("Gender must be M, F, or Other.");
  }

  if (!address || !address.trim()) errors.push("Address is required.");

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
router.get("/", verifyToken, isAdmin, async (req, res) => {
  try {
    const [rows] = await db.query("SELECT * FROM CLIENTS");
    res.json(rows);
  } catch (err) {
    console.error("Failed to fetch clients", err);
    res.status(500).json({ message: "Failed to fetch clients" });
  }
});

// GET /api/clients/:id - Fetch a single client by ID
router.get("/:id", verifyToken, isAdmin, async (req, res) => {
  const requestedId = parseInt(req.params.id, 10);
  if (Number.isNaN(requestedId)) {
    return res.status(400).json({ message: "Invalid client id" });
  }

  try {
    const [rows] = await db.query("SELECT * FROM CLIENTS WHERE clientId = ?", [requestedId]);
    if (!rows.length) {
      return res.status(404).json({ message: "Client not found" });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error("Failed to fetch client", err);
    res.status(500).json({ message: "Failed to fetch client" });
  }
});


// GET /api/clients/me/events - Fetch events for the authenticated client
router.get("/me/events", verifyToken, isClient, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT e.*,
              cl.clothingLabel AS clothingLabel,
              cl.picture       AS clothingPicture,
              cl.description   AS clothingDescription,
              cs.stockInfo     AS clothingStockInfo
         FROM EVENTS e
    LEFT JOIN CLOTHING cl ON cl.clothesId = e.clothesId
    LEFT JOIN (
              SELECT clothingId,
                     GROUP_CONCAT(CONCAT(size, ':', stockQty) SEPARATOR ', ') AS stockInfo
                FROM CLOTHING_STOCK
            GROUP BY clothingId
             ) cs ON cs.clothingId = e.clothesId
        WHERE e.clientId = ?
     ORDER BY e.startsAt DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error("Failed to fetch client events", err);
    res.status(500).json({ message: "Failed to fetch client events" });
  }
});


router.post("/", async (req, res) => {
  const validationErrors = validateClientPayload(req.body);
  if (validationErrors.length) {
    return res.status(400).json({
      message: "Validation failed",
      errors: validationErrors,
    });
  }

  const { fName, lName, email, phoneNb, age, gender, address, password, profilePic } = req.body;

  try {
    const hashedPass = await bcrypt.hash(password, 10);
    const [result] = await db.query(
      `INSERT INTO CLIENTS (fName, lName, email, phoneNb, age, gender, address, password, profilePic)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        fName.trim(),
        lName.trim(),
        email.trim(),
        phoneNb.trim(),
        Number(age),
        gender.trim(),
        address.trim(),
        hashedPass,
        profilePic || null
      ]
    );
    res.status(201).json({ clientId: result.insertId, message: "Client created" });
  } catch (err) {
    handleDbError(err, res, "Failed to create client");
  }
});


router.put("/:id", verifyToken, async (req, res) => {
  const requestedId = parseInt(req.params.id, 10);
  if (Number.isNaN(requestedId)) {
    return res.status(400).json({ message: "Invalid client id" });
  }

  // Client can only update their own info
  if (req.user.id !== requestedId) {
    return res.status(403).json({ message: "Access denied: can only update your own information" });
  }

  try {
    const [existingRows] = await db.query("SELECT * FROM CLIENTS WHERE clientId = ?", [requestedId]);
    if (!existingRows.length) {
      return res.status(404).json({ message: "Client not found" });
    }

    const currentClient = existingRows[0];
    const payload = {
      fName: req.body.fName ?? currentClient.fName,
      lName: req.body.lName ?? currentClient.lName,
      email: req.body.email ?? currentClient.email,
      phoneNb: req.body.phoneNb ?? currentClient.phoneNb,
      age: req.body.age ?? currentClient.age,
      gender: req.body.gender ?? currentClient.gender,
      address: req.body.address ?? currentClient.address,
      profilePic: req.body.profilePic ?? currentClient.profilePic,
    };

    // Handle password separately
    let hashedPassword = currentClient.password;
    if (req.body.password) {
      if (req.body.password.length < 6) {
        return res.status(400).json({ message: "Password must be at least 6 characters." });
      }
      hashedPassword = await bcrypt.hash(req.body.password, 10);
    }

    const validationErrors = validateClientPayload(payload, { requirePassword: false });
    if (validationErrors.length) {
      return res.status(400).json({
        message: "Validation failed",
        errors: validationErrors,
      });
    }

    const [result] = await db.query(
      `UPDATE CLIENTS SET fName = ?, lName = ?, email = ?, password = ?, phoneNb = ?, age = ?, gender = ?, address = ?, profilePic = ?
       WHERE clientId = ?`,
      [
        payload.fName.trim(),
        payload.lName.trim(),
        payload.email.trim(),
        hashedPassword,
        payload.phoneNb.trim(),
        Number(payload.age),
        payload.gender.trim(),
        payload.address.trim(),
        payload.profilePic || null,
        requestedId,
      ]
    );

    res.json({ message: "Client updated" });
  } catch (err) {
    handleDbError(err, res, "Failed to update client");
  }
});



router.delete("/:id", verifyToken, isAdmin, async (req, res) => {
  const requestedId = parseInt(req.params.id, 10);
  if (Number.isNaN(requestedId)) {
    return res.status(400).json({ message: "Invalid client id" });
  }

  try {
    // Check if client has created any events
    const [eventCheck] = await db.query("SELECT COUNT(*) as count FROM EVENTS WHERE clientId = ?", [requestedId]);
    if (eventCheck[0].count > 0) {
      return res.status(409).json({
        message: "Cannot delete client who has created events. Delete or reassign the events first.",
        eventsCount: eventCheck[0].count
      });
    }

    const [result] = await db.query("DELETE FROM CLIENTS WHERE clientId = ?", [requestedId]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Client not found" });
    }
    res.json({ message: "Client deleted" });
  } catch (err) {
    handleDbError(err, res, "Failed to delete client");
  }
});

export default router;
