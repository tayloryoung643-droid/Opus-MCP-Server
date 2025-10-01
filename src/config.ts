import "dotenv/config";
import { z } from "zod";

const rawPort = process.env.MCP_PORT || process.env.PORT || "4000";

const Env = z.object({
  PORT: z.string().default(rawPort),
  MCP_SERVICE_TOKEN: z.string().min(10),
  DATABASE_URL: z.string(),
  APP_ORIGIN: z.string().optional(),
  API_ORIGIN: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().optional(),
  SFDC_CLIENT_ID: z.string().optional(),
  SFDC_CLIENT_SECRET: z.string().optional(),
}).transform((data) => ({
  ...data,
  SFDC_CLIENT_ID: data.SFDC_CLIENT_ID || process.env.SALESFORCE_CLIENT_ID,
  SFDC_CLIENT_SECRET: data.SFDC_CLIENT_SECRET || process.env.SALESFORCE_CLIENT_SECRET,
}));

export const env = Env.parse(process.env);
export const port = Number(env.PORT);
export const portSource = process.env.MCP_PORT
  ? "MCP_PORT"
  : process.env.PORT ? "PORT" : "default(4000)";
