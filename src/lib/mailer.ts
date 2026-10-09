import { env } from "../config/env.js";

// Day 2: no email provider yet. In development the link is printed to the API console.
// A real provider (e.g. Resend) is added when we deploy.
export async function sendMagicLinkEmail(to: string, url: string): Promise<void> {
  if (env.isProd) {
    console.warn(`[mailer] No email provider configured; link for ${to} was NOT delivered.`);
    return;
  }
  console.log(`\n[magic-link] for ${to}\n${url}\n`);
}