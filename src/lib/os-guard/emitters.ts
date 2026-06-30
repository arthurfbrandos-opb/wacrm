import type { SupabaseClient } from '@supabase/supabase-js'
import { osEmitEvent } from './index'

export async function emitSdrReplyEvent(
  db: SupabaseClient,
  args: { accountId: string; contactId?: string | null; conversationId?: string | null; correlationId?: string | null },
): Promise<void> {
  await osEmitEvent(db, {
    accountId: args.accountId,
    agent: 'ian',
    kind: 'sdr.reply_sent',
    summary: 'Ian respondeu um lead',
    ref: { contact_id: args.contactId ?? null, conversation_id: args.conversationId ?? null, correlation_id: args.correlationId ?? null },
  })
}
