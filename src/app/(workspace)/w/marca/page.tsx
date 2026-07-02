"use client";

// Marca — a fundação que alimenta a produção da Squad Content (tom de voz,
// ICP, base de conhecimento, linha editorial). O cliente edita aqui; o worker
// injeta a versão mais recente em cada produção. Leitura via RLS; escrita
// via /api/workspace/brand (audita em os_audit).
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { loadBrandSections } from "@/lib/workspace/queries";
import { orderBrandSections, type BrandSection } from "@/lib/workspace/brand";
import { TerminalWindow } from "@/components/ui/terminal-window";

function fmtAtualizado(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString("pt-BR")} ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
}

function SectionCard({ section }: { section: BrandSection }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(section.content);
  const [saved, setSaved] = useState(section.content);
  const [updatedAt, setUpdatedAt] = useState(section.updated_at);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function salvar() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/workspace/brand", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section_key: section.section_key, content: draft }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? `erro ${res.status}`);
      setSaved(draft);
      setUpdatedAt(new Date().toISOString());
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <TerminalWindow
      title={`marca/${section.section_key}.md`}
      action={
        editing ? null : (
          <button
            type="button"
            onClick={() => {
              setDraft(saved);
              setEditing(true);
            }}
            className="rounded-md border border-border bg-muted px-2.5 py-1 font-mono text-[11px] text-foreground transition-colors hover:bg-primary/10 hover:text-primary"
          >
            Editar
          </button>
        )
      }
    >
      <div className="p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="font-mono text-sm font-semibold text-foreground">{section.title}</p>
          <p className="font-mono text-[10px] text-muted-foreground">
            atualizado {fmtAtualizado(updatedAt)}
          </p>
        </div>
        {editing ? (
          <div className="flex flex-col gap-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={16}
              className="w-full rounded-lg border border-border bg-background p-3 font-mono text-xs leading-relaxed text-foreground focus:border-primary focus:outline-none"
            />
            {error ? <p className="font-mono text-xs text-red-400">{error}</p> : null}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={salvar}
                disabled={busy}
                className="rounded-md border border-primary bg-primary px-3 py-1.5 font-mono text-xs font-semibold text-primary-foreground transition-opacity disabled:opacity-60"
              >
                {busy ? "salvando…" : "Salvar"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setDraft(saved);
                  setEditing(false);
                  setError(null);
                }}
                disabled={busy}
                className="rounded-md border border-border bg-muted px-3 py-1.5 font-mono text-xs text-foreground"
              >
                Cancelar
              </button>
              <p className="ml-auto font-mono text-[10px] text-muted-foreground">
                vale já na próxima peça produzida
              </p>
            </div>
          </div>
        ) : (
          <pre className="max-h-80 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-card/40 p-3 font-mono text-xs leading-relaxed text-muted-foreground">
            {saved || "— seção ainda vazia —"}
          </pre>
        )}
      </div>
    </TerminalWindow>
  );
}

export default function MarcaPage() {
  const [sections, setSections] = useState<BrandSection[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const supabase = createClient();
    loadBrandSections(supabase)
      .then((rows) => {
        if (alive) setSections(orderBrandSections(rows));
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-primary">Marca</p>
        <h1 className="mt-1 font-mono text-2xl font-semibold tracking-tight text-foreground">
          Fundação da sua marca
        </h1>
        <p className="mt-1 max-w-2xl font-mono text-sm text-muted-foreground">
          É daqui que a squad tira sua voz, seu cliente ideal e seus argumentos ao produzir
          conteúdo. O que você editar aqui vale já na próxima peça.
        </p>
      </div>

      {error ? (
        <p className="font-mono text-sm text-red-400">{error}</p>
      ) : sections === null ? (
        <p className="font-mono text-sm text-muted-foreground">carregando…</p>
      ) : sections.length === 0 ? (
        <TerminalWindow title="marca/fundacao">
          <div className="p-4">
            <p className="font-mono text-sm text-muted-foreground">
              ▸ sua fundação ainda não foi carregada — o time da Negócio Simples grava tom de
              voz, cliente ideal e linha editorial aqui na implantação.
            </p>
          </div>
        </TerminalWindow>
      ) : (
        sections.map((s) => <SectionCard key={s.section_key} section={s} />)
      )}
    </div>
  );
}
