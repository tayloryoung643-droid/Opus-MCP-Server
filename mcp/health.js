const fetch = require("node-fetch"); // v2

let last = { tokenProvider: "unknown", at: new Date().toISOString() };

async function probeTokenProvider(emailOrUserId) {
  try {
    const res = await fetch(process.env.MCP_TOKEN_PROVIDER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.MCP_TOKEN_PROVIDER_SECRET}`
      },
      body: JSON.stringify(emailOrUserId)
    });
    last.tokenProvider = res.ok ? "ok" : "fail";
  } catch {
    last.tokenProvider = "fail";
  }
  last.at = new Date().toISOString();
  return last.tokenProvider === "ok";
}

function mountHealth(app) {
  app.get("/healthz", (_, res) => res.json(last));
}

module.exports = { probeTokenProvider, mountHealth };
