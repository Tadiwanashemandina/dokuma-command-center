import { createServiceRoleClient } from "@/lib/supabase/server";

export type NotifyInput = {
  type: string;
  title: string;
  body?: string;
  link?: string;
};

/**
 * Writes the in-app notification unconditionally, then makes a best-effort
 * attempt to also send it as a real email via Resend. The email leg is
 * deliberately non-fatal: a domain still propagating DNS records, a
 * transient Resend outage, or a user with no email on file should never
 * cause the underlying business action (a leave decision, a report
 * publish) to fail just because the notification's email half didn't send.
 * Every attempt — success or failure — is visible via the returned result
 * rather than silently swallowed.
 */
export async function notify(userId: string, input: NotifyInput): Promise<{ inApp: boolean; email: boolean; emailError?: string }> {
  const supabase = createServiceRoleClient();

  const { error: insertError } = await supabase.from("notifications").insert({
    user_id: userId,
    type: input.type,
    title: input.title,
    body: input.body ?? null,
    link: input.link ?? null,
  });
  const inApp = !insertError;
  if (insertError) console.error("notify: failed to write in-app notification:", insertError.message);

  const { data: userData, error: userError } = await supabase.auth.admin.getUserById(userId);
  if (userError || !userData?.user?.email) {
    return { inApp, email: false, emailError: userError?.message ?? "No email on file for this user." };
  }

  try {
    await sendEmail(userData.user.email, input.title, input.body ?? "");
    return { inApp, email: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error sending email.";
    console.error("notify: email send failed:", message);
    return { inApp, email: false, emailError: message };
  }
}

async function sendEmail(to: string, subject: string, body: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const domain = process.env.RESEND_EMAIL_DOMAIN;
  if (!apiKey || !domain) throw new Error("RESEND_API_KEY / RESEND_EMAIL_DOMAIN are not configured.");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `Dokuma Command Centre <notifications@${domain}>`,
      to: [to],
      subject,
      html: `<p style="font-family: sans-serif; color: #0D1B3E;">${body.replace(/\n/g, "<br/>")}</p>`,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Resend API error (${res.status}): ${text}`);
  }
}
