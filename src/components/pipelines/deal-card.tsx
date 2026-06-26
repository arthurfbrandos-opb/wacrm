"use client";

import type { Deal, PipelineStage } from "@/types";
import { Calendar, Check, X, Copy, MessageCircle } from "lucide-react";
import { formatCurrency } from "@/lib/currency";

interface DealCardProps {
  deal: Deal;
  stage: PipelineStage | null;
  onEdit: (deal: Deal) => void;
  isOverlay?: boolean;
  isDuplicate?: boolean;
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("pt-BR", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function initials(name?: string, fallback?: string) {
  const source = (name || fallback || "?").trim();
  if (!source) return "?";
  return source.charAt(0).toUpperCase();
}

// 1ª abordagem do Ian (mesma copy do chaseBubbles do SDR), pré-preenchida no
// wa.me pra acionar manualmente (Web/celular) enquanto o cold outbound oficial
// não está no ar. Ver memória project_sdr_whatsapp_reachout_block_2026_06_25.
function firstApproachLink(name?: string, phone?: string): string | null {
  const digits = (phone || "").replace(/\D/g, "");
  if (!digits) return null;
  const firstName = (name || "").trim().split(/\s+/)[0] || "";
  const text =
    `Fala ${firstName}, Ian da Negócio Simples aqui, tudo certo?\n\n` +
    `Recebi seu cadastro aqui e queria te fazer 2 ou 3 perguntas rápidas antes de agendar nosso diagnóstico. Pode ser? Jogo rápido.`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

export function DealCard({ deal, stage, onEdit, isOverlay, isDuplicate }: DealCardProps) {
  const contactLabel = deal.contact?.name || deal.contact?.phone || "Sem contato";
  const assigneeLabel = deal.assignee?.full_name || null;
  const waLink = firstApproachLink(deal.contact?.name, deal.contact?.phone);

  return (
    <div
      className={`group relative w-full overflow-hidden rounded-xl border border-border/50 bg-muted/70 shadow-sm transition-all ${
        isOverlay
          ? "shadow-xl"
          : "hover:-translate-y-0.5 hover:border-border hover:bg-muted hover:shadow-lg"
      }`}
    >
      {/* 4px left accent bar using stage color */}
      <span
        aria-hidden
        className="absolute left-0 top-0 z-10 h-full w-1"
        style={{ backgroundColor: stage?.color ?? "#94a3b8" }}
      />

      <button
        type="button"
        onClick={(e) => {
          // `onClick` still fires after a non-drag tap because the PointerSensor
          // requires 5px movement before it counts as a drag.
          if (isOverlay) return;
          e.stopPropagation();
          onEdit(deal);
        }}
        className="block w-full cursor-pointer pl-4 pr-3 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/60"
      >
        <div className="flex items-start justify-between gap-2">
          <h4 className="flex-1 text-sm font-semibold leading-snug text-foreground break-words">
            {deal.title}
          </h4>
          {deal.status === "won" && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
              <Check className="h-3 w-3" />
              Ganho
            </span>
          )}
          {deal.status === "lost" && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold text-red-400">
              <X className="h-3 w-3" />
              Perdido
            </span>
          )}
          {isDuplicate && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-400">
              <Copy className="h-3 w-3" />
              duplicado
            </span>
          )}
        </div>

        {/* Contact row */}
        <div className="mt-2 flex items-center gap-2">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-foreground">
            {initials(deal.contact?.name, deal.contact?.phone)}
          </span>
          <span className="truncate text-xs text-muted-foreground">{contactLabel}</span>
        </div>

        <div className="mt-2 flex items-center justify-between">
          <span className="text-sm font-bold text-primary">
            {formatCurrency(deal.value, deal.currency)}
          </span>
          {deal.expected_close_date && (
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <Calendar className="h-3 w-3" />
              {formatDate(deal.expected_close_date)}
            </span>
          )}
        </div>

        {assigneeLabel && (
          <div className="mt-2 flex items-center justify-end">
            <span
              title={assigneeLabel}
              className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary"
            >
              {initials(assigneeLabel)}
            </span>
          </div>
        )}
      </button>

      {/* Ação: WhatsApp 1ª abordagem (não some no overlay de drag). */}
      {waLink && !isOverlay && (
        <a
          href={waLink}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          title="Abrir WhatsApp com a 1ª abordagem pré-escrita"
          className="flex items-center gap-1.5 border-t border-border/40 pl-4 pr-3 py-1.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10"
        >
          <MessageCircle className="h-3.5 w-3.5" />
          WhatsApp · 1ª abordagem
        </a>
      )}
    </div>
  );
}
