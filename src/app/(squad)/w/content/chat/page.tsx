"use client";

// Chat do squad — experiência de chat "de verdade" (padrão claude.ai/ChatGPT):
// conversa ocupa a tela, mensagem do cliente em balão à direita, resposta da
// squad em texto corrido com avatar, indicador de digitação, composer fixo
// embaixo com textarea que cresce. A mensagem vira job na fila; o worker
// responde aqui e a peça cai no kanban "Pra aprovar".
// Polling simples (4s) — mesmo padrão do painel: sem SSE, sem websocket.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowUp, Zap } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

interface ChatMessage {
  id: string;
  author: "cliente" | "squad";
  body: string;
  piece_id: string | null;
  created_at: string;
}

const TIME_FMT = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });

// ── Markdown-lite (sem dependência): **negrito** + listas + parágrafos ──────
function inline(text: string, keyBase: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith("**") && p.endsWith("**") ? (
      <strong key={`${keyBase}-${i}`} className="font-semibold text-foreground">
        {p.slice(2, -2)}
      </strong>
    ) : (
      <span key={`${keyBase}-${i}`}>{p}</span>
    ),
  );
}

function MessageBody({ body }: { body: string }) {
  const lines = body.split("\n");
  const blocks: React.ReactNode[] = [];
  let list: string[] = [];
  let para: string[] = [];

  const flushList = (key: string) => {
    if (!list.length) return;
    blocks.push(
      <ul key={key} className="my-1 flex list-disc flex-col gap-1 pl-5">
        {list.map((item, i) => (
          <li key={i}>{inline(item, `${key}-${i}`)}</li>
        ))}
      </ul>,
    );
    list = [];
  };
  const flushPara = (key: string) => {
    if (!para.length) return;
    blocks.push(
      <p key={key} className="whitespace-pre-wrap">
        {inline(para.join("\n"), key)}
      </p>,
    );
    para = [];
  };

  lines.forEach((raw, i) => {
    const li = raw.match(/^\s*(?:[-•]|\d+[.)])\s+(.*)$/);
    if (li) {
      flushPara(`p-${i}`);
      list.push(li[1]);
    } else if (raw.trim() === "") {
      flushList(`l-${i}`);
      flushPara(`p-${i}`);
    } else {
      flushList(`l-${i}`);
      para.push(raw);
    }
  });
  flushList("l-fim");
  flushPara("p-fim");

  return <div className="flex flex-col gap-2 text-sm leading-relaxed text-foreground">{blocks}</div>;
}

const SUGESTOES = [
  "monta a pauta da semana",
  "gera um carrossel sobre juros abusivos em financiamento",
  "faz um vídeo sobre bloqueio de conta sem aviso",
];

export default function SquadContentChatPage() {
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [working, setWorking] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollKeyRef = useRef("");

  // Poll de mensagens + jobs em andamento (indicador "digitando…").
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

  // Auto-scroll quando muda o nº de mensagens OU o indicador liga/desliga.
  useEffect(() => {
    const key = `${messages?.length ?? 0}·${working}`;
    if (key !== scrollKeyRef.current) {
      scrollKeyRef.current = key;
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, working]);

  // Textarea cresce com o texto (até ~6 linhas), padrão dos chats.
  const autoGrow = () => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };

  const send = async (text?: string) => {
    const message = (text ?? draft).trim();
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
      if (inputRef.current) inputRef.current.style.height = "auto";
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
      inputRef.current?.focus();
    }
  };

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col">
      {/* Conversa — ocupa a tela; só ela rola. */}
      <div className="flex-1 overflow-y-auto pb-4">
        {messages === null ? (
          <p className="pt-8 text-center font-mono text-sm text-muted-foreground">carregando…</p>
        ) : messages.length === 0 && !working ? (
          <div className="flex h-full flex-col items-center justify-center gap-5 px-4 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-primary/30 bg-primary/10 text-primary">
              <Zap className="h-6 w-6" />
            </span>
            <div>
              <h1 className="font-mono text-xl font-semibold tracking-tight text-foreground">
                Fale com a squad
              </h1>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                Peça uma peça nova, um ajuste ou tire dúvida. A conversa é contínua — a
                squad lembra do contexto — e a produção cai em &ldquo;Pra aprovar&rdquo;.
              </p>
            </div>
            <div className="flex max-w-md flex-wrap justify-center gap-2">
              {SUGESTOES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void send(s)}
                  className="rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-5 pt-4">
            {messages.map((m) =>
              m.author === "cliente" ? (
                // Cliente: balão à direita (padrão ChatGPT/claude.ai).
                <div key={m.id} className="flex justify-end pl-10">
                  <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary/15 px-4 py-2.5">
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                      {m.body}
                    </p>
                  </div>
                </div>
              ) : (
                // Squad: avatar + texto corrido (sem balão pesado).
                <div key={m.id} className="flex gap-3 pr-6">
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-primary">
                    <Zap className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <MessageBody body={m.body} />
                    <div className="mt-1.5 flex items-center gap-3">
                      <span className="font-mono text-[10px] text-muted-foreground/70">
                        {TIME_FMT.format(new Date(m.created_at))}
                      </span>
                      {m.piece_id ? (
                        <Link
                          href={`/w/content/pecas/${m.piece_id}`}
                          className="rounded-full border border-primary/40 bg-primary/10 px-2.5 py-0.5 font-mono text-[10px] text-primary transition-colors hover:bg-primary/20"
                        >
                          ver peça ▸
                        </Link>
                      ) : null}
                    </div>
                  </div>
                </div>
              ),
            )}
            {working ? (
              <div className="flex items-center gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-primary">
                  <Zap className="h-3.5 w-3.5" />
                </span>
                <span className="flex items-center gap-1" aria-label="squad trabalhando">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:0ms]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:150ms]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:300ms]" />
                </span>
              </div>
            ) : null}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {error ? <p className="pb-2 text-xs text-destructive">Falha: {error}</p> : null}

      {/* Composer fixo embaixo (padrão claude.ai). */}
      <div className="shrink-0 pb-1">
        <div className="flex items-end gap-2 rounded-2xl border border-border bg-card p-2 shadow-sm focus-within:border-primary/50">
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              autoGrow();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={1}
            maxLength={2000}
            placeholder="Escreva pra squad…"
            className="max-h-40 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={sending || !draft.trim()}
            aria-label="Enviar"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-1.5 text-center font-mono text-[10px] text-muted-foreground/60">
          Enter envia · Shift+Enter quebra linha
        </p>
      </div>
    </div>
  );
}
