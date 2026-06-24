"use client";

import { useState } from "react";
import type { Deal, PipelineStage } from "@/types";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
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
 * Opening an existing deal card surfaces a centered popup (ns-crm style):
 * a contact summary panel on the left + tabs on the right — "Negócio" (edit
 * the deal) and "Cadastro" (the contact's FAP01 quiz answers + UTMs). The
 * contact data rides on `deal.contact` already, so nothing is re-fetched.
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
      <DialogContent className="sm:max-w-3xl p-0 gap-0 overflow-hidden">
        <div className="flex h-[min(85vh,640px)] flex-col">
          {/* Header */}
          <div className="border-b border-border/50 px-4 py-3 pr-12">
            <DialogTitle className="truncate text-popover-foreground">
              {deal.title}
            </DialogTitle>
            <DialogDescription className="mt-0.5 text-xs text-muted-foreground">
              Negócio · {contact?.name || contact?.phone || "sem contato"}
            </DialogDescription>
          </div>

          {/* Body: contact panel + tabs */}
          <div className="flex min-h-0 flex-1 flex-col md:flex-row">
            {/* Left — contact summary */}
            <aside className="shrink-0 space-y-3 overflow-y-auto border-b border-border/50 p-4 md:w-[248px] md:border-b-0 md:border-r">
              {contact ? (
                <>
                  <div className="flex items-center gap-3">
                    <Avatar className="size-11 border border-border bg-muted">
                      <AvatarFallback className="bg-primary/10 text-sm font-medium text-primary">
                        {getInitials(contact.name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">
                        {contact.name || "Desconhecido"}
                      </p>
                      <Badge
                        variant="outline"
                        className={`mt-1 h-5 px-1.5 text-[10px] ${
                          contact.provider === "uazapi"
                            ? "border-violet-500/50 text-violet-600 dark:text-violet-300"
                            : "border-emerald-500/50 text-emerald-600 dark:text-emerald-300"
                        }`}
                      >
                        {contact.provider === "uazapi" ? "Não Oficial" : "Oficial"}
                      </Badge>
                    </div>
                  </div>

                  <div className="space-y-2 text-sm">
                    <button
                      type="button"
                      onClick={copyPhone}
                      aria-label="Copiar telefone do contato"
                      className="flex w-full items-center gap-2 rounded-md px-1 py-0.5 text-left text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 cursor-pointer"
                    >
                      <Phone className="size-3.5 shrink-0" />
                      <span className="truncate">{contact.phone}</span>
                      {copiedPhone ? (
                        <Check className="size-3.5 shrink-0 text-primary" />
                      ) : (
                        <Copy className="size-3.5 shrink-0 opacity-60" />
                      )}
                    </button>
                    {contact.email && (
                      <div className="flex items-center gap-2 px-1 text-muted-foreground">
                        <Mail className="size-3.5 shrink-0" />
                        <span className="truncate">{contact.email}</span>
                      </div>
                    )}
                    {contact.company && (
                      <div className="flex items-center gap-2 px-1 text-muted-foreground">
                        <Building2 className="size-3.5 shrink-0" />
                        <span className="truncate">{contact.company}</span>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Este negócio não tem contato vinculado.
                </p>
              )}
            </aside>

            {/* Right — tabs */}
            <Tabs
              defaultValue="negocio"
              className="flex min-h-0 flex-1 flex-col gap-0"
            >
              <TabsList className="mx-4 mt-3 w-fit shrink-0 bg-muted/50">
                <TabsTrigger value="negocio">Negócio</TabsTrigger>
                <TabsTrigger value="cadastro">Cadastro</TabsTrigger>
              </TabsList>

              <TabsContent
                value="negocio"
                className="flex min-h-0 flex-1 flex-col"
              >
                <DealFormBody
                  open={open}
                  onOpenChange={onOpenChange}
                  deal={deal}
                  pipelineId={pipelineId}
                  stages={stages}
                  defaultStageId={defaultStageId}
                  onSaved={onSaved}
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
        </div>
      </DialogContent>
    </Dialog>
  );
}
