import type { Deal, Fap01Data } from "@/types";

export type Fap01Snapshot = Fap01Data;

// `key` é string (não `keyof Fap01Snapshot`): o tipo Fap01Data não declara
// todas as chaves do payload (contact_name/contact_email/company_name vêm do
// lead), e o acesso é por indexação string em runtime.
export const UNIFY_FIELDS: { key: string; label: string }[] = [
  { key: "contact_name", label: "Nome" },
  { key: "contact_email", label: "Email" },
  { key: "company_name", label: "Empresa" },
  { key: "faturamento_range", label: "Faturamento" },
  { key: "nicho", label: "Nicho" },
  { key: "processo_foco", label: "Processo foco" },
  { key: "urgencia", label: "Urgência" },
  { key: "tem_socio", label: "Sócio" },
];

type DealLite = Pick<Deal, "contact_id" | "status" | "fap01_snapshot">;

/** Contatos com ≥2 deals ABERTOS que vieram do funil (têm snapshot). */
export function duplicateContactIds(deals: DealLite[]): Set<string> {
  const counts = new Map<string, number>();
  for (const d of deals) {
    if (d.status !== "open" || !d.fap01_snapshot || !d.contact_id) continue;
    counts.set(d.contact_id, (counts.get(d.contact_id) ?? 0) + 1);
  }
  const set = new Set<string>();
  for (const [id, n] of counts) if (n >= 2) set.add(id);
  return set;
}

const asText = (v: unknown): string =>
  v == null ? "" : typeof v === "boolean" ? (v ? "Sim" : "Não") : String(v);

export interface DiffRow {
  key: string;
  label: string;
  oldValue: string;
  newValue: string;
  diverges: boolean;
}

export function diffSnapshots(
  oldSnap: Fap01Snapshot,
  newSnap: Fap01Snapshot,
): DiffRow[] {
  return UNIFY_FIELDS.map(({ key, label }) => {
    const oldValue = asText((oldSnap as Record<string, unknown>)[key]);
    const newValue = asText((newSnap as Record<string, unknown>)[key]);
    return { key, label, oldValue, newValue, diverges: oldValue !== newValue };
  });
}

export interface UnifyPatch {
  name: string | null;
  email: string | null;
  company: string | null;
  fap01_data: Fap01Snapshot;
}

/** Patch final do contato. Base = snapshot NOVO (UTM/atribuição = mais novo);
 *  campos escolhidos como 'old' são sobrescritos pelo valor antigo. */
export function buildUnifyPatch(
  oldSnap: Fap01Snapshot,
  newSnap: Fap01Snapshot,
  choices: Record<string, "old" | "new">,
): UnifyPatch {
  const merged: Record<string, unknown> = { ...(newSnap as object) };
  for (const { key } of UNIFY_FIELDS) {
    if (choices[key as string] === "old") {
      merged[key as string] = (oldSnap as Record<string, unknown>)[key];
    }
  }
  const str = (v: unknown) => (v == null || v === "" ? null : String(v));
  return {
    name: str(merged.contact_name),
    email: str(merged.contact_email),
    company: str(merged.company_name),
    fap01_data: merged as Fap01Snapshot,
  };
}
