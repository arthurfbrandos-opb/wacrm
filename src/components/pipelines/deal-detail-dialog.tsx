"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Deal, PipelineStage } from "@/types";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { findOrCreateConversation } from "@/lib/inbox/start-conversation";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { DealFormBody } from "@/components/pipelines/deal-form";
import { Fap01Cadastro, Fap01Utms } from "@/components/contacts/fap01-tab";
import { ContactNotesTab } from "@/components/contacts/contact-notes-tab";
import {
  Phone,
  Mail,
  Building2,
  Copy,
  Check,
  MessageSquare,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { UnifyDealsDialog } from "./unify-deals-dialog";

interface DealDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The deal to open. Carries `deal.contact` (joined with `contacts(*)`),
   *  which includes the FAP01 cadastro payload. */
  deal: Deal | null;
  pipelineId: string;
  stages: PipelineStage[];
  defaultStageId?: string;
  onSaved: () => void;
  isDuplicate?: boolean;
}

function getInitials(name?: string | null) {
  if (!name) return "?";
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

/**
 * Opening an existing deal card surfaces a centered popup (ns-crm style): a
 * clean contact header on top + tabs — "Negócio" (edit the deal) and
 * "Cadastro" (the contact's FAP01 quiz answers + UTMs). The contact rides on
 * `deal.contact` already, so nothing is re-fetched. Single column at the form's
 * native width so the fields breathe instead of getting squeezed.
 */
export function DealDetailDialog({
  open,
  onOpenChange,
  deal,
  pipelineId,
  stages,
  defaultStageId,
  onSaved,
  isDuplicate,
}: DealDetailDialogProps) {
  const router = useRouter();
  const { accountId } = useAuth();
  const [copiedPhone, setCopiedPhone] = useState(false);
  const [openingChat, setOpeningChat] = useState(false);
  const [unifyOpen, setUnifyOpen] = useState(false);
  const contact = deal?.contact ?? null;

  async function copyPhone() {
    if (!contact?.phone) return;
    await navigator.clipboard.writeText(contact.phone);
    setCopiedPhone(true);
    setTimeout(() => setCopiedPhone(false), 2000);
  }

  // Open (or create) this contact's conversation and jump straight to it.
  async function openConversation() {
    if (!contact || !accountId) return;
    setOpeningChat(true);
    try {
      const supabase = createClient();
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
      onOpenChange(false);
      router.push(`/inbox?c=${conv.id}`);
    } catch {
      toast.error("Falha ao abrir a conversa");
    } finally {
      setOpeningChat(false);
    }
  }

  if (!deal) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl p-0 gap-0 overflow-hidden">
        <div className="flex max-h-[85vh] flex-col">
          {/* Contact header */}
          <div className="flex items-start gap-3 border-b border-border/50 p-4 pr-12">
            <Avatar className="size-11 shrink-0 border border-border bg-muted">
              {contact?.avatar_url && (
                <AvatarImage src={contact.avatar_url} alt={contact.name ?? "Contato"} />
              )}
              <AvatarFallback className="bg-primary/10 text-sm font-medium text-primary">
                {getInitials(contact?.name)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <DialogTitle className="truncate text-base text-popover-foreground">
                {deal.title}
              </DialogTitle>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {contact?.name && (
                  <span className="font-medium text-foreground">{contact.name}</span>
                )}
                {contact?.phone && (
                  <button
                    type="button"
                    onClick={copyPhone}
                    aria-label="Copiar telefone do contato"
                    className="flex items-center gap-1 transition-colors hover:text-primary cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 rounded"
                  >
                    <Phone className="size-3" />
                    {contact.phone}
                    {copiedPhone ? (
                      <Check className="size-3 text-primary" />
                    ) : (
                      <Copy className="size-3 opacity-60" />
                    )}
                  </button>
                )}
                {contact?.email && (
                  <span className="flex items-center gap-1">
                    <Mail className="size-3" />
                    {contact.email}
                  </span>
                )}
                {contact?.company && (
                  <span className="flex items-center gap-1">
                    <Building2 className="size-3" />
                    {contact.company}
                  </span>
                )}
                {contact && (
                  <Badge
                    variant="outline"
                    className={`h-5 px-1.5 text-[10px] ${
                      contact.provider === "uazapi"
                        ? "border-violet-500/50 text-violet-600 dark:text-violet-300"
                        : "border-emerald-500/50 text-emerald-600 dark:text-emerald-300"
                    }`}
                  >
                    {contact.provider === "uazapi" ? "Não Oficial" : "Oficial"}
                  </Badge>
                )}
              </div>
              {contact && (
                <button
                  type="button"
                  onClick={openConversation}
                  disabled={openingChat}
                  className="mt-2 inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-primary/10 px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/20 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                >
                  {openingChat ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <MessageSquare className="size-3" />
                  )}
                  Ver conversa
                </button>
              )}
            </div>
          </div>

          {/* Duplicate aviso */}
          {isDuplicate && deal?.contact_id && (
            <div className="mb-3 flex items-center justify-between rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 mx-4 mt-3">
              <span className="text-xs text-amber-300">Esse contato tem mais de um cadastro no funil.</span>
              <Button size="sm" variant="outline" className="border-amber-500/40 text-amber-300 hover:bg-amber-500/10" onClick={() => setUnifyOpen(true)}>
                Unificar
              </Button>
            </div>
          )}

          {/* Tabs */}
          <Tabs
            defaultValue="negocio"
            className="flex min-h-0 flex-1 flex-col gap-0"
          >
            <TabsList className="mx-4 mt-3 w-fit shrink-0 bg-muted/50">
              <TabsTrigger value="negocio">Negócio</TabsTrigger>
              <TabsTrigger value="cadastro">Cadastro</TabsTrigger>
              <TabsTrigger value="utms">UTMs</TabsTrigger>
              <TabsTrigger value="notas">Notas</TabsTrigger>
            </TabsList>

            <TabsContent value="negocio" className="flex min-h-0 flex-1 flex-col">
              <DealFormBody
                open={open}
                onOpenChange={onOpenChange}
                deal={deal}
                pipelineId={pipelineId}
                stages={stages}
                defaultStageId={defaultStageId}
                onSaved={onSaved}
                hideContact
                hideNotes
              />
            </TabsContent>

            <TabsContent
              value="cadastro"
              className="min-h-0 flex-1 overflow-y-auto p-4"
            >
              <Fap01Cadastro data={contact?.fap01_data} />
            </TabsContent>

            <TabsContent
              value="utms"
              className="min-h-0 flex-1 overflow-y-auto p-4"
            >
              <Fap01Utms data={contact?.fap01_data} />
            </TabsContent>

            <TabsContent
              value="notas"
              className="min-h-0 flex-1 overflow-y-auto p-4"
            >
              <ContactNotesTab contactId={contact?.id ?? null} />
            </TabsContent>
          </Tabs>
        </div>
      </DialogContent>
      {deal?.contact_id && (
        <UnifyDealsDialog
          open={unifyOpen}
          onOpenChange={setUnifyOpen}
          contactId={deal.contact_id}
          onUnified={() => { onOpenChange(false); onSaved(); }}
        />
      )}
    </Dialog>
  );
}
