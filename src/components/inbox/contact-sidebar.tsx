"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { Contact, ContactNote } from "@/types";
import { Phone, Mail, Copy, Check, StickyNote, Plus, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  buildChannelOptions,
  currentChannelId,
  type ChannelOption,
  type UazapiConnectionLike,
} from "@/lib/whatsapp/channel-options";
import { ContactFieldsEditor } from "./contact-fields-editor";
import { ContactTagsEditor } from "./contact-tags-editor";
import { ContactDealEditor } from "./contact-deal-editor";
import { toast } from "sonner";
import { format } from "date-fns";

interface ContactSidebarProps {
  contact: Contact | null;
}

export function ContactSidebar({ contact }: ContactSidebarProps) {
  const { accountId } = useAuth();
  const [copied, setCopied] = useState(false);
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [newNote, setNewNote] = useState("");
  const [addingNote, setAddingNote] = useState(false);
  // "Canal de origem" — the registered WhatsApp channels for this account
  // (official Meta + each UazAPI number) and which one this contact replies
  // through. `channelOverride` holds the optimistic selection after a switch;
  // it resets when the contact changes so we fall back to the DB-derived
  // current channel.
  const [channels, setChannels] = useState<ChannelOption[]>([]);
  const [connections, setConnections] = useState<UazapiConnectionLike[]>([]);
  const [channelOverride, setChannelOverride] = useState<string | null>(null);
  const [switchingChannel, setSwitchingChannel] = useState(false);

  // Notes live here; tags and the deal are owned by their own child
  // components (each fetches + writes its own slice).
  const fetchNotes = useCallback(async () => {
    if (!contact) return;
    const supabase = createClient();
    const { data } = await supabase
      .from("contact_notes")
      .select("*")
      .eq("contact_id", contact.id)
      .order("created_at", { ascending: false });
    if (data) setNotes(data);
  }, [contact]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchNotes();
  }, [fetchNotes]);

  const handleCopyPhone = useCallback(async () => {
    if (!contact?.phone) return;
    await navigator.clipboard.writeText(contact.phone);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    // Dep is the whole `contact` object (not `contact?.phone`) so the
    // React Compiler's inference agrees with the manual dep list —
    // fixes the `preserve-manual-memoization` lint error.
  }, [contact]);

  const handleAddNote = useCallback(async () => {
    if (!contact || !newNote.trim()) return;
    if (!accountId) return;
    setAddingNote(true);

    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;

    const { data, error } = await supabase
      .from("contact_notes")
      .insert({
        contact_id: contact.id,
        account_id: accountId,
        user_id: user?.id,
        note_text: newNote.trim(),
      })
      .select()
      .single();

    if (!error && data) {
      setNotes((prev) => [data, ...prev]);
      setNewNote("");
    }
    setAddingNote(false);
  }, [contact, newNote, accountId]);

  // Load the account's WhatsApp channels (official Meta + each UazAPI
  // number). RLS lets any account member SELECT both tables. setState runs
  // inside async callbacks, not synchronously in the effect body.
  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const [cfgRes, connRes] = await Promise.all([
        supabase
          .from("whatsapp_config")
          .select("phone_number_id")
          .eq("account_id", accountId)
          .maybeSingle(),
        supabase
          .from("wa_connections")
          .select("id, label, base_url, is_active_for_crm")
          .eq("account_id", accountId)
          .order("created_at", { ascending: true }),
      ]);
      if (cancelled) return;
      const conns = (connRes.data ?? []) as UazapiConnectionLike[];
      setConnections(conns);
      setChannels(
        buildChannelOptions({
          metaConfigured: !!cfgRes.data?.phone_number_id,
          connections: conns,
        }),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  // Drop the optimistic selection when switching contacts so the selector
  // reflects the new contact's stored channel.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setChannelOverride(null);
  }, [contact?.id]);

  const selectedChannelId =
    channelOverride ?? currentChannelId(contact ?? {}, channels, connections);

  const handleChannelChange = useCallback(
    async (id: string | null) => {
      if (!contact || !id) return;
      const opt = channels.find((c) => c.id === id);
      if (!opt) return;
      setChannelOverride(id);
      setSwitchingChannel(true);
      const supabase = createClient();
      const { error } = await supabase
        .from("contacts")
        .update({
          provider: opt.provider,
          connection_id: opt.connectionId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", contact.id);
      setSwitchingChannel(false);
      if (error) {
        setChannelOverride(null);
        toast.error("Falha ao mudar o canal de origem");
      } else {
        toast.success(`Origem alterada para ${opt.label}`);
      }
    },
    [channels, contact],
  );

  if (!contact) {
    return (
      <div className="flex h-full w-70 items-center justify-center border-l border-border bg-card">
        <p className="text-sm text-muted-foreground">Select a conversation</p>
      </div>
    );
  }

  const displayName = contact.name || contact.phone;
  const initials = displayName.charAt(0).toUpperCase();

  return (
    <div className="flex h-full min-h-0 w-70 flex-col border-l border-border bg-card">
      {/* `min-h-0` is load-bearing: without it the flex-1 ScrollArea grows to
          its content height (min-height:auto) instead of bounding to the
          column, so a tall panel overflows and the ancestor's overflow-hidden
          clips the bottom — the panel looks "stuck" with no scroll. */}
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-4">
          {/* Contact Info */}
          <div className="flex flex-col items-center text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted text-lg font-semibold text-foreground">
              {contact.avatar_url ? (
                <img
                  src={contact.avatar_url}
                  alt={displayName}
                  className="h-16 w-16 rounded-full object-cover"
                />
              ) : (
                initials
              )}
            </div>
            <h3 className="mt-3 text-sm font-semibold text-foreground">
              {displayName}
            </h3>
            {contact.company && (
              <p className="text-xs text-muted-foreground">{contact.company}</p>
            )}
          </div>

          {/* Phone */}
          <div className="mt-4 space-y-2">
            <button
              onClick={handleCopyPhone}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted"
            >
              <Phone className="h-4 w-4 text-muted-foreground" />
              <span className="flex-1 text-left">{contact.phone}</span>
              {copied ? (
                <Check className="h-3 w-3 text-primary" />
              ) : (
                <Copy className="h-3 w-3 text-muted-foreground" />
              )}
            </button>

            {contact.email && (
              <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <span className="truncate">{contact.email}</span>
              </div>
            )}
          </div>

          {/* Canal de origem — which registered number/channel answers this
              contact. Governs both manual replies and the IA (Ian). Only
              rendered when the account has at least one channel configured;
              the picker is disabled when there's only one (nothing to switch
              to) or a switch is in flight. */}
          {channels.length > 0 && (
            <>
              <div className="my-4 border-t border-border" />
              <div>
                <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  <Radio className="h-3 w-3" />
                  Canal de origem
                </div>
                <div className="mt-2">
                  <Select
                    value={selectedChannelId ?? undefined}
                    onValueChange={handleChannelChange}
                    disabled={switchingChannel || channels.length < 2}
                  >
                    <SelectTrigger className="w-full border-border bg-muted text-foreground">
                      <SelectValue placeholder="Selecionar canal" />
                    </SelectTrigger>
                    <SelectContent className="border-border bg-popover">
                      {channels.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="mt-1 px-1 text-[10px] text-muted-foreground">
                    Por onde as respostas (suas e da Ian) saem para este
                    contato.
                  </p>
                </div>
              </div>
            </>
          )}

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Dados do contato — editable cadastro + quiz fields; UTM/origin
              shown read-only inside the editor. */}
          <ContactFieldsEditor contact={contact} />

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Tags — assign existing + quick-create */}
          <ContactTagsEditor contactId={contact.id} accountId={accountId} />

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Deal — 1 contact = 1 deal; migrate pipeline/stage or create */}
          <ContactDealEditor contactId={contact.id} accountId={accountId} />

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Notes */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <StickyNote className="h-3 w-3" />
              Notes
            </div>
            <div className="mt-2">
              <div className="flex gap-2">
                <textarea
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder="Add a note..."
                  rows={2}
                  className="flex-1 resize-none rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground placeholder-muted-foreground outline-none focus:border-primary/50"
                />
                <Button
                  size="sm"
                  className="h-auto bg-primary px-2 hover:bg-primary/90"
                  onClick={handleAddNote}
                  disabled={!newNote.trim() || addingNote}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>

              <div className="mt-2 space-y-2">
                {notes.map((note) => (
                  <div
                    key={note.id}
                    className="rounded-lg bg-muted px-3 py-2"
                  >
                    <p className="whitespace-pre-wrap text-xs text-muted-foreground">
                      {note.note_text}
                    </p>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {format(new Date(note.created_at), "MMM d, yyyy HH:mm")}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
