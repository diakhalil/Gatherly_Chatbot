import { sendEmail } from "./email.js";

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const fullName = (...parts) => parts.filter(Boolean).join(" ").trim();

const formatDateTime = (value) => {
  if (!value) return "Not specified";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
};

export const sendHostApprovalEmail = (host) => {
  const name = fullName(host?.fName, host?.lName) || "there";
  const text = [
    `Hi ${name},`,
    "",
    "Good news: your Gatherly host account has been approved.",
    "You can now sign in, browse accepted events, and apply for host opportunities.",
    "",
    "Best,",
    "The Gatherly Admin Team",
  ].join("\n");

  const html = `
    <p>Hi ${escapeHtml(name)},</p>
    <p>Good news: your Gatherly host account has been approved.</p>
    <p>You can now sign in, browse accepted events, and apply for host opportunities.</p>
    <p>Best,<br>The Gatherly Admin Team</p>
  `;

  return sendEmail({
    to: host?.email,
    subject: "Your Gatherly host account was approved",
    text,
    html,
  });
};

export const sendEventApprovalEmail = (event) => {
  const clientName = fullName(event?.clientFirstName, event?.clientLastName) || "there";
  const eventTitle = event?.title || event?.type || "your event";
  const startsAt = formatDateTime(event?.startsAt);
  const endsAt = formatDateTime(event?.endsAt);
  const location = event?.location || "Not specified";

  const text = [
    `Hi ${clientName},`,
    "",
    `Your event request "${eventTitle}" has been accepted by Gatherly.`,
    "",
    `Location: ${location}`,
    `Starts: ${startsAt}`,
    `Ends: ${endsAt}`,
    "",
    "Our team will continue preparing the hosting details.",
    "",
    "Best,",
    "The Gatherly Admin Team",
  ].join("\n");

  const html = `
    <p>Hi ${escapeHtml(clientName)},</p>
    <p>Your event request <strong>${escapeHtml(eventTitle)}</strong> has been accepted by Gatherly.</p>
    <ul>
      <li><strong>Location:</strong> ${escapeHtml(location)}</li>
      <li><strong>Starts:</strong> ${escapeHtml(startsAt)}</li>
      <li><strong>Ends:</strong> ${escapeHtml(endsAt)}</li>
    </ul>
    <p>Our team will continue preparing the hosting details.</p>
    <p>Best,<br>The Gatherly Admin Team</p>
  `;

  return sendEmail({
    to: event?.clientEmail,
    subject: `Your Gatherly event was accepted: ${eventTitle}`,
    text,
    html,
  });
};

export const sendHostEventAcceptanceEmail = (application) => {
  const hostName = fullName(application?.hostFirstName, application?.hostLastName) || "there";
  const eventTitle = application?.eventTitle || application?.eventType || "the event";
  const roleValue = application?.assignedRole || application?.requestedRole;
  const isTeamLeader = roleValue === "team_leader";
  const role = isTeamLeader ? "Team Leader" : "Host";
  const startsAt = formatDateTime(application?.startsAt);
  const endsAt = formatDateTime(application?.endsAt);
  const location = application?.location || "Not specified";
  const clientName = fullName(application?.clientFirstName, application?.clientLastName) || "Not specified";
  const clientEmail = application?.clientEmail || "Not specified";
  const clientPhone = application?.clientPhone || "Not specified";
  const guestCount = application?.nbOfGuests ?? "Not specified";
  const eventDescription = application?.description || "Not specified";
  const outfitInfo = application?.requestDress
    ? `You requested Gatherly clothing. Size on profile: ${application?.clothingSize || "Not specified"}.`
    : "No Gatherly clothing was requested for this application.";

  const text = isTeamLeader
    ? [
        `Hi ${hostName},`,
        "",
        `You were assigned as Team Leader for "${eventTitle}".`,
        "",
        `Location: ${location}`,
        `Starts: ${startsAt}`,
        `Ends: ${endsAt}`,
        `Guests: ${guestCount}`,
        `Client: ${clientName}`,
        `Client email: ${clientEmail}`,
        `Client phone: ${clientPhone}`,
        `Event brief: ${eventDescription}`,
        outfitInfo,
        "",
        "As Team Leader, please review the event brief, coordinate with the accepted hosts, and be ready to guide check-in and on-site communication.",
        "",
        "Best,",
        "The Gatherly Admin Team",
      ].join("\n")
    : [
        `Hi ${hostName},`,
        "",
        `Good news: you were accepted as a Host for "${eventTitle}".`,
        "",
        `Location: ${location}`,
        `Starts: ${startsAt}`,
        `Ends: ${endsAt}`,
        outfitInfo,
        "",
        "Please arrive on time and follow the Team Leader's instructions during the event.",
        "",
        "Best,",
        "The Gatherly Admin Team",
      ].join("\n");

  const html = isTeamLeader
    ? `
      <p>Hi ${escapeHtml(hostName)},</p>
      <p>You were assigned as <strong>Team Leader</strong> for <strong>${escapeHtml(eventTitle)}</strong>.</p>
      <ul>
        <li><strong>Location:</strong> ${escapeHtml(location)}</li>
        <li><strong>Starts:</strong> ${escapeHtml(startsAt)}</li>
        <li><strong>Ends:</strong> ${escapeHtml(endsAt)}</li>
        <li><strong>Guests:</strong> ${escapeHtml(guestCount)}</li>
        <li><strong>Client:</strong> ${escapeHtml(clientName)}</li>
        <li><strong>Client email:</strong> ${escapeHtml(clientEmail)}</li>
        <li><strong>Client phone:</strong> ${escapeHtml(clientPhone)}</li>
        <li><strong>Event brief:</strong> ${escapeHtml(eventDescription)}</li>
        <li><strong>Clothing:</strong> ${escapeHtml(outfitInfo)}</li>
      </ul>
      <p>As Team Leader, please review the event brief, coordinate with the accepted hosts, and be ready to guide check-in and on-site communication.</p>
      <p>Best,<br>The Gatherly Admin Team</p>
    `
    : `
      <p>Hi ${escapeHtml(hostName)},</p>
      <p>Good news: you were accepted as a <strong>Host</strong> for <strong>${escapeHtml(eventTitle)}</strong>.</p>
      <ul>
        <li><strong>Location:</strong> ${escapeHtml(location)}</li>
        <li><strong>Starts:</strong> ${escapeHtml(startsAt)}</li>
        <li><strong>Ends:</strong> ${escapeHtml(endsAt)}</li>
        <li><strong>Clothing:</strong> ${escapeHtml(outfitInfo)}</li>
      </ul>
      <p>Please arrive on time and follow the Team Leader's instructions during the event.</p>
      <p>Best,<br>The Gatherly Admin Team</p>
    `;

  return sendEmail({
    to: application?.hostEmail,
    subject: isTeamLeader
      ? `Team Leader assignment: ${eventTitle}`
      : `Host assignment confirmed: ${eventTitle}`,
    text,
    html,
  });
};
