import { env } from "../config/env.js";

export function buildMagicLinkEmail(url: string) {
  const minutes = env.MAGIC_LINK_TTL_MINUTES;
  return {
    subject: "Your Auditrail sign-in link",
    text: `Sign in to Auditrail:\n\n${url}\n\nThis link expires in ${minutes} minutes and can be used once. If you didn't request it, you can ignore this email.`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:480px">
<h2 style="margin:0 0 12px">Sign in to Auditrail</h2>
<p>Use the button below to sign in. The link expires in ${minutes} minutes and can be used once.</p>
<p><a href="${url}" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Sign in</a></p>
<p style="color:#666;font-size:13px">Or paste this URL into your browser:<br>${url}</p>
<p style="color:#666;font-size:13px">If you didn't request this, you can safely ignore this email.</p>
</div>`,
  };
}

// With RESEND_API_KEY: sends a real email via Resend's REST API (no extra package needed).
// Without it: development prints the link to the API console; production logs a warning.
export async function sendMagicLinkEmail(to: string, url: string): Promise<void> {
  if (!env.RESEND_API_KEY) {
    if (env.isProd) {
      console.warn(`[mailer] RESEND_API_KEY not set; link for ${to} was NOT delivered.`);
    } else {
      console.log(`\n[magic-link] for ${to}\n${url}\n`);
    }
    return;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.MAIL_FROM, to: [to], ...buildMagicLinkEmail(url) }),
  });

  if (!res.ok) {
    throw new Error(`Resend responded ${res.status}: ${await res.text()}`);
  }
}
