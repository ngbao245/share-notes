import type { PackerPreset } from './types';

// ============================================================
// Packer presets - cho từng loại project
// ============================================================
//
// User chọn 1 preset → exclude/include được auto-fill, vẫn edit được sau.
// ============================================================

const COMMON_EXCLUDES = [
  // Dependencies
  'node_modules/',
  // Build outputs
  'dist/',
  'build/',
  'out/',
  // Dev caches
  '.git/',
  '.cache/',
  '.parcel-cache/',
  // System
  '.DS_Store',
  'Thumbs.db',
  // Lock files (npm install lại được, size lớn)
  '*.lock',
  'yarn.lock',
  'pnpm-lock.yaml',
  // Logs
  '*.log',
  'logs/',
  // Env (security)
  '.env',
  '.env.local',
  '.env.*.local',
  // IDE
  '.vscode/',
  '.idea/',
];

export const PRESETS: PackerPreset[] = [
  {
    id: 'react',
    label: 'React (Vite/CRA)',
    excludePatterns: [
      ...COMMON_EXCLUDES,
      '.vite/',
      'coverage/',
    ],
    includeExtensions: [
      '.ts',
      '.tsx',
      '.js',
      '.jsx',
      '.mjs',
      '.cjs',
      '.css',
      '.scss',
      '.sass',
      '.html',
      '.json',
      '.md',
      '.svg',
      '.gitignore',
      '.npmrc',
      '.editorconfig',
      '.prettierrc',
      '.prettierignore',
      '.eslintrc',
    ],
  },
  {
    id: 'next',
    label: 'Next.js',
    excludePatterns: [
      ...COMMON_EXCLUDES,
      '.next/',
      '.turbo/',
      'coverage/',
    ],
    includeExtensions: [
      '.ts',
      '.tsx',
      '.js',
      '.jsx',
      '.mjs',
      '.css',
      '.scss',
      '.html',
      '.json',
      '.md',
      '.mdx',
      '.svg',
      '.gitignore',
      '.npmrc',
      '.eslintrc',
    ],
  },
  {
    id: 'vanilla',
    label: 'Vanilla HTML/CSS/JS',
    excludePatterns: COMMON_EXCLUDES,
    includeExtensions: [
      '.html',
      '.htm',
      '.css',
      '.js',
      '.json',
      '.md',
      '.svg',
      '.txt',
    ],
  },
  {
    id: 'all',
    label: 'Tất cả file text',
    excludePatterns: COMMON_EXCLUDES,
    includeExtensions: [], // Empty = pack tất cả (filter chỉ bằng exclude)
  },
];

export function getPresetById(id: string): PackerPreset | undefined {
  return PRESETS.find((p) => p.id === id);
}