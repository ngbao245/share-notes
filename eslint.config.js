import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

// Rule cấm dùng `localStorage` / `sessionStorage` trực tiếp trong tool code.
// Buộc dùng `createToolStorage()` từ `@/lib/plugin-storage`. Xem README của module đó.
// Detect qua no-restricted-syntax vì `no-restricted-globals` không catch MemberExpression access.
const NO_DIRECT_STORAGE = [
  'error',
  {
    selector: "MemberExpression[object.name='localStorage']",
    message:
      'Dùng createToolStorage() từ @/lib/plugin-storage thay vì localStorage trực tiếp. Xem src/lib/plugin-storage/README.md.',
  },
  {
    selector: "MemberExpression[object.name='sessionStorage']",
    message:
      'Facade chưa hỗ trợ sessionStorage. Nếu cần ephemeral state, dùng React state hoặc mở spec sessionStorage facade.',
  },
  {
    selector: "CallExpression[callee.object.name='window'][callee.property.name=/^(local|session)Storage$/]",
    message: 'Dùng createToolStorage() thay vì window.localStorage / window.sessionStorage.',
  },
];

export default tseslint.config(
  { ignores: ['dist', 'backup', 'changed-files', 'node_modules'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-restricted-syntax': NO_DIRECT_STORAGE,
    },
  },
  // Allowlist storage-direct access. Chia 2 nhóm:
  //  - Facade internals + logout cleanup — cần iterate localStorage
  //  - Cache Inspector (debug tool đọc tất cả keys để hiển thị)
  //  - useLocalStorage/useSessionStorage hooks — utility, sẽ migrate consumer sau
  //  - json-studio internals (sessionStorage cho editor draft, out of scope facade v1)
  //  - PdfReader sessionStorage (scroll positions per-book, out of scope v1)
  //  - Tests
  {
    files: [
      'src/lib/plugin-storage/**/*.{ts,tsx}',
      'src/lib/auth/user-scope.ts',
      'src/lib/cacheInspect.ts',
      'src/components/setting/CacheInspectorPanel.tsx',
      'src/components/cache/**/*.{ts,tsx}',
      'src/hooks/useLocalStorage.ts',
      'src/hooks/useSessionStorage.ts',
      'src/tools/library/components/PdfReader.tsx',
      'src/tools/json-studio/prefs-store.ts',
      'src/tools/json-studio/store.ts',
      'src/tools/json-studio/editor-store.ts',
      'src/tools/json-studio/components/workspaces/DiffWorkspace.tsx',
      '**/*.test.{ts,tsx}',
    ],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
);
