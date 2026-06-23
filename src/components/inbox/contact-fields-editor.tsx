"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Contact } from "@/types";
import {
  FAP01_EDITABLE_FIELDS,
  FAP01_LOCKED_FIELDS,
  mergeFap01,
} from "@/lib/contacts/fap01-fields";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { ClipboardList, Lock } from "lucide-react";

interface ContactFieldsEditorProps {
  contact: Contact;
  onSaved?: (patch: Partial<Contact>) => void;
}

type FormState = Record<string, string | boolean>;

// Seed a flat, editable form from the contact's columns + fap01_data. Booleans
// stay booleans (Switch); everything else is edited as a string.
function seedForm(contact: Contact): FormState {
  const f: FormState = {
    name: contact.name ?? "",
    email: contact.email ?? "",
    company: contact.company ?? "",
  };
  const data = contact.fap01_data ?? {};
  for (const field of FAP01_EDITABLE_FIELDS) {
    const raw = data[field.key];
    if (field.type === "bool") {
      f[field.key] = raw === true;
    } else {
      f[field.key] = raw == null ? "" : String(raw);
    }
  }
  return f;
}

export function ContactFieldsEditor({ contact, onSaved }: ContactFieldsEditorProps) {
  const initial = useMemo(() => seedForm(contact), [contact]);
  const [form, setForm] = useState<FormState>(initial);
  const [saving, setSaving] = useState(false);

  // Re-seed when the contact changes (switching conversations).
  const [seededFor, setSeededFor] = useState(contact.id);
  if (seededFor !== contact.id) {
    setSeededFor(contact.id);
    setForm(initial);
  }

  const dirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(initial),
    [form, initial],
  );

  const set = (key: string, value: string | boolean) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  async function handleSave() {
    setSaving(true);
    // Coerce the editable fap01 fields back to their types for the merge.
    const edits: Record<string, unknown> = {};
    for (const field of FAP01_EDITABLE_FIELDS) {
      const v = form[field.key];
      if (field.type === "bool") {
        edits[field.key] = v === true;
      } else if (field.type === "number") {
        const s = String(v).trim();
        edits[field.key] = s === "" ? null : Number(s);
      } else {
        const s = String(v).trim();
        edits[field.key] = s === "" ? null : s;
      }
    }
    const patch = {
      name: String(form.name).trim() || null,
      email: String(form.email).trim() || null,
      company: String(form.company).trim() || null,
      fap01_data: mergeFap01(contact.fap01_data, edits),
      updated_at: new Date().toISOString(),
    };
    const supabase = createClient();
    const { error } = await supabase
      .from("contacts")
      .update(patch)
      .eq("id", contact.id);
    setSaving(false);
    if (error) {
      toast.error("Falha ao salvar os dados do contato");
    } else {
      toast.success("Dados do contato salvos");
      onSaved?.(patch as Partial<Contact>);
    }
  }

  // Locked rows only render when they actually carry a value.
  const lockedRows = FAP01_LOCKED_FIELDS.map((f) => ({
    label: f.label,
    value: contact.fap01_data?.[f.key],
  })).filter((r) => r.value != null && String(r.value).trim() !== "");

  return (
    <div>
      <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        <ClipboardList className="h-3 w-3" />
        Dados do contato
      </div>

      <div className="mt-2 space-y-2">
        <Field label="Nome">
          <Input
            value={form.name as string}
            onChange={(e) => set("name", e.target.value)}
            className="h-8 border-border bg-muted text-sm"
          />
        </Field>
        <Field label="Email">
          <Input
            value={form.email as string}
            onChange={(e) => set("email", e.target.value)}
            className="h-8 border-border bg-muted text-sm"
          />
        </Field>
        <Field label="Empresa">
          <Input
            value={form.company as string}
            onChange={(e) => set("company", e.target.value)}
            className="h-8 border-border bg-muted text-sm"
          />
        </Field>

        {FAP01_EDITABLE_FIELDS.map((field) =>
          field.type === "bool" ? (
            <div
              key={field.key}
              className="flex items-center justify-between gap-2 px-1 py-1"
            >
              <span className="text-xs text-muted-foreground">{field.label}</span>
              <Switch
                checked={form[field.key] === true}
                onCheckedChange={(v) => set(field.key, v)}
                aria-label={field.label}
              />
            </div>
          ) : (
            <Field key={field.key} label={field.label}>
              <Input
                type={field.type === "number" ? "number" : "text"}
                value={form[field.key] as string}
                onChange={(e) => set(field.key, e.target.value)}
                className="h-8 border-border bg-muted text-sm"
              />
            </Field>
          ),
        )}
      </div>

      {lockedRows.length > 0 && (
        <div className="mt-3 rounded-md border border-border/60 bg-muted/40 p-2">
          <div className="flex items-center gap-1.5 px-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            <Lock className="h-2.5 w-2.5" />
            Origem (não editável)
          </div>
          <div className="mt-1.5 space-y-1">
            {lockedRows.map((r) => (
              <div
                key={r.label}
                className="flex items-center justify-between gap-2 px-1 text-xs"
              >
                <span className="text-muted-foreground">{r.label}</span>
                <span className="truncate text-right text-foreground">
                  {String(r.value)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <Button
        size="sm"
        onClick={handleSave}
        disabled={!dirty || saving}
        className="mt-3 w-full"
      >
        {saving ? "Salvando…" : "Salvar"}
      </Button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block px-1">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <div className="mt-0.5">{children}</div>
    </label>
  );
}
