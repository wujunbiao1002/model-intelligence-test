'use client';

import { useEffect, useState } from 'react';
import { Check, Copy, Trash2, X } from 'lucide-react';
import type { WorkRecord } from '@/types';
import ArtifactFrame from '@/components/ArtifactFrame';
import { EFFORT_LABELS, formatDuration, formatTime } from '@/lib/format';

export default function WorkModal({ work, onClose, onDelete }: { work: WorkRecord; onClose: () => void; onDelete: () => void }) {
  const [copied, setCopied] = useState(false);
  const group = work.groupName || work.keyName;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(work.prompt);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch { /* Clipboard can be blocked in embedded frames; the text stays selectable. */ }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${group} · ${work.model}`}
        className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-background shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <span className="mb-1.5 inline-block rounded-md bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">组 · {group}</span>
            <div className="truncate text-lg font-semibold">{work.model}</div>
            <div className="text-xs text-muted">
              思考强度 {EFFORT_LABELS[work.effort]} · 耗时 {formatDuration(work.durationMs)} · {formatTime(work.createdAt)}
            </div>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 rounded p-2 hover:bg-line/50" aria-label="关闭"><X size={20} /></button>
        </div>

        <div className="space-y-4 overflow-y-auto p-5">
          <div className="overflow-hidden rounded-lg border border-line">
            <ArtifactFrame artifact={work} title={`${group} · ${work.model}`} />
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-sm font-medium">提示词</span>
              <button type="button" onClick={() => void copyPrompt()} className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted hover:bg-line/50 hover:text-foreground">
                {copied ? <><Check size={14} />已复制</> : <><Copy size={14} />复制</>}
              </button>
            </div>
            <p className="whitespace-pre-wrap break-words rounded-lg border border-line bg-line/20 px-3 py-2 text-sm leading-relaxed">{work.prompt}</p>
          </div>

          <div className="flex justify-end">
            <button type="button" onClick={onDelete} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-error hover:bg-error/10">
              <Trash2 size={14} />删除作品
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
