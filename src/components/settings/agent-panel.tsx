"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Bot, Loader2 } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { SettingsPanelHead } from "./settings-panel-head";

/**
 * SDR agent (Pedro) settings — the system prompt that drives the
 * pre-sales bot. This is the exact text sent to the Pedro backend
 * (`/v6/llm/reply`) as the system prompt; the lead's cadastro and the
 * live agenda slots are appended automatically at reply time. Editing
 * it here changes Pedro's behaviour on the next message.
 *
 * `sdr_config` RLS is read-only for members, so the write goes through
 * the admin-gated `/api/sdr/config` route (PUT). Non-admins get a
 * read-only view.
 */
export function AgentPanel() {
  const { canEditSettings, profileLoading } = useAuth();

  const [loaded, setLoaded] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/sdr/config");
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as {
          system_prompt: string;
          updated_at: string | null;
        };
        if (cancelled) return;
        setLoaded(data.system_prompt);
        setPrompt(data.system_prompt);
        setUpdatedAt(data.updated_at);
      } catch {
        if (!cancelled) toast.error("Falha ao carregar o prompt do agente");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const dirty = loaded !== null && prompt !== loaded;

  async function handleSave() {
    if (!dirty || !prompt.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/sdr/config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ system_prompt: prompt }),
      });
      if (!res.ok) {
        const { error } = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(error ?? String(res.status));
      }
      setLoaded(prompt);
      setUpdatedAt(new Date().toISOString());
      toast.success("Prompt do Pedro atualizado");
    } catch (e) {
      toast.error(
        e instanceof Error ? `Falha ao salvar: ${e.message}` : "Falha ao salvar",
      );
    } finally {
      setSaving(false);
    }
  }

  const readOnly = !canEditSettings || profileLoading;

  return (
    <section className="max-w-2xl animate-in fade-in-50 duration-200">
      <SettingsPanelHead
        title="Agente SDR (Pedro)"
        description="O prompt que comanda o pré-vendas no WhatsApp. É enviado direto ao cérebro do Pedro a cada resposta."
      />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <Bot className="size-4 text-primary" />
            Prompt do sistema
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            Define como o Pedro qualifica o lead e marca o diagnóstico. Os
            dados do lead (cadastro) e os horários livres da agenda são
            anexados automaticamente — não precisa colocar aqui. A mudança
            vale na próxima mensagem.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label className="text-muted-foreground">Prompt</Label>
            {loading ? (
              <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Carregando…
              </div>
            ) : (
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                disabled={readOnly}
                rows={20}
                spellCheck={false}
                className="w-full rounded-lg border border-border bg-muted px-3 py-2 font-mono text-xs leading-relaxed text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
              />
            )}
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{prompt.length.toLocaleString("pt-BR")} caracteres</span>
              {updatedAt && (
                <span>
                  Atualizado{" "}
                  {new Date(updatedAt).toLocaleString("pt-BR", {
                    timeZone: "America/Sao_Paulo",
                  })}
                </span>
              )}
            </div>
            {!canEditSettings && !profileLoading && (
              <p className="text-xs text-muted-foreground">
                Só admins da conta podem editar o prompt do agente.
              </p>
            )}
          </div>

          {canEditSettings && (
            <Button
              onClick={handleSave}
              disabled={saving || !dirty || !prompt.trim()}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {saving ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Salvando…
                </>
              ) : (
                "Salvar"
              )}
            </Button>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
