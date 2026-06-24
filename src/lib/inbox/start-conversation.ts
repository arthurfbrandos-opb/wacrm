import { createClient } from "@/lib/supabase/client";
import type { Conversation } from "@/types";

type SupabaseBrowserClient = ReturnType<typeof createClient>;

/**
 * Find the contact's most recent conversation, or create a fresh one if they
 * have none. Used by the "Nova conversa" flow and the deal popup's "Ver
 * conversa" link so both reuse an existing thread instead of spawning a
 * duplicate. New conversations start with the AI off (`ai_status` defaults to
 * 'off') — a human is opening this on purpose, the SDR shouldn't take over.
 *
 * Returns the conversation row with its `contact` joined, ready to hand to the
 * inbox's selection handler.
 */
export async function findOrCreateConversation(
  supabase: SupabaseBrowserClient,
  input: { accountId: string; userId: string; contactId: string },
): Promise<Conversation> {
  const { data: existing } = await supabase
    .from("conversations")
    .select("*, contact:contacts(*)")
    .eq("contact_id", input.contactId)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (existing) return existing as Conversation;

  const { data: inserted, error } = await supabase
    .from("conversations")
    .insert({
      account_id: input.accountId,
      user_id: input.userId,
      contact_id: input.contactId,
    })
    .select("*, contact:contacts(*)")
    .single();
  if (error) throw error;
  return inserted as Conversation;
}
