import { Router } from "express";
import db from "../config/db.js";
import { verifyToken, isAdmin, isUserOrAdmin, requireActiveHost } from "../middleware/auth.js";
import { summarizeEmailResult } from "../utils/email.js";
import { sendHostEventAcceptanceEmail } from "../utils/notificationEmails.js";


const router = Router();

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


router.get("/", verifyToken, isUserOrAdmin, async (req, res) => {
  try {
    let query;
    let params = [];

    if (req.user.role === "admin") {
      query = `
        SELECT ea.*,
               u.userId AS applicantUserId,
               u.fName AS applicantFirstName,
               u.lName AS applicantLastName,
               u.email AS applicantEmail,
               u.phoneNb AS applicantPhone,
               u.clothingSize AS applicantClothingSize,
               u.description AS applicantDescription,
               e.title AS eventTitle,
               e.location AS eventLocation,
               DATE(e.startsAt) AS eventDate
          FROM EVENT_APP ea
          JOIN USERS u ON u.userId = ea.senderId
          LEFT JOIN EVENTS e ON e.eventId = ea.eventId
         ORDER BY ea.sentAt DESC`;
    } else {
      query = `
        SELECT ea.*,
               u.userId AS applicantUserId,
               u.fName AS applicantFirstName,
               u.lName AS applicantLastName,
               u.email AS applicantEmail,
               u.phoneNb AS applicantPhone,
               u.clothingSize AS applicantClothingSize,
               u.description AS applicantDescription,
               e.title AS eventTitle,
               e.location AS eventLocation,
               DATE(e.startsAt) AS eventDate
          FROM EVENT_APP ea
          JOIN USERS u ON u.userId = ea.senderId
          JOIN EVENTS e ON e.eventId = ea.eventId
         WHERE ea.senderId = ?
         ORDER BY ea.sentAt DESC`;
      params.push(req.user.id);
    }

    const [rows] = await db.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error("Failed to fetch event app", err);
    res.status(500).json({ message: "Failed to fetch event app" });
  }
});

router.get("/:id", verifyToken, isUserOrAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    let query = "SELECT * FROM EVENT_APP WHERE eventAppId = ?";
    let params = [id];

    // If not admin, ensure user can only access their own applications
    if (req.user.role !== 'admin') {
      query += " AND senderId = ?";
      params.push(req.user.id);
    }

    const [rows] = await db.query(query, params);
    if (!rows.length) {
      return res.status(404).json({ message: "Event app not found" });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error("Failed to fetch event application", err);
    res.status(500).json({ message: "Failed to fetch event application" });
  }
});

// GET applications for a specific event (admin only)
router.get("/event/:eventId", verifyToken, isAdmin, async (req, res) => {
  const { eventId } = req.params;
  try {
    const [rows] = await db.query(`
      SELECT ea.*,
             u.fName, u.lName, u.email, u.phoneNb, u.age, u.description, u.clothingSize,
             e.title as eventTitle, DATE(e.startsAt) as eventDate, e.location as eventLocation,
             cs.stockQty as availableStock
      FROM EVENT_APP ea
      JOIN USERS u ON ea.senderId = u.userId
      JOIN EVENTS e ON ea.eventId = e.eventId
      LEFT JOIN CLOTHING_STOCK cs ON cs.clothingId = e.clothesId AND cs.size = u.clothingSize
      WHERE ea.eventId = ?
      ORDER BY ea.sentAt DESC
    `, [eventId]);
    res.json(rows);
  } catch (err) {
    console.error("Failed to fetch applications for event", err);
    res.status(500).json({ message: "Failed to fetch applications for event" });
  }
});


router.post("/", verifyToken, requireActiveHost, async (req, res) => {
  try {
    const { requestedRole, notes, eventId, requestDress, needsRide } = req.body;
    const ridePreference = Boolean(needsRide);

    // Validation
    if (!requestedRole || !requestedRole.trim()) {
      return res.status(400).json({ message: "requestedRole is required" });
    }
    if (!eventId || isNaN(eventId)) {
      return res.status(400).json({ message: "Valid eventId is required" });
    }

    // Check if event exists and is approved
    const [eventCheck] = await db.query(
      "SELECT eventId, clothesId FROM EVENTS WHERE eventId = ? AND status = 'accepted'",
      [parseInt(eventId)]
    );
    if (eventCheck.length === 0) {
      return res.status(400).json({ message: "Invalid event - event not found or not approved" });
    }
    const event = eventCheck[0];

    // Check if user has already applied to this event
    const [existingApp] = await db.query(
      "SELECT eventAppId FROM EVENT_APP WHERE senderId = ? AND eventId = ?",
      [req.user.id, parseInt(eventId)]
    );

    if (existingApp.length > 0) {
      return res.status(409).json({ message: "You have already applied for this event" });
    }

    const [result] = await db.query(
      `INSERT INTO EVENT_APP (status, requestedRole, assignedRole, notes, sentAt, decidedAt, senderId, adminId, eventId, requestDress, needsRide)
       VALUES (?, ?, ?, ?, NOW(), NULL, ?, NULL, ?, ?, ?)`,
      [
        'pending',
        requestedRole.trim(),
        null,
        notes || null,
        req.user.id,
        parseInt(eventId),
        requestDress ? 1 : 0,
        ridePreference ? 1 : 0,
      ]
    );

    res.status(201).json({
      eventAppId: result.insertId,
      message: "Event application created"
    });

  } catch (err) {
    console.error("Failed to create event application", err);
    if (err.code === 'ER_NO_REFERENCED_ROW_2') {
      return res.status(400).json({ message: "Invalid eventId - event does not exist" });
    }
    res.status(500).json({ message: "Failed to create event application" });
  }
});

router.patch("/:id/ride", verifyToken, requireActiveHost, async (req, res) => {
  const { id } = req.params;
  const { needsRide } = req.body || {};

  if (typeof needsRide !== "boolean") {
    return res.status(400).json({ message: "needsRide must be a boolean" });
  }

  try {
    const [rows] = await db.query(
      "SELECT senderId, status FROM EVENT_APP WHERE eventAppId = ?",
      [id]
    );

    if (!rows.length) {
      return res.status(404).json({ message: "Event application not found" });
    }

    const app = rows[0];
    if (app.senderId !== req.user.id) {
      return res.status(403).json({ message: "Access denied" });
    }

    if (app.status !== "pending") {
      return res.status(400).json({ message: "Transportation preference can only be updated while the application is pending" });
    }

    await db.query(
      "UPDATE EVENT_APP SET needsRide = ? WHERE eventAppId = ?",
      [needsRide ? 1 : 0, id]
    );

    res.json({ message: "Transportation preference updated" });
  } catch (err) {
    console.error("Failed to update transportation preference", err);
    res.status(500).json({ message: "Failed to update transportation preference" });
  }
});


router.put("/:id", verifyToken, isAdmin, async (req, res) => {
  const { id } = req.params;
  let { status, assignedRole, decidedAt, adminId } = req.body;

  // Use 'accepted' and 'rejected' consistently
  if (status && !['accepted', 'rejected'].includes(status)) {
    return res.status(400).json({ message: "Invalid status value. Must be 'accepted' or 'rejected'" });
  }
 
  // Treat empty assignedRole as undefined
  if (assignedRole === "") {
    assignedRole = undefined; 
  }

  if (adminId && (isNaN(adminId) || adminId <= 0)) {
    return res.status(400).json({ message: "Invalid adminId" });
  }

  if (assignedRole && !['host', 'team_leader'].includes(assignedRole.toLowerCase())) {
    return res.status(400).json({ message: "Invalid assignedRole. Must be 'host' or 'team_leader'" });
  }

  try {
    // First, get the current application to check status and get requestedRole, eventId, senderId, requestDress
    const [currentApp] = await db.query("SELECT status, requestedRole, eventId, senderId, requestDress FROM EVENT_APP WHERE eventAppId = ?", [id]);
    if (currentApp.length === 0) {
      return res.status(404).json({ message: "Event application not found" });
    }

    const currentStatus = currentApp[0].status;
    const requestedRole = currentApp[0].requestedRole;
    const eventId = currentApp[0].eventId;
    const senderId = currentApp[0].senderId;
    const requestDress = currentApp[0].requestDress;
    const resultingStatus = typeof status !== "undefined" ? status : currentStatus;

    // Prevent changing status if already decided
    if (status && currentStatus !== 'pending' && status !== currentStatus) {
      return res.status(400).json({ 
        message: `Cannot change status from '${currentStatus}' to '${status}'. Decision has already been made.` 
      });
    }

    // Only allow status changes from pending to accepted/rejected
    if (status && status !== currentStatus && currentStatus !== 'pending' && ['accepted', 'rejected'].includes(currentStatus)) {
      return res.status(400).json({
        message: "Cannot modify status of an application that has already been decided"
      });
    }

    /*
    // COMMENTED: Flexible logic allowing status changes (uncomment these blocks and comment out the active ones above if you want admins to be able to change decisions)

    // Remove these active restrictions:
    // if (status && currentStatus !== 'pending' && status !== currentStatus) {
    //   return res.status(400).json({
    //     message: `Cannot change status from '${currentStatus}' to '${status}'. Decision has already been made.`
    //   });
    // }

    // if (status && currentStatus !== 'pending' && ['accepted', 'rejected'].includes(currentStatus)) {
    //   return res.status(400).json({
    //     message: "Cannot modify status of an application that has already been decided"
    //   });
    // }

    // And add this to allow flexible status changes:
    // if (status && currentStatus !== 'pending' && status !== currentStatus) {
    //   // Allow the change but you could log it here
    //   console.log(`Admin ${req.user.id} changed status from ${currentStatus} to ${status} for application ${id}`);
    // }
    */

    

    const setParts = [];
    const values = [];
    let finalAssignedRole;

    if (status !== undefined) {
      setParts.push("status = ?");
      values.push(status);
      
      // Use 'accepted' for approval logic
      if (status === 'accepted') {
        // Check for scheduling conflicts before accepting
        const [eventData] = await db.query(
          "SELECT startsAt, endsAt FROM EVENTS WHERE eventId = ?",
          [eventId]
        );

        if (eventData.length === 0) {
          return res.status(400).json({ message: "Event not found" });
        }

        const { startsAt: newStart, endsAt: newEnd } = eventData[0];

        // Check if user has any accepted applications with overlapping dates
        const [conflicts] = await db.query(`
          SELECT ea.eventAppId, e.title, e.startsAt, e.endsAt
          FROM EVENT_APP ea
          JOIN EVENTS e ON ea.eventId = e.eventId
          WHERE ea.senderId = ? AND ea.status = 'accepted' AND ea.eventAppId != ?
          AND (
            (e.startsAt <= ? AND e.endsAt >= ?) OR
            (? <= e.endsAt AND ? >= e.startsAt)
          )
        `, [senderId, id, newStart, newStart, newEnd, newEnd]);

        if (conflicts.length > 0) {
          const conflictDetails = conflicts.map(c =>
            `${c.title} (${new Date(c.startsAt).toISOString().split('T')[0]} to ${new Date(c.endsAt).toISOString().split('T')[0]})`
          ).join(', ');
          return res.status(409).json({
            message: "Cannot accept application due to scheduling conflict",
            conflicts: conflictDetails
          });
        }

        const roleToAssign = (assignedRole ?? requestedRole) ?? null;
        if (roleToAssign !== null) {
          const normalizedRole = roleToAssign.toLowerCase();
          setParts.push("assignedRole = ?");
          values.push(normalizedRole);
          finalAssignedRole = normalizedRole;
        }
      } else if (status === 'rejected') {
        // When rejecting, don't set assignedRole
      }
    } else if (assignedRole !== undefined) {
      // Only allow updating assignedRole for accepted applications
      if (currentStatus !== 'accepted') {
        return res.status(400).json({ message: "Cannot update assignedRole for applications that are not accepted" });
      }
      const normalizedRole = assignedRole.toLowerCase();
      setParts.push("assignedRole = ?");
      values.push(normalizedRole);
      finalAssignedRole = normalizedRole;
    }

    if (decidedAt !== undefined) {
      setParts.push("decidedAt = ?");
      values.push(decidedAt);
    }
    if (adminId !== undefined) {
      setParts.push("adminId = ?");
      values.push(adminId);
    }

    if (setParts.length === 0) {
      return res.status(400).json({ message: "No valid fields to update. Only status, assignedRole, decidedAt, and adminId can be updated" });
    }

    // Use 'accepted' for decision logic
    if (status && ['accepted', 'rejected'].includes(status)) {
      if (!setParts.includes("decidedAt = ?")) {
        setParts.push("decidedAt = NOW()");
      }
      if (!setParts.includes("adminId = ?")) {
        setParts.push("adminId = ?");
        values.push(req.user.id);
      }
    }

    let shouldDecrementStock = false;
    let clothingStockParams = null;
    if (currentStatus === "pending" && resultingStatus === 'accepted' && requestDress) {
      // Get user's clothing size
      const [userRows] = await db.query("SELECT clothingSize FROM USERS WHERE userId = ?", [senderId]);
      if (userRows.length === 0) {
        return res.status(400).json({ message: "User not found" });
      }
      const userSize = userRows[0].clothingSize;

      const [eventRows] = await db.query("SELECT clothesId FROM EVENTS WHERE eventId = ?", [eventId]);
      if (eventRows.length === 0) {
        return res.status(400).json({ message: "Event not found" });
      }
      const clothesId = eventRows[0].clothesId;

      if (clothesId && userSize) {
        const [stockRows] = await db.query(
          "SELECT stockQty FROM CLOTHING_STOCK WHERE clothingId = ? AND size = ?",
          [clothesId, userSize]
        );
        if (stockRows.length === 0 || stockRows[0].stockQty <= 0) {
          return res.status(409).json({ message: "Cannot accept application - insufficient stock for requested dress size" });
        }
        shouldDecrementStock = true;
        clothingStockParams = [clothesId, userSize];
      }
    }

    const query = `UPDATE EVENT_APP SET ${setParts.join(', ')} WHERE eventAppId = ?`;
    values.push(id);

    const [result] = await db.query(query, values);
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Event application not found" });
    }

    if (resultingStatus === 'accepted' && finalAssignedRole === 'team_leader') {
      await db.query(
        "UPDATE EVENTS SET teamLeaderId = ? WHERE eventId = ?",
        [senderId, eventId]
      );
    }

    if (shouldDecrementStock) {
      await db.query(
        "UPDATE CLOTHING_STOCK SET stockQty = stockQty - 1 WHERE clothingId = ? AND size = ?",
        clothingStockParams
      );
    }

    let emailNotification;
    if (currentStatus === "pending" && resultingStatus === "accepted") {
      const notificationDetails = await fetchApplicationNotificationDetails(id);
      const emailResult = await sendHostEventAcceptanceEmail(notificationDetails);
      emailNotification = logEmailNotification(
        `Host event acceptance email notification for application ${id}`,
        emailResult
      );
    }

    res.json({
      message: "Event application updated",
      ...(emailNotification ? { emailNotification } : {}),
    });
  } catch (err) {
    console.error("Failed to update event application", err);
    if (err.code === 'ER_NO_REFERENCED_ROW_2') {
      return res.status(400).json({ message: "Invalid adminId" });
    }
    res.status(500).json({ message: "Failed to update event application" });
  }
});



router.delete("/:id", verifyToken, isAdmin, async (req, res) => {
  const { id } = req.params;
  try {
   const [result] = await db.query("DELETE FROM EVENT_APP WHERE eventAppId = ?", [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Event application not found" });
    }
    res.json({ message: "Event application deleted" });
  } catch (err) {
    console.error("Failed to delete event application", err);
    res.status(500).json({ message: "Failed to delete event application" });
  }
});

export default router;
