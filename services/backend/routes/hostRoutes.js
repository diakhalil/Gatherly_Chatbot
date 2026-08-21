import { Router } from "express";
import db from "../config/db.js";
import { verifyToken } from "../middleware/auth.js";

const router = Router();

//make sure that self or admin
const ensureSelfOrAdmin = (req, targetUserId) => {
  if (req.user.role === "admin") return true;
  return req.user.role === "user" && req.user.id === targetUserId;
};

//accept code of conduct
router.post("/code-of-conduct/accept", verifyToken, async (req, res) => {
  const userId = Number(req.body.userId);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ message: "Validation failed", errors: ["Valid userId is required."] });
  }

  if (!ensureSelfOrAdmin(req, userId)) {
    return res.status(403).json({ message: "Access denied." });
  }

  try {
    const [rows] = await db.query(
      "SELECT userId, eligibility, isActive, codeOfConductAccepted FROM USERS WHERE userId = ?",
      [userId]
    );
    if (!rows.length) {
      return res.status(404).json({ message: "User not found." });
    }

    const user = rows[0];

    if (user.eligibility === "blocked") {
      return res.status(403).json({
        message: "This account is blocked and cannot accept the Code of Conduct.",
      });
    }

    if (user.codeOfConductAccepted) {
      return res.status(400).json({ message: "Code of Conduct already accepted." });
    }

    await db.query(
      "UPDATE USERS SET codeOfConductAccepted = 1, updatedAt = NOW() WHERE userId = ?",
      [userId]
    );

    res.json({
      message: "Code of Conduct accepted.",
      user: {
        userId,
        eligibility: "pending",
        isActive: Boolean(user.isActive),
        codeOfConductAccepted: true,
      },
    });
  } catch (err) {
    console.error("Failed to accept code of conduct", err);
    res.status(500).json({ message: "Failed to accept code of conduct." });
  }
});

export default router;
