import "dotenv/config";

export const CONFIG = {
  PORT: Number(process.env.PORT ?? process.env.MCP_PORT ?? 4000),
  TOKEN: process.env.MCP_SERVICE_TOKEN ?? process.env.MCP_SECRET_TOKEN ?? ""
};

console.log(`[config] port=${CONFIG.PORT}, tokenLen=${CONFIG.TOKEN.length}`);
if (CONFIG.TOKEN.length < 10) throw new Error("MCP token missing/too short");
