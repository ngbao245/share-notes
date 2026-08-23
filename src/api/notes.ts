import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { workspaceSelect, workspaceInsert, workspaceUpdate, workspaceDelete } from '@/lib/workspace/client';
import { noteRowToDomain, noteInputToRow, noteToUpdateRow, type NoteRow } from '@/lib/workspace/mappers';
import type { Note, NoteType } from '@/schemas/note';
import { optimisticList } from '@/lib/optimistic';
import { dualWriteNote, dualDeleteNote, dualDeleteNotes } from '@/lib/rag/dual-write';

// ============================================================
// Notes API hooks — Workspace Proxy + Optimistic UI
// ============================================================

async function fetchNotes(): Promise<Note[]> {
  const rows = await workspaceSelect<NoteRow>('notes', {
    order: { column: 'updated_at', ascending: false },
  });
  return rows.map(noteRowToDomain);
}

export function useNotes() {
  return useQuery({ queryKey: ['notes'], queryFn: fetchNotes });
}

// ============================================================
// Mutations
// ============================================================

export interface NoteInput {
  title: string;
  content?: string;
  type?: NoteType;
  source?: string | null;
  tags?: string | null;
  example?: string | null;
  url1?: string | null;
  url2?: string | null;
  url3?: string | null;
  url4?: string | null;
  url5?: string | null;
  linkedNotes?: string[];
  isChildNote?: boolean;
  parentNoteId?: string | null;
  wordCountEnabled?: boolean;
  timerDuration?: string | null;
}

export function useCreateNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: NoteInput) => {
      // noteInputToRow needs userId but proxy injects it server-side
      // Send row without user_id — proxy adds it
      const row = noteInputToRow(input, '');
      const { user_id: _, ...rowWithoutUserId } = row;
      const created = await workspaceInsert<NoteRow>('notes', rowWithoutUserId);
      return noteRowToDomain(created);
    },
    onSuccess: (note) => {
      if (note?.id) dualWriteNote(note);
    },
    ...optimisticList<Note[], NoteInput>(qc, ['notes'], (old, input) => {
      const temp: Note = {
        id: 'temp_' + Date.now(),
        title: input.title,
        content: input.content ?? '',
        type: input.type ?? 'note',
        source: input.source ?? null,
        tags: input.tags ?? null,
        example: input.example ?? null,
        url1: input.url1 ?? null,
        url2: input.url2 ?? null,
        url3: input.url3 ?? null,
        url4: input.url4 ?? null,
        url5: input.url5 ?? null,
        wordCountEnabled: input.wordCountEnabled ?? null,
        timerDuration: input.timerDuration ?? null,
        linkedNotes: input.linkedNotes ?? [],
        isChildNote: input.isChildNote ?? false,
        parentNoteId: input.parentNoteId ?? null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      return [temp, ...old];
    }),
  });
}

export function useUpdateNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (note: Note) => {
      const updateRow = noteToUpdateRow(note);
      const { id, ...fields } = updateRow;
      const updated = await workspaceUpdate<NoteRow>('notes', id, fields);
      return noteRowToDomain(updated);
    },
    onSuccess: (updated) => {
      if (updated?.id) dualWriteNote(updated);
    },
    ...optimisticList<Note[], Note>(qc, ['notes'], (old, note) =>
      old.map((n) => (n.id === note.id ? { ...note, updatedAt: new Date().toISOString() } : n)),
    ),
  });
}

// ============================================================
// Delete với cascade
// ============================================================
export function useDeleteNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const all = qc.getQueryData<Note[]>(['notes']) ?? [];
      const target = all.find((n) => n.id === id);

      if (!target) {
        await workspaceDelete('notes', id);
        dualDeleteNote(id);
        return;
      }

      // 1. Xoá child notes
      const childNoteIds = (target.linkedNotes ?? [])
        .map((linkedId) => all.find((n) => n.id === linkedId))
        .filter((n): n is Note => !!n && n.isChildNote)
        .map((n) => n.id);

      if (childNoteIds.length > 0) {
        await workspaceDelete('notes', childNoteIds);
      }

      // 2. Update notes referencing target
      const referencing = all.filter(
        (n) => n.id !== id && !childNoteIds.includes(n.id) && (n.linkedNotes ?? []).includes(id),
      );
      for (const ref of referencing) {
        const newLinked = (ref.linkedNotes ?? []).filter((lid) => lid !== id);
        await workspaceUpdate('notes', ref.id, { linked_notes: newLinked });
        const updatedRef = { ...ref, linkedNotes: newLinked, updatedAt: new Date().toISOString() };
        dualWriteNote(updatedRef);
      }

      // 3. Gỡ khỏi parent
      if (target.isChildNote && target.parentNoteId) {
        const parent = all.find((n) => n.id === target.parentNoteId);
        if (parent) {
          const newLinked = (parent.linkedNotes ?? []).filter((lid) => lid !== id);
          await workspaceUpdate('notes', parent.id, { linked_notes: newLinked });
          const updatedParent = { ...parent, linkedNotes: newLinked, updatedAt: new Date().toISOString() };
          dualWriteNote(updatedParent);
        }
      }

      // 4. Xoá target
      await workspaceDelete('notes', id);
      dualDeleteNote(id);
      if (childNoteIds.length > 0) dualDeleteNotes(childNoteIds);
    },
    ...optimisticList<Note[], string>(qc, ['notes'], (old, id) => {
      const target = old.find((n) => n.id === id);
      if (!target) return old.filter((n) => n.id !== id);
      const childIds = new Set(
        (target.linkedNotes ?? [])
          .map((linkedId) => old.find((n) => n.id === linkedId))
          .filter((n): n is Note => !!n && n.isChildNote)
          .map((n) => n.id),
      );
      return old
        .filter((n) => n.id !== id && !childIds.has(n.id))
        .map((n) =>
          (n.linkedNotes ?? []).includes(id)
            ? { ...n, linkedNotes: (n.linkedNotes ?? []).filter((lid) => lid !== id) }
            : n,
        );
    }),
  });
}
