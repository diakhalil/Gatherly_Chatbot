import "../config/env.js";

const ACCESS_TOKEN_REFRESH_BUFFER_MS = 60 * 1000;

let cachedAccessToken = null;
let cachedAccessTokenExpiresAt = 0;

const normalizeEmail = (value) => String(value || "").trim();

const getMailConfig = () => ({
  clientId: normalizeEmail(process.env.GOOGLE_CLIENT_ID),
  clientSecret: normalizeEmail(process.env.GOOGLE_CLIENT_SECRET),
  refreshToken: normalizeEmail(process.env.GOOGLE_REFRESH_TOKEN),
  from: normalizeEmail(process.env.GOOGLE_EMAIL_FROM || process.env.GMAIL_FROM || process.env.MAIL_FROM),
  fromName: normalizeEmail(process.env.GOOGLE_EMAIL_FROM_NAME || "Gatherly"),
});

const getMissingConfig = (config) =>
  Object.entries({
    GOOGLE_CLIENT_ID: config.clientId,
    GOOGLE_CLIENT_SECRET: config.clientSecret,
    GOOGLE_REFRESH_TOKEN: config.refreshToken,
    GOOGLE_EMAIL_FROM: config.from,
  })
    .filter(([, value]) => !value)
    .map(([key]) => key);

const sanitizeHeader = (value) => String(value || "").replace(/[\r\n]+/g, " ").trim();

const encodeHeader = (value) => {
  const sanitized = sanitizeHeader(value);
  if (!/[^\x20-\x7E]/.test(sanitized)) return sanitized;
  return `=?UTF-8?B?${Buffer.from(sanitized, "utf8").toString("base64")}?=`;
};

const formatAddress = (name, email) => {
  const cleanEmail = sanitizeHeader(email);
  const cleanName = sanitizeHeader(name);
  if (!cleanName) return `<${cleanEmail}>`;
  return `"${cleanName.replace(/"/g, '\\"')}" <${cleanEmail}>`;
};

const toBase64Url = (value) =>
  Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

const encodeBodyPart = (value) =>
  (Buffer.from(String(value || ""), "utf8").toString("base64").match(/.{1,76}/g) || [""]).join("\r\n");

const buildMimeMessage = ({ from, fromName, to, subject, text, html }) => {
  const boundary = `gatherly_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const plainText = text || "";
  const htmlText = html || plainText.replace(/\n/g, "<br>");

  return [
    `From: ${formatAddress(fromName, from)}`,
    `To: ${sanitizeHeader(to)}`,
    `Subject: ${encodeHeader(subject)}`,
    "MIME-Version: 1.0",
    `Date: ${new Date().toUTCString()}`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    encodeBodyPart(plainText),
    "",
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    encodeBodyPart(htmlText),
    "",
    `--${boundary}--`,
    "",
  ].join("\r\n");
};

const getGoogleAccessToken = async (config) => {
  if (
    cachedAccessToken &&
    Date.now() + ACCESS_TOKEN_REFRESH_BUFFER_MS < cachedAccessTokenExpiresAt
  ) {
    return cachedAccessToken;
  }

  if (typeof fetch !== "function") {
    throw new Error("Global fetch is not available. Use Node 18+ for Gmail API email sending.");
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: config.refreshToken,
      grant_type: "refresh_token",
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    const details = [data.error, data.error_description].filter(Boolean).join(": ");
    throw new Error(
      details
        ? `Google token request failed (${response.status}): ${details}`
        : `Google token request failed (${response.status})`
    );
  }

  cachedAccessToken = data.access_token;
  cachedAccessTokenExpiresAt = Date.now() + Number(data.expires_in || 3600) * 1000;
  return cachedAccessToken;
};

export const sendEmail = async ({ to, subject, text, html }) => {
  const recipient = normalizeEmail(to);
  if (!recipient) {
    return { sent: false, skipped: true, reason: "missing_recipient" };
  }

  const config = getMailConfig();
  const missingConfig = getMissingConfig(config);
  if (missingConfig.length) {
    return {
      sent: false,
      skipped: true,
      reason: "mail_not_configured",
      missingConfig,
    };
  }

  try {
    const accessToken = await getGoogleAccessToken(config);
    const raw = toBase64Url(
      buildMimeMessage({
        from: config.from,
        fromName: config.fromName,
        to: recipient,
        subject,
        text,
        html,
      })
    );

    const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error?.message || `Gmail send failed (${response.status})`);
    }

    return { sent: true, messageId: data.id || null };
  } catch (err) {
    console.warn("Email notification failed:", err.message);
    return { sent: false, skipped: false, reason: "send_failed", error: err.message };
  }
};

export const summarizeEmailResult = (result) => {
  if (result?.sent) return "sent";
  if (result?.skipped) return result.reason || "skipped";
  return "failed";
};
