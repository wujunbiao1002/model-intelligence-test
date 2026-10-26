import type { Artifact, ArtifactType, StatusData } from '@/types';
import { BASE_PATH } from '@/lib/format';

const DATA_URL = BASE_PATH + '/data';
const artifactCache = new Map<string, Promise<Artifact>>();

export async function fetchStatus(): Promise<StatusData | null> {
  const response = await fetch(`${DATA_URL}/status.json?t=${Date.now()}`, { cache: 'no-store' });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`读取检测结果失败（HTTP ${response.status}）`);
  return response.json() as Promise<StatusData>;
}

// Run files are immutable (one file per run id), so they are cached for the page lifetime.
export function fetchRunArtifact(file: string, type: ArtifactType): Promise<Artifact> {
  const url = `${DATA_URL}/${file}`;
  let pending = artifactCache.get(url);
  if (!pending) {
    pending = fetch(url).then(async (response) => {
      if (!response.ok) throw new Error(`作品加载失败（HTTP ${response.status}）`);
      return { type, content: await response.text() };
    });
    pending.catch(() => artifactCache.delete(url));
    artifactCache.set(url, pending);
  }
  return pending;
}
