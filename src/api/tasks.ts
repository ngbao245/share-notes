import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { workspaceSelect, workspaceInsert, workspaceUpdate, workspaceDelete } from '@/lib/workspace/client';
import { taskRowToDomain, taskInputToRow, taskToUpdateRow, listRowToDomain, listInputToRow, type TaskRow, type TaskListRow } from '@/lib/workspace/mappers';
import type { Task, List } from '@/schemas/task';
import { optimisticList } from '@/lib/optimistic';
import { dualWriteTask, dualDeleteTask } from '@/lib/rag/dual-write';

// ============================================================
// Tasks API hooks — Workspace Proxy + Optimistic UI
// ============================================================

interface TaskApiResponse {
  tasks: Task[];
  lists: List[];
}

async function fetchTasks(): Promise<TaskApiResponse> {
  const [taskRows, listRows] = await Promise.all([
    workspaceSelect<TaskRow>('tasks', { order: { column: 'created_at', ascending: false } }),
    workspaceSelect<TaskListRow>('task_lists', { order: { column: 'created_at', ascending: true } }),
  ]);

  return {
    tasks: taskRows.map(taskRowToDomain),
    lists: listRows.map(listRowToDomain),
  };
}

export function useTasks() {
  return useQuery({ queryKey: ['tasks'], queryFn: fetchTasks });
}

// ============================================================
// Mutations
// ============================================================

export interface TaskInput {
  title: string;
  description?: string;
  dueDate?: string | null;
  priority?: 'normal' | 'high';
  recurring?: boolean;
  parentId?: string | null;
  url1?: string | null;
  url2?: string | null;
  url3?: string | null;
}

export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: TaskInput) => {
      const row = taskInputToRow(input, '');
      const { user_id: _, ...rowWithoutUserId } = row;
      const created = await workspaceInsert<TaskRow>('tasks', rowWithoutUserId);
      return taskRowToDomain(created);
    },
    onSuccess: (task) => {
      if (task?.id) dualWriteTask(task);
    },
    ...optimisticList<TaskApiResponse, TaskInput>(qc, ['tasks'], (old, input) => {
      const tempTask: Task = {
        id: 'temp_' + Date.now(),
        title: input.title,
        type: 'task',
        description: input.description ?? null,
        parentId: input.parentId ?? null,
        status: 'pending',
        priority: input.priority ?? 'normal',
        dueDate: input.dueDate ?? null,
        recurring: input.recurring ?? false,
        url1: input.url1 ?? null,
        url2: input.url2 ?? null,
        url3: input.url3 ?? null,
        completedDate: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      return { ...old, tasks: [tempTask, ...old.tasks] };
    }),
  });
}

export function useUpdateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (task: Task) => {
      const updateRow = taskToUpdateRow(task);
      const { id, ...fields } = updateRow;
      const updated = await workspaceUpdate<TaskRow>('tasks', id, fields);
      return taskRowToDomain(updated);
    },
    onSuccess: (updated) => {
      if (updated?.id) dualWriteTask(updated);
    },
    ...optimisticList<TaskApiResponse, Task>(qc, ['tasks'], (old, task) => ({
      ...old,
      tasks: old.tasks.map((t) => (t.id === task.id ? { ...task, updatedAt: new Date().toISOString() } : t)),
    })),
  });
}

export function useToggleTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (task: Task) => {
      const newStatus = task.status === 'completed' ? 'pending' : 'completed';
      const now = new Date().toISOString();
      const updated = await workspaceUpdate<TaskRow>('tasks', task.id, {
        status: newStatus,
        completed_date: newStatus === 'completed' ? now : null,
      });
      return taskRowToDomain(updated);
    },
    onSuccess: (updated) => {
      if (updated?.id) dualWriteTask(updated);
    },
    ...optimisticList<TaskApiResponse, Task>(qc, ['tasks'], (old, task) => {
      const newStatus = task.status === 'completed' ? 'pending' : 'completed';
      const now = new Date().toISOString();
      return {
        ...old,
        tasks: old.tasks.map((t) =>
          t.id === task.id
            ? { ...t, status: newStatus as 'pending' | 'completed', completedDate: newStatus === 'completed' ? now : null, updatedAt: now }
            : t,
        ),
      };
    }),
  });
}

export function useToggleImportant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (task: Task) => {
      const newPriority = task.priority === 'high' ? 'normal' : 'high';
      const updated = await workspaceUpdate<TaskRow>('tasks', task.id, { priority: newPriority });
      return taskRowToDomain(updated);
    },
    onSuccess: (updated) => {
      if (updated?.id) dualWriteTask(updated);
    },
    ...optimisticList<TaskApiResponse, Task>(qc, ['tasks'], (old, task) => ({
      ...old,
      tasks: old.tasks.map((t) =>
        t.id === task.id
          ? { ...t, priority: (task.priority === 'high' ? 'normal' : 'high') as 'normal' | 'high', updatedAt: new Date().toISOString() }
          : t,
      ),
    })),
  });
}

export function useDeleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await workspaceDelete('tasks', id);
      dualDeleteTask(id);
    },
    ...optimisticList<TaskApiResponse, string>(qc, ['tasks'], (old, id) => ({
      ...old,
      tasks: old.tasks.filter((t) => t.id !== id),
    })),
  });
}

// ============================================================
// Custom lists
// ============================================================

export function useCreateList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (title: string) => {
      const row = listInputToRow(title, '');
      const { user_id: _, ...rowWithoutUserId } = row;
      const created = await workspaceInsert<TaskListRow>('task_lists', rowWithoutUserId);
      return listRowToDomain(created);
    },
    ...optimisticList<TaskApiResponse, string>(qc, ['tasks'], (old, title) => ({
      ...old,
      lists: [...old.lists, { id: 'temp_' + Date.now(), title, type: 'list' as const, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
    })),
  });
}

export function useDeleteList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (listId: string) => {
      await workspaceDelete('task_lists', listId);
    },
    ...optimisticList<TaskApiResponse, string>(qc, ['tasks'], (old, listId) => ({
      ...old,
      lists: old.lists.filter((l) => l.id !== listId),
    })),
  });
}
