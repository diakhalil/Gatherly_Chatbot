const GEMINI_API_KEY =
  process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
const CHAT_SUMMARY_MODEL =
  process.env.CHAT_SUMMARY_MODEL || "gemini-2.0-flash";

export const loadMessagesToSummarize = async (
  db,
  conversationId,
  lastSummarizedMessageId,
  recentWindow
) => {
  const [rows] = await db.query(
    `SELECT messageId, messageRole, content
     FROM CHAT_MESSAGES
     WHERE conversationId = ?
       AND messageRole IN ('user', 'assistant')
       AND messageId > COALESCE(?, 0)
       AND messageId NOT IN (
         SELECT messageId
         FROM (
           SELECT messageId
           FROM CHAT_MESSAGES
           WHERE conversationId = ?
             AND messageRole IN ('user', 'assistant')
           ORDER BY messageId DESC
           LIMIT ?
         ) AS recent
       )
     ORDER BY messageId ASC`,
    [
      conversationId,
      lastSummarizedMessageId,
      conversationId,
      recentWindow,
    ]
  );

  return rows;
};

export const summarizeConversationMessages = async (
  existingSummary,
  messages
) => {
  if (!messages.length) {
    return existingSummary || "";
  }

  if (!GEMINI_API_KEY) {
    console.warn(
      "GEMINI_API_KEY is missing; skipping chat summarization."
    );
    return existingSummary || "";
  }

  const transcript = messages
    .map(
      (row) =>
        `${String(row.messageRole).toUpperCase()}: ${row.content}`
    )
    .join("\n\n");

  const system =
    "You summarize Gatherly chat history for another AI assistant. " +
    "Keep event IDs, names, roles, decisions, preferences, and open questions. " +
    "Use concise bullet points or short paragraphs. Do not invent facts.";

  const userContent = existingSummary
    ? `Existing summary:\n${existingSummary}\n\nNew messages to merge:\n${transcript}`
    : `Summarize these messages:\n${transcript}`;

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${CHAT_SUMMARY_MODEL}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: userContent }] }],
      generationConfig: { temperature: 0 },
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `Summary provider returned HTTP ${response.status}: ${detail.slice(0, 300)}`
    );
  }

  const result = await response.json();
  const summary = result?.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || "")
    .join("")
    .trim();

  if (!summary) {
    throw new Error("Summary provider returned an empty summary.");
  }

  return summary;
};




export const maybeSummarizeConversation = async ({
  db,
  conversationId,
  existingSummary = "",
  lastSummarizedMessageId = null,
  messageCount,
  recentWindow,
  triggerCount,
}) => {
  if (messageCount <= triggerCount) {
    return {
      summary: existingSummary,
      lastSummarizedMessageId,
      summarized: false,
    };
  }

  const messages = await loadMessagesToSummarize(
    db,
    conversationId,
    lastSummarizedMessageId,
    recentWindow
  );

  if (!messages.length) {
    return {
      summary: existingSummary,
      lastSummarizedMessageId,
      summarized: false,
    };
  }

  const summary = await summarizeConversationMessages(
    existingSummary,
    messages
  );
  const newLastSummarizedMessageId =
    messages[messages.length - 1].messageId;

  await db.query(
    `UPDATE CHAT_CONVERSATIONS
     SET contextSummary = ?,
         lastSummarizedMessageId = ?
     WHERE conversationId = ?`,
    [summary, newLastSummarizedMessageId, conversationId]
  );

  return {
    summary,
    lastSummarizedMessageId: newLastSummarizedMessageId,
    summarized: true,
  };
};
