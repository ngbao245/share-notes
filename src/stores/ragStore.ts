// ============================================================
// RAG Zustand store
// ============================================================
//
// Single source of truth runtime cho RAG module:
//   - config:   parse từ MockAPI Config record (fallback default)
//   - tokens:   decrypt từ MockAPI SettingInfor record
//   - status:   bootstrap state cho UI quyết định render gì
//   - chatMode: mode hiện tại (Auto/Internal) — có thể override khỏi config
//   - sessions: state cho feature chat sessions (active id, draft, summary cache)
//
// Bootstrap flow:
//   App.tsx mount → tryBootstrapRag() → setConfig/setTokens/setStatus
//   Các component (modal, search, chat) read từ store, không gọi vault lại.
// ============================================================

import { create } from 'zustand';

import {
  DEFAULT_RAG_CONFIG,
  EMPTY_RAG_TOKENS,
  activeGeminiKeys,
  type RagChatMode,
  type RagConfig,
  type RagStatus,
  type RagTokens,
} from '@/lib/rag/types';
import { createToolStorage } from '@/lib/plugin-storage';

const activeSessionStorage = createToolStorage<string>({
  toolId: 'rag',
  key: 'active-session',
  scope: 'user',
});

/**
 * Pending context — caller (Reader SelectionMenu) đẩy raw quote + page
 * vào store. ChatTab render ContextCard + QuickActions cho user chọn
 * action (Giải thích / Tóm tắt / custom), KHÔNG auto-send.
 */
export interface RagPendingContext {
  text: string;
  page: number;
  /** id để ChatTab phân biệt context mới (kể cả text trùng). */
  id: string;
}

function readActiveSessionIdFromLS(): string | null {
  const v = activeSessionStorage.get();
  return v && v.length > 0 ? v : null;
}

function writeActiveSessionIdToLS(id: string | null): void {
  if (id === null) activeSessionStorage.remove();
  else activeSessionStorage.set(id);
}

/**
 * Hydrate `activeSessionId` từ facade sau khi có session (real userId).
 * ragStore init lúc module load (trước auth ready) — sync với 'anonymous'
 * userId, không đọc được data user thật. Gọi từ AuthGuard sau setSession
 * để hydrate lại đúng.
 */
export function hydrateRagActiveSession(): void {
  useRagStore.setState({ activeSessionId: readActiveSessionIdFromLS() });
}

interface RagState {
  config: RagConfig;
  tokens: RagTokens;
  status: RagStatus;
  /** Lỗi gần nhất khi bootstrap (cho UI hiển thị CTA setup). */
  errorMessage: string | null;
  /** Mode chat hiện tại — khởi tạo từ config.chatDefaultMode, user có thể override trong phiên. */
  chatMode: RagChatMode;
  /** Context từ Reader SelectionMenu — ChatTab render UI để user chọn action. */
  pendingContext: RagPendingContext | null;

  // ----- Chat sessions state -----
  /** Session đang active. null = fresh (chưa gửi message nào). */
  activeSessionId: string | null;
  /** Draft text chưa gửi (persist qua đóng/mở modal, mất khi refresh). */
  draftInput: string;

  setConfig: (config: RagConfig) => void;
  setTokens: (tokens: RagTokens) => void;
  setStatus: (status: RagStatus, errorMessage?: string | null) => void;
  setChatMode: (mode: RagChatMode) => void;
  setPendingContext: (text: string, page: number) => void;
  clearPendingContext: () => void;

  setActiveSessionId: (id: string | null) => void;
  setDraftInput: (text: string) => void;

  reset: () => void;
}

export const useRagStore = create<RagState>((set) => ({
  config: DEFAULT_RAG_CONFIG,
  tokens: EMPTY_RAG_TOKENS,
  status: 'idle',
  errorMessage: null,
  chatMode: DEFAULT_RAG_CONFIG.chatDefaultMode,
  pendingContext: null,

  activeSessionId: readActiveSessionIdFromLS(),
  draftInput: '',

  setConfig: (config) =>
    set((state) => ({
      config,
      chatMode: state.status === 'idle' ? config.chatDefaultMode : state.chatMode,
    })),

  setTokens: (tokens) => set({ tokens }),

  setStatus: (status, errorMessage = null) => set({ status, errorMessage }),

  setChatMode: (mode) => set({ chatMode: mode }),

  setPendingContext: (text, page) =>
    set({
      pendingContext: {
        text,
        page,
        id: Math.random().toString(36).slice(2) + Date.now().toString(36),
      },
    }),

  clearPendingContext: () => set({ pendingContext: null }),

  setActiveSessionId: (id) => {
    writeActiveSessionIdToLS(id);
    set({ activeSessionId: id });
  },

  setDraftInput: (text) => set({ draftInput: text }),

  reset: () => {
    writeActiveSessionIdToLS(null);
    set({
      config: DEFAULT_RAG_CONFIG,
      tokens: EMPTY_RAG_TOKENS,
      status: 'idle',
      errorMessage: null,
      chatMode: DEFAULT_RAG_CONFIG.chatDefaultMode,
      pendingContext: null,
      activeSessionId: null,
      draftInput: '',
    });
  },
}));

// ============================================================
// Selectors
// ============================================================

export const selectHasGeminiKey = (state: RagState): boolean =>
  activeGeminiKeys(state.tokens).length > 0;

export const selectIsReady = (state: RagState): boolean =>
  state.status === 'ready' && activeGeminiKeys(state.tokens).length > 0;