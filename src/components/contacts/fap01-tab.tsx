import type { Fap01Data } from '@/types';

/** One labelled section of FAP01 fields; renders nothing if all rows are empty. */
export function Fap01Section({
  title,
  rows,
}: {
  title: string;
  rows: [string, string | null][];
}) {
  const present = rows.filter(([, v]) => v != null && v !== '');
  if (present.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {title}
      </p>
      <dl className="mt-2 space-y-1.5">
        {present.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-3 text-sm">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="text-right text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Read-only view of the FAP01 funnel payload (cadastro/quiz + UTMs). */
export function Fap01Tab({ data }: { data?: Fap01Data | null }) {
  if (!data) {
    return (
      <p className="text-xs text-muted-foreground">
        Esse contato não veio pelo funil FAP01 — sem dados de origem.
      </p>
    );
  }

  const yesNo = (v: unknown) =>
    typeof v === 'boolean' ? (v ? 'Sim' : 'Não') : null;
  const cidadeUf = [data.company_city, data.company_state].filter(Boolean).join('/');

  const qual: [string, string | null][] = [
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
  const origem: [string, string | null][] = [
    ['utm_source', data.source_utm_source ?? null],
    ['utm_medium', data.source_utm_medium ?? null],
    ['utm_campaign', data.source_utm_campaign ?? null],
    ['Referrer', data.source_referrer ?? null],
    ['Cidade/UF', cidadeUf || null],
  ];

  return (
    <div className="space-y-5">
      <Fap01Section title="Qualificação (quiz)" rows={qual} />
      <Fap01Section title="Origem / UTMs" rows={origem} />
    </div>
  );
}
