import { Router } from "express";
import crypto from "crypto";
import db from "../config/db.js";
import { verifyToken } from "../middleware/auth.js";

const router = Router();

const normalizeRole = (role) => {
  if (role === "user") return "host";
  if (["admin", "host", "client"].includes(role)) return role;
  return null;
};

const getOwner = (req) => ({
  ownerId: req.user.id,
  ownerRole: normalizeRole(req.user.role),
});

router.post("/conversations", verifyToken, async (req, res) => {
  try {
    const { ownerId, ownerRole } = getOwner(req);

    if (!ownerRole) {
      return res.status(403).json({ message: "Unsupported account role." });
    }

    const conversationId = crypto.randomUUID();

    await db.query(
      `INSERT INTO CHAT_CONVERSATIONS
       (conversationId, ownerId, ownerRole, title)
       VALUES (?, ?, ?, ?)`,
      [conversationId, ownerId, ownerRole, "New chat"]
    );

    return res.status(201).json({
      conversationId,
      title: "New chat",
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Failed to create conversation:", error);
    return res.status(500).json({ message: "Failed to create conversation." });
  }
});

router.get("/conversations", verifyToken, async (req, res) => {
  try {
    const { ownerId, ownerRole } = getOwner(req);

    const [rows] = await db.query(
      `SELECT conversationId, title, createdAt, updatedAt
       FROM CHAT_CONVERSATIONS
       WHERE ownerId = ? AND ownerRole = ?
       ORDER BY updatedAt DESC`,
      [ownerId, ownerRole]
    );

    return res.json(rows);
  } catch (error) {
    console.error("Failed to list conversations:", error);
    return res.status(500).json({ message: "Failed to list conversations." });
  }
});

router.get("/conversations/:conversationId/messages",
  verifyToken,
  async (req, res) => {
    try {
      const { ownerId, ownerRole } = getOwner(req);
      const { conversationId } = req.params;

      const [conversations] = await db.query(
        `SELECT conversationId, title
         FROM CHAT_CONVERSATIONS
         WHERE conversationId = ?
           AND ownerId = ?
           AND ownerRole = ?`,
        [conversationId, ownerId, ownerRole]
      );

      if (!conversations.length) {
        return res.status(404).json({ message: "Conversation not found." });
      }

      const [messages] = await db.query(
        `SELECT messageId, messageRole, content, agentName,
                citations, createdAt
         FROM CHAT_MESSAGES
         WHERE conversationId = ?
         ORDER BY messageId ASC`,
        [conversationId]
      );

      return res.json({
        conversation: conversations[0],
        messages,
      });
    } catch (error) {
      console.error("Failed to load conversation:", error);
      return res.status(500).json({ message: "Failed to load conversation." });
    }
  }
);

router.patch("/conversations/:conversationId",
  verifyToken,
  async (req, res) => {
    try {
      const { ownerId, ownerRole } = getOwner(req);
      const title = String(req.body.title || "").trim().slice(0, 150);

      if (!title) {
        return res.status(400).json({ message: "Title is required." });
      }

      const [result] = await db.query(
        `UPDATE CHAT_CONVERSATIONS
         SET title = ?
         WHERE conversationId = ?
           AND ownerId = ?
           AND ownerRole = ?`,
        [title, req.params.conversationId, ownerId, ownerRole]
      );

      if (!result.affectedRows) {
        return res.status(404).json({ message: "Conversation not found." });
      }

      return res.json({ title });
    } catch (error) {
      console.error("Failed to rename conversation:", error);
      return res.status(500).json({ message: "Failed to rename conversation." });
    }
  }
);

router.delete(
  "/conversations/:conversationId",
  verifyToken,
  async (req, res) => {
    try {
      const { ownerId, ownerRole } = getOwner(req);

      const [result] = await db.query(
        `DELETE FROM CHAT_CONVERSATIONS
         WHERE conversationId = ?
           AND ownerId = ?
           AND ownerRole = ?`,
        [req.params.conversationId, ownerId, ownerRole]
      );

      if (!result.affectedRows) {
        return res.status(404).json({ message: "Conversation not found." });
      }

      return res.json({ message: "Conversation deleted." });
    } catch (error) {
      console.error("Failed to delete conversation:", error);
      return res.status(500).json({ message: "Failed to delete conversation." });
    }
  }
);

export default router;