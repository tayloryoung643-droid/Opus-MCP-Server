const express = require("express");
const { mountHealth, probeTokenProvider } = require("./health");
const { generatePrep } = require("./generatePrep");

const app = express();
app.use(express.json());
mountHealth(app);

app.post("/mcp/generate-prep", async (req, res) => {
  try {
    const { email, meeting } = req.body || {};
    if (!email) return res.status(400).json({ error: "email required" });
    const prep = await generatePrep(email, meeting || {});
    res.json(prep);
  } catch (e) {
    res.status(500).json({ error: e.message || "failed" });
  }
});

const PORT = process.env.MCP_PORT || 7000;
app.listen(PORT, async () => {
  console.log(`MCP on :${PORT}`);
  try { await probeTokenProvider({ email: "tayloryoung643@gmail.com" }); } catch {}
});
