import { useState } from 'react';
import { Copy, Terminal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from '@/components/ui/sonner';

// ============================================================
// ScriptGenerator — generate PowerShell script to export git commits
// ============================================================

interface ScriptGeneratorProps {
  /** compact mode khi hiện trong tab nhỏ (sau khi đã import folder) */
  compact?: boolean;
}

export default function ScriptGenerator({ compact }: ScriptGeneratorProps) {
  const [commits, setCommits] = useState('');
  const [outputBase, setOutputBase] = useState('');
  const [openFolder, setOpenFolder] = useState(true);
  const [exportOutside, setExportOutside] = useState(true); // true = cd .. ra parent, false = tạo trong repo

  function generateScript(): string {
    const lines = commits
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    if (lines.length === 0) return '# Nhap commit hash phia tren';

    const folderName = outputBase || 'export';

    if (lines.length === 1) {
      const hash = lines[0];
      const short = hash.slice(0, 7);

      const parts: string[] = [];

      if (exportOutside) {
        parts.push(
          `$repoRoot = (Get-Location).Path`,
          `Set-Location ..`,
          `$outputBase = Join-Path (Get-Location).Path "${folderName}"`,
        );
      } else {
        parts.push(
          `$repoRoot = (Get-Location).Path`,
          `$outputBase = Join-Path $repoRoot "${folderName}"`,
        );
      }

      parts.push(
        `$commit = "${hash}"`,
        `$output = Join-Path $outputBase "commit-${short}"`,
        `New-Item -ItemType Directory -Force -Path $output | Out-Null`,
        ``,
        `git -C $repoRoot diff-tree --no-commit-id --name-status -r $commit |`,
        `ForEach-Object {`,
        `    $parts = $_ -split "\`t"`,
        `    $status = $parts[0]`,
        `    if ($status -eq "D") { return }`,
        `    if ($status.StartsWith("R")) { $file = $parts[2] } else { $file = $parts[1] }`,
        `    $srcFile = Join-Path $repoRoot $file`,
        `    if (-not (Test-Path $srcFile)) { Write-Warning "Skip: $file"; return }`,
        `    $dest = Join-Path $output $file`,
        `    New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null`,
        `    Copy-Item -Path $srcFile -Destination $dest -Force`,
        `    Write-Host "  $file"`,
        `}`,
        ``,
        `Write-Host "Done! Commit: $($commit.Substring(0,7)) -> $output"`,
      );

      if (openFolder) {
        parts.push(`explorer.exe $outputBase`);
      }
      return parts.join('\n');
    }

    // Multi commit
    const commitList = lines.map((h) => `"${h}"`).join(', ');
    const padLen = String(lines.length).length < 3 ? 3 : String(lines.length).length;

    const parts: string[] = [];

    if (exportOutside) {
      parts.push(
        `$repoRoot = (Get-Location).Path`,
        `Set-Location ..`,
        `$outputBase = Join-Path (Get-Location).Path "${folderName}"`,
      );
    } else {
      parts.push(
        `$repoRoot = (Get-Location).Path`,
        `$outputBase = Join-Path $repoRoot "${folderName}"`,
      );
    }

    parts.push(
      `$commits = @(${commitList})`,
      ``,
      `for ($i = 0; $i -lt $commits.Length; $i++) {`,
      `    $commit = $commits[$i]`,
      `    $num = ($i + 1).ToString().PadLeft(${padLen}, '0')`,
      `    $short = $commit.Substring(0, 7)`,
      `    $output = Join-Path $outputBase "$num-commit-$short"`,
      `    New-Item -ItemType Directory -Force -Path $output | Out-Null`,
      ``,
      `    git -C $repoRoot diff-tree --no-commit-id --name-status -r $commit |`,
      `    ForEach-Object {`,
      `        $parts = $_ -split "\`t"`,
      `        $status = $parts[0]`,
      `        if ($status -eq "D") { return }`,
      `        if ($status.StartsWith("R")) { $file = $parts[2] } else { $file = $parts[1] }`,
      `        $srcFile = Join-Path $repoRoot $file`,
      `        if (-not (Test-Path $srcFile)) { Write-Warning "Skip: $file"; return }`,
      `        $dest = Join-Path $output $file`,
      `        New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null`,
      `        Copy-Item -Path $srcFile -Destination $dest -Force`,
      `        Write-Host "  $file"`,
      `    }`,
      `    Write-Host "Done: $num-commit-$short"`,
      `}`,
      ``,
      `Write-Host ""`,
      `Write-Host "All done! ${lines.length} commits exported to: $outputBase"`,
    );

    if (openFolder) {
      parts.push(`explorer.exe $outputBase`);
    }
    return parts.join('\n');
  }

  const script = generateScript();

  function handleCopy() {
    navigator.clipboard.writeText(script);
    toast.success('Copied script');
  }

  if (compact) {
    return (
      <div className="border border-border bg-card">
        <div className="border-b border-border bg-muted px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Git Export Script
        </div>
        <div className="space-y-2 p-3">
          <div className="flex gap-2">
            <input
              value={commits}
              onChange={(e) => setCommits(e.target.value)}
              placeholder="commit hash (1 hoac nhieu dong)"
              className="h-7 flex-1 border border-input bg-background px-2 font-mono text-[11px] focus:border-primary focus:outline-none"
            />
            <Button size="sm" variant="outline" onClick={handleCopy} className="h-7 gap-1 px-2 text-xs">
              <Copy className="h-3 w-3" />
            </Button>
          </div>
          <input
            value={outputBase}
            onChange={(e) => setOutputBase(e.target.value)}
            placeholder="export"
            className="h-7 w-full border border-input bg-background px-2 font-mono text-[11px] focus:border-primary focus:outline-none"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border bg-muted px-3 py-2">
        <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Git Export Script
        </span>
      </div>
      <div className="space-y-3 p-4">
        <p className="text-xs text-muted-foreground">
          Nhap commit hash + ten folder. Copy script chay trong PowerShell{' '}
          <span className="rounded bg-muted px-1 font-mono text-[10px]">tai git repo</span>.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Commit hash (moi dong 1 hash)
            </label>
            <textarea
              value={commits}
              onChange={(e) => setCommits(e.target.value)}
              placeholder={'abc1234\ndef5678\n...'}
              rows={3}
              className="w-full resize-none border border-input bg-background p-2 font-mono text-xs focus:border-primary focus:outline-none"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Ten folder output
            </label>
            <input
              value={outputBase}
              onChange={(e) => setOutputBase(e.target.value)}
              placeholder="export"
              className="h-8 w-full border border-input bg-background px-2 font-mono text-xs focus:border-primary focus:outline-none"
            />
            <p className="text-[10px] text-muted-foreground">
              {exportOutside
                ? 'Tao folder nay tai parent cua git repo (cd ..)'
                : 'Tao folder nay ben trong git repo'}
              {commits.split('\n').filter((l) => l.trim()).length > 1
                ? `. ${commits.split('\n').filter((l) => l.trim()).length} subfolder: NNN-commit-{hash7}/`
                : ''}
            </p>
          </div>
        </div>

        {/* Options */}
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <Checkbox
              checked={exportOutside}
              onCheckedChange={(checked) => setExportOutside(!!checked)}
            />
            <span>Tao o ngoai repo (cd ..)</span>
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <Checkbox
              checked={openFolder}
              onCheckedChange={(checked) => setOpenFolder(!!checked)}
            />
            <span>Mo folder sau khi xong</span>
          </label>
        </div>

        {/* Script preview */}
        <div className="relative">
          <pre className="max-h-48 overflow-auto border border-border bg-background p-3 font-mono text-[11px] text-muted-foreground">
            {script}
          </pre>
          <Button
            size="sm"
            onClick={handleCopy}
            className="absolute right-2 top-2 h-7 gap-1.5 px-2 text-xs"
          >
            <Copy className="h-3 w-3" />
            Copy
          </Button>
        </div>
      </div>
    </div>
  );
}
