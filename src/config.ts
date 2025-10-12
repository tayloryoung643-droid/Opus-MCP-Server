import "dotenv/config";

export const CONFIG = {
  PORT: Number(process.env.PORT ?? process.env.MCP_PORT ?? 4000),
  TOKEN: process.env.MCP_SERVICE_TOKEN ?? process.env.MCP_SECRET_TOKEN ?? "",
  TOKEN_PROVIDER_URL: process.env.TOKEN_PROVIDER_URL ?? "",
  MCP_TOKEN_PROVIDER_SECRET: process.env.MCP_TOKEN_PROVIDER_SECRET ?? "",
  LOG_LEVEL: process.env.LOG_LEVEL ?? "info",
  PREP_MODE: process.env.PREP_MODE ?? "minimal"
};

console.log(`[config] port=${CONFIG.PORT}, tokenLen=${CONFIG.TOKEN.length}, logLevel=${CONFIG.LOG_LEVEL}`);
if (CONFIG.TOKEN.length < 10) {
  throw new Error("MCP token missing/too short (set MCP_SERVICE_TOKEN or MCP_SECRET_TOKEN)");
}

// Token provider is optional - warn if not configured
if (!CONFIG.TOKEN_PROVIDER_URL) {
  console.warn("[config] TOKEN_PROVIDER_URL not set - will use local integration state only");
}
