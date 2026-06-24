/**
 * Pull a contact's WhatsApp profile picture (and display name) via UazAPI and
 * persist it on the contact so the CRM shows the real WhatsApp avatar.
 *
 * Endpoint (uazapiGO, verified against the live instance):
 *   POST {baseUrl}/chat/GetNameAndImageURL   header `token`   body { number }
 *   → { id, name?, image, imagePreview }
 *
 * The `image` URL points at pps.whatsapp.net and EXPIRES (it carries an `oe`
 * param), so we download the bytes and re-host them in the public `chat-media`
 * bucket — the stored avatar then never breaks. Everything here is best-effort:
 * a failure (private photo, no UazAPI connection, network blip) leaves the
 * contact's existing avatar untouched and never throws to the caller.
 */
import { decrypt } from "@/lib/whatsapp/encryption";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

const CHAT_MEDIA_BUCKET = "chat-media";

interface NameAndImage {
  name: string | null;
  imageUrl: string | null;
}

/** Raw UazAPI call — returns the contact's name + full-res image URL (or nulls). */
export async function fetchUazapiNameAndImage(opts: {
  baseUrl: string;
  token: string;
  number: string;
}): Promise<NameAndImage> {
  const base = opts.baseUrl.replace(/\/+$/, "");
  const res = await fetch(`${base}/chat/GetNameAndImageURL`, {
    method: "POST",
    headers: { "Content-Type": "application/json", token: opts.token },
    body: JSON.stringify({ number: opts.number }),
  });
  if (!res.ok) return { name: null, imageUrl: null };
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const image =
    (typeof data.image === "string" && data.image) ||
    (typeof data.imagePreview === "string" && data.imagePreview) ||
    null;
  const name = typeof data.name === "string" && data.name.trim() ? data.name.trim() : null;
  return { name, imageUrl: image };
}

/**
 * Best-effort: fetch the contact's WhatsApp photo via the account's active
 * UazAPI connection, re-host it in `chat-media`, and write the public URL to
 * `contacts.avatar_url`. Returns the new URL, or null if nothing was stored.
 * Never throws.
 */
export async function syncContactAvatarFromWhatsApp(
  admin: Admin,
  input: { accountId: string; contactId: string; phone: string },
): Promise<string | null> {
  try {
    // Only works through a UazAPI number — Meta Cloud API has no equivalent.
    const { data: conn } = await admin
      .from("wa_connections")
      .select("base_url, access_token_enc")
      .eq("account_id", input.accountId)
      .eq("is_active_for_crm", true)
      .maybeSingle();
    if (!conn) return null;

    const number = input.phone.replace(/\D/g, "");
    if (!number) return null;

    const { name, imageUrl } = await fetchUazapiNameAndImage({
      baseUrl: conn.base_url,
      token: decrypt(conn.access_token_enc),
      number,
    });
    if (!imageUrl) return null;

    // Download the (expiring) WhatsApp CDN image and re-host it.
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) return null;
    const contentType = imgRes.headers.get("content-type") || "image/jpeg";
    const bytes = Buffer.from(await imgRes.arrayBuffer());
    if (bytes.length === 0) return null;

    const path = `account-${input.accountId}/avatars/${input.contactId}.jpg`;
    const { error: upErr } = await admin.storage
      .from(CHAT_MEDIA_BUCKET)
      .upload(path, bytes, { contentType, upsert: true, cacheControl: "3600" });
    if (upErr) return null;

    const {
      data: { publicUrl },
    } = admin.storage.from(CHAT_MEDIA_BUCKET).getPublicUrl(path);
    // Cache-bust so a refreshed photo isn't masked by the old cached object.
    const url = `${publicUrl}?v=${Date.now()}`;

    const patch: Record<string, unknown> = { avatar_url: url };
    // Backfill the WhatsApp display name only when we don't have one yet.
    const { data: contact } = await admin
      .from("contacts")
      .select("name")
      .eq("id", input.contactId)
      .maybeSingle();
    if (name && !contact?.name) patch.name = name;

    await admin.from("contacts").update(patch).eq("id", input.contactId);
    return url;
  } catch {
    return null;
  }
}
