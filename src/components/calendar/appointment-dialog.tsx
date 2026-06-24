"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { Contact } from "@/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

const SP = "America/Sao_Paulo";

/** ISO instant → { date: "YYYY-MM-DD", time: "HH:mm" } in São Paulo wall time. */
function isoToSpParts(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: SP,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: SP,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
  return { date, time };
}

/** SP wall time (date + time) → UTC ISO. Brazil is a fixed UTC-3 (no DST). */
function spPartsToIso(date: string, time: string): string {
  return new Date(`${date}T${time}:00-03:00`).toISOString();
}

export interface AppointmentLite {
  id: string;
  scheduled_at: string;
  notes: string | null;
  contact_id: string;
  deal_id: string | null;
}

interface AppointmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null → create mode. */
  appointment: AppointmentLite | null;
  /** Pre-selected date ("YYYY-MM-DD") when creating from a day cell. */
  defaultDate?: string;
  onSaved: () => void;
}

export function AppointmentDialog({
  open,
  onOpenChange,
  appointment,
  defaultDate,
  onSaved,
}: AppointmentDialogProps) {
  const supabase = createClient();
  const { accountId } = useAuth();

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [deals, setDeals] = useState<{ id: string; title: string }[]>([]);

  const [contactId, setContactId] = useState("");
  const [dealId, setDealId] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("09:00");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Two-click inline confirm instead of window.confirm (which ignores the
  // dark theme and isn't keyboard/screen-reader friendly).
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isEdit = !!appointment;

  // Reset the form whenever the dialog opens — prop-driven sync.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return;
    setConfirmDelete(false);
    if (appointment) {
      const { date: d, time: t } = isoToSpParts(appointment.scheduled_at);
      setContactId(appointment.contact_id);
      setDealId(appointment.deal_id ?? "");
      setDate(d);
      setTime(t);
      setNotes(appointment.notes ?? "");
    } else {
      setContactId("");
      setDealId("");
      setDate(defaultDate ?? isoToSpParts(new Date().toISOString()).date);
      setTime("09:00");
      setNotes("");
    }
  }, [open, appointment, defaultDate]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Load contacts when the dialog opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("contacts").select("*").order("name");
      if (cancelled) return;
      setContacts((data ?? []) as Contact[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, supabase]);

  // Load the chosen contact's deals (optional link).
  useEffect(() => {
    if (!open || !contactId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDeals([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("deals")
        .select("id, title")
        .eq("contact_id", contactId)
        .order("created_at", { ascending: false });
      if (cancelled) return;
      setDeals((data ?? []) as { id: string; title: string }[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, contactId, supabase]);

  async function handleSave() {
    if (!contactId || !date || !time) {
      toast.error("Contato, data e horário são obrigatórios");
      return;
    }
    if (!accountId) {
      toast.error("Seu perfil não está vinculado a uma conta.");
      return;
    }
    setSaving(true);
    const payload = {
      account_id: accountId,
      contact_id: contactId,
      deal_id: dealId || null,
      scheduled_at: spPartsToIso(date, time),
      notes: notes.trim() || null,
    };

    const { error } = isEdit
      ? await supabase.from("appointments").update(payload).eq("id", appointment!.id)
      : await supabase.from("appointments").insert(payload);

    setSaving(false);
    if (error) {
      toast.error(isEdit ? "Falha ao salvar" : "Falha ao criar agendamento");
      return;
    }
    onSaved();
    onOpenChange(false);
    toast.success(isEdit ? "Agendamento atualizado" : "Agendamento criado");
  }

  async function handleDelete() {
    if (!appointment) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setDeleting(true);
    const { error } = await supabase
      .from("appointments")
      .delete()
      .eq("id", appointment.id);
    setDeleting(false);
    if (error) {
      toast.error("Falha ao excluir");
      return;
    }
    onSaved();
    onOpenChange(false);
    toast.success("Agendamento excluído");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-popover border-border">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">
            {isEdit ? "Editar agendamento" : "Novo agendamento"}
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label className="text-muted-foreground">Contato</Label>
            <select
              value={contactId}
              onChange={(e) => setContactId(e.target.value)}
              className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary"
            >
              <option value="">Selecione um contato</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name || c.phone}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label className="text-muted-foreground">Data</Label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary"
              />
            </div>
            <div className="grid gap-2">
              <Label className="text-muted-foreground">Horário</Label>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary"
              />
            </div>
          </div>

          {deals.length > 0 && (
            <div className="grid gap-2">
              <Label className="text-muted-foreground">Negócio (opcional)</Label>
              <select
                value={dealId}
                onChange={(e) => setDealId(e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary"
              >
                <option value="">Nenhum</option>
                {deals.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="grid gap-2">
            <Label className="text-muted-foreground">Observações</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Link da reunião, contexto, etc."
              className="min-h-20 bg-muted border-border text-foreground"
            />
          </div>
        </div>

        <DialogFooter className="bg-popover/50 border-border sm:justify-between">
          {isEdit ? (
            <Button
              variant="outline"
              onClick={handleDelete}
              disabled={deleting || saving}
              className={
                confirmDelete
                  ? "border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20 hover:text-red-300"
                  : "border-border text-red-400 hover:bg-red-500/10 hover:text-red-400"
              }
            >
              <Trash2 className="h-4 w-4" />
              {deleting
                ? "Excluindo..."
                : confirmDelete
                  ? "Confirmar exclusão"
                  : "Excluir"}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              Cancelar
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving || !contactId}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {saving ? "Salvando..." : "Salvar"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
