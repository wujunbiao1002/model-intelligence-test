import { runChat, SYSTEM_PROMPT, ChatError } from '@/lib/chat';
import { extractArtifact, toDocument } from '@/lib/artifact';
import type { Artifact, Effort } from '@/types';
import { getSub2ApiKey } from '@/lib/sub2api-client';

export { SYSTEM_PROMPT, ChatError, extractArtifact, toDocument };

export interface TestOptions {
  keyId: number;
  userId: number;
  model: string;
  effort: Effort;
  prompt: string;
  signal?: AbortSignal;
  onDelta?: (state: { content: string; reasoning: string }) => void;
}

export async function runTest(options: TestOptions): Promise<{ content: string; reasoning: string; artifact: Artifact | null; durationMs: number }> {
  const begin = Date.now();
  const apiKey = await getSub2ApiKey(options.keyId, options.userId);
  const result = await runChat({
    baseUrl: '/v1',
    apiKey,
    model: options.model,
    prompt: options.prompt,
    effort: options.effort === 'default' ? undefined : options.effort,
    signal: options.signal,
    onDelta: options.onDelta,
  });
  const artifact = extractArtifact(result.content);
  return { ...result, artifact, durationMs: Date.now() - begin };
}
