'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { toast } from 'sonner';
import type { ContactNote } from '@/types';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Plus, Trash2 } from 'lucide-react';

/**
 * Contact notes (list + add + delete), keyed by contact. Shared by the contact
 * detail view and the pipeline deal popup so both surfaces show the exact same
 * notes experience for a given contact.
 */
export function ContactNotesTab({
  contactId,
  onChanged,
}: {
  contactId: string | null;
  onChanged?: () => void;
}) {
  const supabase = createClient();
  const { accountId } = useAuth();

  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [newNote, setNewNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  const fetchNotes = useCallback(async () => {
    if (!contactId) return;
    setLoading(true);
    const { data } = await supabase
      .from('contact_notes')
      .select('*')
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false });
    if (data) setNotes(data);
    setLoading(false);
  }, [contactId, supabase]);

  useEffect(() => {
    // Prop-driven load (contact changed) — the loading flag flip is the
    // intended effect, not a cascading-render bug.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchNotes();
  }, [fetchNotes]);

  async function addNote() {
    if (!contactId || !newNote.trim()) return;
    setSaving(true);
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user || !accountId) {
      toast.error('Não autenticado');
      setSaving(false);
      return;
    }
    const { error } = await supabase.from('contact_notes').insert({
      contact_id: contactId,
      account_id: accountId,
      user_id: user.id,
      note_text: newNote.trim(),
    });
    if (error) {
      toast.error('Falha ao adicionar nota');
    } else {
      setNewNote('');
      fetchNotes();
      onChanged?.();
      toast.success('Nota adicionada');
    }
    setSaving(false);
  }

  async function deleteNote(noteId: string) {
    const { error } = await supabase.from('contact_notes').delete().eq('id', noteId);
    if (error) {
      toast.error('Falha ao excluir nota');
    } else {
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
      onChanged?.();
      toast.success('Nota excluída');
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 space-y-2">
        <Textarea
          value={newNote}
          onChange={(e) => setNewNote(e.target.value)}
          placeholder="Escreva uma nota..."
          className="min-h-[60px] resize-none border-border bg-muted text-sm text-foreground placeholder:text-muted-foreground"
        />
        <Button
          onClick={addNote}
          disabled={!newNote.trim() || saving}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
          size="sm"
        >
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
          Adicionar Nota
        </Button>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : notes.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Nenhuma nota ainda.</p>
        ) : (
          notes.map((note) => (
            <div
              key={note.id}
              className="group rounded-lg border border-border/50 bg-muted/50 p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="flex-1 whitespace-pre-wrap text-sm text-muted-foreground">
                  {note.note_text}
                </p>
                <button
                  onClick={() => deleteNote(note.id)}
                  aria-label="Excluir nota"
                  className="shrink-0 cursor-pointer text-muted-foreground opacity-0 transition-all hover:text-red-400 focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                {new Date(note.created_at).toLocaleDateString('pt-BR', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
