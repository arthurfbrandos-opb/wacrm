"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface ContextOption {
  key: string;
  label: string;
  hint: string;
  /** Rota-destino quando o contexto é navegável; ausente = "em breve". */
  href?: string;
}

// "Minha Empresa" (wacrm/tenant zero) e "Workspace Cliente" (fatia 01/07) são
// funcionais; Meus Clientes / Admin entram em fatias futuras.
const CONTEXTS: ContextOption[] = [
  { key: "mine", label: "Minha Empresa", hint: "tenant zero", href: "/dashboard/os" },
  { key: "clients", label: "Meus Clientes", hint: "em breve" },
  { key: "workspace", label: "Workspace Cliente", hint: "workspace", href: "/w" },
  { key: "admin", label: "Admin", hint: "em breve" },
];

export function ContextSelector() {
  const pathname = usePathname();
  // Contexto corrente inferido pela rota: /w ou /w/* = workspace; resto = minha empresa.
  const currentKey = pathname === "/w" || pathname.startsWith("/w/") ? "workspace" : "mine";

  return (
    <div className="mb-4">
      <p className="mb-2 px-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        Contexto
      </p>
      <div className="flex flex-col gap-1">
        {CONTEXTS.map((c) => {
          const isCurrent = c.key === currentKey;
          if (c.href) {
            return (
              <Link
                key={c.key}
                href={c.href}
                aria-current={isCurrent ? "true" : undefined}
                className={
                  isCurrent
                    ? "flex items-center justify-between gap-2 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 font-mono text-sm font-medium text-primary"
                    : "flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 font-mono text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                }
              >
                <span>{c.label}</span>
                <span
                  className={
                    isCurrent
                      ? "text-[9px] uppercase tracking-wider text-primary/70"
                      : "rounded-full border border-border px-1.5 py-0.5 text-[9px] uppercase tracking-wider"
                  }
                >
                  {c.hint}
                </span>
              </Link>
            );
          }
          return (
            <button
              key={c.key}
              type="button"
              disabled
              title="Em breve"
              className="flex cursor-not-allowed items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 font-mono text-sm font-medium text-muted-foreground opacity-60"
            >
              <span>{c.label}</span>
              <span className="rounded-full border border-border px-1.5 py-0.5 text-[9px] uppercase tracking-wider">
                {c.hint}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
