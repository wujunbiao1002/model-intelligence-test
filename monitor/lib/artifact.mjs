// Artifact extraction, used by the cron monitor.
// The browser uses src/lib/artifact.ts (same logic, TypeScript for Next.js compatibility).

/** @typedef {{ type: 'svg' | 'html', content: string }} Artifact */

const FENCE = /```[a-zA-Z0-9_-]*[^\n]*\n([\s\S]*?)```/g;

function stripThinking(text) {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^[\s\S]*?<\/think>/i, '');
}

/** @returns {Artifact | null} */
function findIn(chunk) {
  const lower = chunk.toLowerCase();
  const htmlStart = lower.search(/<!doctype html|<html[\s>]/);
  if (htmlStart !== -1) {
    const end = lower.lastIndexOf('</html>');
    const content = end > htmlStart ? chunk.slice(htmlStart, end + 7) : chunk.slice(htmlStart);
    return { type: 'html', content: content.trim() };
  }
  const svgStart = lower.indexOf('<svg');
  const svgEnd = lower.lastIndexOf('</svg>');
  if (svgStart !== -1 && svgEnd > svgStart) {
    const before = chunk.slice(0, svgStart);
    const after = chunk.slice(svgEnd + 6);
    // A <style>/<script> wrapped around the SVG means the model wrote an HTML fragment.
    if (/<(style|script|body|div)[\s>]/i.test(before + after)) {
      return { type: 'html', content: chunk.trim() };
    }
    return { type: 'svg', content: chunk.slice(svgStart, svgEnd + 6).trim() };
  }
  return null;
}

/**
 * Pulls the renderable SVG/HTML out of a model reply.
 * @param {string} text
 * @returns {Artifact | null}
 */
export function extractArtifact(text) {
  const clean = stripThinking(text || '');
  const fenced = [...clean.matchAll(FENCE)].map((match) => match[1]);
  for (const block of fenced.sort((a, b) => b.length - a.length)) {
    const found = findIn(block);
    if (found) return found;
  }
  return findIn(clean);
}

// Blocks all network access from model output; the iframe sandbox already isolates origin.
const CSP = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:";

/**
 * Wraps an artifact into a full document for a sandboxed iframe's srcdoc.
 * @param {Artifact} artifact
 */
export function toDocument(artifact) {
  const head = `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}"><meta name="viewport" content="width=device-width,initial-scale=1">`;
  if (artifact.type === 'svg') {
    return `<!doctype html><html><head>${head}<style>html,body{margin:0;height:100%;background:#fff;overflow:hidden}body{display:flex;align-items:center;justify-content:center}svg{width:100%;height:100%;display:block}</style></head><body>${artifact.content}</body></html>`;
  }
  return `<!doctype html><html><head>${head}<style>html,body{margin:0}</style></head><body>${artifact.content}</body></html>`;
}
