import { Router } from "express";
import db from "../config/db.js";
import { verifyToken } from "../middleware/auth.js";
import { maybeSummarizeConversation } from "../utils/conversationSummary.js";

const router = Router();

const AGENT_API_URL =
  process.env.AGENT_API_URL || "http://127.0.0.1:8001";

const pendingApprovals = new Map();
const RECENT_MESSAGE_WINDOW = 8;
const SUMMARY_TRIGGER_MESSAGE_COUNT = 20;

/** Persist RAG sources only (artifacts.rag) — no other message logic changes. */
const serializeRagCitations = (payload) => {
  const rag = payload?.artifacts?.rag;
  if (!rag || typeof rag !== "object") return null;
  try {
    return JSON.stringify(rag);
  } catch {
    return null;
  }
};

const normalizeRole = (role) => {
  if (role === "user") return "host";
  if (["admin", "client", "host"].includes(role)) return role;
  return null;
};

const findOwnedConversation = async (
  conversationId,
  ownerId,
  ownerRole
) => {
  const [rows] = await db.query(
    `SELECT conversationId, title, contextSummary, lastSummarizedMessageId
     FROM CHAT_CONVERSATIONS
     WHERE conversationId = ?
       AND ownerId = ?
       AND ownerRole = ?`,
    [conversationId, ownerId, ownerRole]
  );

  return rows[0];
};

const loadRecentHistory = async (conversationId, limit = RECENT_MESSAGE_WINDOW) => {
  const [rows] = await db.query(
    `SELECT messageRole, content
     FROM (
       SELECT messageId, messageRole, content
       FROM CHAT_MESSAGES
       WHERE conversationId = ?
         AND messageRole IN ('user', 'assistant')
       ORDER BY messageId DESC
       LIMIT ?
     ) AS recent
     ORDER BY messageId ASC`,
    [conversationId, limit]
  );

  return rows.map((row) => ({
    role: row.messageRole,
    content: row.content,
  }));
};


const parseAgentJson = async (response) => {
  const text = await response.text();

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      text.startsWith("Internal Server Error")
        ? "The Agent API crashed. Check the Agent terminal for the real error."
        : text || "The Agent API returned an invalid response."
    );
  }
};

const buildAgentContext = async (conversation) => {
  const summary = conversation.contextSummary || "";
  const history = await loadRecentHistory(
    conversation.conversationId,
    RECENT_MESSAGE_WINDOW
  );

  const [countRows] = await db.query(
    `SELECT COUNT(*) AS messageCount
     FROM CHAT_MESSAGES
     WHERE conversationId = ?
       AND messageRole IN ('user', 'assistant')`,
    [conversation.conversationId]
  );

  const messageCount = Number(countRows[0]?.messageCount || 0);

  return {
    summary,
    history,
    messageCount,
    lastSummarizedMessageId: conversation.lastSummarizedMessageId || null,
    shouldSummarize: messageCount > SUMMARY_TRIGGER_MESSAGE_COUNT,
  };
};
const relayWorkflowStream = async ({
  res,
  endpoint,
  payload,
  conversationId,
  agentName,
}) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const upstream = await fetch(`${AGENT_API_URL}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!upstream.ok || !upstream.body) {
    res.write(`data: ${JSON.stringify({ type: "error", data: { message: "The Agent API could not start this workflow." } })}\n\n`);
    return res.end();
  }

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() || "";

    for (const block of blocks) {
      const line = block.split("\n").find((item) => item.startsWith("data: "));
      if (!line) continue;
      const event = JSON.parse(line.slice(6));

      if (event.type === "result") {
        await db.query(
          `INSERT INTO CHAT_MESSAGES
           (conversationId, messageRole, content, agentName, citations)
           VALUES (?, 'assistant', ?, ?, ?)`,
          [
            conversationId,
            event.data.response || "Workflow completed.",
            event.data.handled_by || agentName || null,
            serializeRagCitations(event.data),
          ]
        );
      }

      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  }

  res.end();
};

router.post("/chat", verifyToken, async (req, res) => {
  try {
    const message = String(req.body.message || "").trim();
    const conversationId = String(
      req.body.conversationId || ""
    ).trim();

    const ownerId = req.user.id;
    const ownerRole = normalizeRole(req.user.role);

    const imageBase64Early =
      typeof req.body.imageBase64 === "string" ? req.body.imageBase64.trim() : "";
    if (!message && !imageBase64Early) {
      return res.status(400).json({
        message: "Chat message or image is required.",
      });
    }

    const effectiveMessage =
      message ||
      (imageBase64Early ? "What wedding style is this photo?" : "");

    if (!conversationId) {
      return res.status(400).json({
        message: "conversationId is required.",
      });
    }

    if (!ownerRole) {
      return res.status(403).json({
        message: "Your account role cannot access the chatbot.",
      });
    }

    const conversation = await findOwnedConversation(
      conversationId,
      ownerId,
      ownerRole
    );

    if (!conversation) {
      return res.status(404).json({
        message: "Conversation not found.",
      });
    }

    const agentContext = await buildAgentContext(conversation);
    const history = agentContext.history;

    await db.query(
      `INSERT INTO CHAT_MESSAGES
       (conversationId, messageRole, content)
       VALUES (?, 'user', ?)`,
      [conversationId, effectiveMessage]
    );

    const messageCount = agentContext.messageCount + 1;
    let summary = agentContext.summary;

    try {
      const summaryResult = await maybeSummarizeConversation({
        db,
        conversationId,
        existingSummary: agentContext.summary,
        lastSummarizedMessageId: agentContext.lastSummarizedMessageId,
        messageCount,
        recentWindow: RECENT_MESSAGE_WINDOW,
        triggerCount: SUMMARY_TRIGGER_MESSAGE_COUNT,
      });

      summary = summaryResult.summary;
    } catch (summaryError) {
      console.error("Chat summarization failed:", summaryError);
    }

    const suggestedTitle = effectiveMessage.slice(0, 80);

    await db.query(
      `UPDATE CHAT_CONVERSATIONS
       SET title = CASE
         WHEN title = 'New chat' THEN ?
         ELSE title
       END,
       updatedAt = CURRENT_TIMESTAMP
       WHERE conversationId = ?`,
      [suggestedTitle, conversationId]
    );

    const eventIdRaw = req.body.eventId;
    const eventId =
      eventIdRaw === undefined || eventIdRaw === null || eventIdRaw === ""
        ? null
        : Number(eventIdRaw);
    const latitude =
      req.body.latitude === undefined || req.body.latitude === null
        ? null
        : Number(req.body.latitude);
    const longitude =
      req.body.longitude === undefined || req.body.longitude === null
        ? null
        : Number(req.body.longitude);

    const imageBase64 =
      typeof req.body.imageBase64 === "string" ? req.body.imageBase64.trim() : "";
    const imageFilename =
      typeof req.body.imageFilename === "string"
        ? req.body.imageFilename.trim()
        : "upload.jpg";

    const agentPayload = {
      message: effectiveMessage,
      role: ownerRole,
      user_id: ownerId,
      conversation_id: conversationId,
      history,
      summary,
    };

    if (Number.isInteger(eventId) && eventId > 0) {
      agentPayload.event_id = eventId;
    }
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      agentPayload.latitude = latitude;
      agentPayload.longitude = longitude;
    }
    if (imageBase64) {
      agentPayload.image_base64 = imageBase64;
      agentPayload.image_filename = imageFilename || "upload.jpg";
    }

    const response = await fetch(`${AGENT_API_URL}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(agentPayload),
    });

    const data = await parseAgentJson(response);

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    if (data.status === "approval_required") {
      pendingApprovals.set(data.request_id, {
        conversationId,
        ownerId,
        ownerRole,
      });

      return res.json(data);
    }

    const assistantResponse =
      data.response || data.message || "No response was returned.";

    await db.query(
      `INSERT INTO CHAT_MESSAGES
       (conversationId, messageRole, content, agentName, citations)
       VALUES (?, 'assistant', ?, ?, ?)`,
      [
        conversationId,
        assistantResponse,
        data.handled_by || null,
        serializeRagCitations(data),
      ]
    );

    return res.json(data);
  } catch (error) {
    console.error("Agent chat failed:", error);

    return res.status(503).json({
      message: "The Gatherly assistant is currently unavailable.",
    });
  }
});

router.post("/chat/stream", verifyToken, async (req, res) => {
  try {
    const message = String(req.body.message || "").trim();
    const conversationId = String(
      req.body.conversationId || ""
    ).trim();
    const ownerId = req.user.id;
    const ownerRole = normalizeRole(req.user.role);

    const imageBase64Early =
      typeof req.body.imageBase64 === "string" ? req.body.imageBase64.trim() : "";
    if (!message && !imageBase64Early) {
      return res.status(400).json({
        message: "Chat message or image is required.",
      });
    }

    const effectiveMessage =
      message ||
      (imageBase64Early ? "What wedding style is this photo?" : "");

    if (!conversationId) {
      return res.status(400).json({
        message: "conversationId is required.",
      });
    }

    if (!ownerRole) {
      return res.status(403).json({
        message: "Your account role cannot access the chatbot.",
      });
    }

    const conversation = await findOwnedConversation(
      conversationId,
      ownerId,
      ownerRole
    );

    if (!conversation) {
      return res.status(404).json({
        message: "Conversation not found.",
      });
    }

    const agentContext = await buildAgentContext(conversation);
    const history = agentContext.history;

    await db.query(
      `INSERT INTO CHAT_MESSAGES
       (conversationId, messageRole, content)
       VALUES (?, 'user', ?)`,
      [conversationId, effectiveMessage]
    );

    const messageCount = agentContext.messageCount + 1;
    let summary = agentContext.summary;

    try {
      const summaryResult = await maybeSummarizeConversation({
        db,
        conversationId,
        existingSummary: agentContext.summary,
        lastSummarizedMessageId: agentContext.lastSummarizedMessageId,
        messageCount,
        recentWindow: RECENT_MESSAGE_WINDOW,
        triggerCount: SUMMARY_TRIGGER_MESSAGE_COUNT,
      });

      summary = summaryResult.summary;
    } catch (summaryError) {
      console.error("Chat stream summarization failed:", summaryError);
    }

    const suggestedTitle = effectiveMessage.slice(0, 80);

    await db.query(
      `UPDATE CHAT_CONVERSATIONS
       SET title = CASE
         WHEN title = 'New chat' THEN ?
         ELSE title
       END,
       updatedAt = CURRENT_TIMESTAMP
       WHERE conversationId = ?`,
      [suggestedTitle, conversationId]
    );

    const eventIdRaw = req.body.eventId;
    const eventId =
      eventIdRaw === undefined || eventIdRaw === null || eventIdRaw === ""
        ? null
        : Number(eventIdRaw);
    const latitude =
      req.body.latitude === undefined || req.body.latitude === null
        ? null
        : Number(req.body.latitude);
    const longitude =
      req.body.longitude === undefined || req.body.longitude === null
        ? null
        : Number(req.body.longitude);

    const imageBase64 =
      typeof req.body.imageBase64 === "string" ? req.body.imageBase64.trim() : "";
    const imageFilename =
      typeof req.body.imageFilename === "string"
        ? req.body.imageFilename.trim()
        : "upload.jpg";

    const payload = {
      message: effectiveMessage,
      role: ownerRole,
      user_id: ownerId,
      conversation_id: conversationId,
      history,
      summary,
    };

    if (Number.isInteger(eventId) && eventId > 0) {
      payload.event_id = eventId;
    }
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      payload.latitude = latitude;
      payload.longitude = longitude;
    }
    if (imageBase64) {
      payload.image_base64 = imageBase64;
      payload.image_filename = imageFilename || "upload.jpg";
    }

    await relayWorkflowStream({
      res,
      endpoint: "/chat/stream",
      payload,
      conversationId,
      agentName: null,
    });
  } catch (error) {
    console.error("Agent chat stream failed:", error);
    if (!res.headersSent) {
      return res.status(503).json({
        message: "The Gatherly assistant is currently unavailable.",
      });
    }
    res.write(
      `data: ${JSON.stringify({
        type: "error",
        data: { message: "The chat stream failed." },
      })}\n\n`
    );
    res.end();
  }
});


router.post("/resume", verifyToken, async (req, res) => {
  try {
    const { requestId, approved } = req.body;
    const pending = pendingApprovals.get(requestId);
    const ownerRole = normalizeRole(req.user.role);

    if (!requestId || typeof approved !== "boolean") {
      return res.status(400).json({
        message: "requestId and approved are required.",
      });
    }

    if (
      !pending ||
      pending.ownerId !== req.user.id ||
      pending.ownerRole !== ownerRole
    ) {
      return res.status(404).json({
        message: "Pending request not found.",
      });
    }

    const response = await fetch(`${AGENT_API_URL}/resume`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        request_id: requestId,
        approved,
      }),
    });

    const data = await parseAgentJson(response);

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    pendingApprovals.delete(requestId);

    const assistantResponse =
      data.response || data.message || "No response was returned.";

    await db.query(
      `INSERT INTO CHAT_MESSAGES
       (conversationId, messageRole, content, agentName, citations)
       VALUES (?, 'assistant', ?, ?, ?)`,
      [
        pending.conversationId,
        assistantResponse,
        data.handled_by || null,
        serializeRagCitations(data),
      ]
    );

    await db.query(
      `UPDATE CHAT_CONVERSATIONS
       SET updatedAt = CURRENT_TIMESTAMP
       WHERE conversationId = ?`,
      [pending.conversationId]
    );

    return res.json({
      ...data,
      conversationId: pending.conversationId,
    });
  } catch (error) {
    console.error("Agent resume failed:", error);

    return res.status(503).json({
      message: "The Gatherly assistant is currently unavailable.",
    });
  }
});

export default router;
