import jwt from "jsonwebtoken";
import db from "../config/db.js";
import "../config/env.js";

export const verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ message: "Access denied" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ message: "Session expired. Please sign in again." });
    }
    res.status(400).json({ message: "Invalid token" });
  }
};

export const isAdmin = (req, res, next) => {
  if (req.user.role !== "admin") return res.status(403).json({ message: "Admin access required" });
  next();
};

export const isUser = (req, res, next) => {
  if (req.user.role !== "user") return res.status(403).json({ message: "User access required" });
  next();
};

export const isClient = (req, res, next) => {
  if (req.user.role !== "client") return res.status(403).json({ message: "Client access required" });
  next();
};

export function isUserOrAdmin(req, res, next) {
  if (req.user.role === "user" || req.user.role === "admin") {
    return next();
  }
  return res.status(403).json({ message: "Access denied" });
}

const fetchHostProfile = async (userId) => {
  const [rows] = await db.query(
    "SELECT userId, eligibility, isActive, codeOfConductAccepted FROM USERS WHERE userId = ?",
    [userId]
  );
  return rows[0];
};

export const requireActiveHost = async (req, res, next) => {
  if (req.user.role !== "user") {
    return res.status(403).json({ message: "User access required" });
  }
  try {
    const profile = await fetchHostProfile(req.user.id);
    if (!profile) {
      return res.status(404).json({ message: "User not found" });
    }
    const isApproved =
      profile.eligibility === "approved" &&
      Boolean(profile.isActive) &&
      Boolean(profile.codeOfConductAccepted);
    if (!isApproved) {
      return res.status(403).json({
        message: "Host account is not active.",
        eligibility: profile.eligibility,
        isActive: Boolean(profile.isActive),
        codeOfConductAccepted: Boolean(profile.codeOfConductAccepted),
      });
    }
    req.hostProfile = profile;
    next();
  } catch (err) {
    console.error("Failed to verify host access", err);
    res.status(500).json({ message: "Failed to verify host access" });
  }
};
