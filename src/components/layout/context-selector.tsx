"use client";

interface ContextOption {
  key: string;
  label: string;
  hint: string;
  active: boolean;
}

// Só "Minha Empresa" é funcional nesta fatia; os demais contextos
// (Meus Clientes / Workspace / Admin) entram em fatias futuras.
const CONTEXTS: ContextOption[] = [
  { key: "mine", label: "Minha Empresa", hint: "tenant zero", active: true },
  { key: "clients", label: "Meus Clientes", hint: "em breve", active: false },
  { key: "workspace", label: "Workspace Cliente", hint: "em breve", active: false },
  { key: "admin", label: "Admin", hint: "em breve", active: false },
];

export function ContextSelector() {
  return (
    <div className="mb-4">
      <p className="mb-2 px-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        Contexto
      </p>
      <div className="flex flex-col gap-1">
        {CONTEXTS.map((c) => (
          <button
            key={c.key}
            type="button"
            disabled={!c.active}
            aria-current={c.active ? "true" : undefined}
            title={c.active ? undefined : "Em breve"}
            className={
              c.active
                ? "flex items-center justify-between gap-2 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 font-mono text-sm font-medium text-primary"
                : "flex cursor-not-allowed items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 font-mono text-sm font-medium text-muted-foreground opacity-60"
            }
          >
            <span>{c.label}</span>
            <span
              className={
                c.active
                  ? "text-[9px] uppercase tracking-wider text-primary/70"
                  : "rounded-full border border-border px-1.5 py-0.5 text-[9px] uppercase tracking-wider"
              }
            >
              {c.hint}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
