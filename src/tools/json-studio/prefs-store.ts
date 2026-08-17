import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { CanvasThemeMode } from '@/tools/json-studio/lib/types';
import { createFacadeStorage } from '@/lib/plugin-storage/zustand-adapter';
import { buildKey } from '@/lib/plugin-storage';

// ============================================================
// JSON Studio Preferences - persist localStorage
// ============================================================
//
// Tách store riêng vì:
// - Prefs cần persist (user mở lại tool vẫn giữ setting)
// - Main data store thì không (rawData không persist - quá lớn, dễ thay đổi)
// - Subscribe riêng → component nào chỉ quan tâm prefs không re-render khi data đổi
//
// Để tránh "flash from default" khi reload (ruler hiện → mất → hiện lại):
// đọc localStorage SYNC ngay khi module load, dùng làm default state.
// Như vậy render đầu tiên đã có giá trị đúng, không bị Zustand rehydrate async sau.
//
// MIGRATION v1 (json-viewer → json-studio): done via LEGACY_MAPPING trong facade
// migration script (bibo:json-viewer:prefs + bibo:json-studio:prefs → v1:global:tool:json-studio:state).
// Xem `src/lib/plugin-storage/migrate-legacy.ts`.
// ============================================================

// Facade key nơi zustand persist ghi state. Dùng cho `loadInitial()` sync read
// và match key adapter build.
const FACADE_KEY = buildKey({ toolId: 'json-studio', key: 'state', scope: 'global' });

interface JsonStudioPrefsState {
  graphTheme: CanvasThemeMode;
  zoomOnScroll: boolean;
  showRuler: boolean;

  setGraphTheme: (theme: CanvasThemeMode) => void;
  setZoomOnScroll: (enabled: boolean) => void;
  setShowRuler: (show: boolean) => void;
}

type PersistedPrefs = Pick<
  JsonStudioPrefsState,
  'graphTheme' | 'zoomOnScroll' | 'showRuler'
>;

const DEFAULTS: PersistedPrefs = {
  graphTheme: 'dark',
  zoomOnScroll: true,
  showRuler: true,
};

/** Đọc sync localStorage tại FACADE_KEY để render đầu có giá trị đúng. */
function loadInitial(): PersistedPrefs {
  if (typeof localStorage === 'undefined') return DEFAULTS;
  try {
    const raw = localStorage.getItem(FACADE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw);
    // Zustand v4 persist format: { state: {...}, version: ... }
    const state = parsed?.state ?? parsed;
    return {
      graphTheme: state?.graphTheme ?? DEFAULTS.graphTheme,
      zoomOnScroll: state?.zoomOnScroll ?? DEFAULTS.zoomOnScroll,
      showRuler: state?.showRuler ?? DEFAULTS.showRuler,
    };
  } catch {
    return DEFAULTS;
  }
}

const initial = loadInitial();

export const useJsonStudioPrefsStore = create<JsonStudioPrefsState>()(
  persist(
    (set) => ({
      // Khởi tạo từ localStorage sync — render đầu đã đúng
      ...initial,

      setGraphTheme: (graphTheme) => set({ graphTheme }),
      setZoomOnScroll: (zoomOnScroll) => set({ zoomOnScroll }),
      setShowRuler: (showRuler) => set({ showRuler }),
    }),
    {
      // Name ignored bởi facade adapter; facade build key từ toolId.
      name: 'json-studio',
      version: 1,
      storage: createJSONStorage(() =>
        createFacadeStorage({ toolId: 'json-studio', scope: 'global' }),
      ),
      // BỎ auto-rehydrate vì đã load sync ở `loadInitial()`.
      // Persist vẫn auto-save khi setState (nhờ subscribe), nhưng không trigger
      // rehydrate async sau mount → không bao giờ flash từ default → persisted value.
      skipHydration: true,
    }
  )
);