"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { diffSnapshots, type DiffRow, type Fap01Snapshot } from "@/lib/deals/duplicates";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  contactId: string;
  onUnified: () => void;
}

export function UnifyDealsDialog({ open, onOpenChange, contactId, onUnified }: Props) {
  const supabase = createClient();
  const [rows, setRows] = useState<DiffRow[]>([]);
  const [choices, setChoices] = useState<Record<string, "old" | "new">>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [count, setCount] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("deals")
      .select("id, created_at, fap01_snapshot")
      .eq("contact_id", contactId)
      .eq("status", "open")
      .not("fap01_snapshot", "is", null)
      .order("created_at", { ascending: true });
    const deals = (data ?? []) as { fap01_snapshot: Fap01Snapshot }[];
    setCount(deals.length);
    if (deals.length >= 2) {
      const oldS = deals[0].fap01_snapshot;
      const newS = deals[deals.length - 1].fap01_snapshot;
      setRows(diffSnapshots(oldS, newS));
    } else {
      setRows([]);
    }
    setChoices({});
    setLoading(false);
  }, [supabase, contactId]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  async function handleUnify() {
    setSaving(true);
    const res = await fetch("/api/deals/unify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contactId, choices }),
    });
    setSaving(false);
    if (!res.ok) {
      toast.error("Falha ao unificar");
      return;
    }
    toast.success("Leads unificados");
    onOpenChange(false);
    onUnified();
  }

  const diverging = rows.filter((r) => r.diverges);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg bg-popover border-border">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">Unificar lead duplicado</DialogTitle>
        </DialogHeader>

        {loading ? (
          <p className="py-6 text-sm text-muted-foreground">Carregando…</p>
        ) : count < 2 ? (
          <p className="py-6 text-sm text-muted-foreground">Não há mais duplicados pra unificar.</p>
        ) : (
          <div className="space-y-4 py-2">
            <p className="text-xs text-muted-foreground">
              Mantemos o cadastro mais antigo como base do negócio. Onde houver divergência,
              escolha qual valor fica. UTMs/origem ficam sempre com o mais recente.
            </p>
            {diverging.length === 0 ? (
              <p className="text-sm text-foreground">Os dois cadastros são iguais — unificar só remove o duplicado.</p>
            ) : (
              <div className="space-y-3">
                {diverging.map((r) => {
                  const choice = choices[r.key as string] ?? "new";
                  return (
                    <div key={r.key as string} className="rounded-lg border border-border p-3">
                      <p className="mb-2 text-sm font-semibold text-foreground">{r.label}</p>
                      <div className="grid grid-cols-2 gap-2">
                        {(["old", "new"] as const).map((side) => (
                          <button
                            key={side}
                            type="button"
                            onClick={() => setChoices((c) => ({ ...c, [r.key as string]: side }))}
                            className={`rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                              choice === side
                                ? "border-primary bg-primary/10 text-foreground"
                                : "border-border text-muted-foreground hover:bg-muted"
                            }`}
                          >
                            <span className="block text-[10px] uppercase text-muted-foreground">
                              {side === "old" ? "Antigo" : "Novo"}
                            </span>
                            {(side === "old" ? r.oldValue : r.newValue) || "—"}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="border-border text-muted-foreground hover:bg-muted">
            Cancelar
          </Button>
          <Button onClick={handleUnify} disabled={saving || count < 2} className="bg-primary text-primary-foreground hover:bg-primary/90">
            {saving ? "Unificando…" : "Unificar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
