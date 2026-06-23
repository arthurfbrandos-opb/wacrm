# Contact sidebar v2 + collapsible left list

> 2026-06-23 · wacrm · branch `feat/uazapi-adapter`
> Builds on the inbox UX work (`2026-06-23-inbox-ux-canal-origem-design.md`).
> Five changes: editable form data, tag assign+quick-create, deal
> pipeline/stage migration, channel label confirmation, and a collapsible
> left conversation list.

## Decisions (locked with Arthur)

1. **Form data (`fap01_data`)** — EDITABLE: `name`, `email`, `company` (top-level
   columns) + the quiz/cadastro answers (`faturamento_range`, `nicho`,
   `tem_socio`, `processo_foco`, `urgencia`, `num_funcionarios`, `company_city`,
   `company_state`) + **`mql`** (toggle, "caso a gente mude de ideia").
   READ-ONLY (origin/attribution, must never change): `source_utm_source`,
   `source_utm_medium`, `source_utm_campaign`, `source_referrer`, `attribution`,
   `passed_lowtier_gate`, `funnel_stage`.
2. **Active Deals** — enforce 1 contact = 1 deal: show the single deal with
   pipeline + stage selectors to migrate in place; if the contact has no deal,
   a "Criar deal" button creates one (default: first pipeline + its first stage).
3. **Tags** — assign existing tags + quick-create (name + color from the
   `tag-manager` PRESET_COLORS palette); creating applies it to the contact.
4. **Canal de origem** — keep as built: option label = the connection's `label`
   (the instance name set at registration); switchable only with 2+ channels.
   No change needed.
5. **Left list** — collapsible on lg+, mirroring the right contact panel
   (toggle in the thread header, persisted in localStorage).

## Component breakdown (keep the sidebar a thin composition)

`contact-sidebar.tsx` already does channel + notes; adding editable forms, tags,
and deals inline would bloat it. Extract focused children, each owning its data
and writes:

- `contact-fields-editor.tsx` — name/email/company + fap01 quiz fields
  (editable) and the locked attribution block (read-only). Props: `contact`,
  `onSaved`.
- `contact-tags-editor.tsx` — current tags (removable) + an "add" popover
  listing existing tags and a quick-create row (name + color swatches). Props:
  `contactId`, `accountId`.
- `contact-deal-editor.tsx` — the contact's single deal: pipeline + stage
  selects, or a "Criar deal" button when none. Props: `contactId`, `accountId`.

The sidebar composes these under their section headers and keeps the contact
header, phone/email, and channel selector it already has.

## Details

### Form fields editor

- Renders text inputs for string fields, a `Switch` for booleans (`tem_socio`,
  `mql`), a number input for `urgencia`. PT-BR labels (Faturamento, Nicho, Tem
  sócio?, Processo foco, Urgência, Nº de funcionários, Cidade, Estado, MQL).
- Edit-in-place with a single "Salvar" affordance per the section (dirty-state
  enabled). Save = `update contacts set name/email/company` (columns) +
  `fap01_data = { ...existing, ...editedQuizFields }` (merge, never drop the
  locked keys). Optimistic + toast.
- Locked block: render `source_utm_*`, `source_referrer` as read-only rows
  (muted, no input). `attribution` shown compactly only if present (read-only).
  Empty locked fields are hidden (no blank rows).

### Tags editor

- Reuse the assign/unassign pattern from `contact-detail-view`: insert/delete
  `contact_tags`. List existing tags via `tags` (account-scoped, RLS).
- Quick-create: name input + the 8 PRESET_COLORS swatches → `insert tags
  { account_id, name, color }` then assign. Refresh local list. Dedupe by name
  (case-insensitive) to avoid duplicates.

### Deal editor

- Load the contact's deal: `deals select *, stage:pipeline_stages(*)` where
  `contact_id`. Rule says ≤1; if >1 (legacy), show the most recent and log a
  warning (no destructive merge here).
- Pipeline select (all `pipelines` with `stages`) + stage select (stages of the
  chosen pipeline). Changing writes `update deals set pipeline_id, stage_id`.
  Switching pipeline resets stage to that pipeline's first stage.
- No deal → "Criar deal" → `insert deals { account_id, contact_id, pipeline_id:
  firstPipeline.id, stage_id: firstStage.id }`. Then render the selectors.

### Left list collapse

- New `listCollapsed` state in the inbox page (default false), persisted to a
  `LIST_PANEL_STORAGE_KEY` localStorage key, reconciled after mount (same
  hydration-safe pattern as `contactPanelOpen`).
- A toggle in the thread header left cluster (PanelLeftClose / PanelLeftOpen),
  lg+ only (mobile already swaps list/thread by active conversation). When
  collapsed, the left `<div>` wrapping `ConversationList` gets `lg:hidden`.

## Out of scope

- No bulk tag management / tag editing (lives in Settings).
- No deal deletion or multi-deal merge UI (just surface most-recent if a legacy
  duplicate exists).
- No change to FAP01 ingestion, the normalizer, or send paths.
- Phone stays read-only (account-unique key).

## Testing

- **Pure logic (vitest):** the editable-vs-locked field partition for
  `fap01_data` extracted to a small pure module + tested (which keys are
  editable, merge preserves locked keys). Tag name-dedupe helper tested.
- **Behaviour (manual, by effect on deploy):** edit a quiz field + save →
  persists, UTM rows are read-only; add an existing tag + quick-create a new
  one → both apply; change a deal's pipeline/stage → persists; create a deal
  when none → appears; collapse/expand the left list → persists across reload.
- `tsc` clean; full vitest suite green (pre-existing currency/date-utils
  locale failures unrelated).

## Deploy

`rsync → /opt/wacrm` + `docker compose build/up wacrm` on `srv1571722`. Verify
by effect (307, container Up, manual checks above).
