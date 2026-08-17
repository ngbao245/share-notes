// ============================================================
// Folder diff — so sánh 2 folder slot bất kỳ
// ============================================================
//
// Match theo relative path (không tính prefix slot label).
// Classification:
//   - added:     path có trong B, không trong A
//   - removed:   path có trong A, không trong B
//   - modified:  path có cả 2, size khác nhau (heuristic nhanh)
//   - unchanged: path có cả 2, size giống nhau
//
// "Modified" là heuristic — 2 file cùng size vẫn có thể khác content
// (ít khả năng với text file cùng path). Deep compare content = future work.
// ============================================================

export interface FolderFile {
  file: File;
  path: string;
}

export interface DiffEntry {
  path: string;
  sizeA?: number;
  sizeB?: number;
  sizeDelta?: number; // sizeB - sizeA (chỉ có cho modified)
}

export interface FolderDiff {
  added: DiffEntry[];
  removed: DiffEntry[];
  modified: DiffEntry[];
  unchangedCount: number;
}

/**
 * Compute diff giữa 2 folder slots (based on relative path + file size).
 */
export function computeFolderDiff(
  filesA: FolderFile[],
  filesB: FolderFile[],
): FolderDiff {
  const mapA = new Map<string, FolderFile>();
  for (const f of filesA) mapA.set(f.path, f);
  const mapB = new Map<string, FolderFile>();
  for (const f of filesB) mapB.set(f.path, f);

  const added: DiffEntry[] = [];
  const removed: DiffEntry[] = [];
  const modified: DiffEntry[] = [];
  let unchangedCount = 0;

  // Scan B: added + modified + unchanged
  for (const [path, fb] of mapB) {
    const fa = mapA.get(path);
    if (!fa) {
      added.push({ path, sizeB: fb.file.size });
    } else if (fa.file.size !== fb.file.size) {
      modified.push({
        path,
        sizeA: fa.file.size,
        sizeB: fb.file.size,
        sizeDelta: fb.file.size - fa.file.size,
      });
    } else {
      unchangedCount++;
    }
  }

  // Scan A: removed (không có trong B)
  for (const [path, fa] of mapA) {
    if (!mapB.has(path)) {
      removed.push({ path, sizeA: fa.file.size });
    }
  }

  // Sort mỗi list theo path để hiển thị ổn định
  const byPath = (x: DiffEntry, y: DiffEntry) => x.path.localeCompare(y.path);
  added.sort(byPath);
  removed.sort(byPath);
  modified.sort(byPath);

  return { added, removed, modified, unchangedCount };
}

/**
 * Format bytes ngắn gọn cho UI.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
}
