"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Loader2, Plus, Trash2 } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { TerminalWindow } from "@/components/ui/terminal-window";
import {
  BUILTIN_VARIABLES,
  BUILTIN_NAMES,
  isValidVariableName,
  unknownTokens,
  type CustomVariable,
} from "@/lib/sdr/variables";
import { SettingsPanelHead } from "./settings-panel-head";

interface CustomField {
  id: string;
  field_name: string;
}

/**
 * SDR agent (Ian) settings — the system prompt that drives the pre-sales bot,
 * plus the variables it can interpolate. The prompt is the exact text sent to
 * the Ian backend (`/v6/llm/reply`); the lead cadastro + live agenda are
 * appended automatically. `{{variables}}` written in the prompt are substituted
 * per-lead at send time (built-ins always work; custom ones map to custom
 * fields). Writes go through the admin-gated `/api/sdr/config` route.
 */
export function AgentPanel() {
  const { canEditSettings, profileLoading } = useAuth();

  const [loaded, setLoaded] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [vars, setVars] = useState<CustomVariable[]>([]);
  const [loadedVars, setLoadedVars] = useState("[]");
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [savingVars, setSavingVars] = useState(false);

  const [newName, setNewName] = useState("");
  const [newFieldId, setNewFieldId] = useState("");
  const [newFallback, setNewFallback] = useState("");

  const [fap01Source, setFap01Source] = useState<'meta' | 'uazapi'>('meta');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/sdr/config");
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as {
          system_prompt: string;
          updated_at: string | null;
          variables: CustomVariable[];
          custom_fields: CustomField[];
          fap01_source: 'meta' | 'uazapi';
        };
        if (cancelled) return;
        setLoaded(data.system_prompt);
        setPrompt(data.system_prompt);
        setUpdatedAt(data.updated_at);
        setVars(data.variables ?? []);
        setLoadedVars(JSON.stringify(data.variables ?? []));
        setCustomFields(data.custom_fields ?? []);
        setFap01Source(data.fap01_source ?? 'meta');
      } catch {
        if (!cancelled) toast.error("Falha ao carregar o agente");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const dirty = loaded !== null && prompt !== loaded;
  const varsDirty = JSON.stringify(vars) !== loadedVars;
  const readOnly = !canEditSettings || profileLoading;

  const unknown = useMemo(
    () => unknownTokens(prompt, vars.map((v) => v.name)),
    [prompt, vars],
  );

  async function handleSavePrompt() {
    if (!dirty || !prompt.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/sdr/config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ system_prompt: prompt }),
      });
      if (!res.ok) {
        const { error } = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(error ?? String(res.status));
      }
      setLoaded(prompt);
      setUpdatedAt(new Date().toISOString());
      toast.success("Prompt do Ian atualizado");
    } catch (e) {
      toast.error(e instanceof Error ? `Falha ao salvar: ${e.message}` : "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  }

  function handleAddVar() {
    const name = newName.toLowerCase().trim();
    if (!isValidVariableName(name)) {
      toast.error("Nome inválido — use só letras minúsculas, números e _");
      return;
    }
    if (BUILTIN_NAMES.includes(name)) {
      toast.error(`"${name}" já é uma variável embutida`);
      return;
    }
    if (vars.some((v) => v.name === name)) {
      toast.error(`"${name}" já existe`);
      return;
    }
    if (!newFieldId) {
      toast.error("Escolha o campo customizado de origem");
      return;
    }
    setVars([...vars, { name, custom_field_id: newFieldId, fallback: newFallback }]);
    setNewName("");
    setNewFieldId("");
    setNewFallback("");
  }

  async function handleSaveVars() {
    if (!varsDirty) return;
    setSavingVars(true);
    try {
      const res = await fetch("/api/sdr/config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ variables: vars }),
      });
      if (!res.ok) {
        const { error } = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(error ?? String(res.status));
      }
      setLoadedVars(JSON.stringify(vars));
      toast.success("Variáveis salvas");
    } catch (e) {
      toast.error(e instanceof Error ? `Falha ao salvar: ${e.message}` : "Falha ao salvar");
    } finally {
      setSavingVars(false);
    }
  }

  async function handleSaveFap01Source(next: 'meta' | 'uazapi') {
    setFap01Source(next);
    try {
      const res = await fetch('/api/sdr/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fap01_source: next }),
      });
      if (!res.ok) {
        const { error } = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(error ?? String(res.status));
      }
      toast.success('Origem do 1º contato atualizada');
    } catch (e) {
      toast.error(e instanceof Error ? `Falha ao salvar: ${e.message}` : 'Falha ao salvar');
    }
  }

  const fieldName = (id: string) =>
    customFields.find((f) => f.id === id)?.field_name ?? "campo apagado";

  return (
    <section className="max-w-2xl animate-in fade-in-50 duration-200">
      <SettingsPanelHead
        title="Agente SDR (Ian)"
        description="O prompt que comanda o pré-vendas no WhatsApp, e as variáveis que ele preenche por lead. Enviado direto ao cérebro do Ian a cada resposta."
      />

      {/* PROMPT */}
      <TerminalWindow title="settings/agent/system-prompt">
        <p className="border-b border-border px-5 py-2 font-mono text-xs text-muted-foreground">
          # define como o ian qualifica o lead e marca o diagnóstico. use <code>{"{{variavel}}"}</code> pra inserir dados do lead. a mudança vale na próxima mensagem.
        </p>
        <div className="space-y-4 p-5">
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
            {unknown.length > 0 && (
              <div className="flex items-start gap-2 rounded-lg border border-fn-attention/40 bg-fn-attention/10 px-3 py-2 text-xs text-foreground">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-fn-attention" />
                <span>
                  Você usou{" "}
                  {unknown.map((t, i) => (
                    <span key={t}>
                      <code className="font-mono">{`{{${t}}}`}</code>
                      {i < unknown.length - 1 ? ", " : ""}
                    </span>
                  ))}{" "}
                  mas não {unknown.length > 1 ? "são variáveis" : "é variável"} —
                  o Ian vai receber esse texto literal. Crie a variável abaixo ou
                  corrija o nome.
                </span>
              </div>
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
                Só admins da conta podem editar o agente.
              </p>
            )}
          </div>

          {canEditSettings && (
            <Button
              onClick={handleSavePrompt}
              disabled={saving || !dirty || !prompt.trim()}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {saving ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Salvando…
                </>
              ) : (
                "Salvar prompt"
              )}
            </Button>
          )}
        </div>
      </TerminalWindow>

      {/* VARIÁVEIS */}
      <TerminalWindow title="settings/agent/variables" className="mt-4">
        <p className="border-b border-border px-5 py-2 font-mono text-xs text-muted-foreground">
          # escreva <code>{"{{nome}}"}</code> no prompt — o sistema troca pelo valor daquele lead antes de enviar. sem valor, usa o fallback.
        </p>
        <div className="space-y-6 p-5 text-sm">
          {/* Built-in */}
          <div>
            <p className="font-medium text-foreground">Embutidas (sempre funcionam)</p>
            <ul className="mt-2 grid gap-1.5">
              {BUILTIN_VARIABLES.map((v) => (
                <li key={v.name} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <code className="font-mono text-xs text-primary">{`{{${v.name}}}`}</code>
                  <span className="text-muted-foreground">— {v.label}</span>
                  <span className="text-xs text-muted-foreground/70">ex: {v.example}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Custom */}
          <div className="space-y-3">
            <p className="font-medium text-foreground">
              Customizadas (de campos do contato)
            </p>

            {vars.length > 0 && (
              <ul className="space-y-2">
                {vars.map((v) => (
                  <li
                    key={v.name}
                    className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-border bg-muted/40 px-3 py-2"
                  >
                    <code className="font-mono text-xs text-primary">{`{{${v.name}}}`}</code>
                    <span className="text-muted-foreground">→ {fieldName(v.custom_field_id)}</span>
                    {v.fallback && (
                      <span className="text-xs text-muted-foreground/70">
                        fallback: {v.fallback}
                      </span>
                    )}
                    {canEditSettings && (
                      <button
                        type="button"
                        onClick={() => setVars(vars.filter((x) => x.name !== v.name))}
                        className="ml-auto text-muted-foreground hover:text-fn-error"
                        aria-label={`Remover ${v.name}`}
                      >
                        <Trash2 className="size-4" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {canEditSettings && customFields.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Você ainda não tem campos customizados. Crie em{" "}
                <strong>Settings → Fields &amp; tags</strong> pra mapear uma
                variável a eles.
              </p>
            )}

            {canEditSettings && customFields.length > 0 && (
              <div className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-border p-3">
                <div className="grid gap-1">
                  <Label className="text-xs text-muted-foreground">Nome</Label>
                  <input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="plano_atual"
                    className="h-9 w-40 rounded-lg border border-border bg-muted px-2.5 font-mono text-xs text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div className="grid gap-1">
                  <Label className="text-xs text-muted-foreground">Campo do contato</Label>
                  <select
                    value={newFieldId}
                    onChange={(e) => setNewFieldId(e.target.value)}
                    className="h-9 w-44 rounded-lg border border-border bg-muted px-2 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                  >
                    <option value="">escolher…</option>
                    {customFields.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.field_name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-1">
                  <Label className="text-xs text-muted-foreground">Fallback</Label>
                  <input
                    value={newFallback}
                    onChange={(e) => setNewFallback(e.target.value)}
                    placeholder="(opcional)"
                    className="h-9 w-32 rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                  />
                </div>
                <Button type="button" variant="outline" onClick={handleAddVar} className="h-9">
                  <Plus className="size-4" />
                  Adicionar
                </Button>
              </div>
            )}

            {canEditSettings && (
              <Button
                onClick={handleSaveVars}
                disabled={savingVars || !varsDirty}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {savingVars ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Salvando…
                  </>
                ) : (
                  "Salvar variáveis"
                )}
              </Button>
            )}
          </div>

          {/* Auto-injected context (not tokens) */}
          <div className="border-t border-border pt-4 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Anexado automático (não precisa de token)</p>
            <p className="mt-1">
              O cadastro do lead (qualificação FAP01) e os horários reais da
              agenda do Arthur são anexados ao prompt a cada mensagem — o Ian
              usa pra confirmar, nunca re-pergunta.
            </p>
          </div>
        </div>
      </TerminalWindow>

      {/* ORIGEM FAP01 */}
      <TerminalWindow title="settings/agent/origem-fap01" className="mt-4">
        <p className="border-b border-border px-5 py-2 font-mono text-xs text-muted-foreground">
          # canal usado pelo ian para o 1º contato com leads captados (fap01). mude só se o canal oficial estiver indisponível.
        </p>
        <div className="space-y-4 p-5 text-sm">
          <div className="grid gap-2">
            <Label className="text-muted-foreground">Origem do 1º contato (captação/abordagem)</Label>
            <select
              value={fap01Source}
              disabled={readOnly}
              onChange={(e) => handleSaveFap01Source(e.target.value as 'meta' | 'uazapi')}
              className="h-9 w-56 rounded-lg border border-border bg-muted px-2 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
            >
              <option value="meta">Oficial (Meta)</option>
              <option value="uazapi">Não Oficial (UazAPI)</option>
            </select>
            {!canEditSettings && !profileLoading && (
              <p className="text-xs text-muted-foreground">
                Só admins da conta podem alterar a origem.
              </p>
            )}
          </div>
        </div>
      </TerminalWindow>

      {/* MODELO */}
      <TerminalWindow title="settings/agent/model" className="mt-4">
        <p className="border-b border-border px-5 py-2 font-mono text-xs text-muted-foreground">
          # o modelo não é fixo: o cérebro do ian escolhe por mensagem (definido no backend, não editável aqui).
        </p>
        <div className="space-y-2 p-5 text-sm text-muted-foreground">
          <div className="flex items-baseline gap-2">
            <span className="font-medium text-foreground">Sonnet</span>
            <span className="font-mono text-xs">claude-sonnet-4-6</span>
            <span>— raciocínio (SPIN · objeção · gates)</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="font-medium text-foreground">Haiku</span>
            <span className="font-mono text-xs">claude-haiku-4-5</span>
            <span>— saudação · slots · confirmação</span>
          </div>
          <p className="pt-1 text-xs">
            Fallback automático se a Anthropic falhar (Max OAuth → API key → gpt-4o).
          </p>
        </div>
      </TerminalWindow>
    </section>
  );
}
