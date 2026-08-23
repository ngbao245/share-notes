// ============================================================
// Vault API hooks — TanStack Query
// ============================================================
//
// CRITICAL: All hooks are DISABLED until vault is unlocked.
// No API calls happen without successful unlock.
// ============================================================

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/authStore';
import { WORKSPACE_ANON_KEY, WORKSPACE_PROXY_URL as PROXY_URL } from '@/lib/workspace/env';
import { useVaultStore } from './store';
import type { VaultMetaRow, VaultEntryRow } from './types';

// ── Workspace proxy helpers (vault-specific tables) ──

type VaultTable = 'vault_meta' | 'vault_entries';

interface ProxyRequest {
  table: VaultTable;
  action: 'select' | 'insert' | 'update' | 'delete' | 'upsert';
  data?: Record<string, unknown> | Record<string, unknown>[];
  filters?: Record<string, unknown>;
  order?: { column: string; ascending?: boolean };
  limit?: number;
  single?: boolean;
}

async function vaultProxy<T = unknown>(body: ProxyRequest): Promise<T> {
  const token = useAuthStore.getState().session?.access_token;
  if (!token) throw new Error('Not authenticated');

  const res = await fetch(PROXY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      apikey: WORKSPACE_ANON_KEY,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error((err as { error?: string }).error ?? `Vault proxy error: ${res.status}`);
  }

  const json = (await res.json()) as { data: T };
  return json.data;
}

// ── Vault Meta ──

export function useVaultMeta() {
  return useQuery<VaultMetaRow | null>({
    queryKey: ['vault', 'meta'],
    queryFn: async () => {
      const rows = await vaultProxy<VaultMetaRow[]>({
        table: 'vault_meta',
        action: 'select',
        limit: 1,
      });
      return rows.length > 0 ? rows[0] : null;
    },
    staleTime: Infinity, // meta rarely changes
  });
}

export function useUpsertVaultMeta() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Omit<VaultMetaRow, 'user_id' | 'created_at' | 'updated_at'> & { id?: string }) => {
      return vaultProxy<VaultMetaRow>({
        table: 'vault_meta',
        action: 'upsert',
        data: { ...data, updated_at: new Date().toISOString() },
        single: true,
      });
    },
    onSuccess: (result) => {
      qc.setQueryData(['vault', 'meta'], result);
    },
  });
}

// ── Vault Entries ──

export function useVaultEntries() {
  const unlocked = useVaultStore((s) => s.unlocked);

  return useQuery<VaultEntryRow[]>({
    queryKey: ['vault', 'entries'],
    queryFn: async () => {
      return vaultProxy<VaultEntryRow[]>({
        table: 'vault_entries',
        action: 'select',
        order: { column: 'updated_at', ascending: false },
      });
    },
    // CRITICAL: do NOT fetch until vault is unlocked
    enabled: unlocked,
    staleTime: 30_000,
  });
}

export function useCreateVaultEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Omit<VaultEntryRow, 'id' | 'user_id' | 'created_at' | 'updated_at'>) => {
      return vaultProxy<VaultEntryRow>({
        table: 'vault_entries',
        action: 'insert',
        data: {
          ...data,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        single: true,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vault', 'entries'] });
    },
  });
}

export function useUpdateVaultEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; data: Partial<Omit<VaultEntryRow, 'id' | 'user_id' | 'created_at'>> }) => {
      return vaultProxy<VaultEntryRow>({
        table: 'vault_entries',
        action: 'update',
        filters: { id: input.id },
        data: { ...input.data, updated_at: new Date().toISOString() },
        single: true,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vault', 'entries'] });
    },
  });
}

export function useDeleteVaultEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await vaultProxy({
        table: 'vault_entries',
        action: 'delete',
        filters: { id },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vault', 'entries'] });
    },
  });
}