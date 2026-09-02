import { createServiceRoleClient, createClient } from "@/lib/supabase/server";

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024; // 10MB
export const ALLOWED_DOCUMENT_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

export function validateDocumentFile(file: File): string | null {
  if (file.size === 0) return "File is empty.";
  if (file.size > MAX_DOCUMENT_BYTES) return `File exceeds the ${MAX_DOCUMENT_BYTES / 1024 / 1024}MB limit.`;
  if (!ALLOWED_DOCUMENT_TYPES.includes(file.type)) return "Only PDF, Word, and image files are allowed.";
  return null;
}

// Uploads via the service-role client after the caller's own requireRole()
// check — Storage RLS on these buckets has no INSERT policies at all, so
// every write goes through this path, same as every table write in the app.
export async function uploadDocument(bucket: string, path: string, file: File): Promise<void> {
  const supabase = createServiceRoleClient();
  const buffer = Buffer.from(await file.arrayBuffer());
  const { error } = await supabase.storage.from(bucket).upload(path, buffer, {
    contentType: file.type || "application/octet-stream",
    upsert: true,
  });
  if (error) throw new Error(error.message);
}

// Uses the cookie-session client so the signed URL is only ever issued for
// an object the caller's own Storage SELECT policy allows them to read —
// this does not bypass RLS the way the upload path (necessarily) does.
export async function getSignedDocumentUrl(bucket: string, path: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 60);
  if (error || !data) return null;
  return data.signedUrl;
}
