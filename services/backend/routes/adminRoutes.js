import { Router } from "express";
import db from "../config/db.js";
import bcrypt from "bcryptjs";
import { verifyToken, isAdmin } from "../middleware/auth.js";
import { summarizeEmailResult } from "../utils/email.js";
import {
  sendEventApprovalEmail,
  sendHostApprovalEmail,
  sendHostEventAcceptanceEmail,
} from "../utils/notificationEmails.js";
import { buildTransportationSummary } from "../utils/transportation.js";
// import { verify } from "jsonwebtoken";

const router = Router();
const HOST_RETURN_FIELDS =
  "userId, fName, lName, email, phoneNb, age, gender, address, clothingSize, eligibility, isActive, codeOfConductAccepted, profilePic, description, createdAt, updatedAt";
const CLIENT_BASE_FIELDS = ["clientId", "fName", "lName", "email", "phoneNb", "age", "gender", "address"];
const CLIENT_SELECT_WITH_ALIAS = CLIENT_BASE_FIELDS.map((field) => `c.${field}`).join(", ");
const CLOTHING_FIELDS = ["clothesId", "clothingLabel", "picture", "description"];
const CLOTHING_SELECT = CLOTHING_FIELDS.join(", ");
const STOCK_SIZE_ORDER =
  "CASE WHEN FIELD(size, 'XS', 'S', 'M', 'L', 'XL', 'XXL') = 0 THEN 1 ELSE 0 END, FIELD(size, 'XS', 'S', 'M', 'L', 'XL', 'XXL'), size";

// GET all event requests with client information (with optional status filter)
router.get("/event-requests", verifyToken, isAdmin, async (req, res) => {
  try {
    const { status } = req.query;
    let whereClause = "";
    let params = [];

    if (status && status !== 'all') {
      whereClause = "WHERE e.status = ?";
      params.push(status);
    }

    const [rows] = await db.query(
      `SELECT e.*,
              c.fName AS clientFirstName,
              c.lName AS clientLastName,
              c.email AS clientEmail,
              c.phoneNb AS clientPhone,
              c.address AS clientAddress,
              cl.clothingLabel,
              cl.picture       AS clothingPicture,
              cl.description   AS clothingDescription,
              cs.stockInfo     AS clothingStockInfo,
              tl.userId        AS teamLeaderId,
              tl.fName         AS teamLeaderFirstName,
              tl.lName         AS teamLeaderLastName,
              tl.email         AS teamLeaderEmail,
              tl.phoneNb       AS teamLeaderPhone,
              a.adminId,
              a.fName          AS adminFirstName,
              a.lName          AS adminLastName,
              a.email          AS adminEmail,
              (
                SELECT COUNT(*)
                  FROM EVENT_APP ea
                 WHERE ea.eventId = e.eventId
                   AND ea.status = 'accepted'
              ) AS acceptedHostsCount
         FROM EVENTS e
    LEFT JOIN CLIENTS c ON c.clientId = e.clientId
    LEFT JOIN CLOTHING cl ON cl.clothesId = e.clothesId
    LEFT JOIN USERS tl ON tl.userId = e.teamLeaderId
    LEFT JOIN ADMINS a ON a.adminId = e.adminId
    LEFT JOIN (
              SELECT clothingId,
                     GROUP_CONCAT(CONCAT(size, ':', stockQty) SEPARATOR ', ') AS stockInfo
                FROM CLOTHING_STOCK
            GROUP BY clothingId
             ) cs ON cs.clothingId = e.clothesId
        ${whereClause}
        ORDER BY e.createdAt DESC`,
      params
    );

    const eventsWithTransport = await Promise.all(
      rows.map(async (event) => ({
        ...event,
        transportationSummary: await buildTransportationSummary(event.eventId, event.nbOfHosts),
      }))
    );

    res.json(eventsWithTransport);
  } catch (err) {
    console.error("Failed to fetch event requests", err);
    res.status(500).json({ message: "Failed to fetch event requests" });
  }
});

// Admin dashboard stats (keep before /:id to avoid route shadowing)
router.get("/stats", verifyToken, isAdmin, async (req, res) => {
  try {
    const [pendingEventRequests] = await db.query("SELECT COUNT(*) as count FROM EVENTS WHERE status = 'pending'");
    const [pendingHostApplications] = await db.query("SELECT COUNT(*) as count FROM EVENT_APP WHERE status = 'pending'");

    res.json({
      pendingEventRequests: pendingEventRequests[0].count,
      pendingHostApplications: pendingHostApplications[0].count,
    });
  } catch (err) {
    console.error("Failed to fetch stats", err);
    res.status(500).json({ message: "Failed to fetch stats" });
  }
});

router.get("/hosts/pending", verifyToken, isAdmin, async (_req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT ${HOST_RETURN_FIELDS}
         FROM USERS
        WHERE eligibility = 'pending'
        ORDER BY createdAt DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error("Failed to fetch pending hosts", err);
    res.status(500).json({ message: "Failed to fetch pending hosts" });
  }
});

router.get("/clients", verifyToken, isAdmin, async (_req, res) => {
  try {
    const [clients] = await db.query(
      `SELECT ${CLIENT_SELECT_WITH_ALIAS},
              stats.eventCount,
              stats.lastEventAt,
              stats.firstEventAt
         FROM CLIENTS c
    LEFT JOIN (
              SELECT clientId,
                     COUNT(eventId) AS eventCount,
                     MAX(COALESCE(endsAt, startsAt)) AS lastEventAt,
                     MIN(COALESCE(startsAt, createdAt)) AS firstEventAt
                FROM EVENTS
               WHERE clientId IS NOT NULL
            GROUP BY clientId
             ) stats ON stats.clientId = c.clientId
     ORDER BY c.clientId DESC`
    );

    const normalized = clients.map((client) => ({
      ...client,
      eventCount: Number(client.eventCount || 0),
      lastEventAt: client.lastEventAt || null,
      firstEventAt: client.firstEventAt || null,
    }));

    res.json(normalized);
  } catch (err) {
    console.error("Failed to fetch clients", err);
    res.status(500).json({ message: "Failed to fetch clients." });
  }
});

// Clothing inventory management
router.get("/clothing", verifyToken, isAdmin, async (_req, res) => {
  try {
    const [items] = await db.query(
      `SELECT ${CLOTHING_SELECT}
         FROM CLOTHING
     ORDER BY clothingLabel`
    );

	    const [stockRows] = await db.query(
	      `SELECT clothingId, size, stockQty
	         FROM CLOTHING_STOCK
	     ORDER BY clothingId, ${STOCK_SIZE_ORDER}`
	    );

    const stockMap = new Map();
    stockRows.forEach((row) => {
      if (!stockMap.has(row.clothingId)) {
        stockMap.set(row.clothingId, []);
      }
      stockMap.get(row.clothingId).push({
        size: row.size,
        stockQty: Number(row.stockQty),
      });
    });

    const normalized = items.map((item) => ({
      ...item,
      stock: stockMap.get(item.clothesId) || [],
    }));

    res.json(normalized);
  } catch (err) {
    console.error("Failed to fetch clothing inventory", err);
    res.status(500).json({ message: "Failed to fetch clothing inventory." });
  }
});

router.post("/clothing", verifyToken, isAdmin, async (req, res) => {
  const { clothingLabel, description, picture, stock } = req.body || {};
  if (!clothingLabel || !clothingLabel.trim()) {
    return res.status(400).json({ message: "clothingLabel is required." });
  }

  const sanitizedStock = Array.isArray(stock)
    ? stock
        .map((entry) => ({
          size: typeof entry.size === "string" ? entry.size.trim().toUpperCase() : "",
          stockQty: Number(entry.stockQty),
        }))
        .filter((entry) => entry.size && Number.isInteger(entry.stockQty) && entry.stockQty >= 0)
    : [];

  try {
    const [result] = await db.query(
      "INSERT INTO CLOTHING (clothingLabel, description, picture) VALUES (?, ?, ?)",
      [clothingLabel.trim(), description?.trim() || null, picture?.trim() || null]
    );

    const clothesId = result.insertId;

    for (const entry of sanitizedStock) {
      await db.query(
        `INSERT INTO CLOTHING_STOCK (clothingId, size, stockQty)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE stockQty = VALUES(stockQty)`,
        [clothesId, entry.size, entry.stockQty]
      );
    }

    const response = {
      clothesId,
      clothingLabel: clothingLabel.trim(),
      description: description?.trim() || null,
      picture: picture?.trim() || null,
      stock: sanitizedStock,
    };

    res.status(201).json(response);
  } catch (err) {
    console.error("Failed to add clothing", err);
    res.status(500).json({ message: "Failed to add clothing." });
  }
});

router.patch("/clothing/:clothesId/stock", verifyToken, isAdmin, async (req, res) => {
  const clothesId = Number(req.params.clothesId);
  const { size, amount, operation = "add" } = req.body || {};

  if (!Number.isInteger(clothesId) || clothesId <= 0) {
    return res.status(400).json({ message: "Invalid clothesId" });
  }
  if (!size || !size.trim()) {
    return res.status(400).json({ message: "size is required" });
  }
  const normalizedSize = size.trim().toUpperCase();
  const quantity = Number(amount);
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return res.status(400).json({ message: "amount must be a positive integer" });
  }
  if (!["add", "remove"].includes(operation)) {
    return res.status(400).json({ message: "operation must be 'add' or 'remove'" });
  }

  try {
    const [itemRows] = await db.query("SELECT clothesId FROM CLOTHING WHERE clothesId = ?", [clothesId]);
    if (!itemRows.length) {
      return res.status(404).json({ message: "Clothing item not found" });
    }

    if (operation === "add") {
      await db.query(
        `INSERT INTO CLOTHING_STOCK (clothingId, size, stockQty)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE stockQty = CLOTHING_STOCK.stockQty + VALUES(stockQty)`,
        [clothesId, normalizedSize, quantity]
      );
    } else {
      const [result] = await db.query(
        `UPDATE CLOTHING_STOCK
            SET stockQty = stockQty - ?
          WHERE clothingId = ?
            AND size = ?
            AND stockQty >= ?`,
        [quantity, clothesId, normalizedSize, quantity]
      );

      if (result.affectedRows === 0) {
        const [stockRows] = await db.query(
          "SELECT stockQty FROM CLOTHING_STOCK WHERE clothingId = ? AND size = ?",
          [clothesId, normalizedSize]
        );
        if (!stockRows.length) {
          return res.status(404).json({ message: "No stock exists for that size" });
        }
        return res.status(409).json({ message: "Cannot remove more items than are in stock" });
      }
    }

	    const [updatedStock] = await db.query(
	      `SELECT size, stockQty FROM CLOTHING_STOCK WHERE clothingId = ? ORDER BY ${STOCK_SIZE_ORDER}`,
	      [clothesId]
	    );

    res.json({
      clothesId,
      stock: updatedStock.map((entry) => ({
        size: entry.size,
        stockQty: Number(entry.stockQty),
      })),
    });
  } catch (err) {
    console.error("Failed to update stock", err);
    res.status(500).json({ message: "Failed to update stock." });
  }
});

router.patch("/clothing/:clothesId/stock/remove", verifyToken, isAdmin, async (req, res) => {
  const clothesId = Number(req.params.clothesId);
  const { size, amount } = req.body || {};

  if (!Number.isInteger(clothesId) || clothesId <= 0) {
    return res.status(400).json({ message: "Invalid clothesId" });
  }
  if (!size || !size.trim()) {
    return res.status(400).json({ message: "size is required" });
  }
  const normalizedSize = size.trim().toUpperCase();
  const quantity = Number(amount);
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return res.status(400).json({ message: "amount must be a positive integer" });
  }

  try {
    const [itemRows] = await db.query("SELECT clothesId FROM CLOTHING WHERE clothesId = ?", [clothesId]);
    if (!itemRows.length) {
      return res.status(404).json({ message: "Clothing item not found" });
    }

    const [result] = await db.query(
      `UPDATE CLOTHING_STOCK
          SET stockQty = stockQty - ?
        WHERE clothingId = ?
          AND size = ?
          AND stockQty >= ?`,
      [quantity, clothesId, normalizedSize, quantity]
    );

    if (result.affectedRows === 0) {
      const [stockRows] = await db.query(
        "SELECT stockQty FROM CLOTHING_STOCK WHERE clothingId = ? AND size = ?",
        [clothesId, normalizedSize]
      );
      if (!stockRows.length) {
        return res.status(404).json({ message: "No stock exists for that size" });
      }
      return res.status(409).json({ message: "Cannot remove more items than are in stock" });
    }

    const [updatedStock] = await db.query(
      `SELECT size, stockQty FROM CLOTHING_STOCK WHERE clothingId = ? ORDER BY ${STOCK_SIZE_ORDER}`,
      [clothesId]
    );

    res.json({
      clothesId,
      stock: updatedStock.map((entry) => ({
        size: entry.size,
        stockQty: Number(entry.stockQty),
      })),
    });
  } catch (err) {
    console.error("Failed to remove stock", err);
    res.status(500).json({ message: "Failed to remove stock." });
  }
});

router.get("/clients/:clientId", verifyToken, isAdmin, async (req, res) => {
  const clientId = Number(req.params.clientId);
  if (!Number.isInteger(clientId) || clientId <= 0) {
    return res.status(400).json({ message: "Invalid client id" });
  }

  try {
    const [clientRows] = await db.query(
      `SELECT ${CLIENT_BASE_FIELDS.join(", ")},
              NULL AS createdAt,
              NULL AS updatedAt
         FROM CLIENTS
        WHERE clientId = ?`,
      [clientId]
    );
    if (!clientRows.length) {
      return res.status(404).json({ message: "Client not found." });
    }

    const [events] = await db.query(
      `SELECT eventId, type, status, startsAt, endsAt, location, createdAt
         FROM EVENTS
        WHERE clientId = ?
     ORDER BY createdAt DESC`,
      [clientId]
    );

    const firstEventAt =
      events.length > 0
        ? events.reduce((earliest, event) => {
            const candidate = event.startsAt || event.createdAt || earliest;
            if (!earliest) return candidate;
            return new Date(candidate) < new Date(earliest) ? candidate : earliest;
          }, null)
        : null;

    res.json({
      ...clientRows[0],
      events,
      firstEventAt,
    });
  } catch (err) {
    console.error("Failed to fetch client details", err);
    res.status(500).json({ message: "Failed to fetch client details." });
  }
});

const fetchHostById = async (userId) => {
  const [rows] = await db.query(
    `SELECT ${HOST_RETURN_FIELDS}
       FROM USERS
      WHERE userId = ?`,
    [userId]
  );
  return rows[0];
};

const fetchEventWithClientById = async (eventId) => {
  const [rows] = await db.query(
    `SELECT e.eventId,
            e.title,
            e.type,
            e.location,
            e.startsAt,
            e.endsAt,
            c.fName AS clientFirstName,
            c.lName AS clientLastName,
            c.email AS clientEmail
       FROM EVENTS e
  LEFT JOIN CLIENTS c ON c.clientId = e.clientId
      WHERE e.eventId = ?`,
    [eventId]
  );
  return rows[0];
};

const fetchApplicationNotificationDetails = async (eventAppId) => {
  const [rows] = await db.query(
    `SELECT ea.eventAppId,
            ea.requestedRole,
            ea.assignedRole,
            ea.requestDress,
            u.fName AS hostFirstName,
            u.lName AS hostLastName,
            u.email AS hostEmail,
            u.phoneNb AS hostPhone,
            u.clothingSize,
            e.title AS eventTitle,
            e.type AS eventType,
            e.description,
            e.location,
            e.startsAt,
            e.endsAt,
            e.nbOfGuests,
            c.fName AS clientFirstName,
            c.lName AS clientLastName,
            c.email AS clientEmail,
            c.phoneNb AS clientPhone
       FROM EVENT_APP ea
       JOIN USERS u ON u.userId = ea.senderId
       JOIN EVENTS e ON e.eventId = ea.eventId
  LEFT JOIN CLIENTS c ON c.clientId = e.clientId
      WHERE ea.eventAppId = ?`,
    [eventAppId]
  );
  return rows[0];
};

const logEmailNotification = (label, result) => {
  const status = summarizeEmailResult(result);
  console.info(`${label}: ${status}`);
  return status;
};

router.patch("/hosts/:userId/approve", verifyToken, isAdmin, async (req, res) => {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ message: "Invalid user id" });
  }

  try {
    const host = await fetchHostById(userId);
    if (!host) {
      return res.status(404).json({ message: "User not found" });
    }

    if (!host.codeOfConductAccepted) {
      return res.status(400).json({ message: "User must accept Code of Conduct before approval." });
    }

    await db.query(
      `UPDATE USERS
          SET eligibility = 'approved',
              isActive = 1,
              updatedAt = NOW()
        WHERE userId = ?`,
      [userId]
    );

    const updated = await fetchHostById(userId);
    const emailResult = await sendHostApprovalEmail(updated);
    const emailNotification = logEmailNotification(
      `Host approval email notification for user ${userId}`,
      emailResult
    );
    res.json({
      message: "Host approved.",
      user: updated,
      emailNotification,
    });
  } catch (err) {
    console.error("Failed to approve host", err);
    res.status(500).json({ message: "Failed to approve host" });
  }
});

router.patch("/hosts/:userId/block", verifyToken, isAdmin, async (req, res) => {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ message: "Invalid user id" });
  }

  try {
    const host = await fetchHostById(userId);
    if (!host) {
      return res.status(404).json({ message: "User not found" });
    }

    await db.query(
      `UPDATE USERS
          SET eligibility = 'blocked',
              isActive = 0,
              updatedAt = NOW()
        WHERE userId = ?`,
      [userId]
    );

    const updated = await fetchHostById(userId);
    res.json({ message: "Host blocked.", user: updated });
  } catch (err) {
    console.error("Failed to block host", err);
    res.status(500).json({ message: "Failed to block host" });
  }
});

// GET /api/users - Fetch all users (hosts/hostesses)
router.get("/", verifyToken, isAdmin, async (req, res) => {
  try {
    const [rows] = await db.query("SELECT * FROM ADMINS");
    res.json(rows);
  } catch (err) {
    console.error("Failed to fetch admins", err);
    res.status(500).json({ message: "Failed to fetch admins" });
  }
});

// GET /api/users/:id - Fetch a single user by ID
router.get("/:id", verifyToken, isAdmin, async (req, res) => {
   const requestedId = parseInt(req.params.id, 10);
  if (Number.isNaN(requestedId)) {
    return res.status(400).json({ message: "Invalid admin id" });
  }
  const { id } = req.params;
  try {
    const [rows] = await db.query("SELECT * FROM ADMINS WHERE adminId = ?", [id]);
    if (!rows.length) {
      return res.status(404).json({ message: "Admin not found" });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error("Failed to fetch admin", err);
    res.status(500).json({ message: "Failed to fetch admin" });
  }
});

router.post("/", async (req, res) => {
  const validationErrors = validateAdminPayload(req.body);
  if (validationErrors.length) {
    return res.status(400).json({
      message: "Validation failed",
      errors: validationErrors,
    });
  }

  const { fName, lName, email, password, phoneNb, profilePic, age, gender, address, yearsOfExperience } = req.body;

  try {
    const hashedPass = await bcrypt.hash(password, 10);
    const [result] = await db.query(
      `INSERT INTO ADMINS (fName, lName, email, password, phoneNb, profilePic, age, gender, address, yearsOfExperience)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        fName.trim(),
        lName.trim(),
        email.trim(),
        hashedPass,
        phoneNb.trim(),
        profilePic?.trim() || null,
        Number(age),
        gender.trim(),
        address.trim(),
        Number(yearsOfExperience)
      ]
    );
    res.status(201).json({ adminId: result.insertId, message: "Admin created" });
  } catch (err) {
    handleDbError(err, res, "Failed to create admin");
  }
});


router.put("/:id", verifyToken, async (req, res) => {
  const requestedId = parseInt(req.params.id, 10);
  if (Number.isNaN(requestedId)) {
    return res.status(400).json({ message: "Invalid admin id" });
  }

  // Admin can only update their own info
  if (req.user.id !== requestedId) {
    return res.status(403).json({ message: "Access denied: can only update your own information" });
  }   

  try {
    const [existingRows] = await db.query("SELECT * FROM ADMINS WHERE adminId = ?", [requestedId]);
    if (!existingRows.length) {
      return res.status(404).json({ message: "Admin not found" });
    }

    const currentAdmin = existingRows[0];
    const payload = {
      fName: req.body.fName ?? currentAdmin.fName,
      lName: req.body.lName ?? currentAdmin.lName,
      email: req.body.email ?? currentAdmin.email,
      phoneNb: req.body.phoneNb ?? currentAdmin.phoneNb,
      profilePic: req.body.profilePic ?? currentAdmin.profilePic,
      age: req.body.age ?? currentAdmin.age,
      gender: req.body.gender ?? currentAdmin.gender,
      address: req.body.address ?? currentAdmin.address,
      yearsOfExperience: req.body.yearsOfExperience ?? currentAdmin.yearsOfExperience,
    };

    // Handle password separately
    let hashedPassword = currentAdmin.password;
    if (req.body.password) {
      if (req.body.password.length < 6) {
        return res.status(400).json({ message: "Password must be at least 6 characters." });
      }
      hashedPassword = await bcrypt.hash(req.body.password, 10);
    }

    const validationErrors = validateAdminPayload(payload, { requirePassword: false });
    if (validationErrors.length) {
      return res.status(400).json({
        message: "Validation failed",
        errors: validationErrors,
      });
    }

    const [result] = await db.query(
      `UPDATE ADMINS SET fName = ?, lName = ?, email = ?, password = ?, phoneNb = ?, profilePic = ?, age = ?, gender = ?, address = ?, yearsOfExperience = ?
       WHERE adminId = ?`,
      [
        payload.fName.trim(),
        payload.lName.trim(),
        payload.email.trim(),
        hashedPassword,
        payload.phoneNb.trim(),
        payload.profilePic?.trim() || null,
        Number(payload.age),
        payload.gender.trim(),
        payload.address.trim(),
        Number(payload.yearsOfExperience),
        requestedId,
      ]
    );

    res.json({ message: "Admin updated" });
  } catch (err) {
    handleDbError(err, res, "Failed to update admin");
  }
});

// DELETE /api/admins/:id - Delete admin
router.delete("/:id", verifyToken, isAdmin, async (req, res) => {
  const requestedId = parseInt(req.params.id, 10);
  if (Number.isNaN(requestedId)) {
    return res.status(400).json({ message: "Invalid admin id" });
  }

  try {
    // Check if admin has processed any applications
    const [appCheck] = await db.query("SELECT COUNT(*) as count FROM EVENT_APP WHERE adminId = ?", [requestedId]);
    if (appCheck[0].count > 0) {
      return res.status(409).json({
        message: "Cannot delete admin who has processed applications. Reassign or delete the applications first.",
        applicationsCount: appCheck[0].count
      });
    }

    const [result] = await db.query("DELETE FROM ADMINS WHERE adminId = ?", [requestedId]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Admin not found" });
    }
    res.json({ message: "Admin deleted" });
  } catch (err) {
    handleDbError(err, res, "Failed to delete admin");
  }
});

const validateAdminPayload = (body, { requirePassword = true } = {}) => {
  const errors = [];
  const allowedGenders = ["M", "F", "Other"];

  const {
    fName, lName, email, password, phoneNb, profilePic, age, gender,
    address, yearsOfExperience
  } = body;

  if (!fName || !fName.trim()) errors.push("First name is required.");
  if (!lName || !lName.trim()) errors.push("Last name is required.");
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    errors.push("Valid email is required.");
  if (requirePassword && (!password || password.length < 6))
    errors.push("Password must be at least 6 characters.");
  if (!phoneNb || !phoneNb.trim()) errors.push("Phone number is required.");

  const ageValue = Number(age);
  if (Number.isNaN(ageValue) || ageValue < 21 || ageValue > 80) {
    errors.push("Age must be between 21 and 80.");
  }

  const genderValue = gender?.trim();
  if (!genderValue) {
    errors.push("Gender is required.");
  } else if (!allowedGenders.includes(genderValue)) {
    errors.push("Gender must be M, F, or Other.");
  }

  if (!address || !address.trim()) errors.push("Address is required.");
  
  const expValue = Number(yearsOfExperience);
  if (Number.isNaN(expValue) || expValue < 0 || expValue > 50) {
    errors.push("Years of experience must be between 0 and 50.");
  }

  return errors;
};

const handleDbError = (err, res, defaultMessage) => {
  if (err.code === "ER_DUP_ENTRY") {
    return res.status(409).json({ message: "Email already exists." });
  }
  console.error(defaultMessage, err);
  return res.status(500).json({ message: defaultMessage });
};



// Approve event request
router.put("/event-requests/:id/approve", verifyToken, isAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const [result] = await db.query(
      "UPDATE EVENTS SET status = 'accepted', adminId = ? WHERE eventId = ? AND status = 'pending'",
      [req.user.id, id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Event request not found or already processed" });
    }
    const event = await fetchEventWithClientById(id);
    const emailResult = await sendEventApprovalEmail(event);
    const emailNotification = logEmailNotification(
      `Event approval email notification for event ${id}`,
      emailResult
    );
    res.json({
      message: "Event approved",
      emailNotification,
    });
  } catch (err) {
    console.error("Failed to approve event", err);
    res.status(500).json({ message: "Failed to approve event" });
  }
});

// Reject event request
router.put("/event-requests/:id/reject", verifyToken, isAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const [result] = await db.query(
      "UPDATE EVENTS SET status = 'rejected', adminId = ? WHERE eventId = ? AND status = 'pending'",
      [req.user.id, id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Event request not found or already processed" });
    }
    res.json({ message: "Event rejected" });
  } catch (err) {
    console.error("Failed to reject event", err);
    res.status(500).json({ message: "Failed to reject event" });
  }
});

// GET host applications with user and event details
router.get("/host-applications", verifyToken, isAdmin, async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT ea.*,
             u.fName, u.lName, u.email, u.phoneNb, u.age, u.description,
             e.title as eventTitle, DATE(e.startsAt) as eventDate, e.location as eventLocation
      FROM EVENT_APP ea
      JOIN USERS u ON ea.senderId = u.userId
      JOIN EVENTS e ON ea.eventId = e.eventId
      WHERE ea.requestedRole = 'host'
      ORDER BY ea.sentAt DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error("Failed to fetch host applications", err);
    res.status(500).json({ message: "Failed to fetch host applications" });
  }
});

// Approve host application
router.put("/host-applications/:id/approve", verifyToken, isAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    // Fetch application with user size, event clothing, and requestDress flag
    const [appRows] = await db.query(
      `SELECT ea.status,
              ea.requestDress,
              ea.senderId,
              ea.eventId,
              u.clothingSize,
              e.clothesId
         FROM EVENT_APP ea
         JOIN USERS u ON u.userId = ea.senderId
    LEFT JOIN EVENTS e ON e.eventId = ea.eventId
        WHERE ea.eventAppId = ?`,
      [id]
    );

    if (!appRows.length) {
      return res.status(404).json({ message: "Application not found" });
    }

    const app = appRows[0];
    if (app.status !== "pending") {
      return res.status(400).json({ message: "Application already processed" });
    }

    // If dress is requested, ensure stock is available for the user's size
    if (app.requestDress && app.clothesId && app.clothingSize) {
      const [stockRows] = await db.query(
        "SELECT stockQty FROM CLOTHING_STOCK WHERE clothingId = ? AND size = ?",
        [app.clothesId, app.clothingSize]
      );
      const stockQty = stockRows[0]?.stockQty ?? 0;
      if (stockQty <= 0) {
        return res
          .status(409)
          .json({ message: "Insufficient stock for requested dress size" });
      }

      await db.query(
        "UPDATE CLOTHING_STOCK SET stockQty = stockQty - 1 WHERE clothingId = ? AND size = ?",
        [app.clothesId, app.clothingSize]
      );
    }

    const [result] = await db.query(
      "UPDATE EVENT_APP SET status = 'accepted', adminId = ?, decidedAt = NOW() WHERE eventAppId = ? AND status = 'pending'",
      [req.user.id, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Application not found or already processed" });
    }

    const notificationDetails = await fetchApplicationNotificationDetails(id);
    const emailResult = await sendHostEventAcceptanceEmail(notificationDetails);
    const emailNotification = logEmailNotification(
      `Host event acceptance email notification for application ${id}`,
      emailResult
    );

    res.json({
      message: "Application approved",
      emailNotification,
    });
  } catch (err) {
    console.error("Failed to approve application", err);
    res.status(500).json({ message: "Failed to approve application" });
  }
});



export default router;
