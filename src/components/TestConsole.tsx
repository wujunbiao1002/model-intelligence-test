'use client';

import { useCallback, useEffect, useState } from 'react';
import { Key, Loader2, Play, StopCircle, Trash2 } from 'lucide-react';
import { getSub2ApiModels } from '@/lib/sub2api-client';
import { useSub2ApiSession } from '@/components/AuthInitializer';
import { ChatError, runTest, SYSTEM_PROMPT } from '@/lib/test-client';
import ArtifactFrame from '@/components/ArtifactFrame';
import WorkModal from '@/components/WorkModal';
import { deleteWork, listWorks, saveWork } from '@/lib/work-store';
import type { Effort, WorkRecord } from '@/types';
import { EFFORT_LABELS, formatDuration, formatTime } from '@/lib/format';

const EFFORTS: Effort[] = ['default', 'low', 'medium', 'high', 'xhigh'];

export default function TestConsole() {
  const session = useSub2ApiSession();
  const [keyId, setKeyId] = useState<number | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState('');
  const [effort, setEffort] = useState<Effort>('high');
  const [prompt, setPrompt] = useState('用 SVG 画一只鹈鹕骑自行车的 2D 循环动画');
  const [running, setRunning] = useState(false);
  const [controller, setController] = useState<AbortController | null>(null);
  const [status, setStatus] = useState('');
  const [result, setResult] = useState<WorkRecord | null>(null);
  const [works, setWorks] = useState<WorkRecord[]>([]);
  const [viewing, setViewing] = useState<WorkRecord | null>(null);

  useEffect(() => {
    if (!keyId || !session.authenticated) return;
    let cancelled = false;
    getSub2ApiModels(keyId).then((list) => {
      if (!cancelled) {
        const ids = list.map((m) => m.id).sort();
        setModels(ids);
        if (ids.length > 0) setModel(ids[0]);
      }
    }).catch(() => { if (!cancelled) setModels([]); });
    return () => { cancelled = true; };
  }, [keyId, session.authenticated]);

  useEffect(() => {
    if (!session.user?.id) return;
    let cancelled = false;
    listWorks(session.user.id).then((list) => { if (!cancelled) setWorks(list); }).catch(() => {});
    return () => { cancelled = true; };
  }, [session.user?.id, result]);

  const handleStart = async () => {
    if (!keyId || !model || !prompt.trim() || !session.user?.id) return;
    setRunning(true);
    setStatus('正在调用模型...');
    setResult(null);
    const ctrl = new AbortController();
    setController(ctrl);
    try {
      const keyOption = session.keys?.find((k) => k.id === keyId);
      const testResult = await runTest({
        keyId,
        userId: session.user.id,
        model,
        effort,
        prompt: prompt.trim(),
        signal: ctrl.signal,
        onDelta: (state) => setStatus(`生成中... ${state.content.length} 字符`),
      });
      if (!testResult.artifact) throw new Error('回复中没有找到 SVG 或 HTML 作品');
      const record: WorkRecord = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        userId: session.user.id,
        model,
        groupName: keyOption?.groupName,
        keyName: keyOption?.name || `Key ${keyId}`,
        effort,
        prompt: prompt.trim(),
        type: testResult.artifact.type,
        content: testResult.artifact.content,
        durationMs: testResult.durationMs,
        createdAt: Date.now(),
      };
      await saveWork(record);
      setResult(record);
      setStatus('');
    } catch (error) {
      if ((error as { name?: string }).name === 'AbortError') {
        setStatus('已停止');
      } else {
        setStatus('错误：' + (error instanceof ChatError || error instanceof Error ? error.message : String(error)));
      }
    } finally {
      setRunning(false);
      setController(null);
    }
  };

  const handleStop = () => {
    controller?.abort();
  };

  const handleDelete = async (id: string): Promise<boolean> => {
    if (!confirm('确定删除这个作品？')) return false;
    await deleteWork(id);
    setWorks((current) => current.filter((w) => w.id !== id));
    return true;
  };

  const closeViewing = useCallback(() => setViewing(null), []);

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-line bg-background p-4">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
          <Key size={20} />
          我的测试
        </h2>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium">选择 API Key</label>
              <select
                value={keyId || ''}
                onChange={(e) => { setKeyId(Number(e.target.value) || null); setModels([]); setModel(''); }}
                disabled={running}
                className="w-full rounded border border-line bg-background px-3 py-2 text-sm focus:border-accent focus:outline-none disabled:opacity-50"
              >
                <option value="">请选择 Key</option>
                {session.keys?.map((key) => (
                  <option key={key.id} value={key.id}>
                    {key.name} {key.groupName ? `(${key.groupName})` : ''} · {key.maskedKey}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">选择模型</label>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                disabled={running || !keyId}
                className="w-full rounded border border-line bg-background px-3 py-2 text-sm focus:border-accent focus:outline-none disabled:opacity-50"
              >
                {models.length === 0 && <option value="">请先选择 Key</option>}
                {models.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">提示词</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={running}
              rows={3}
              placeholder="描述你想要的作品..."
              className="w-full rounded border border-line bg-background px-3 py-2 text-sm focus:border-accent focus:outline-none disabled:opacity-50"
            />
            <details className="mt-1.5 text-xs text-muted">
              <summary className="cursor-pointer select-none hover:text-foreground">系统提示词</summary>
              <p className="mt-1 leading-relaxed">{SYSTEM_PROMPT}</p>
            </details>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <label className="text-sm font-medium">思考强度</label>
              <div className="flex gap-2">
                {EFFORTS.map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => setEffort(e)}
                    disabled={running}
                    className={`rounded px-3 py-1 text-sm ${effort === e ? 'bg-accent text-white' : 'border border-line hover:bg-line/50'} disabled:opacity-50`}
                  >
                    {EFFORT_LABELS[e]}
                  </button>
                ))}
              </div>
            </div>

            {!running ? (
              <button
                type="button"
                onClick={() => void handleStart()}
                disabled={!keyId || !model || !prompt.trim()}
                className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-white hover:bg-accent/90 disabled:opacity-50"
              >
                <Play size={16} />
                开始测试
              </button>
            ) : (
              <button
                type="button"
                onClick={handleStop}
                className="inline-flex items-center gap-2 rounded-lg bg-error px-4 py-2 text-white hover:bg-error/90"
              >
                <StopCircle size={16} />
                停止
              </button>
            )}
          </div>

          {status && (
            <div className="flex items-center gap-2 text-sm text-muted">
              {running && <Loader2 size={14} className="animate-spin" />}
              {status}
            </div>
          )}
        </div>
      </div>

      {result && (
        <div className="rounded-lg border border-line bg-background p-4">
          <div className="mb-3">
            <div className="font-medium">测试结果</div>
            <div className="text-xs text-muted">
              {result.model} · {result.groupName || result.keyName} · {EFFORT_LABELS[result.effort]} · {formatDuration(result.durationMs)}
            </div>
          </div>
          <div className="max-w-3xl overflow-hidden rounded-lg border border-line">
            <ArtifactFrame artifact={result} title="测试结果" />
          </div>
        </div>
      )}

      <div className="rounded-lg border border-line bg-background p-4">
        <h3 className="mb-4 border-b border-line pb-2 font-medium">我的作品 ({works.length})</h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {works.length === 0 ? (
            <div className="col-span-full py-8 text-center text-sm text-muted">还没有作品，开始测试吧</div>
          ) : (
            works.map((work) => (
              <div key={work.id} className="group/card relative">
                <button
                  type="button"
                  onClick={() => setViewing(work)}
                  className="block w-full text-left"
                  aria-label={`查看 ${work.groupName || work.keyName} · ${work.model}`}
                >
                  <div className="relative overflow-hidden rounded-xl border border-line transition group-hover/card:shadow-md">
                    <ArtifactFrame artifact={work} title={work.model} />
                    <span className="absolute left-2.5 top-2.5 max-w-[75%] truncate rounded-md border border-line bg-white/95 px-2 py-0.5 text-xs text-foreground shadow-sm dark:bg-gray-900/90">
                      组 · {work.groupName || work.keyName}
                    </span>
                  </div>
                  <div className="mt-2.5 truncate pr-8 text-base font-semibold">{work.model}</div>
                  <div className="mt-0.5 truncate text-xs text-muted">
                    {EFFORT_LABELS[work.effort]} · {formatDuration(work.durationMs)} · {formatTime(work.createdAt)}
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete(work.id)}
                  className="absolute bottom-6 right-0 rounded p-1 text-muted opacity-60 hover:bg-error/10 hover:text-error hover:opacity-100"
                  title="删除"
                  aria-label="删除作品"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {viewing && (
        <WorkModal
          work={viewing}
          onClose={closeViewing}
          onDelete={() => { void handleDelete(viewing.id).then((deleted) => { if (deleted) setViewing(null); }); }}
        />
      )}
    </div>
  );
}
