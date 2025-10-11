const fetch = require("node-fetch");

async function getGoogleToken(email) {
  const r = await fetch(process.env.MCP_TOKEN_PROVIDER_URL, {
    method: "POST",
    headers: {
      "Content-Type":"application/json",
      "Authorization":`Bearer ${process.env.MCP_TOKEN_PROVIDER_SECRET}`
    },
    body: JSON.stringify({ email })
  });
  if (!r.ok) throw new Error(`Token provider failed (${r.status})`);
  const json = await r.json();
  if (!json.google) throw new Error("No Google connected");
  return json.google.access_token;
}

async function getEvent(accessToken, meeting = {}) {
  if (meeting.id) {
    const r = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(meeting.id)}`,
      { headers: { "Authorization": `Bearer ${accessToken}` } }
    );
    if (r.ok) return r.json();
  }
  const base = meeting.time ? new Date(meeting.time) : new Date();
  const timeMin = new Date(base.getTime() - 60*60*1000).toISOString();      // -1h
  const timeMax = new Date(base.getTime() + 3*60*60*1000).toISOString();     // +3h
  const q = new URLSearchParams({ timeMin, timeMax, singleEvents: "true", orderBy: "startTime" });
  const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${q}`, {
    headers: { "Authorization": `Bearer ${accessToken}` }
  });
  const data = await r.json();
  return (data.items && data.items[0]) || null;
}

async function generatePrep(email, meeting = {}) {
  const token = await getGoogleToken(email);
  const evt = await getEvent(token, meeting);

  const title = (evt && evt.summary) || meeting.title || "Upcoming Meeting";
  const attendees = ((evt && evt.attendees) || []).map(a => a.email).filter(Boolean);
  const start = (evt && evt.start && (evt.start.dateTime || evt.start.date)) || meeting.time || null;
  const location = (evt && evt.location) || "—";

  return {
    title,
    attendees,
    context: {
      when: start,
      location,
      organizer: evt && evt.organizer && evt.organizer.email,
      description: (evt && evt.description) || ""
    },
    talking_points: [
      "Confirm goals and success metrics",
      "Tailor demo to 1–2 key workflows",
      "Quantify value with a simple ROI assumption"
    ],
    risks: [
      "Unclear decision process / multi-stakeholder",
      "Timeline slippage vs. competing priorities"
    ],
    agenda: ["Intro", "Current workflow & pain", "Demo focused on outcomes", "Mutual next steps"]
  };
}

module.exports = { generatePrep };
