import type { Fap01Data } from '@/types';

/** One labelled section. Title in solid white/bold; rows in the normal
 *  muted-label / foreground-value pairing. */
function Fap01Section({
  title,
  rows,
}: {
  title: string;
  rows: [string, string | null][];
}) {
  const present = rows.filter(([, v]) => v != null && v !== '');
  if (present.length === 0) {
    return <p className="text-xs text-muted-foreground">Sem dados.</p>;
  }
  return (
    <div>
      <p className="mb-2 text-sm font-semibold text-foreground">{title}</p>
      <dl className="space-y-1.5">
        {present.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-3 text-sm">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="break-all text-right text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

const yesNo = (v: unknown) =>
  typeof v === 'boolean' ? (v ? 'Sim' : 'Não') : null;

function emptyState() {
  return (
    <p className="text-xs text-muted-foreground">
      Esse contato não veio pelo funil FAP01 — sem dados de origem.
    </p>
  );
}

/** Cadastro / quiz answers from the FAP01 funnel. */
export function Fap01Cadastro({ data }: { data?: Fap01Data | null }) {
  if (!data) return emptyState();
  const rows: [string, string | null][] = [
    ['Faturamento', data.faturamento_range ?? null],
    ['Funcionários', data.num_funcionarios ?? null],
    ['Nicho', data.nicho ?? null],
    ['Sócio', yesNo(data.tem_socio)],
    ['Processo foco', data.processo_foco ?? null],
    ['Urgência', data.urgencia != null ? String(data.urgencia) : null],
    ['Estágio do funil', data.funnel_stage ?? null],
    ['MQL', yesNo(data.mql)],
    ['Passou o gate', yesNo(data.passed_lowtier_gate)],
  ];
  return <Fap01Section title="Qualificação (quiz)" rows={rows} />;
}

// The funnel sends the rich attribution blob; the top-level source_utm_* are
// often null while the real campaign data lives in attribution.last_touch.utm.
type AttrTouch = {
  utm?: Record<string, string | undefined>;
  referrer?: string;
  landing_url?: string;
};
type Attribution = { last_touch?: AttrTouch; first_touch?: AttrTouch };

/** Lead origin: UTMs + referrer + landing, pulled from the top-level fields
 *  with a fallback to the attribution blob (where they usually really are). */
export function Fap01Utms({ data }: { data?: Fap01Data | null }) {
  if (!data) return emptyState();
  const attr = (data.attribution ?? null) as Attribution | null;
  const touch = attr?.last_touch ?? attr?.first_touch ?? null;
  const utm = touch?.utm ?? {};
  const cidadeUf = [data.company_city, data.company_state].filter(Boolean).join('/');

  const rows: [string, string | null][] = [
    ['utm_source', data.source_utm_source ?? utm.utm_source ?? null],
    ['utm_medium', data.source_utm_medium ?? utm.utm_medium ?? null],
    ['utm_campaign', data.source_utm_campaign ?? utm.utm_campaign ?? null],
    ['utm_content', utm.utm_content ?? null],
    ['Referrer', data.source_referrer ?? touch?.referrer ?? null],
    ['Landing', touch?.landing_url ?? null],
    ['Cidade/UF', cidadeUf || null],
  ];
  return <Fap01Section title="Origem / UTMs" rows={rows} />;
}
