import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { createFacadeStorage } from '@/lib/plugin-storage/zustand-adapter';

// ============================================================
// Agency Studio — UI state store
// ============================================================
// Persist wizardStep + draftCampaign vào localStorage để user reload
// giữ tiến độ tạo campaign. KHÔNG persist selectedLeadIds (Set khó
// serialize, và selection ephemeral nên reset là OK) và leadFilters
// (mỗi session filter khác nhau).
// ============================================================

export interface LeadFilters {
  search: string;
  status: string;
  tags: string[];
}

export interface DraftCampaign {
  name: string;
  description: string;
  templateId: string | null;
  selectedLeadIds: string[];
  scheduleAt: string | null;
}

interface AgencyStudioState {
  // Lead list UI
  leadFilters: LeadFilters;
  selectedLeadIds: Set<string>;

  // Campaign wizard (persist)
  wizardStep: 1 | 2 | 3 | 4 | 5;
  draftCampaign: DraftCampaign;

  // Actions
  setLeadFilters: (f: Partial<LeadFilters>) => void;
  toggleLeadSelection: (id: string) => void;
  toggleAllLeads: (ids: string[], checked: boolean) => void;
  clearLeadSelection: () => void;
  setWizardStep: (step: 1 | 2 | 3 | 4 | 5) => void;
  updateDraftCampaign: (patch: Partial<DraftCampaign>) => void;
  resetWizard: () => void;
}

const defaultFilters: LeadFilters = { search: '', status: '', tags: [] };
const defaultDraft: DraftCampaign = {
  name: '',
  description: '',
  templateId: null,
  selectedLeadIds: [],
  scheduleAt: null,
};

export const useAgencyStudioStore = create<AgencyStudioState>()(
  persist(
    (set) => ({
      leadFilters: defaultFilters,
      selectedLeadIds: new Set(),
      wizardStep: 1,
      draftCampaign: defaultDraft,

      setLeadFilters: (f) =>
        set((s) => ({ leadFilters: { ...s.leadFilters, ...f } })),

      toggleLeadSelection: (id) =>
        set((s) => {
          const next = new Set(s.selectedLeadIds);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return { selectedLeadIds: next };
        }),

      toggleAllLeads: (ids, checked) =>
        set((s) => {
          const next = new Set(s.selectedLeadIds);
          for (const id of ids) {
            if (checked) next.add(id);
            else next.delete(id);
          }
          return { selectedLeadIds: next };
        }),

      clearLeadSelection: () => set({ selectedLeadIds: new Set() }),

      setWizardStep: (step) => set({ wizardStep: step }),

      updateDraftCampaign: (patch) =>
        set((s) => ({ draftCampaign: { ...s.draftCampaign, ...patch } })),

      resetWizard: () =>
        set({ wizardStep: 1, draftCampaign: defaultDraft }),
    }),
    {
      // `name` được zustand truyền vào adapter method nhưng facade ignore
      // (adapter build key theo toolId). Giữ để zustand không complain.
      name: 'agency-studio',
      version: 1,
      storage: createJSONStorage(() =>
        createFacadeStorage({ toolId: 'agency-studio', scope: 'user' }),
      ),
      // Chỉ persist wizardStep + draftCampaign để user reload giữa tạo
      // campaign vẫn tiếp được. Set/filter không cần persist.
      partialize: (state) => ({
        wizardStep: state.wizardStep,
        draftCampaign: state.draftCampaign,
      }),
    },
  ),
);
