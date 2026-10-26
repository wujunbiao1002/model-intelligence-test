import type { Effort } from '@/types';

export const EFFORT_LABELS: Record<Effort, string> = {
  default: '默认',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '极高',
};

const pad = (value: number) => String(value).padStart(2, '0');

export function formatTime(value: string | number | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m${pad(seconds % 60)}s`;
}

export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || '';
