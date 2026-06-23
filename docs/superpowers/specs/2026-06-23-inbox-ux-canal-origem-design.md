# Inbox UX — header declutter, IA switch, channel/origin selector

> 2026-06-23 · wacrm · branch `feat/uazapi-adapter`
> Three coordinated UI changes in the inbox, plus one small SDR send-path
> adjustment so the IA replies from the same number the human selected.

## Why

After the UazAPI/Ian go-live, three rough edges in the inbox:

1. The conversation header repeats the contact name/phone that the right-hand
   contact panel already shows — visual noise.
2. The IA control (`[🤖 IA Respondendo ▾]` dropdown) reads like a passive
   status pill, not a clear on/off control.
3. There's no way, from the inbox, to choose **which number/channel** answers a
   conversation (this UazAPI number, the official Meta API, or another
   registered number).

## Verified facts (grounding)

- **IA gate is real, two levels.** Inbound webhook only invokes the SDR
  `if (conversation.ai_status === 'on')`; inside `runSdrReply` a second read
  (`if (conv.ai_status !== 'on') return`) re-checks before replying (handles the
  human-flips-mid-message race). Turning the switch off → SDR not invoked.
  Turning it back on → resumes on the **next** inbound message (no retroactive
  replay). The SDR already sets `ai_status='human'` itself on hand-off tags.
- **Origin lives on the contact** (migration 024): `contacts.provider`
  (`'meta' | 'uazapi'`) + `contacts.connection_id` (which UazAPI connection).
- **Manual send already honors it.** `/api/whatsapp/send` routes UazAPI sends
  through `contact.connection_id` (else the account's active connection), and
  Meta sends through the Cloud API. No backend change needed for manual sends.
- **SDR auto-reply does NOT honor it yet.** `runSdrReply` picks the channel via
  `resolveAccountProvider(accountId)` (account's single active connection), not
  the contact's `connection_id`. With one number it's identical; with 2+ it
  would diverge. We fix this (see change D).
- `Switch` UI component exists (`src/components/ui/switch.tsx`). Manual-send
  hook point is `handleSend` in `message-thread.tsx`.

## Changes

### A. Header — drop the duplicate name (`message-thread.tsx`)

The avatar stays as a visual anchor. The name + phone block gets `lg:hidden`
**only when the contact panel is open** (`contactPanelOpen` prop, already
passed). On mobile (`< lg`) the panel never renders, so the name still shows
there; on desktop it shows only when the panel is collapsed. No info lost.

### B. IA control → switch + "Você assumiu" badge (`message-thread.tsx`)

Replace the `AI_STATUS_OPTIONS` dropdown with:

- A **`Switch`** labelled "IA": checked (green) ⇒ `ai_status: 'on'`;
  unchecked ⇒ `ai_status: 'off'`.
- When `ai_status === 'human'`: switch sits in the off position **and** an amber
  badge **"Você assumiu"** renders beside it. Flipping the switch on returns
  control to the IA (`'on'`).
- `onCheckedChange`: `true → handleAiStatusChange('on')`,
  `false → handleAiStatusChange('off')`.
- **Auto-flip (behaviour change):** in `handleSend`, after a successful manual
  reply, if `aiStatus === 'on'` flip it to `'human'` — the human took over, so
  the IA stops auto-replying and the badge appears. Today a manual send does not
  touch `ai_status`. This is the only behaviour change; everything else is
  presentation.
- The 3 model values (`on/human/off`) are unchanged — only the rendering and the
  options dropdown are removed.

### C. Channel/origin selector in the contact panel (`contact-sidebar.tsx`)

New **"Canal de origem"** section:

- On mount (when a contact is active), fetch the available channels for the
  account:
  - **API Oficial (Meta)** — only if a `whatsapp_config` row with a
    `phone_number_id` exists for the account.
  - Each **UazAPI** connection in `wa_connections` (label + base number), via the
    existing `GET /api/accounts/{id}/whatsapp/connections` endpoint (or a direct
    RLS-allowed select).
- Current selection derives from `contact.provider` + `contact.connection_id`.
- On change, update `contacts` directly (same pattern as
  `contact-detail-view.tsx`'s `transferProvider`, extended to set
  `connection_id`):
  - Meta → `{ provider: 'meta', connection_id: null }`
  - UazAPI conn X → `{ provider: 'uazapi', connection_id: X.id }`
- Only channels that actually exist are listed (no dead options). If just one
  channel exists, it renders as the lone (still selectable) option.

### D. SDR replies follow the contact's channel (`sdr/processor.ts` + `sdr/send.ts`)

So the IA answers from the **same** number the human selected:

- `sendText` already accepts an optional `connectionId` (it queries
  `wa_connections` by `id` when given, else by `is_active_for_crm`).
- In `runSdrReply`, when the resolved provider is `uazapi`, pass
  `contact.connection_id` (when set) to `sendText`. When it's null, behaviour is
  unchanged (account active connection).
- `resolveAccountProvider` still decides meta-vs-uazapi at the account level;
  this only refines *which* UazAPI connection when the contact pins one.

## Out of scope

- No change to the inbound normalizer or the Meta send path.
- No new media/template support over UazAPI.
- No per-conversation channel field (origin stays on the contact, per 024).

## Testing

- **Pure logic:** the "build channel list from (whatsapp_config, wa_connections)
  + current contact" mapping is extracted to a small pure helper and unit-tested
  (vitest): Meta-only, UazAPI-only, both, none, and current-selection
  resolution.
- **Behaviour (manual, by effect on deploy):**
  - Toggle IA off → lead message → no SDR reply. Toggle on → next message →
    SDR replies.
  - Manual reply while IA on → `ai_status` flips to `human`, badge shows.
    (Note: this auto-flip is implemented as part of change B via `handleSend`.)
  - Select a channel in the panel → manual reply goes out from that channel;
    with the SDR on, the IA reply also goes from that channel (change D).
- `tsc --noEmit` clean; full vitest suite green (pre-existing currency/date-utils
  failures are locale/timezone, unrelated).

## Deploy

`rsync ~/Projects/wacrm → /opt/wacrm` + `docker compose build/up wacrm` on
`srv1571722`. Verify by effect (homepage 307, container Up, manual toggle/send).
