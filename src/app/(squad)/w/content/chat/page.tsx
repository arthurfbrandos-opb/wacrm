"use client";

// Chat do squad — o cliente pede peça/ajuste conversando. A mensagem vira job
// na fila; o worker responde aqui e a peça cai no kanban "Pra aprovar".
// Polling simples (4s) — mesmo padrão do painel: sem SSE, sem websocket.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { TerminalWindow } from "@/components/ui/terminal-window";
import { createClient } from "@/lib/supabase/client";

interface ChatMessage {
  id: string;
  author: "cliente" | "squad";
  body: string;
  piece_id: string | null;
  created_at: string;
}

const TIME_FMT = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });

export default function SquadContentChatPage() {
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [working, setWorking] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const countRef = useRef(0);

  // Poll de mensagens + jobs em andamento (indicador "produzindo…").
  useEffect(() => {
    let alive = true;
    const supabase = createClient();
    const tick = async () => {
      const [msgs, jobs] = await Promise.all([
        supabase
          .from("content_chat_messages")
          .select("id, author, body, piece_id, created_at")
          .order("created_at", { ascending: true })
          .limit(200),
        supabase.from("content_jobs").select("id").in("status", ["pending", "running"]).limit(1),
      ]);
      if (!alive) return;
      if (msgs.error) {
        setError(msgs.error.message);
        return;
      }
      setError(null);
      setMessages((msgs.data ?? []) as ChatMessage[]);
      setWorking((jobs.data ?? []).length > 0);
    };
    void tick();
    const id = setInterval(tick, 4000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // Auto-scroll só quando chega mensagem nova (não a cada poll).
  useEffect(() => {
    const count = messages?.length ?? 0;
    if (count !== countRef.current) {
      countRef.current = count;
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  const send = async () => {
    const message = draft.trim();
    if (!message || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/workspace/content/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setDraft("");
      setWorking(true);
      // Eco otimista — o poll seguinte traz a versão do banco.
      setMessages((m) => [
        ...(m ?? []),
        {
          id: `otimista-${Date.now()}`,
          author: "cliente",
          body: message,
          piece_id: null,
          created_at: new Date().toISOString(),
        },
      ]);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col gap-4">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-primary">
          Squad Content · Chat
        </p>
        <h1 className="mt-1 font-mono text-2xl font-semibold tracking-tight text-foreground">Fale com o squad</h1>
        <p className="mt-1 max-w-2xl font-mono text-sm text-muted-foreground">
          Peça uma peça nova, um ajuste ou tire dúvida — a produção cai no kanban pra sua aprovação.
        </p>
      </div>

      <TerminalWindow
        title="squad/chat"
        className="min-h-64 flex-1"
        bodyClassName="flex min-h-0 flex-col gap-3 overflow-y-auto p-4"
      >
        {messages === null ? (
          <p className="font-mono text-sm text-muted-foreground">carregando…</p>
        ) : messages.length === 0 ? (
          <div className="flex flex-col gap-3">
            <p className="font-mono text-sm text-muted-foreground">
              ▸ Nenhuma conversa ainda. É uma conversa contínua — o squad lembra do
              contexto. Alguns começos:
            </p>
            <div className="flex flex-wrap gap-2">
              {[
                "monta a pauta da semana",
                "gera um carrossel sobre juros abusivos em financiamento",
                "gera um estático sobre bloqueio de conta",
              ].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setDraft(s)}
                  className="rounded-full border border-border bg-card px-3 py-1.5 font-mono text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={
                m.author === "cliente"
                  ? "ml-auto max-w-[85%] rounded-xl rounded-br-sm border border-primary/40 bg-primary/10 px-3 py-2"
                  : "mr-auto max-w-[85%] rounded-xl rounded-bl-sm border border-border bg-card/40 px-3 py-2"
              }
            >
              <p className="whitespace-pre-wrap text-sm text-foreground">{m.body}</p>
              <div className="mt-1 flex items-center justify-between gap-3">
                <span className="font-mono text-[10px] text-muted-foreground">
                  {m.author === "cliente" ? "você" : "squad"} · {TIME_FMT.format(new Date(m.created_at))}
                </span>
                {m.piece_id ? (
                  <Link
                    href={`/w/content/pecas/${m.piece_id}`}
                    className="font-mono text-[10px] text-primary hover:underline"
                  >
                    ver peça ▸
                  </Link>
                ) : null}
              </div>
            </div>
          ))
        )}
        {working ? (
          <div className="mr-auto flex items-center gap-2 rounded-xl border border-border bg-card/40 px-3 py-2">
            <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
            <span className="font-mono text-xs text-muted-foreground">squad produzindo…</span>
          </div>
        ) : null}
        <div ref={bottomRef} />
      </TerminalWindow>

      {error ? <p className="text-xs text-destructive">Falha: {error}</p> : null}

      <div className="flex items-end gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={2}
          maxLength={2000}
          placeholder="Escreva pro squad… (Enter envia · Shift+Enter quebra linha)"
          className="flex-1 resize-none rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/50 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={sending || !draft.trim()}
          aria-label="Enviar"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/40 bg-primary/10 text-primary transition-colors hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
