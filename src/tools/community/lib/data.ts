// ============================================================
// Community — shared types + dummy data
// ============================================================

export interface IdeaComment {
  id: string;
  author: string;
  content: string;
  date: string;
}

export type IdeaStatus =
  | 'under-consideration'
  | 'planned'
  | 'in-progress'
  | 'shipped'
  | 'not-likely';

export interface Idea {
  id: string;
  title: string;
  description: string;
  votes: number;
  status: IdeaStatus;
  author: string;
  date: string;
  topics: string[];
  comments: IdeaComment[];
}

export interface Announcement {
  id: string;
  title: string;
  content: string;
  date: string;
  tags: { label: string; color: string }[];
}

export const STATUS_META: Record<IdeaStatus, { label: string; color: string }> = {
  'under-consideration': { label: 'Under consideration', color: 'rgb(255, 0, 136)' },
  planned: { label: 'Planned', color: 'rgb(255, 170, 0)' },
  'in-progress': { label: 'In progress', color: 'rgb(126, 166, 225)' },
  shipped: { label: 'Shipped', color: 'rgb(68, 221, 204)' },
  'not-likely': { label: 'Not likely', color: 'rgb(155, 155, 155)' },
};

export const TOPICS_WITH_COUNT = [
  { label: 'Improvement', count: 12 },
  { label: 'New feature', count: 18 },
  { label: 'Bug', count: 3 },
  { label: 'Integrations', count: 6 },
  { label: 'Productivity', count: 8 },
  { label: 'UI/UX', count: 5 },
];

export const DUMMY_IDEAS: Idea[] = [
  {
    id: '1',
    title: 'Dark mode cho Reader',
    description: 'Them che do dark cho trang doc PDF, giam moi mat khi doc ban dem.',
    votes: 42,
    status: 'shipped',
    author: 'Minh',
    date: '15 Jul, 2026',
    topics: ['Improvement'],
    comments: [
      { id: 'c1', author: 'Lan', content: 'Yes! Rat can tinh nang nay, doc ban dem rat kho chiu.', date: '16 Jul, 2026' },
      { id: 'c2', author: 'Khoa', content: 'Co the them auto-switch theo system theme duoc khong?', date: '17 Jul, 2026' },
      { id: 'c3', author: 'Admin', content: 'Da ship! Check Library > Settings.', date: '20 Jul, 2026' },
    ],
  },
  {
    id: '2',
    title: 'Export notes sang Markdown',
    description: 'Cho phep export toan bo notes thanh file .md de backup hoac dung ben ngoai.',
    votes: 38,
    status: 'in-progress',
    author: 'Lan',
    date: '20 Jun, 2026',
    topics: ['New feature'],
    comments: [
      { id: 'c4', author: 'Tung', content: 'Nen ho tro ca export toan bo va tung note rieng le.', date: '21 Jun, 2026' },
      { id: 'c5', author: 'Nam', content: 'Zip file voi frontmatter metadata thi tuyet voi!', date: '22 Jun, 2026' },
    ],
  },
  {
    id: '3',
    title: 'Sync bookmark qua thiet bi',
    description: 'Dong bo bookmark giua cac thiet bi khac nhau khi login cung account.',
    votes: 29,
    status: 'planned',
    author: 'Khoa',
    date: '5 May, 2026',
    topics: ['New feature', 'Integrations'],
    comments: [
      { id: 'c6', author: 'Hoa', content: 'Real-time sync hay manual trigger?', date: '6 May, 2026' },
      { id: 'c7', author: 'Khoa', content: 'Real-time se tot hon, nhung manual cung OK.', date: '6 May, 2026' },
      { id: 'c8', author: 'Minh', content: 'Can conflict resolution strategy.', date: '7 May, 2026' },
    ],
  },
  {
    id: '4',
    title: 'Keyboard shortcut cho moi action',
    description: 'Mo rong keyboard shortcut coverage, cho phep custom key binding.',
    votes: 25,
    status: 'under-consideration',
    author: 'Tung',
    date: '12 Apr, 2026',
    topics: ['Improvement'],
    comments: [
      { id: 'c9', author: 'Nam', content: 'Vim-style keybinding pls!', date: '13 Apr, 2026' },
    ],
  },
  {
    id: '5',
    title: 'Widget thoi tiet tren homepage',
    description: 'Hien thi thoi tiet hien tai ngay tren HubPro homepage.',
    votes: 18,
    status: 'not-likely',
    author: 'Hoa',
    date: '1 Mar, 2026',
    topics: ['New feature'],
    comments: [],
  },
  {
    id: '6',
    title: 'Pomodoro timer tich hop',
    description: 'Bo dem Pomodoro tich hop ngay trong app, dong bo voi Tasks.',
    votes: 33,
    status: 'under-consideration',
    author: 'Nam',
    date: '28 Feb, 2026',
    topics: ['New feature', 'Productivity'],
    comments: [
      { id: 'c10', author: 'Lan', content: 'Co notification sound khong?', date: '1 Mar, 2026' },
      { id: 'c11', author: 'Tung', content: 'Nen integrate voi Tasks — auto log time.', date: '2 Mar, 2026' },
    ],
  },
];

export const DUMMY_ANNOUNCEMENTS: Announcement[] = [
  {
    id: '1',
    title: 'Dark mode Reader da ship',
    content: 'Reader gio da ho tro dark mode. Vao Library > mo sach bat ky > click icon mat trang de chuyen. Tinh nang nay hoat dong ca voi PDF va EPUB.',
    date: '10 Aug, 2026',
    tags: [
      { label: 'New Feature', color: 'rgb(99, 146, 217)' },
      { label: 'Shipped', color: 'rgb(68, 221, 204)' },
    ],
  },
  {
    id: '2',
    title: 'Cai thien hieu nang JSON Studio',
    content: 'JSON Studio gio co the xu ly file len toi 50MB ma khong lag. Su dung virtualized tree + web worker de parse background.',
    date: '1 Aug, 2026',
    tags: [{ label: 'Improvement', color: 'rgb(99, 200, 217)' }],
  },
  {
    id: '3',
    title: 'Agency Studio ra mat',
    content: 'Tool quan ly lead va email outreach moi da san sang. Tao campaign, track open/click, va quan ly template email ngay trong hub.',
    date: '15 Jul, 2026',
    tags: [
      { label: 'New Feature', color: 'rgb(99, 146, 217)' },
      { label: 'Announcement', color: 'rgb(255, 60, 60)' },
    ],
  },
];
