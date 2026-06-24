"use client";

import { useState } from "react";
import type { Deal, PipelineStage } from "@/types";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { DealFormBody } from "@/components/pipelines/deal-form";
import { Fap01Tab } from "@/components/contacts/fap01-tab";
import { Phone, Mail, Building2, Copy, Check } from "lucide-react";

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
}: DealDetailDialogProps) {
  const [copiedPhone, setCopiedPhone] = useState(false);
  const contact = deal?.contact ?? null;

  async function copyPhone() {
    if (!contact?.phone) return;
    await navigator.clipboard.writeText(contact.phone);
    setCopiedPhone(true);
    setTimeout(() => setCopiedPhone(false), 2000);
  }

  if (!deal) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl p-0 gap-0 overflow-hidden">
        <div className="flex max-h-[85vh] flex-col">
          {/* Contact header */}
          <div className="flex items-start gap-3 border-b border-border/50 p-4 pr-12">
            <Avatar className="size-11 shrink-0 border border-border bg-muted">
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
            </div>
          </div>

          {/* Tabs */}
          <Tabs
            defaultValue="negocio"
            className="flex min-h-0 flex-1 flex-col gap-0"
          >
            <TabsList className="mx-4 mt-3 w-fit shrink-0 bg-muted/50">
              <TabsTrigger value="negocio">Negócio</TabsTrigger>
              <TabsTrigger value="cadastro">Cadastro</TabsTrigger>
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
              />
            </TabsContent>

            <TabsContent
              value="cadastro"
              className="min-h-0 flex-1 overflow-y-auto p-4"
            >
              <Fap01Tab data={contact?.fap01_data} />
            </TabsContent>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
}
