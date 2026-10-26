// Shared by browser and Node: OpenAI-compatible streaming chat.

export const SYSTEM_PROMPT = '你是一名前端动画设计师。只输出一个完整可运行的作品：单个 <svg> 元素，或一个完整的 HTML 文档。不要解释，不要输出多个版本，不要引用任何外部资源。';

export const EFFORTS = ['default', 'low', 'medium', 'high', 'xhigh'] as const;

export class ChatError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'ChatError';
    this.status = status;
  }
}

export interface ChatUsage { prompt_tokens?: number; completion_tokens?: number }

interface ChatStreamEvent {
  error?: { message?: string };
  usage?: ChatUsage;
  choices?: { delta?: { content?: unknown; reasoning_content?: unknown; reasoning?: unknown } }[];
}

export async function readChatStream(
  body: ReadableStream<Uint8Array>,
  onDelta?: (state: { content: string; reasoning: string }) => void
): Promise<{ content: string; reasoning: string; usage: ChatUsage | null }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let reasoning = '';
  let usage: ChatUsage | null = null;
  const handleLine = (raw: string) => {
    const line = raw.trim();
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return;
    let event: ChatStreamEvent;
    try { event = JSON.parse(data); } catch { return; }
    if (event.error) throw new ChatError(event.error.message || JSON.stringify(event.error));
    if (event.usage) usage = event.usage;
    const delta = event.choices?.[0]?.delta;
    if (!delta) return;
    const reasoningPart = delta.reasoning_content || delta.reasoning || '';
    if (typeof delta.content === 'string') content += delta.content;
    if (typeof reasoningPart === 'string') reasoning += reasoningPart;
    onDelta?.({ content, reasoning });
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) handleLine(line);
  }
  buffer += decoder.decode();
  if (buffer) handleLine(buffer);
  return { content, reasoning, usage };
}

export interface RunChatOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  prompt: string;
  effort?: string;
  signal?: AbortSignal;
  onDelta?: (state: { content: string; reasoning: string }) => void;
}

export async function runChat(options: RunChatOptions): Promise<{ content: string; reasoning: string; usage: ChatUsage | null }> {
  const body: Record<string, unknown> = {
    model: options.model,
    stream: true,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: options.prompt },
    ],
  };
  if (options.effort && options.effort !== 'default') body.reasoning_effort = options.effort;
  const response = await fetch(options.baseUrl.replace(/\/+$/, '') + '/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + options.apiKey, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(body),
    signal: options.signal,
  });
  if (!response.ok || !response.body) {
    let detail = '';
    try {
      const text = await response.text();
      try { detail = JSON.parse(text)?.error?.message || text; } catch { detail = text; }
    } catch { /* body unreadable */ }
    // Gateways (Cloudflare/nginx) answer timeouts with an HTML page; keep only its title.
    if (/^\s*</.test(detail)) detail = (detail.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || '网关返回了错误页面').trim();
    throw new ChatError(`HTTP ${response.status}${detail ? '：' + detail.slice(0, 300) : ''}`, response.status);
  }
  return readChatStream(response.body, options.onDelta);
}
