import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DIRECT_URL: z.string().optional(),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
    APP_URL: z
    .string()
    .default("http://localhost:3000")
    .transform((value, ctx) => {
      try {
        return new URL(value).origin; // drops any path / trailing slash
      } catch {
        ctx.addIssue({ code: "custom", message: "APP_URL must be a valid URL" });
        return z.NEVER;
      }
    }),
  MAGIC_LINK_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(7),
  RESEND_API_KEY: z.string().optional(),
  MAIL_FROM: z.string().default("Auditrail <onboarding@resend.dev>"),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(1),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:");
  for (const issue of parsed.error.issues) {
    console.error(` - ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = {
  ...parsed.data,
  corsOrigins: parsed.data.CORS_ORIGIN.split(",").map((o) => o.trim()),
  isProd: parsed.data.NODE_ENV === "production",
};
