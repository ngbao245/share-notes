
import type { ModalId } from '@/stores/modalStore';

// ============================================================
// Danh sách tools - single source of truth
// ============================================================
//
// File này list metadata tĩnh cho từng tool: id, label, action, description,
// và group (dùng cho Shortcuts modal). KHÔNG quyết định tool nằm ở category
// nào trên HubPro — mapping category là dynamic.
//
// Icon: render qua `<ToolIcon id={tool.id} />` (xem ToolIcon.tsx).
// Tool ID phải khớp với key trong ICON_MAP của ToolIcon.
//
// Phím tắt: KHÔNG khai báo ở đây. Shortcut là dynamic — user gán qua
// Setting → lưu /Config → bootstrap load vào shortcutStore. Xem
// `src/lib/shortcutRegistry.ts` và `src/stores/shortcutStore.ts`.
//
// Category trên HubPro: dynamic — user kéo-thả tool giữa 6 category fix cứng
// (Productivity, Finance, Tracking, Utilities, Developer, Admin) qua Setting →
// Tool Categories. Lưu MockAPI record group="Setting" type="Category".
// Xem `src/components/ToolCategoryManager.tsx` và `src/api/toolCategories.ts`.
// Default state (user chưa config): tất cả tool ở section "Unassigned".
// ============================================================

export type ToolKind =
  /** Mở modal toàn cục (Calculator, Translate...) */
  | { kind: 'modal'; modalId: ModalId }
  /** Điều hướng tới page (Notes, Tasks, Movies...) */
  | { kind: 'route'; path: string }
  /** Chưa implement, click → alert tạm thời */
  | { kind: 'todo' };

export interface Tool {
  id: string;
  label: string;
  /**
   * Nhóm logic của tool — dùng làm section header trong Shortcuts modal.
   * KHÔNG phải category assignment cho HubPro (cái đó dynamic qua Setting).
   */
  group: ToolGroup;
  action: ToolKind;
  /** Mô tả ngắn, dùng ở HubPro tile hover */
  description?: string;
}

/**
 * 6 category fix cứng. User KHÔNG thêm/xoá được. Nhưng tool nào ở category nào
 * là dynamic, chỉnh qua /setting → Tool Categories.
 */
export type ToolGroup =
  | 'Productivity'
  | 'Finance'
  | 'Tracking'
  | 'Utilities'
  | 'Developer'
  | 'Admin';

export const TOOL_GROUPS: readonly ToolGroup[] = [
  'Productivity',
  'Finance',
  'Tracking',
  'Utilities',
  'Developer',
  'Admin',
] as const;

export const TOOLS: Tool[] = [
  // Productivity
  {
    id: 'notes',
    label: 'Notes',
    group: 'Productivity',
    action: { kind: 'route', path: '/notes' },
    description: 'Rich text note-taking với highlight và shortcut',
  },
  {
    id: 'tasks',
    label: 'Tasks',
    group: 'Productivity',
    action: { kind: 'route', path: '/tasks' },
    description: 'Task management theo style Microsoft To Do',
  },
  {
    id: 'vault',
    label: 'Vault',
    group: 'Utilities',
    action: { kind: 'route', path: '/vault' },
    description: 'Zero-knowledge encrypted secrets — notes, accounts, cards',
  },
  {
    id: 'library',
    label: 'Library',
    group: 'Productivity',
    action: { kind: 'route', path: '/library' },
    description: 'Thư viện sách shared — đọc, highlight, note, translate',
  },
  {
    id: 'markdown-preview',
    label: 'Markdown',
    group: 'Productivity',
    action: { kind: 'route', path: '/markdown' },
    description: 'Markdown editor + live preview, export PDF',
  },
  {
    id: 'json-studio',
    label: 'JSON Studio',
    group: 'Developer',
    action: { kind: 'route', path: '/json-studio' },
    description: 'JSON toolkit — visualize, format, diff, convert, path, schema',
  },
  {
    id: 'rag',
    label: 'AI Search',
    group: 'Productivity',
    action: { kind: 'modal', modalId: 'rag' },
    description: 'Semantic search + AI chat trên notes / tasks / highlights',
  },
  {
    id: 'bookmarks',
    label: 'Bookmarks',
    group: 'Productivity',
    action: { kind: 'route', path: '/bookmarks' },
    description: 'Quick links dashboard theo phong cách Superdense — favicon grid + public profile',
  },
  {
    id: 'canvas',
    label: 'Canvas',
    group: 'Productivity',
    action: { kind: 'route', path: '/canvas' },
    description: 'Milanote-style infinite canvas — sắp xếp ý tưởng, ảnh, link, note theo không gian',
  },

  // Finance
  {
    id: 'expense',
    label: 'Chi tiêu',
    group: 'Finance',
    action: { kind: 'route', path: '/expense' },
    description: 'Ghi chép chi tiêu cá nhân',
  },

  // Tracking
  {
    id: 'spx',
    label: 'SPX Tracking',
    group: 'Tracking',
    action: { kind: 'modal', modalId: 'spxTracking' },
    description: 'Theo dõi đơn hàng SPX',
  },
  {
    id: 'watchlist',
    label: 'Watchlist',
    group: 'Tracking',
    action: { kind: 'route', path: '/watchlist' },
    description: 'Theo dõi phim, series, manga, anime',
  },
  {
    id: 'agency-studio',
    label: 'Agency Studio',
    group: 'Tracking',
    action: { kind: 'route', path: '/agency-studio' },
    description: 'Quản lý lead và email outreach — Lead → Template → Campaign → Track',
  },

  // Utilities
  {
    id: 'translate',
    label: 'Translate',
    group: 'Utilities',
    action: { kind: 'modal', modalId: 'translate' },
    description: 'Dịch Việt-Anh tự động',
  },
  {
    id: 'calculator',
    label: 'Calculator',
    group: 'Utilities',
    action: { kind: 'modal', modalId: 'calculator' },
    description: 'Máy tính cơ bản',
  },
  {
    id: 'encoder',
    label: 'Encoder',
    group: 'Utilities',
    action: { kind: 'modal', modalId: 'encoder' },
    description: 'Encode API URL cho config.js',
  },
  {
    id: 'crypto',
    label: 'Crypto',
    group: 'Utilities',
    action: { kind: 'modal', modalId: 'crypto' },
    description: 'Mã hoá / giải mã AES-GCM (dùng chung passphrase với Setting)',
  },
  {
    id: 'audio',
    label: 'Audio',
    group: 'Utilities',
    action: { kind: 'modal', modalId: 'audio' },
    description: 'Phát nhạc YouTube nền — playlist + floating window',
  },

  // Developer
  {
    id: 'p2p-transfer',
    label: 'P2P Transfer',
    group: 'Developer',
    action: { kind: 'route', path: '/p2p' },
    description: 'Truyền file ngang hàng qua WebRTC',
  },
  {
    id: 'code-compare',
    label: 'Compare',
    group: 'Developer',
    action: { kind: 'route', path: '/code-compare' },
    description: 'So sánh 2 đoạn code — inline diff',
  },
  {
    id: 'design-system',
    label: 'Design System',
    group: 'Developer',
    action: { kind: 'route', path: '/design-system' },
    description: 'Internal — preview theme tokens, components, variants',
  },

  // Admin
  {
    id: 'portfolio-landing',
    label: 'Portfolio',
    group: 'Admin',
    action: { kind: 'route', path: '/portfolio' },
    description: 'Public landing page bán dịch vụ — polygon 3D hero',
  },
  {
    id: 'project-packer',
    label: 'Project Packer',
    group: 'Admin',
    action: { kind: 'route', path: '/project-packer' },
    description: 'Đóng gói project source code',
  },
  {
    id: 'pdf-studio',
    label: 'PDF Studio',
    group: 'Utilities',
    action: { kind: 'route', path: '/pdf-studio' },
    description: 'Chuyển đổi PDF 12 chiều — Word, Excel, PPTX, PNG, JPG, EPUB',
  },
  {
    id: 'image-studio',
    label: 'Image Studio',
    group: 'Utilities',
    action: { kind: 'route', path: '/image-studio' },
    description: 'Gộp ảnh, nén ảnh, trích xuất text từ ảnh (OCR)',
  },
  {
    id: 'community',
    label: 'Community',
    group: 'Admin',
    action: { kind: 'route', path: '/community/ideas' },
    description: 'Ideas, Progress, Announcements — thu thap feedback va cong bo cap nhat',
  },
  {
    id: 'setting',
    label: 'Config',
    group: 'Admin',
    action: { kind: 'route', path: '/config' },
    description: 'Quản lý setting dự án (CRUD qua mockapi)',
  },
  {
    id: 'home-widgets',
    label: 'Home Widgets',
    group: 'Productivity',
    action: { kind: 'route', path: '/' },
    description: 'Widget system trên HubPro homepage — daily reminder, quick actions',
  },
];

/**
 * Group tools theo `Tool.group` — dùng cho Shortcuts modal section header.
 * KHÔNG dùng làm layout cho HubPro (đó là dynamic qua ToolCategoryManager).
 */
export function groupTools(tools: Tool[]): Record<ToolGroup, Tool[]> {
  const result: Record<ToolGroup, Tool[]> = {
    Productivity: [],
    Finance: [],
    Tracking: [],
    Utilities: [],
    Developer: [],
    Admin: [],
  };
  for (const t of tools) result[t.group].push(t);
  return result;
}
