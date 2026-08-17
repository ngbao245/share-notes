# Mojibake Fix — Kinh nghiệm + Plan cho auto-fix tool

Status: Notes. Tool chưa build.

## Nguyên nhân

File source code UTF-8 bị commit qua process decode sai encoding (CP1252 / Latin-1 / Windows-1252). Mỗi ký tự tiếng Việt (2-3 bytes UTF-8) bị hiểu thành 2-3 ký tự Latin-1 riêng biệt.

VD: "Quản lý" (UTF-8) → "Quß║ún lừ" (bị decode CP1252)

Nguyên nhân cụ thể trong repo này: commit `1774297d` và các commit trước đó dùng tool/editor lưu file với encoding sai. Commit `38c70fd` (fix garbled first pass) fix được 1 phần nhưng chưa hết.

## Công thức reverse

```python
# Nguyên lý:
#   UTF-8 bytes → bị decode bằng CP1252 → ra mojibake string
# Reverse:
#   mojibake string → encode bằng CP1252 → ra UTF-8 bytes gốc → decode UTF-8
fixed = broken_text.encode('cp1252').decode('utf-8')
```

Hoạt động vì CP1252 là superset ASCII, mỗi byte 0x80-0xFF map 1:1 sang 1 character. Encode ngược lấy lại bytes gốc.

## Detection pattern

Regex detect dòng có mojibake tiếng Việt (đủ specificity cho repo này):

```python
import re
MOJIBAKE = re.compile(r'ß║|ß╗|╞░|╞í|├¬|├⌐|├│|├▓|├║|├╣|├ó|─æ|─É|─â|Γö|ΓÇ')
```

Giải thích:
- `ß║` + `ß╗` — prefix cho hầu hết vowel có dấu (ạ, ả, ấ, ầ, ẹ, ế, ọ, ố, ờ, ự...)
- `╞░` — chữ "ư"
- `╞í` — chữ "ơ"
- `├¬` — chữ "ê"
- `├⌐` — chữ "é"
- `├│` — chữ "ó"
- `├▓` — chữ "ò"
- `├║` — chữ "ú"
- `├╣` — chữ "ù"
- `├ó` — chữ "â"
- `─æ` — chữ "đ"
- `─É` — chữ "Đ"
- `─â` — chữ "ă"
- `Γö` — box drawing chars (em-dash, quotes bị corrupt)
- `ΓÇ` — em-dash `—` bị thành `ΓÇö`

## Script auto-fix (draft)

```python
#!/usr/bin/env python3
"""
Fix mojibake tiếng Việt trong repo.
Scan files, detect dòng bị, reverse encode CP1252 → UTF-8.

Usage:
  python fix_mojibake.py [--dry-run] [path...]
  
  --dry-run: chỉ report, không sửa file
  path: folder/file cụ thể (default: src/ docs/ .gitignore)
"""
import os
import re
import sys

MOJIBAKE = re.compile(r'ß║|ß╗|╞░|╞í|├¬|├⌐|├│|├▓|├║|├╣|├ó|─æ|─É|─â|Γö|ΓÇ')
EXTENSIONS = {'.ts', '.tsx', '.css', '.md', '.json', '.html', '.js'}
SKIP_DIRS = {'node_modules', 'dist', '.git', '.codegraph', 'backup', 'changed-files'}

def fix_line(line: str) -> tuple[str, bool]:
    """Try reverse mojibake. Return (fixed_line, was_changed)."""
    if not MOJIBAKE.search(line):
        return line, False
    try:
        fixed = line.encode('cp1252').decode('utf-8')
        return fixed, True
    except (UnicodeDecodeError, UnicodeEncodeError):
        # Không reverse được (mixed encoding, partial corruption)
        return line, False

def fix_file(path: str, dry_run: bool = False) -> int:
    """Fix 1 file. Return số dòng đã sửa."""
    with open(path, 'r', encoding='utf-8') as f:
        lines = f.readlines()
    
    fixed_lines = []
    count = 0
    for i, line in enumerate(lines, 1):
        new_line, changed = fix_line(line)
        fixed_lines.append(new_line)
        if changed:
            count += 1
            if dry_run:
                print(f'  L{i}: {line.rstrip()[:80]}')
                print(f'    → {new_line.rstrip()[:80]}')
    
    if count > 0 and not dry_run:
        with open(path, 'w', encoding='utf-8', newline='') as f:
            f.writelines(fixed_lines)
    
    return count

def scan(targets: list[str], dry_run: bool):
    total_files = 0
    total_lines = 0
    
    for target in targets:
        if os.path.isfile(target):
            ext = os.path.splitext(target)[1]
            if ext in EXTENSIONS:
                count = fix_file(target, dry_run)
                if count > 0:
                    action = '[DRY]' if dry_run else '[FIX]'
                    print(f'{action} {target} — {count} lines')
                    total_files += 1
                    total_lines += count
        elif os.path.isdir(target):
            for root, dirs, files in os.walk(target):
                dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
                for name in files:
                    ext = os.path.splitext(name)[1]
                    if ext not in EXTENSIONS:
                        continue
                    path = os.path.join(root, name)
                    count = fix_file(path, dry_run)
                    if count > 0:
                        action = '[DRY]' if dry_run else '[FIX]'
                        print(f'{action} {path} — {count} lines')
                        total_files += 1
                        total_lines += count
    
    print(f'\nTotal: {total_files} files, {total_lines} lines {"(dry run)" if dry_run else "fixed"}')

if __name__ == '__main__':
    args = sys.argv[1:]
    dry_run = '--dry-run' in args
    args = [a for a in args if a != '--dry-run']
    
    if not args:
        args = ['src', 'docs', '.gitignore']
    
    scan(args, dry_run)
```

## Edge cases cần handle (khi build tool thật)

1. **Mixed line** — 1 dòng có cả text đúng + mojibake. `encode('cp1252')` sẽ fail nếu text đúng chứa ký tự ngoài CP1252 range (VD emoji). Cần split line thành segments, try fix từng segment.

2. **Double-encoded** — file bị encode sai 2 lần (hiếm nhưng có). Cần detect và apply reverse 2 lần.

3. **Binary/non-text** — skip file có null byte hoặc detect binary.

4. **Git diff safety** — chạy `git diff --stat` sau fix để verify không sửa logic code (chỉ sửa comment/string).

5. **JSON files** — cẩn thận với escape sequences. `\"` trong JSON string không nên bị mangle.

6. **Dấu nháy** — `'` và `"` trong string literals có thể bị corrupt thành `ΓÇÖ` / `ΓÇ£`. Cần map riêng.

## Files đã fix manual trong session này

- `src/lib/tools.ts` — full rewrite (25+ dòng)
- `src/routes/HubPro.tsx` — 21 vùng str_replace
- `src/styles/index.css` — 8 dòng
- `.gitignore` — 1 dòng

## Files có thể còn bị (chưa scan)

Cần chạy script với `--dry-run` trên:
- `src/tools/project-packer/components/PackPanel.tsx` (user đã mở, comments có TV)
- `src/tools/project-packer/components/UnpackPanel.tsx`
- `docs/*.md`
- Bất kỳ file nào có comment tiếng Việt commit trước `38c70fd`

## Khi nào build tool

Khi rảnh, không urgent. Approach hiện tại (Kiro đọc + fix manual theo context) hoạt động tốt cho từng file. Tool hữu ích khi:
- Cần batch fix 50+ file cùng lúc
- CI hook detect mojibake trong PR mới (prevent regression)
- New contributor commit từ editor có encoding issue

## Prevent regression

Thêm vào CI (GitHub Actions):
```yaml
- name: Detect mojibake
  run: |
    if grep -rP 'ß║|ß╗|╞░|├¬|─æ|ΓÇ' src/ docs/ --include='*.ts' --include='*.tsx' --include='*.css' --include='*.md'; then
      echo "::error::Mojibake detected! Run fix_mojibake.py"
      exit 1
    fi
```
