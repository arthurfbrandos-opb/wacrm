"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { findTagByName, type TagLike } from "@/lib/contacts/tags";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Tag as TagIcon, Plus, X, Check } from "lucide-react";
import { toast } from "sonner";

// Same palette as the Settings tag-manager. Local copy (8 swatches) to avoid
// coupling to that component; quick-create defaults to the 4th (Emerald).
const PRESET_COLORS = [
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#10b981",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
];

interface ContactTagsEditorProps {
  contactId: string;
  accountId: string | null;
}

export function ContactTagsEditor({ contactId, accountId }: ContactTagsEditorProps) {
  const [allTags, setAllTags] = useState<TagLike[]>([]);
  const [assignedIds, setAssignedIds] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(PRESET_COLORS[3]);
  const [busy, setBusy] = useState(false);

  const fetchTags = useCallback(async () => {
    if (!accountId) return;
    const supabase = createClient();
    const [tagsRes, ctRes] = await Promise.all([
      supabase
        .from("tags")
        .select("id, name, color")
        .eq("account_id", accountId)
        .order("name"),
      supabase.from("contact_tags").select("tag_id").eq("contact_id", contactId),
    ]);
    if (tagsRes.data) setAllTags(tagsRes.data as TagLike[]);
    if (ctRes.data)
      setAssignedIds(new Set(ctRes.data.map((r) => r.tag_id as string)));
  }, [accountId, contactId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAssignedIds(new Set());
    fetchTags();
  }, [fetchTags]);

  const assign = useCallback(
    async (tagId: string) => {
      const supabase = createClient();
      setAssignedIds((prev) => new Set(prev).add(tagId));
      const { error } = await supabase
        .from("contact_tags")
        .insert({ contact_id: contactId, tag_id: tagId });
      if (error) {
        setAssignedIds((prev) => {
          const n = new Set(prev);
          n.delete(tagId);
          return n;
        });
        toast.error("Falha ao adicionar a tag");
      }
    },
    [contactId],
  );

  const unassign = useCallback(
    async (tagId: string) => {
      const supabase = createClient();
      setAssignedIds((prev) => {
        const n = new Set(prev);
        n.delete(tagId);
        return n;
      });
      const { error } = await supabase
        .from("contact_tags")
        .delete()
        .eq("contact_id", contactId)
        .eq("tag_id", tagId);
      if (error) {
        setAssignedIds((prev) => new Set(prev).add(tagId));
        toast.error("Falha ao remover a tag");
      }
    },
    [contactId],
  );

  const quickCreate = useCallback(async () => {
    const name = newName.trim();
    if (!name || !accountId) return;
    // Reuse an existing tag with the same name instead of duplicating.
    const existing = findTagByName(allTags, name);
    if (existing) {
      if (!assignedIds.has(existing.id)) await assign(existing.id);
      setNewName("");
      setOpen(false);
      return;
    }
    setBusy(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("tags")
      .insert({ account_id: accountId, name, color: newColor })
      .select("id, name, color")
      .single();
    setBusy(false);
    if (error || !data) {
      toast.error("Falha ao criar a tag");
      return;
    }
    setAllTags((prev) => [...prev, data as TagLike]);
    await assign((data as TagLike).id);
    setNewName("");
    setOpen(false);
  }, [newName, newColor, accountId, allTags, assignedIds, assign]);

  const assigned = allTags.filter((t) => assignedIds.has(t.id));
  const unassigned = allTags.filter((t) => !assignedIds.has(t.id));

  return (
    <div>
      <div className="flex items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          <TagIcon className="h-3 w-3" />
          Tags
        </div>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Adicionar tag"
          >
            <Plus className="h-3 w-3" />
            Tag
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="w-60 border-border bg-popover p-2"
          >
            {unassigned.length > 0 && (
              <div className="mb-2 max-h-40 space-y-0.5 overflow-y-auto">
                {unassigned.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => assign(t.id)}
                    className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-muted"
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: t.color }}
                    />
                    <span className="flex-1 truncate text-foreground">{t.name}</span>
                    <Plus className="h-3 w-3 text-muted-foreground" />
                  </button>
                ))}
              </div>
            )}

            <div className="border-t border-border pt-2">
              <p className="px-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                Criar nova
              </p>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") quickCreate();
                }}
                placeholder="Nome da tag"
                className="mt-1 h-8 border-border bg-muted text-sm"
              />
              <div className="mt-2 flex items-center gap-1.5">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setNewColor(c)}
                    aria-label={`Cor ${c}`}
                    className="flex h-5 w-5 items-center justify-center rounded-full"
                    style={{ backgroundColor: c }}
                  >
                    {newColor === c && <Check className="h-3 w-3 text-white" />}
                  </button>
                ))}
              </div>
              <button
                onClick={quickCreate}
                disabled={!newName.trim() || busy}
                className="mt-2 w-full rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
              >
                {busy ? "Criando…" : "Criar e aplicar"}
              </button>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      <div className="mt-2 flex flex-wrap gap-1">
        {assigned.length === 0 ? (
          <p className="px-1 text-xs text-muted-foreground">Sem tags</p>
        ) : (
          assigned.map((t) => (
            <span
              key={t.id}
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
              style={{ backgroundColor: `${t.color}20`, color: t.color }}
            >
              {t.name}
              <button
                onClick={() => unassign(t.id)}
                aria-label={`Remover ${t.name}`}
                className="opacity-70 hover:opacity-100"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          ))
        )}
      </div>
    </div>
  );
}
