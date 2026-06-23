"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Deal, Pipeline, PipelineStage } from "@/types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DollarSign } from "lucide-react";
import { toast } from "sonner";

type PipelineWithStages = Pipeline & { stages: PipelineStage[] };

interface ContactDealEditorProps {
  contactId: string;
  accountId: string | null;
}

/**
 * The contact's single deal (rule: 1 contact = 1 deal). Shows pipeline + stage
 * selectors to migrate in place, or a "Criar deal" button when none exists. A
 * legacy duplicate (>1 deal) surfaces the most recent and logs a warning — no
 * destructive merge here.
 */
export function ContactDealEditor({ contactId, accountId }: ContactDealEditorProps) {
  const [pipelines, setPipelines] = useState<PipelineWithStages[]>([]);
  const [deal, setDeal] = useState<Deal | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const fetchAll = useCallback(async () => {
    const supabase = createClient();
    const [pRes, dRes] = await Promise.all([
      supabase
        .from("pipelines")
        .select("*, stages:pipeline_stages(*)")
        .order("created_at", { ascending: true }),
      supabase
        .from("deals")
        .select("*")
        .eq("contact_id", contactId)
        .order("created_at", { ascending: false }),
    ]);
    const pls = ((pRes.data ?? []) as PipelineWithStages[]).map((p) => ({
      ...p,
      stages: (p.stages ?? []).slice().sort((a, b) => a.position - b.position),
    }));
    const deals = (dRes.data ?? []) as Deal[];
    if (deals.length > 1) {
      console.warn(
        `[contact-deal-editor] contact ${contactId} has ${deals.length} deals (expected 1); showing the most recent`,
      );
    }
    setPipelines(pls);
    setDeal(deals[0] ?? null);
    setLoading(false);
  }, [contactId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    fetchAll();
  }, [fetchAll]);

  const currentPipeline = pipelines.find((p) => p.id === deal?.pipeline_id);
  const stages = currentPipeline?.stages ?? [];

  async function changePipeline(pipelineId: string | null) {
    if (!deal || !pipelineId) return;
    const target = pipelines.find((p) => p.id === pipelineId);
    const firstStage = target?.stages[0];
    if (!firstStage) return;
    const prev = deal;
    setDeal({ ...deal, pipeline_id: pipelineId, stage_id: firstStage.id });
    const supabase = createClient();
    const { error } = await supabase
      .from("deals")
      .update({
        pipeline_id: pipelineId,
        stage_id: firstStage.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", deal.id);
    if (error) {
      setDeal(prev);
      toast.error("Falha ao mudar o pipeline");
    }
  }

  async function changeStage(stageId: string | null) {
    if (!deal || !stageId) return;
    const prev = deal;
    setDeal({ ...deal, stage_id: stageId });
    const supabase = createClient();
    const { error } = await supabase
      .from("deals")
      .update({ stage_id: stageId, updated_at: new Date().toISOString() })
      .eq("id", deal.id);
    if (error) {
      setDeal(prev);
      toast.error("Falha ao mudar o estágio");
    }
  }

  async function createDeal() {
    if (!accountId) return;
    const pipeline = pipelines[0];
    const firstStage = pipeline?.stages[0];
    if (!pipeline || !firstStage) {
      toast.error("Crie um pipeline primeiro em Pipelines");
      return;
    }
    setBusy(true);
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const { data, error } = await supabase
      .from("deals")
      .insert({
        account_id: accountId,
        user_id: session?.user?.id,
        contact_id: contactId,
        pipeline_id: pipeline.id,
        stage_id: firstStage.id,
        title: "Novo deal",
        value: 0,
        currency: "BRL",
        status: "open",
      })
      .select("*")
      .single();
    setBusy(false);
    if (error || !data) {
      toast.error("Falha ao criar o deal");
      return;
    }
    setDeal(data as Deal);
    toast.success("Deal criado");
  }

  return (
    <div>
      <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        <DollarSign className="h-3 w-3" />
        Deal
      </div>
      <div className="mt-2">
        {loading ? (
          <p className="px-1 text-xs text-muted-foreground">Carregando…</p>
        ) : !deal ? (
          <button
            onClick={createDeal}
            disabled={busy}
            className="w-full rounded-md border border-border px-2 py-1.5 text-xs text-foreground hover:bg-muted disabled:opacity-50"
          >
            {busy ? "Criando…" : "Criar deal"}
          </button>
        ) : (
          <div className="space-y-2">
            <label className="block px-1">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Pipeline
              </span>
              <Select
                value={deal.pipeline_id}
                onValueChange={changePipeline}
                disabled={pipelines.length === 0}
              >
                <SelectTrigger className="mt-0.5 h-8 w-full border-border bg-muted text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-border bg-popover">
                  {pipelines.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="block px-1">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Estágio
              </span>
              <Select
                value={deal.stage_id}
                onValueChange={changeStage}
                disabled={stages.length === 0}
              >
                <SelectTrigger className="mt-0.5 h-8 w-full border-border bg-muted text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-border bg-popover">
                  {stages.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      <span className="inline-flex items-center gap-2">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: s.color }}
                        />
                        {s.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          </div>
        )}
      </div>
    </div>
  );
}
