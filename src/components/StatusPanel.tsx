'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, ImageOff, Loader2, RefreshCw, X, XCircle } from 'lucide-react';
import type { Artifact, StatusData, StatusGroup, StatusRun } from '@/types';
import { fetchRunArtifact, fetchStatus } from '@/lib/status';
import { EFFORT_LABELS, formatDuration, formatTime } from '@/lib/format';
import ArtifactFrame from '@/components/ArtifactFrame';

const STATE_BADGE: Record<StatusGroup['state'], { label: string; className: string }> = {
  running: { label: '检测中', className: 'bg-blue-50 text-accent dark:bg-blue-950/40' },
  ok: { label: '检测完成', className: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' },
  failed: { label: '检测失败', className: 'bg-red-50 text-error dark:bg-red-950/40' },
  idle: { label: '等待检测', className: 'bg-line/60 text-muted' },
};

const REFRESH_MS = 60_000;

function useRunArtifact(run: StatusRun | undefined) {
  const file = run?.status === 'ok' ? run.file : undefined;
  const type = run?.type;
  const [loaded, setLoaded] = useState<{ file: string; artifact?: Artifact; error?: string } | null>(null);

  useEffect(() => {
    if (!file || !type) return;
    let cancelled = false;
    fetchRunArtifact(file, type)
      .then((artifact) => { if (!cancelled) setLoaded({ file, artifact }); })
      .catch((error: unknown) => { if (!cancelled) setLoaded({ file, error: error instanceof Error ? error.message : '加载失败' }); });
    return () => { cancelled = true; };
  }, [file, type]);

  const current = loaded && loaded.file === file ? loaded : null;
  return { artifact: current?.artifact, error: current?.error, loading: Boolean(file) && !current };
}

function RunPreview({ run, title, className = '', fill = false }: { run: StatusRun | undefined; title: string; className?: string; fill?: boolean }) {
  const { artifact, error, loading } = useRunArtifact(run);
  if (artifact) return <ArtifactFrame artifact={artifact} title={title} className={className} fill={fill} />;
  return (
    <div className={`flex w-full flex-col items-center justify-center gap-2 bg-line/30 p-3 text-center text-xs text-muted ${fill ? 'h-full' : 'aspect-[16/10]'} ${className}`}>
      {loading ? <Loader2 size={18} className="animate-spin" />
        : run?.status === 'failed' ? <XCircle size={fill ? 40 : 28} className="text-error" aria-label="检测失败" />
          : <><ImageOff size={20} /><span>{error ? '作品加载失败' : '暂无作品'}</span></>}
    </div>
  );
}

function RunThumb({ run, groupName, onOpen }: { run: StatusRun; groupName: string; onOpen: () => void }) {
  const detail = `第 ${run.round} 轮 · ${formatTime(run.startedAt)} · ${EFFORT_LABELS[run.effort]} · ${formatDuration(run.durationMs)}${run.status === 'failed' ? ' · 失败' : ''}`;
  return (
    <button
      type="button"
      onClick={onOpen}
      title={detail}
      aria-label={`${groupName} ${detail}`}
      className="group relative overflow-hidden rounded-lg border border-line text-left transition hover:border-accent/60 hover:shadow-md"
    >
      <RunPreview run={run} title={`${groupName} 第 ${run.round} 轮`} />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 translate-y-full bg-black/65 px-2 py-1.5 text-[11px] leading-tight text-white transition group-hover:translate-y-0 group-focus-visible:translate-y-0">
        <div className="truncate font-medium">{run.model}</div>
        <div className="truncate opacity-90">{detail}</div>
      </div>
    </button>
  );
}

function RunModal({ run, groupName, prompt, onClose }: { run: StatusRun; groupName: string; prompt: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${groupName} 第 ${run.round} 轮`}
        className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-background shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <span className="mb-1.5 inline-block rounded-md bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">组 · {groupName}</span>
            <div className="truncate text-lg font-semibold">{run.model}</div>
            <div className="text-xs text-muted">
              第 {run.round} 轮 · 思考强度 {EFFORT_LABELS[run.effort]} · 耗时 {formatDuration(run.durationMs)} · {formatTime(run.startedAt)}
            </div>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 rounded p-2 hover:bg-line/50" aria-label="关闭"><X size={20} /></button>
        </div>
        <div className="space-y-4 overflow-y-auto p-5">
          <RunPreview run={run} title={`${groupName} 第 ${run.round} 轮`} className="rounded-lg border border-line" />
          <div>
            <div className="mb-1.5 text-sm font-medium">提示词</div>
            <p className="whitespace-pre-wrap break-words rounded-lg border border-line bg-line/20 px-3 py-2 text-sm leading-relaxed">{prompt}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function GroupCard({ group, historySize, onOpen }: { group: StatusGroup; historySize: number; onOpen: (run: StatusRun) => void }) {
  const badge = STATE_BADGE[group.state] || STATE_BADGE.idle;
  const latest = group.runs[0];
  const latestOk = group.runs.find((run) => run.status === 'ok');

  return (
    <section className="rounded-xl border border-line bg-background p-5">
      <div className="mb-4 flex items-center justify-between gap-3 border-b border-line pb-4">
        <h3 className="truncate text-lg font-semibold">组 · {group.name}</h3>
        <span className={`shrink-0 rounded-full px-3 py-1 text-sm font-medium ${badge.className}`}>{badge.label}</span>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-medium">{badge.label}</div>
              <div className="truncate text-sm text-muted">{latest?.model || group.model} · 第 {group.round} 轮</div>
            </div>
            <div className="shrink-0 text-sm text-muted">{formatTime(latest?.startedAt)}</div>
          </div>
          <div className="mb-2 flex items-center justify-between text-xs text-muted">
            <span>最近{group.runs.length > 0 ? ` ${group.runs.length} ` : ''}次检测</span>
            <span>悬停查看详情 · 点击放大</span>
          </div>
          {group.runs.length === 0 ? (
            <div className="flex aspect-[16/10] items-center justify-center rounded-lg border border-dashed border-line text-sm text-muted">暂无检测记录</div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {group.runs.map((run) => (
                <RunThumb key={run.id} run={run} groupName={group.name} onOpen={() => onOpen(run)} />
              ))}
              {Array.from({ length: Math.max(0, historySize - group.runs.length) }, (_, index) => (
                <div key={`empty-${index}`} aria-hidden="true" className="flex aspect-[16/10] items-center justify-center rounded-lg border border-dashed border-line text-xs text-muted">待检测</div>
              ))}
            </div>
          )}
        </div>

        {/* On wide screens the preview stretches to the thumbnail grid's height; stacked, it keeps 16:10. */}
        <div className="flex min-w-0 flex-col">
          <div className="mb-3 flex items-center justify-between text-sm text-muted">
            <span>最新预览</span>
            <span>{formatTime(latestOk?.startedAt)}</span>
          </div>
          <div className="relative aspect-[16/10] lg:aspect-auto lg:min-h-0 lg:flex-1">
            {latestOk ? (
              <button type="button" onClick={() => onOpen(latestOk)} className="absolute inset-0 block overflow-hidden rounded-lg border border-line text-left transition hover:shadow-md" aria-label={`放大 ${group.name} 最新作品`}>
                <RunPreview run={latestOk} title={`${group.name} 最新预览`} fill />
              </button>
            ) : (
              <div className="absolute inset-0 overflow-hidden rounded-lg border border-line">
                <RunPreview run={undefined} title={`${group.name} 最新预览`} fill />
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

export default function StatusPanel() {
  const [status, setStatus] = useState<StatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ run: StatusRun; groupName: string } | null>(null);

  const load = useCallback(() => fetchStatus()
    .then((data) => {
      if (!data) throw new Error('尚未有检测结果，请等待定时任务运行后刷新');
      setStatus(data);
      setError(null);
    })
    .catch((err: unknown) => setError(err instanceof Error ? err.message : '加载失败'))
    .finally(() => { setLoading(false); setRefreshing(false); }), []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const refresh = () => { setRefreshing(true); void load(); };
  const closePreview = useCallback(() => setPreview(null), []);

  if (loading) return <div className="flex h-64 items-center justify-center text-muted">加载检测结果中...</div>;
  if (!status) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-12">
        <AlertCircle size={32} className="text-error" />
        <p className="text-sm text-error">{error}</p>
        <button type="button" onClick={refresh} className="inline-flex items-center gap-2 rounded-lg border border-line px-4 py-2 hover:bg-line/50">
          <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />重新加载
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-2xl font-semibold">{status.title || '系统检测'}</h2>
          <p className="mt-1 text-sm text-muted">每 {status.intervalMinutes} 分钟更新 · 查看最近{status.historySize}次检测预览 · 提示词：{status.prompt}</p>
        </div>
        <div className="flex items-center gap-3 text-right text-sm text-muted">
          <div>
            <div>更新于 {formatTime(status.updatedAt)}</div>
            <div>下次更新 {formatTime(status.nextUpdateAt)}</div>
          </div>
          <button type="button" onClick={refresh} className="rounded p-2 hover:bg-line/50" title="刷新" aria-label="刷新">
            <RefreshCw size={18} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {status.notice && <p className="text-sm text-muted">{status.notice}</p>}
      {error && <p role="alert" className="text-sm text-error">刷新失败：{error}（显示的是上次结果）</p>}

      {status.groups.length === 0 && <div className="py-12 text-center text-sm text-muted">配置中没有启用的分组</div>}
      {status.groups.map((group) => (
        <GroupCard key={group.id} group={group} historySize={status.historySize || 6} onOpen={(run) => setPreview({ run, groupName: group.name })} />
      ))}

      {preview && <RunModal run={preview.run} groupName={preview.groupName} prompt={status.prompt} onClose={closePreview} />}
    </div>
  );
}
