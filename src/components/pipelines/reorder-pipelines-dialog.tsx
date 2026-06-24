"use client";

import { useEffect, useState } from "react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  arrayMove,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import type { Pipeline } from "@/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface ReorderPipelinesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pipelines: Pipeline[];
  onReordered: () => void;
}

export function ReorderPipelinesDialog({
  open,
  onOpenChange,
  pipelines,
  onReordered,
}: ReorderPipelinesDialogProps) {
  const supabase = createClient();
  const [items, setItems] = useState<Pipeline[]>(pipelines);
  const [saving, setSaving] = useState(false);

  // Sync local order when the dialog (re)opens — legit prop-driven reset.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return;
    setItems([...pipelines].sort((a, b) => a.position - b.position));
  }, [open, pipelines]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  function handleReorder(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex((p) => p.id === active.id);
    const newIndex = items.findIndex((p) => p.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    setItems(arrayMove(items, oldIndex, newIndex));
  }

  async function handleSave() {
    setSaving(true);
    // Persist only the rows whose position actually changed.
    const updates = items
      .map((p, i) => ({ id: p.id, position: i, prev: p.position }))
      .filter((u) => u.position !== u.prev);

    const results = await Promise.all(
      updates.map((u) =>
        supabase.from("pipelines").update({ position: u.position }).eq("id", u.id),
      ),
    );

    setSaving(false);
    if (results.some((r) => r.error)) {
      toast.error("Falha ao salvar a nova ordem");
      return;
    }
    onReordered();
    onOpenChange(false);
    toast.success("Ordem atualizada");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-popover border-border">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">
            Reordenar funis
          </DialogTitle>
        </DialogHeader>

        <div className="py-2">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleReorder}
          >
            <SortableContext
              items={items.map((p) => p.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="flex flex-col gap-2">
                {items.map((p) => (
                  <SortablePipelineRow key={p.id} pipeline={p} />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>

        <DialogFooter className="bg-popover/50 border-border">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-border text-muted-foreground hover:bg-muted"
          >
            Cancelar
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {saving ? "Salvando..." : "Salvar ordem"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SortablePipelineRow({ pipeline }: { pipeline: Pipeline }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: pipeline.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 rounded-lg border border-border bg-muted p-2"
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="cursor-grab touch-none text-muted-foreground hover:text-foreground active:cursor-grabbing"
        aria-label="Arrastar para reordenar"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <span className="flex-1 truncate font-mono text-sm text-foreground">
        {pipeline.name}
      </span>
    </div>
  );
}
