import { Router } from "express";
import jwt from "jsonwebtoken";
import db from "../config/db.js";
import "../config/env.js";
import { verifyToken, isAdmin, requireActiveHost } from "../middleware/auth.js";

const router = Router();
const MIN_STAR_RATING = 1;
const MAX_STAR_RATING = 5;
const VISIBILITY_VALUES = new Set(["public", "private", "hidden"]);

//parse + validate +ve int
const parsePositiveInt = (value) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

//parse + validate star rating
const parseStarRating = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) return null;
  if (parsed < MIN_STAR_RATING || parsed > MAX_STAR_RATING) return null;
  return parsed;
};

//auth middleware
const optionalAuth = (req, _res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) {
    req.optionalUser = null;
    return next();
  }
  try {
    req.optionalUser = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    req.optionalUser = null;
  }
  next();
};

//map review row to object
const mapReviewRow = (row) => ({
  reviewerId: row.reviewerId,
  eventId: row.eventId,
  starRating: row.starRating,
  content: row.content,
  visibility: row.visibility,
  createdAt: row.createdAt,
  reviewer: row.fName
    ? {
        fName: row.fName,
        lName: row.lName,
      }
    : undefined,
});

//tl submits review for event
router.post(
  "/host/events/:eventId/review",
  verifyToken,
  requireActiveHost,
  async (req, res) => {
    const parsedEventId = parsePositiveInt(req.params.eventId);
    if (!parsedEventId) {
      return res.status(400).json({ message: "Invalid event id." });
    }

    const parsedRating = parseStarRating(req.body?.starRating);
    if (parsedRating === null) {
      return res
        .status(400)
        .json({ message: "starRating must be an integer between 1 and 5." });
    }

    const trimmedContent =
      typeof req.body?.content === "string" ? req.body.content.trim() : "";

    try {
      const [eventRows] = await db.query(
        `SELECT eventId, teamLeaderId, endsAt
           FROM EVENTS
          WHERE eventId = ?`,
        [parsedEventId]
      );
      if (!eventRows.length) {
        return res.status(404).json({ message: "Event not found." });
      }
      const event = eventRows[0];
      if (event.teamLeaderId !== req.user.id) {
        return res
          .status(403)
          .json({ message: "Only the team leader can review this event." });
      }
      const eventEnd = event.endsAt ? new Date(event.endsAt) : null;
      if (!eventEnd || Number.isNaN(eventEnd.getTime()) || eventEnd > new Date()) {
        return res
          .status(400)
          .json({ message: "You can only review an event after it has ended." });
      }

      const [existingRows] = await db.query(
        `SELECT 1
           FROM REVIEW
          WHERE reviewerId = ? AND eventId = ?`,
        [req.user.id, parsedEventId]
      );
      if (existingRows.length) {
        return res
          .status(400)
          .json({ message: "You have already submitted a review for this event." });
      }

      await db.query(
        `INSERT INTO REVIEW (reviewerId, eventId, starRating, content, visibility)
         VALUES (?, ?, ?, ?, 'public')`,
        [req.user.id, parsedEventId, parsedRating, trimmedContent || null]
      );

      const [createdRows] = await db.query(
        `SELECT reviewerId, eventId, starRating, content, visibility, createdAt
           FROM REVIEW
          WHERE reviewerId = ? AND eventId = ?`,
        [req.user.id, parsedEventId]
      );
      res.status(201).json({
        message: "Review submitted successfully.",
        review: createdRows[0],
      });
    } catch (err) {
      console.error("Failed to create review", err);
      res.status(500).json({ message: "Failed to create review." });
    }
  }
);

//get reviews for an event
router.get("/events/:eventId/reviews", optionalAuth, async (req, res) => {
  const parsedEventId = parsePositiveInt(req.params.eventId);
  if (!parsedEventId) {
    return res.status(400).json({ message: "Invalid event id." });
  }

  try {
    const [eventRows] = await db.query("SELECT eventId FROM EVENTS WHERE eventId = ?", [
      parsedEventId,
    ]);
    if (!eventRows.length) {
      return res.status(404).json({ message: "Event not found." });
    }

    const currentUser = req.optionalUser ?? null;
    const currentUserId = currentUser?.id ?? null;
    const isAdminRequest = currentUser?.role === "admin";

    let query = `
      SELECT r.reviewerId,
             r.eventId,
             r.starRating,
             r.content,
             r.visibility,
             r.createdAt,
             u.fName,
             u.lName
        FROM REVIEW r
        JOIN USERS u ON u.userId = r.reviewerId
       WHERE r.eventId = ?
    `;
    const params = [parsedEventId];

    if (!isAdminRequest) {
      query += " AND (r.visibility = 'public'";
      if (currentUserId) {
        query += " OR r.reviewerId = ?";
        params.push(currentUserId);
      }
      query += ")";
    }

    const [rows] = await db.query(query, params);
    res.json({
      eventId: parsedEventId,
      reviews: rows.map(mapReviewRow),
    });
  } catch (err) {
    console.error("Failed to fetch reviews", err);
    res.status(500).json({ message: "Failed to fetch reviews." });
  }
});

//admin updates review visibility
router.patch(
  "/admin/events/:eventId/reviews/:reviewerId/visibility",
  verifyToken,
  isAdmin,
  async (req, res) => {
    const parsedEventId = parsePositiveInt(req.params.eventId);
    const parsedReviewerId = parsePositiveInt(req.params.reviewerId);
    if (!parsedEventId || !parsedReviewerId) {
      return res.status(400).json({ message: "Invalid reviewer or event id." });
    }

    const visibilityInput = typeof req.body?.visibility === "string" ? req.body.visibility.trim().toLowerCase() : null;
    if (!visibilityInput || !VISIBILITY_VALUES.has(visibilityInput)) {
      return res.status(400).json({ message: "visibility must be 'public', 'private', or 'hidden'." });
    }

    try {
      const [result] = await db.query(
        `UPDATE REVIEW
            SET visibility = ?
          WHERE reviewerId = ? AND eventId = ?`,
        [visibilityInput, parsedReviewerId, parsedEventId]
      );
      if (result.affectedRows === 0) {
        return res.status(404).json({ message: "Review not found." });
      }

      const [rows] = await db.query(
        `SELECT reviewerId, eventId, starRating, content, visibility, createdAt
           FROM REVIEW
          WHERE reviewerId = ? AND eventId = ?`,
        [parsedReviewerId, parsedEventId]
      );

      res.json({
        message: "Review visibility updated successfully.",
        review: rows[0],
      });
    } catch (err) {
      console.error("Failed to update review visibility", err);
      res.status(500).json({ message: "Failed to update review visibility." });
    }
  }
);

export default router;
