import { useRef, useState } from 'react';
import { FileDown, RotateCcw, Upload, Archive } from 'lucide-react';
import { PackerLoadingSpinner } from './PackerLoadingSpinner';

import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';

import TerminalLog from './TerminalLog';
import { unpackText, buildZip, downloadBlob } from '@/tools/project-packer/lib/unpack';
import type { LogEntry } from '@/tools/project-packer/lib/types';

// ============================================================
// UnpackPanel - Tab "Giải nén"
// ============================================================
//
// 3 cách input:
// 1. Paste text vào textarea
// 2. Upload .txt files
// 3. Upload .zip (output v1 Project Packer) → extract chunks → parse
// ============================================================

export default function UnpackPanel() {
    const [text, setText] = useState('');
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const zipInputRef = useRef<HTMLInputElement>(null);
    const logIdRef = useRef(0);

    function log(message: string, type: LogEntry['type'] = 'info') {
        setLogs((prev) => [
            ...prev,
            { id: ++logIdRef.current, message, type, timestamp: new Date() },
        ]);
    }

    function reset() {
        setText('');
        setLogs([]);
        setIsProcessing(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
    }

    async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
        const files = Array.from(e.target.files ?? []);
        if (files.length === 0) return;

        log(`Đọc ${files.length} file...`);
        // Sort theo tên để đúng thứ tự part-01, part-02...
        files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

        const contents = await Promise.all(
            files.map(
                (f) =>
                    new Promise<string>((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = (ev) => resolve(String(ev.target?.result ?? ''));
                        reader.onerror = () => reject(new Error(`Không đọc được ${f.name}`));
                        reader.readAsText(f);
                    }),
            ),
        );

        const merged = contents.join('\n\n');
        setText(merged);
        log(`✓ Đã load ${files.length} file (${merged.length.toLocaleString('vi-VN')} ký tự)`, 'success');
    }

    async function handleZipUpload(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (!file) return;

        if (!file.name.endsWith('.zip')) {
            toast.error('Vui lòng chọn file .zip');
            return;
        }

        setIsProcessing(true);
        setLogs([]);
        log(`Đọc ZIP: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`);

        try {
            const { default: JSZip } = await import('jszip');
            const zip = await JSZip.loadAsync(file);

            // Tìm tất cả .txt files trong ZIP
            const txtFiles: { name: string; content: string }[] = [];
            const entries = Object.entries(zip.files).filter(
                ([name, entry]) => name.endsWith('.txt') && !entry.dir,
            );

            log(`Tìm thấy ${entries.length} file .txt trong ZIP`);

            // Sort theo tên (part-1, part-2...)
            entries.sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));

            for (const [name, entry] of entries) {
                const content = await entry.async('text');
                txtFiles.push({ name, content });
                log(`Extracted: ${name} (${(content.length / 1024).toFixed(1)} KB)`);
            }

            if (txtFiles.length === 0) {
                log('Không tìm thấy file .txt nào trong ZIP', 'error');
                toast.error('ZIP không chứa file .txt');
                setIsProcessing(false);
                return;
            }

            const merged = txtFiles.map((f) => f.content).join('\n\n');
            setText(merged);
            log(`✓ Extracted ${txtFiles.length} chunk(s), tổng ${merged.length.toLocaleString('vi-VN')} ký tự`, 'success');
            toast.success(`Đã extract ${txtFiles.length} file từ ZIP`);
        } catch (err) {
            log(`Lỗi đọc ZIP: ${String(err)}`, 'error');
            toast.error('Không đọc được file ZIP');
        }

        setIsProcessing(false);
        if (zipInputRef.current) zipInputRef.current.value = '';
    }

    async function handleUnpack() {
        if (!text.trim()) {
            toast.error('Hãy paste text hoặc upload file trước');
            return;
        }

        setIsProcessing(true);
        setLogs([]);
        log('Bắt đầu giải nén...');

        try {
            const { files, partsDetected } = unpackText(text);
            log(`Phát hiện ${partsDetected} part`);
            log(`Parse được ${files.length} file`);

            if (files.length === 0) {
                log('Không tìm thấy file nào trong text', 'error');
                toast.error('Không parse được file. Kiểm tra format.');
                setIsProcessing(false);
                return;
            }

            // Validate path không rỗng
            const validFiles = files.filter((f) => f.path && f.path.trim());
            if (validFiles.length < files.length) {
                log(`Bỏ qua ${files.length - validFiles.length} file path rỗng`, 'warning');
            }

            log('Đang tạo file ZIP...');
            const blob = await buildZip(validFiles);
            log(`✓ ZIP size: ${(blob.size / 1024).toFixed(2)} KB`, 'success');

            downloadBlob(blob, 'project-unpacked.zip');
            log(`✓ Đã download project-unpacked.zip với ${validFiles.length} file`, 'success');
            toast.success(`Đã giải nén ${validFiles.length} file`);
        } catch (e) {
            log(`Lỗi: ${String(e)}`, 'error');
            toast.error('Giải nén thất bại');
        }

        setIsProcessing(false);
    }

    const charCount = text.length;
    const filesHint =
        text.match(/===FILE_START===/g)?.length ?? 0;

    return (
        <div className="grid h-full gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            {/* ===== Cột trái: Input ===== */}
            <div className="flex flex-col border border-border bg-card">
                {/* Header — chỉ stats */}
                <div className="flex items-center border-b border-border bg-muted px-3 py-2">
                    <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Paste text {charCount > 0 && (
                            <span className="normal-case font-normal">
                                — {charCount.toLocaleString('vi-VN')} ký tự
                                {filesHint > 0 && ` · ${filesHint} file`}
                            </span>
                        )}
                    </span>
                </div>
                {/* Textarea */}
                <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder={'===FILE_START===\nPATH: src/App.tsx\nCONTENT_START:\n...\n===FILE_END==='}
                    className="flex-1 resize-none bg-background p-3 font-mono text-xs focus:outline-none"
                />
                {/* Footer — tất cả buttons bên phải */}
                <div className="flex items-center justify-end gap-2 border-t border-border px-3 py-2">
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".txt,.bibopack"
                        multiple
                        className="hidden"
                        onChange={handleFileUpload}
                    />
                    <input
                        ref={zipInputRef}
                        type="file"
                        accept=".zip"
                        className="hidden"
                        onChange={handleZipUpload}
                    />
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => zipInputRef.current?.click()}
                        disabled={isProcessing}
                        className="h-7 gap-1.5 px-2 text-xs"
                    >
                        <Archive className="h-3 w-3" />
                        .zip
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isProcessing}
                        className="h-7 gap-1.5 px-2 text-xs"
                    >
                        <Upload className="h-3 w-3" />
                        .txt
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={reset}
                        disabled={isProcessing}
                        className="h-7 gap-1.5 px-2 text-xs"
                    >
                        <RotateCcw className="h-3 w-3" />
                    </Button>
                    <Button
                        size="sm"
                        onClick={handleUnpack}
                        disabled={isProcessing || !text.trim()}
                        className="gap-1.5"
                    >
                        {isProcessing ? (
                            <PackerLoadingSpinner size="sm" />
                        ) : (
                            <FileDown className="h-3 w-3" />
                        )}
                        {isProcessing ? 'Đang xử lý...' : 'Giải nén → ZIP'}
                    </Button>
                </div>
            </div>

            {/* ===== Cột phải: Terminal Log (cùng height với trái) ===== */}
            <div className="flex min-h-0 flex-col">
                <TerminalLog logs={logs} className="flex flex-1 flex-col [&>div:last-child]:max-h-none [&>div:last-child]:flex-1" />
            </div>
        </div>
    );
}
