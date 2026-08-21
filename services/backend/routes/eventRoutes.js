import { Router } from "express";
import db from "../config/db.js";
import { verifyToken, isAdmin, isClient, isUserOrAdmin, isUser, requireActiveHost } from "../middleware/auth.js";
import { summarizeEmailResult } from "../utils/email.js";
import { sendEventApprovalEmail } from "../utils/notificationEmails.js";
import { buildTransportationSummary } from "../utils/transportation.js";

const router = Router();
const ALLOWED_STATUSES = ["pending", "accepted", "rejected"];
const HAS_TIME = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?/;

const fetchEventWithClientById = async (eventId) => {
  const [rows] = await db.query(
    `SELECT e.eventId,
            e.status,
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

const logEmailNotification = (label, result) => {
  const status = summarizeEmailResult(result);
  console.info(`${label}: ${status}`);
  return status;
};

// List all accepted events (public)
router.get("/", async (_req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT e.*,
             c.clothingLabel AS clothingLabel,
             c.picture       AS clothingPicture,
             c.description   AS clothingDescription,
             cs.stockInfo    AS clothingStockInfo,
             EXISTS (
               SELECT 1 FROM TRANSPORTATION t WHERE t.eventId = e.eventId
             ) AS transportationAvailable,
             (
               SELECT COUNT(*)
                 FROM EVENT_APP ea
                WHERE ea.eventId = e.eventId
                  AND ea.status = 'accepted'
             ) AS acceptedHostsCount
        FROM EVENTS e
   LEFT JOIN CLOTHING c ON c.clothesId = e.clothesId
   LEFT JOIN (
              SELECT clothingId,
                     GROUP_CONCAT(CONCAT(size, ':', stockQty) SEPARATOR ', ') AS stockInfo
                FROM CLOTHING_STOCK
            GROUP BY clothingId
             ) cs ON cs.clothingId = e.clothesId
       WHERE e.status = 'accepted'`);
    const normalized = rows.map((event) => ({
      ...event,
      transportationAvailable: Boolean(event.transportationAvailable),
    }));

    res.json(normalized);
  } catch (err) {
    console.error("Failed to fetch events", err);
    res.status(500).json({ message: "Failed to fetch events" });
  }
});

// Team leader/admin event overview
router.get("/:id/team-view", verifyToken, isUserOrAdmin, async (req, res) => {
  const eventId = parseInt(req.params.id, 10);
  if (Number.isNaN(eventId)) {
    return res.status(400).json({ message: "Invalid event id" });
  }

  try {
    const [eventRows] = await db.query(
      `SELECT e.*, 
              c.fName AS clientFirstName, c.lName AS clientLastName,
              c.email AS clientEmail, c.phoneNb AS clientPhone, c.address AS clientAddress,
              tl.fName AS tlFirstName, tl.lName AS tlLastName,
              cl.clothingLabel AS clothingLabel,
              cl.picture       AS clothingPicture,
              cl.description   AS clothingDescription,
              cs.stockInfo     AS clothingStockInfo,
              (
                SELECT COUNT(*)
                  FROM EVENT_APP ea2
                 WHERE ea2.eventId = e.eventId
                   AND ea2.status = 'accepted'
              ) AS acceptedHostsCount
         FROM EVENTS e
    LEFT JOIN CLIENTS c ON c.clientId = e.clientId
    LEFT JOIN USERS tl ON tl.userId = e.teamLeaderId
    LEFT JOIN CLOTHING cl ON cl.clothesId = e.clothesId
    LEFT JOIN (
              SELECT clothingId,
                     GROUP_CONCAT(CONCAT(size, ':', stockQty) SEPARATOR ', ') AS stockInfo
                FROM CLOTHING_STOCK
            GROUP BY clothingId
             ) cs ON cs.clothingId = e.clothesId
        WHERE e.eventId = ?`,
      [eventId]
    );

    if (!eventRows.length) {
      return res.status(404).json({ message: "Event not found" });
    }

    const event = eventRows[0];

    if (req.user.role === "user") {
      const isAssignedLeader = event.teamLeaderId === req.user.id;
      if (!isAssignedLeader) {
        const [assignmentRows] = await db.query(
          `SELECT 1 FROM EVENT_APP 
            WHERE eventId = ? AND senderId = ? 
              AND assignedRole = 'team_leader' AND status = 'accepted'`,
          [eventId, req.user.id]
        );
        if (!assignmentRows.length) {
          return res.status(403).json({ message: "Access denied" });
        }
      }
    }

    const [hostRows] = await db.query(
      `SELECT ea.eventAppId,
              ea.assignedRole,
              u.userId,
              u.fName,
              u.lName,
              u.email,
              u.phoneNb,
              u.clothingSize,
              u.profilePic,
              u.description,
              clo.clothesId,
              clo.clothingLabel,
              clo.picture  AS clothingPicture,
              clo.description AS clothingDescription,
              ea.needsRide
        FROM EVENT_APP ea
        JOIN USERS u ON u.userId = ea.senderId
    LEFT JOIN EVENTS ev ON ev.eventId = ea.eventId
    LEFT JOIN CLOTHING clo ON clo.clothesId = ev.clothesId AND ea.requestDress = 1
        WHERE ea.eventId = ? AND ea.status = 'accepted'
        ORDER BY ea.assignedRole DESC, u.fName`,
      [eventId]
    );
    const transportationSummary = await buildTransportationSummary(eventId, event.nbOfHosts);

    const normalizeDate = (value) =>
      value instanceof Date ? value.toISOString() : value;

    const client = event.clientId
      ? {
          id: event.clientId,
          name: [event.clientFirstName, event.clientLastName].filter(Boolean).join(" ").trim() || null,
          email: event.clientEmail || null,
          phone: event.clientPhone || null,
          address: event.clientAddress || null,
        }
      : null;

    const teamLeaderName = [event.tlFirstName, event.tlLastName]
      .filter(Boolean)
      .join(" ")
      .trim();

    res.json({
      event: {
        eventId: event.eventId,
        title: event.title,
        type: event.type,
        description: event.description,
        location: event.location,
        startsAt: normalizeDate(event.startsAt),
        endsAt: normalizeDate(event.endsAt),
        nbOfHosts: event.nbOfHosts,
        nbOfGuests: event.nbOfGuests || null,
        acceptedHostsCount: event.acceptedHostsCount || 0,
        dressCode: event.dressCode ?? null,
        status: event.status,
        teamLeaderId: event.teamLeaderId,
        teamLeaderName: teamLeaderName || null,
        outfit: event.clothingLabel
          ? {
              clothesId: event.clothesId,
              label: event.clothingLabel,
              picture: event.clothingPicture,
              description: event.clothingDescription,
              stockInfo: event.clothingStockInfo || null,
            }
          : null,
        transportationAvailable: Boolean(transportationSummary.available),
      },
      client,
      hosts: hostRows.map((host) => ({
        eventAppId: host.eventAppId,
        userId: host.userId,
        name: `${host.fName} ${host.lName}`.trim(),
        email: host.email,
        phone: host.phoneNb,
        role: host.assignedRole === "team_leader" ? "Team Leader" : "Host",
        clothingSize: host.clothingSize,
        profileImage: host.profilePic,
        description: host.description,
        needsRide: Boolean(host.needsRide),
        outfit: host.clothesId
          ? {
              clothesId: host.clothesId,
              label: host.clothingLabel,
              picture: host.clothingPicture,
              description: host.clothingDescription,
            }
          : null,
      })),
      transportation: {
        ...transportationSummary,
        trips: transportationSummary.trips.map((row) => ({
          ...row,
          departureTime: normalizeDate(row.departureTime),
          returnTime: normalizeDate(row.returnTime),
        })),
      },
    });
  } catch (err) {
    console.error("Failed to fetch team view", err);
    res.status(500).json({ message: "Failed to fetch team view" });
  }
});

router.get("/team-leader/assignments", verifyToken, requireActiveHost, async (req, res) => {
  const userId = req.user.id;
  try {
    const [rows] = await db.query(
      `SELECT DISTINCT e.eventId,
              e.title,
              e.status,
              e.startsAt,
              e.location,
              e.teamLeaderId
         FROM EVENTS e
    LEFT JOIN EVENT_APP ea
           ON ea.eventId = e.eventId
          AND ea.senderId = ?
          AND ea.assignedRole = 'team_leader'
          AND ea.status = 'accepted'
        WHERE e.teamLeaderId = ?
           OR ea.eventAppId IS NOT NULL
        ORDER BY e.startsAt DESC`,
      [userId, userId]
    );
    res.json(rows);
  } catch (err) {
    console.error("Failed to fetch team leader assignments", err);
    res.status(500).json({ message: "Failed to fetch team leader assignments" });
  }
});

// Get a single accepted event (public)
router.get("/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await db.query(
      `SELECT e.*,
              cl.clothingLabel AS clothingLabel,
              cl.picture       AS clothingPicture,
              cl.description   AS clothingDescription,
              (
                SELECT COUNT(*)
                  FROM EVENT_APP ea
                 WHERE ea.eventId = e.eventId
                   AND ea.status = 'accepted'
              ) AS acceptedHostsCount,
              cs.stockInfo     AS clothingStockInfo,
              EXISTS (
                SELECT 1 FROM TRANSPORTATION t WHERE t.eventId = e.eventId
              ) AS transportationAvailable
         FROM EVENTS e
    LEFT JOIN CLOTHING cl ON cl.clothesId = e.clothesId
    LEFT JOIN (
              SELECT clothingId,
                     GROUP_CONCAT(CONCAT(size, ':', stockQty) SEPARATOR ', ') AS stockInfo
                FROM CLOTHING_STOCK
            GROUP BY clothingId
             ) cs ON cs.clothingId = e.clothesId
        WHERE e.eventId = ? AND e.status = 'accepted'`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ message: "Event not found" });
    const event = rows[0];
    res.json({
      ...event,
      transportationAvailable: Boolean(event.transportationAvailable),
    });
  } catch (err) {
    console.error("Failed to fetch event", err);
    res.status(500).json({ message: "Failed to fetch event" });
  }
});

// Client creates an event request (pending)
router.post("/", verifyToken, isClient, async (req, res) => {
  const {
    type,
    description,
    location,
    locationLat,
    locationLng,
    locationPlaceName,
    startsAt,
    endsAt,
    nbOfGuests,
  } = req.body;

  // Quick validation
  if (!type || !description || !location || !startsAt || !endsAt || !nbOfGuests) {
    return res.status(400).json({ message: "type, description, location, startsAt, endsAt, and nbOfGuests are required" });
  }
  if (!HAS_TIME.test(String(startsAt)) || !HAS_TIME.test(String(endsAt))) {
    return res.status(400).json({ message: "startsAt and endsAt must include a time (e.g., 2026-06-15 00:00:00)" });
  }

  const now = new Date();
  const start = new Date(startsAt);
  const end = new Date(endsAt);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return res.status(400).json({ message: "Invalid dates" });
  }

  if (start < now || end < now) {
    return res.status(400).json({ message: "Dates must be in the future" });
  }

  if (start >= end) {
    return res.status(400).json({ message: "End date should be after Start Date" });
  }
  //if the client sent a title, trim whitespaces and use it, otherwise autogenerate one
  const title = req.body.title?.trim() || `${type} on ${String(startsAt).split("T")[0]}`;
  const clientId = req.user.id;

  try {
    const [result] = await db.query(
      `INSERT INTO EVENTS (
         title, type, description, location, locationLat, locationLng, locationPlaceName, startsAt, endsAt,
         nbOfHosts, nbOfGuests, floorPlan, attendeesList, rate,
         teamLeaderId, clothesId, clientId, adminId, status
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      , [
        title,
        type,
        description,
        location,
        locationLat ?? null,
        locationLng ?? null,
        locationPlaceName?.trim() || null,
        startsAt,
        endsAt,
        Math.max(1, Math.ceil(Number(nbOfGuests) / 5)),
        Number(nbOfGuests),
        req.body.floorPlan ?? null,
        req.body.attendeesList ?? null,
        req.body.rate ?? null,
        req.body.teamLeaderId ?? null,
        req.body.clothesId ?? null,
        clientId,
        null,
        "pending"
      ]
    );

    res.status(201).json({ eventId: result.insertId, message: "Event request submitted (pending approval)" });
  } catch (err) {
    console.error("Failed to create event", err);
    res.status(500).json({ message: "Failed to create event" });
  }
});

// Admin updates an event (fields and/or status)
//Admin updates go through PUT /api/events/:id with a valid admin token. You only send the fields you want to change; missing fields stay as-is.

//req.params is an object Express builds from the URL path parameters. For a route like PUT /api/events/:id, when the URL is /api/events/42, req.params is { id: "42" }. You destructure from it to get the id value.
//Any clientId sent in the request is simply not used (should not be changed)
router.put("/:id", verifyToken, isAdmin, async (req, res) => {
  const { id } = req.params;
  const {
    title,
    type,
    description,
    location,
    locationLat,
    locationLng,
    locationPlaceName,
    startsAt,
    endsAt,
    nbOfHosts,
    floorPlan,
    attendeesList,
    rate,
    teamLeaderId,
    clothesId,
    adminId,
    status,
  } = req.body;

  if (!req.body || Object.keys(req.body).length === 0) {
    return res.status(400).json({ message: "No fields to update" });
  }

//if a status was provided and it’s not one of pending|accepted|rejected--> error.
  if (status && !ALLOWED_STATUSES.includes(status)) {
    return res.status(400).json({ message: "Invalid status" });
  }
  // both startsAt and endsAt were provided, ensure they're valid dates and endsAt is after startsAt
  if (startsAt && endsAt) {
    const now = new Date();
    const start = new Date(startsAt);
    const end = new Date(endsAt);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return res.status(400).json({ message: "Invalid dates" });
    }

    if (start < now || end < now) {
      return res.status(400).json({ message: "Dates must be in the future!" });
    }

    if (start >= end) {
      return res.status(400).json({ message: "End date must be after Start date" });
    }
  }

  const fields = [];
  const values = [];

  const add = (col, val, transform = (v) => v) => {
    if (typeof val !== "undefined") {
      fields.push(`${col} = ?`);
      values.push(transform(val));
    }
  };

  if (typeof title !== "undefined" && !title.trim()) {
  return res.status(400).json({ message: "Title cannot be empty" });
}
  add("title", title?.trim());
  add("type", type?.trim());
  add("description", description);
  add("location", location?.trim());
  add("locationLat", locationLat ?? null);
  add("locationLng", locationLng ?? null);
  add("locationPlaceName", locationPlaceName?.trim() || null);
  add("startsAt", startsAt);
  add("endsAt", endsAt);
  add("nbOfHosts", nbOfHosts, Number);
  add("floorPlan", floorPlan ?? null);
  add("attendeesList", attendeesList ?? null);
  add("rate", rate ?? null);
  add("teamLeaderId", teamLeaderId ?? null);
  if (Object.prototype.hasOwnProperty.call(req.body, "clothesId")) {
    add("clothesId", clothesId ?? null);
  }

  if (typeof status !== "undefined") {
    fields.push("status = ?");
    values.push(status);
    //Status change to accepted or rejected without adminId → adminId auto set to the acting admin
    if (["accepted", "rejected"].includes(status) && typeof adminId === "undefined") {
      fields.push("adminId = ?");
      values.push(req.user.id);
    }
  }

  if (typeof adminId !== "undefined") {
    fields.push("adminId = ?");
    values.push(adminId);
  }


  values.push(id);

  try {
    const previousEvent =
      status === "accepted" ? await fetchEventWithClientById(id) : null;
    if (status === "accepted" && !previousEvent) {
      return res.status(404).json({ message: "Event not found" });
    }

    const [result] = await db.query(`UPDATE EVENTS SET ${fields.join(", ")} WHERE eventId = ?`, values);
    if (result.affectedRows === 0) return res.status(404).json({ message: "Event not found" });

    let emailNotification;
    if (status === "accepted" && previousEvent.status !== "accepted") {
      const updatedEvent = await fetchEventWithClientById(id);
      const emailResult = await sendEventApprovalEmail(updatedEvent || previousEvent);
      emailNotification = logEmailNotification(
        `Event approval email notification for event ${id}`,
        emailResult
      );
    }

    res.json({
      message: "Event updated",
      ...(emailNotification ? { emailNotification } : {}),
    });
  } catch (err) {
    console.error("Failed to update event", err);
    res.status(500).json({ message: "Failed to update event" });
  }
});

// Admin deletes an event
router.delete("/:id", verifyToken, isAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const [result] = await db.query("DELETE FROM EVENTS WHERE eventId = ?", [id]);
    if (result.affectedRows === 0) return res.status(404).json({ message: "Event not found" });
    res.json({ message: "Event deleted" });
  } catch (err) {
    console.error("Failed to delete event", err);
    res.status(500).json({ message: "Failed to delete event" });
  }
});



export default router;
