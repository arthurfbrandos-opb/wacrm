"use client";

import { useState, useEffect, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { findOrCreateConversation } from "@/lib/inbox/start-conversation";
import type { Contact, Conversation } from "@/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Search, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface NewConversationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the found-or-created conversation so the inbox can open it. */
  onStarted: (conversation: Conversation) => void;
}

/**
 * Start a conversation from inside the CRM: pick a contact, and we open their
 * existing thread or create a fresh one. The first message is then sent from
 * the normal composer (which already enforces WhatsApp's 24h / template rules).
 */
export function NewConversationDialog({
  open,
  onOpenChange,
  onStarted,
}: NewConversationDialogProps) {
  const supabase = createClient();
  const { accountId } = useAuth();

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [startingId, setStartingId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSearch("");
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data } = await supabase.from("contacts").select("*").order("name");
      if (cancelled) return;
      setContacts((data ?? []) as Contact[]);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, supabase]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter(
      (c) =>
        (c.name ?? "").toLowerCase().includes(q) ||
        c.phone.toLowerCase().includes(q) ||
        (c.email ?? "").toLowerCase().includes(q),
    );
  }, [contacts, search]);

  async function start(contact: Contact) {
    if (!accountId) {
      toast.error("Seu perfil não está vinculado a uma conta.");
      return;
    }
    setStartingId(contact.id);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      if (!userId) {
        toast.error("Não autenticado");
        return;
      }
      const conv = await findOrCreateConversation(supabase, {
        accountId,
        userId,
        contactId: contact.id,
      });
      onStarted(conv);
      onOpenChange(false);
    } catch {
      toast.error("Falha ao iniciar a conversa");
    } finally {
      setStartingId(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-popover border-border p-0 gap-0 overflow-hidden">
        <DialogHeader className="border-b border-border/50 p-4 pr-12">
          <DialogTitle className="text-popover-foreground">Nova conversa</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Escolha um contato para abrir (ou iniciar) a conversa.
          </DialogDescription>
        </DialogHeader>

        <div className="p-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome, telefone ou e-mail..."
              autoFocus
              className="border-border bg-muted pl-9 text-sm text-foreground placeholder-muted-foreground focus-visible:border-primary/50"
            />
          </div>
        </div>

        <div className="max-h-[50vh] min-h-[8rem] overflow-y-auto px-2 pb-2">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {contacts.length === 0
                ? "Nenhum contato ainda."
                : "Nenhum contato encontrado."}
            </p>
          ) : (
            filtered.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => start(c)}
                disabled={startingId !== null}
                className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 cursor-pointer"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium text-foreground">
                  {(c.name || c.phone).charAt(0).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-foreground">
                    {c.name || c.phone}
                  </span>
                  {c.name && (
                    <span className="block truncate text-xs text-muted-foreground">
                      {c.phone}
                    </span>
                  )}
                </span>
                {startingId === c.id && (
                  <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
                )}
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
