import { Router } from "express";
import db from "../config/db.js";
import { verifyToken, isAdmin, isUserOrAdmin } from "../middleware/auth.js";
import { buildTransportationSummary } from "../utils/transportation.js";

const router = Router();

const toMysqlDateTime = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const pad = (num) => String(num).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

//get event 
const fetchEventMeta = async (eventId) => {
  const [rows] = await db.query(
    "SELECT eventId, nbOfHosts, teamLeaderId FROM EVENTS WHERE eventId = ?",
    [eventId]
  );
  return rows[0] || null;
};

//admin or teamleader can access
const ensureEventAccess = async (eventId, user) => {
  const event = await fetchEventMeta(eventId);
  if (!event) {
    return { allowed: false, reason: "Event not found" };
  }

  if (user.role === "admin") {
    return { allowed: true, event };
  }

  if (user.role !== "user") {
    return { allowed: false, reason: "Access denied" };
  }

  if (event.teamLeaderId === user.id) {
    return { allowed: true, event };
  }


//accepted hosts can access
  const [assignment] = await db.query(
    `SELECT 1
       FROM EVENT_APP
      WHERE eventId = ?
        AND senderId = ?
        AND status = 'accepted'`,
    [eventId, user.id]
  );

  if (assignment.length) {
    return { allowed: true, event };
  }

  return { allowed: false, reason: "Access denied" };
};

//get transportation details + possible errors
router.get("/:eventId", verifyToken, isUserOrAdmin, async (req, res) => {
  const eventId = Number(req.params.eventId);
  if (!Number.isInteger(eventId) || eventId <= 0) {
    return res.status(400).json({ message: "Invalid event id" });
  }

  try {
    const { allowed, event, reason } = await ensureEventAccess(eventId, req.user);
    if (!allowed) {
      return res.status(reason === "Event not found" ? 404 : 403).json({ message: reason });
    }

    const summary = await buildTransportationSummary(eventId, event.nbOfHosts);
    res.json(summary);
  } catch (err) {
    console.error("Failed to fetch transportation", err);
    res.status(500).json({ message: "Failed to fetch transportation" });
  }
});

//admin creates/updates transp + errors
router.post("/:eventId", verifyToken, isAdmin, async (req, res) => {
  const eventId = Number(req.params.eventId);
  const { pickupLocation, departureTime, returnTime, payment } = req.body || {};

  if (!Number.isInteger(eventId) || eventId <= 0) {
    return res.status(400).json({ message: "Invalid event id" });
  }
  if (!pickupLocation || !pickupLocation.trim()) {
    return res.status(400).json({ message: "pickupLocation is required" });
  }
  const mysqlDeparture = toMysqlDateTime(departureTime);
  if (!mysqlDeparture) {
    return res.status(400).json({ message: "Valid departureTime is required" });
  }
  let mysqlReturn = null;
  if (returnTime) {
    mysqlReturn = toMysqlDateTime(returnTime);
    if (!mysqlReturn) {
      return res.status(400).json({ message: "returnTime is invalid" });
    }
    if (new Date(returnTime) < new Date(departureTime)) {
      return res.status(400).json({ message: "returnTime must be after departureTime" });
    }
  }

  const sanitizedPayment = Number(payment ?? 0);
  if (Number.isNaN(sanitizedPayment) || sanitizedPayment < 0) {
    return res.status(400).json({ message: "payment must be a positive number" });
  }

  try {
    const event = await fetchEventMeta(eventId);
    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }
    //check existing transportation
    const [existing] = await db.query(
      "SELECT transportationId FROM TRANSPORTATION WHERE eventId = ?",
      [eventId]
    );
    //update or insert transportation
    if (existing.length) {
      await db.query(
        `UPDATE TRANSPORTATION
            SET pickupLocation = ?,
                departureTime = ?,
                returnTime = ?,
                payment = ?
          WHERE eventId = ?`,
        [
          pickupLocation.trim(),
          mysqlDeparture,
          mysqlReturn,
          sanitizedPayment,
          eventId,
        ]
      );
    } else {
      await db.query(
        `INSERT INTO TRANSPORTATION (eventId, pickupLocation, departureTime, returnTime, payment)
         VALUES (?, ?, ?, ?, ?)`,
        [eventId, pickupLocation.trim(), mysqlDeparture, mysqlReturn, sanitizedPayment]
      );
    }
    //return updated summary
    const summary = await buildTransportationSummary(eventId, event.nbOfHosts);
    res.json({ message: "Transportation saved", transportation: summary });
  } catch (err) {
    console.error("Failed to save transportation", err);
    res.status(500).json({ message: "Failed to save transportation" });
  }
});

//admin deletes transportation + possible errors
router.delete("/:eventId", verifyToken, isAdmin, async (req, res) => {
  const eventId = Number(req.params.eventId);
  if (!Number.isInteger(eventId) || eventId <= 0) {
    return res.status(400).json({ message: "Invalid event id" });
  }

  try {
    const [result] = await db.query("DELETE FROM TRANSPORTATION WHERE eventId = ?", [eventId]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Transportation not found" });
    }
    res.json({ message: "Transportation removed" });
  } catch (err) {
    console.error("Failed to delete transportation", err);
    res.status(500).json({ message: "Failed to delete transportation" });
  }
});

export default router;
