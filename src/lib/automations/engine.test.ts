import { describe, it, expect, beforeEach, vi } from "vitest";

// Shared mock state for the service-role client. Lives in a hoisted block
// so the vi.mock factory below can close over it.
const h = vi.hoisted(() => ({
  state: {
    owned: null as { id: string } | null,
    ownedCustomField: null as { id: string } | null,
    automations: [] as Record<string, unknown>[],
    steps: [] as Record<string, unknown>[],
    fromCalls: [] as string[],
    updateCalls: [] as { table: string; filters: [string, string, unknown][] }[],
    upsertCalls: [] as { table: string; payload: unknown }[],
    deleteCalls: [] as { table: string; filters: [string, string, unknown][] }[],
    insertCalls: [] as { table: string; payload: unknown }[],
    // Canal/janela (send_ai window-aware): conversa da régua + conexão UazAPI
    // ativa da conta (null = conta Meta-only).
    conversation: null as { last_inbound_at: string | null } | null,
    waConnection: { id: "wa1" } as { id: string } | null,
  },
}));

vi.mock("./admin-client", () => {
  const { state } = h;

  function resolve(ops: {
    table: string;
    type: string;
    payload?: unknown;
    filters: [string, string, unknown][];
  }) {
    const { table, type } = ops;
    if (table === "contacts") {
      if (type === "update") {
        state.updateCalls.push({ table, filters: ops.filters });
        return { data: null, error: null };
      }
      // ownership guard / condition read
      return { data: state.owned, error: null };
    }
    if (table === "custom_fields") {
      // account-scoped ownership lookup for a custom field definition
      return { data: state.ownedCustomField, error: null };
    }
    if (table === "contact_custom_values") {
      if (type === "upsert") {
        state.upsertCalls.push({ table, payload: ops.payload });
        return { data: null, error: null };
      }
      return { data: null, error: null };
    }
    if (table === "automations") return { data: state.automations, error: null };
    if (table === "automation_pending_executions") {
      if (type === "delete") {
        state.deleteCalls.push({ table, filters: ops.filters });
        return { data: [{ id: "p1" }], error: null };
      }
      if (type === "insert") {
        state.insertCalls.push({ table, payload: ops.payload });
        return { data: null, error: null };
      }
      if (type === "update") {
        state.updateCalls.push({ table, filters: ops.filters });
        return { data: null, error: null };
      }
      return { data: [], error: null };
    }
    if (table === "conversations") {
      return { data: state.conversation, error: null };
    }
    if (table === "wa_connections") {
      return { data: state.waConnection, error: null };
    }
    if (table === "whatsapp_config") {
      return { data: { account_id: "acct-1" }, error: null };
    }
    if (table === "contact_notes") {
      if (type === "insert") {
        state.insertCalls.push({ table, payload: ops.payload });
        return { data: null, error: null };
      }
      return { data: null, error: null };
    }
    if (table === "automation_logs") {
      if (type === "insert") return { data: { id: "log1" }, error: null };
      if (type === "update") return { data: null, error: null };
      return { data: { steps_executed: [], status: "success" }, error: null };
    }
    if (table === "automation_steps") return { data: state.steps, error: null };
    if (table === "deals") {
      if (type === "update") {
        state.updateCalls.push({ table, filters: ops.filters });
        return { data: null, error: null };
      }
      return { data: null, error: null };
    }
    if (table === "sdr_config") {
      return { data: { system_prompt: "Você é o Ian.", variables: [] }, error: null };
    }
    if (table === "messages") {
      if (type === "insert") {
        state.insertCalls.push({ table, payload: ops.payload });
        return { data: { id: "msg1" }, error: null };
      }
      return { data: [], error: null };
    }
    return { data: null, error: null };
  }

  function builder(table: string) {
    const ops = {
      table,
      type: "select",
      payload: undefined as unknown,
      filters: [] as [string, string, unknown][],
    };
    const b: Record<string, unknown> = {
      select: () => b,
      insert: (p: unknown) => ((ops.type = "insert"), (ops.payload = p), b),
      update: (p: unknown) => ((ops.type = "update"), (ops.payload = p), b),
      delete: () => ((ops.type = "delete"), b),
      upsert: (p: unknown) => ((ops.type = "upsert"), (ops.payload = p), b),
      eq: (k: string, v: unknown) => (ops.filters.push(["eq", k, v]), b),
      gte: () => b,
      is: () => b,
      order: () => b,
      limit: () => b,
      in: (k: string, v: unknown) => (ops.filters.push(["in", k, v]), b),
      single: () => Promise.resolve(resolve(ops)),
      maybeSingle: () => Promise.resolve(resolve(ops)),
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve(resolve(ops)).then(onF, onR),
    };
    return b;
  }

  return {
    supabaseAdmin: () => ({
      from: (t: string) => {
        state.fromCalls.push(t);
        return builder(t);
      },
      rpc: () => Promise.resolve({ error: null }),
    }),
  };
});

vi.mock("./meta-send", () => ({
  engineSendText: vi.fn(async () => ({ whatsapp_message_id: "m1" })),
  engineSendTemplate: vi.fn(async () => ({ whatsapp_message_id: "m1" })),
}));

const sendTextMock = vi.fn(async (..._args: unknown[]) => ({ messageId: "uaz-1" }));
const sendTemplateMock = vi.fn(async (..._args: unknown[]) => ({ messageId: "tpl-1" }));
vi.mock("@/lib/sdr/send", () => ({
  resolveAccountProvider: vi.fn(async () => "uazapi"),
  sendText: (...args: unknown[]) => sendTextMock(...args),
  sendTemplate: (...args: unknown[]) => sendTemplateMock(...args),
  setAccountPresence: vi.fn(async () => {}),
}));
const notifyArthurMock = vi.fn(async (..._args: unknown[]) => {});
vi.mock("@/lib/sdr/notify", () => ({
  notifyArthur: (...args: unknown[]) => notifyArthurMock(...args),
}));
vi.mock("@/lib/pkg/pedro/client", () => ({
  pedroFromEnv: () => ({
    // "MULTIBUBBLE" in the guidance ⇒ a 2-paragraph reply, to exercise bubbling.
    reply: vi.fn(async (system: string) => ({
      text: system.includes("MULTIBUBBLE")
        ? "Primeira linha.\n\nSegunda linha."
        : `GEN:${system.includes("corrido")}`,
    })),
  }),
}));

import { runAutomationsForTrigger, cancelPendingForContact } from "./engine";

const ACCOUNT = "acct-1";

beforeEach(() => {
  h.state.owned = null;
  h.state.ownedCustomField = null;
  h.state.automations = [];
  h.state.steps = [];
  h.state.fromCalls = [];
  h.state.updateCalls = [];
  h.state.upsertCalls = [];
  h.state.deleteCalls = [];
  h.state.insertCalls = [];
  h.state.conversation = null;
  h.state.waConnection = { id: "wa1" };
  sendTextMock.mockClear();
  sendTemplateMock.mockClear();
  notifyArthurMock.mockClear();
  process.env.BUBBLE_DELAY_MS = "0"; // no inter-bubble wait in tests
});

describe("runAutomationsForTrigger — tenant isolation", () => {
  it("refuses to dispatch when the contact is not in the account (GHSA-63cv-2c49-m5v3)", async () => {
    // Ownership lookup returns nothing — the contact belongs to another tenant.
    h.state.owned = null;
    // If the guard failed, this automation would run an update_contact_field step.
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [updateStep()];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "victim-contact-uuid",
      context: { message_text: "manual trigger" },
    });

    // Bailed at the guard: never fetched automations, never wrote a contact.
    expect(h.state.fromCalls).toContain("contacts");
    expect(h.state.fromCalls).not.toContain("automations");
    expect(h.state.updateCalls).toHaveLength(0);
  });

  it("proceeds past the guard when the contact belongs to the account", async () => {
    h.state.owned = { id: "c1" };
    h.state.automations = []; // no matching automations; just prove we got past the guard

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    expect(h.state.fromCalls).toContain("automations");
  });

  it("scopes the update_contact_field write to the automation's account", async () => {
    h.state.owned = { id: "c1" };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [updateStep()];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    expect(h.state.updateCalls).toHaveLength(1);
    const filters = h.state.updateCalls[0].filters;
    expect(filters).toContainEqual(["eq", "id", "c1"]);
    expect(filters).toContainEqual(["eq", "account_id", ACCOUNT]);
  });
});

describe("update_contact_field — custom fields", () => {
  it("upserts contact_custom_values when the field is account-owned", async () => {
    h.state.owned = { id: "c1" };
    h.state.ownedCustomField = { id: "cf1" };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [customStep("custom:cf1", "Premium")];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    // No direct contacts column write for a custom field.
    expect(h.state.updateCalls).toHaveLength(0);
    expect(h.state.upsertCalls).toHaveLength(1);
    expect(h.state.upsertCalls[0].payload).toEqual({
      contact_id: "c1",
      custom_field_id: "cf1",
      value: "Premium",
    });
  });

  it("interpolates {{ vars.* }} into the custom value", async () => {
    h.state.owned = { id: "c1" };
    h.state.ownedCustomField = { id: "cf1" };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [customStep("custom:cf1", "{{ vars.source }}")];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: { vars: { source: "WhatsApp Ad" } },
    });

    expect(h.state.upsertCalls).toHaveLength(1);
    expect(
      (h.state.upsertCalls[0].payload as { value: string }).value,
    ).toBe("WhatsApp Ad");
  });

  it("refuses to write a custom field from another account", async () => {
    h.state.owned = { id: "c1" };
    h.state.ownedCustomField = null; // account-scoped lookup finds nothing
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [customStep("custom:foreign-cf", "x")];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    expect(h.state.upsertCalls).toHaveLength(0);
    expect(h.state.updateCalls).toHaveLength(0);
  });
});

describe("move_deal", () => {
  it("moves the contact's open deal scoped to the account", async () => {
    h.state.owned = { id: "c1" };
    h.state.automations = [{
      id: "a1", account_id: ACCOUNT, user_id: "u1",
      trigger_type: "tag_added", trigger_config: {}, is_active: true,
    }];
    h.state.steps = [{
      id: "s1", automation_id: "a1", step_type: "move_deal",
      position: 0, parent_step_id: null,
      step_config: { pipeline_id: "pl-followup", stage_id: "st-fu1" },
    }];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "tag_added",
      contactId: "c1",
      context: { tag_id: "fu1" },
    });

    const dealUpdates = h.state.updateCalls.filter((u) => u.table === "deals");
    expect(dealUpdates).toHaveLength(1);
    expect(dealUpdates[0].filters).toContainEqual(["eq", "account_id", ACCOUNT]);
    expect(dealUpdates[0].filters).toContainEqual(["eq", "contact_id", "c1"]);
    expect(dealUpdates[0].filters).toContainEqual(["eq", "status", "open"]);
  });
});

describe("send_ai", () => {
  it("generates text with the agent voice + guidance and sends via UazAPI", async () => {
    h.state.owned = { id: "c1", phone: "5511999" } as { id: string };
    h.state.automations = [{
      id: "a1", account_id: ACCOUNT, user_id: "u1",
      trigger_type: "tag_added", trigger_config: {}, is_active: true,
    }];
    h.state.steps = [{
      id: "s1", automation_id: "a1", step_type: "send_ai",
      position: 0, parent_step_id: null,
      step_config: { guidance: "corrido — leve, sem cobrar." },
    }];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "tag_added",
      contactId: "c1",
      context: { conversation_id: "conv1", tag_id: "fu1" },
    });

    expect(sendTextMock).toHaveBeenCalledTimes(1);
    const callArgs = sendTextMock.mock.calls[0] as unknown[];
    // sendText(admin, accountId, {provider, phone}, text)
    expect(callArgs[1]).toBe(ACCOUNT);
    expect((callArgs[2] as { provider: string }).provider).toBe("uazapi");
    expect((callArgs[2] as { phone: string }).phone).toBe("5511999");
    expect(callArgs[3]).toBe("GEN:true");
  });

  it("does NOT replay conversation history (proactive touch), but still persists to the inbox", async () => {
    // A proactive régua touch must follow the diretriz, not continue a possibly
    // concluded thread — so it should never load the conversation history into
    // the brain. It must still persist the generated message to the inbox.
    h.state.owned = { id: "c1", phone: "5511999" } as { id: string };
    h.state.automations = [{
      id: "a1", account_id: ACCOUNT, user_id: "u1",
      trigger_type: "tag_added", trigger_config: {}, is_active: true,
    }];
    h.state.steps = [{
      id: "s1", automation_id: "a1", step_type: "send_ai",
      position: 0, parent_step_id: null,
      step_config: { guidance: "corrido — leve." },
    }];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "tag_added",
      contactId: "c1",
      context: { conversation_id: "conv1", tag_id: "fu1" },
    });

    // messages is touched exactly once: the inbox-persist INSERT. No history SELECT.
    const messageCalls = h.state.fromCalls.filter((t) => t === "messages");
    expect(messageCalls).toHaveLength(1);
    expect(sendTextMock).toHaveBeenCalledTimes(1);
  });

  it("splits the reply into bubbles and sends each separately (no wall-of-text)", async () => {
    h.state.owned = { id: "c1", phone: "5511999" } as { id: string };
    h.state.automations = [{
      id: "a1", account_id: ACCOUNT, user_id: "u1",
      trigger_type: "tag_added", trigger_config: {}, is_active: true,
    }];
    h.state.steps = [{
      id: "s1", automation_id: "a1", step_type: "send_ai",
      position: 0, parent_step_id: null,
      step_config: { guidance: "MULTIBUBBLE" },
    }];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "tag_added",
      contactId: "c1",
      context: { conversation_id: "conv1", tag_id: "fu1" },
    });

    // Two paragraphs ⇒ two separate WhatsApp sends, in order.
    expect(sendTextMock).toHaveBeenCalledTimes(2);
    expect((sendTextMock.mock.calls[0] as unknown[])[3]).toBe("Primeira linha.");
    expect((sendTextMock.mock.calls[1] as unknown[])[3]).toBe("Segunda linha.");
    // Inbox keeps one row with the bubbles joined.
    expect(h.state.fromCalls.filter((t) => t === "messages")).toHaveLength(1);
  });
});

describe("send_ai — Meta window-aware (régua Meta-only)", () => {
  function fu1Automation() {
    return [{
      id: "a1", account_id: ACCOUNT, user_id: "u1",
      trigger_type: "tag_added", trigger_config: {}, is_active: true,
    }];
  }
  function metaLead() {
    // Meta-origin contact on a Meta-only account (no active UazAPI connection).
    h.state.owned = {
      id: "c1", phone: "5511999", name: "João Silva", provider: "meta",
    } as { id: string };
    h.state.waConnection = null;
    h.state.automations = fu1Automation();
  }
  const CTX = { conversation_id: "conv1", tag_id: "fu1" };

  it("window closed + step template → sends the template with the first name, no free text", async () => {
    metaLead();
    h.state.conversation = { last_inbound_at: null }; // lead never replied
    h.state.steps = [{
      id: "s1", automation_id: "a1", step_type: "send_ai",
      position: 0, parent_step_id: null,
      step_config: {
        guidance: "toque leve",
        template: { name: "fu1_toque_1h", lang: "pt_BR", body: "Oi, {{1}}! Sou eu de novo." },
      },
    }];

    await runAutomationsForTrigger({
      accountId: ACCOUNT, triggerType: "tag_added", contactId: "c1", context: CTX,
    });

    expect(sendTemplateMock).toHaveBeenCalledTimes(1);
    const call = sendTemplateMock.mock.calls[0] as unknown[];
    expect(call[1]).toBe(ACCOUNT);
    expect(call[2]).toMatchObject({
      templateName: "fu1_toque_1h",
      languageCode: "pt_BR",
      bodyParams: ["João"],
    });
    expect(sendTextMock).not.toHaveBeenCalled();
    // Inbox persists the RENDERED template body.
    const msgs = h.state.insertCalls.filter((c) => c.table === "messages");
    expect(msgs).toHaveLength(1);
    expect(msgs[0].payload).toMatchObject({ content_text: "Oi, João! Sou eu de novo." });
  });

  it("window closed + NO step template → skips the touch and keeps the chain alive", async () => {
    metaLead();
    h.state.conversation = { last_inbound_at: null };
    h.state.steps = [
      {
        id: "s1", automation_id: "a1", step_type: "send_ai",
        position: 0, parent_step_id: null,
        step_config: { guidance: "toque sem template" },
      },
      {
        id: "s2", automation_id: "a1", step_type: "wait",
        position: 1, parent_step_id: null,
        step_config: { unit: "hours", amount: 2 },
      },
    ];

    await runAutomationsForTrigger({
      accountId: ACCOUNT, triggerType: "tag_added", contactId: "c1", context: CTX,
    });

    expect(sendTemplateMock).not.toHaveBeenCalled();
    expect(sendTextMock).not.toHaveBeenCalled();
    // The following wait step still enqueued — the régua did NOT die.
    const pend = h.state.insertCalls.filter(
      (c) => c.table === "automation_pending_executions",
    );
    expect(pend).toHaveLength(1);
  });

  it("window OPEN → free text in the agent voice via Meta (no template)", async () => {
    metaLead();
    h.state.conversation = { last_inbound_at: new Date().toISOString() };
    h.state.steps = [{
      id: "s1", automation_id: "a1", step_type: "send_ai",
      position: 0, parent_step_id: null,
      step_config: { guidance: "corrido — leve, sem cobrar." },
    }];

    await runAutomationsForTrigger({
      accountId: ACCOUNT, triggerType: "tag_added", contactId: "c1", context: CTX,
    });

    expect(sendTextMock).toHaveBeenCalledTimes(1);
    expect((sendTextMock.mock.calls[0] as unknown[])[2]).toMatchObject({
      provider: "meta",
      phone: "5511999",
    });
    expect(sendTemplateMock).not.toHaveBeenCalled();
  });

  it("send failure → contact note + Arthur notified + pending touches halted (no silent death)", async () => {
    metaLead();
    h.state.conversation = { last_inbound_at: null };
    sendTemplateMock.mockRejectedValueOnce(
      new Error("Meta API error: (#131047) Re-engagement message"),
    );
    h.state.steps = [{
      id: "s1", automation_id: "a1", step_type: "send_ai",
      position: 0, parent_step_id: null,
      step_config: {
        guidance: "toque",
        template: { name: "fu1_toque_1h", lang: "pt_BR", body: "Oi, {{1}}!" },
      },
    }];

    await runAutomationsForTrigger({
      accountId: ACCOUNT, triggerType: "tag_added", contactId: "c1", context: CTX,
    });

    const notes = h.state.insertCalls.filter((c) => c.table === "contact_notes");
    expect(notes).toHaveLength(1);
    expect(String((notes[0].payload as { note_text: string }).note_text)).toMatch(/falhou/i);
    expect(notifyArthurMock).toHaveBeenCalledTimes(1);
    const halted = h.state.updateCalls.filter(
      (u) => u.table === "automation_pending_executions",
    );
    expect(halted).toHaveLength(1);
    expect(halted[0].filters).toContainEqual(["eq", "contact_id", "c1"]);
    expect(halted[0].filters).toContainEqual(["eq", "status", "pending"]);
  });
});

describe("cancel_on_reply", () => {
  it("deletes pending executions for the contact scoped to the account", async () => {
    h.state.automations = [{ id: "a1", account_id: ACCOUNT, cancel_on_reply: true }];
    await cancelPendingForContact(ACCOUNT, "c1");
    const del = h.state.deleteCalls.filter((d) => d.table === "automation_pending_executions");
    expect(del).toHaveLength(1);
    expect(del[0].filters).toContainEqual(["eq", "account_id", ACCOUNT]);
    expect(del[0].filters).toContainEqual(["eq", "contact_id", "c1"]);
    expect(del[0].filters).toContainEqual(["in", "automation_id", ["a1"]]);
  });
});

function automationWithUpdateStep() {
  return {
    id: "a1",
    account_id: ACCOUNT,
    user_id: "u1",
    trigger_type: "new_message_received",
    trigger_config: {},
    is_active: true,
  };
}

function updateStep() {
  return {
    id: "s1",
    automation_id: "a1",
    step_type: "update_contact_field",
    position: 0,
    parent_step_id: null,
    step_config: { field: "company", value: "pwned-by-automation" },
  };
}

function customStep(field: string, value: string) {
  return {
    id: "s1",
    automation_id: "a1",
    step_type: "update_contact_field",
    position: 0,
    parent_step_id: null,
    step_config: { field, value },
  };
}
