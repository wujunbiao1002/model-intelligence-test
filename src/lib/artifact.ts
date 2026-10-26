// Shared by browser and Node: extract SVG/HTML artifacts from model replies.

import type { Artifact } from '@/types';

const FENCE = /```[a-zA-Z0-9_-]*[^\n]*\n([\s\S]*?)```/g;

function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^[\s\S]*?<\/think>/i, '');
}

function findIn(chunk: string): Artifact | null {
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
    if (/<(style|script|body|div)[\s>]/i.test(before + after)) {
      return { type: 'html', content: chunk.trim() };
    }
    return { type: 'svg', content: chunk.slice(svgStart, svgEnd + 6).trim() };
  }
  return null;
}

export function extractArtifact(text: string): Artifact | null {
  const clean = stripThinking(text || '');
  const fenced = [...clean.matchAll(FENCE)].map((match) => match[1]);
  for (const block of fenced.sort((a, b) => b.length - a.length)) {
    const found = findIn(block);
    if (found) return found;
  }
  return findIn(clean);
}

const CSP = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:";

export function toDocument(artifact: Artifact): string {
  const head = `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}"><meta name="viewport" content="width=device-width,initial-scale=1">`;
  if (artifact.type === 'svg') {
    return `<!doctype html><html><head>${head}<style>html,body{margin:0;height:100%;background:#fff;overflow:hidden}body{display:flex;align-items:center;justify-content:center}svg{width:100%;height:100%;display:block}</style></head><body>${artifact.content}</body></html>`;
  }
  // The model's HTML may assume a specific viewport size; scale the whole page down to fit
  // the iframe instead of letting it overflow into scrollbars.
  return `<!doctype html><html><head>${head}<style>html,body{margin:0;height:100%;overflow:hidden}#__fit{position:absolute;inset:0;display:flex;align-items:center;justify-content:center}#__fit>div{transform-origin:center}</style></head><body><div id="__fit"><div id="__fit-content">${artifact.content}</div></div><script>(function(){function fit(){var c=document.getElementById('__fit-content');var w=document.body.clientWidth,h=document.body.clientHeight;var cw=c.scrollWidth||w,ch=c.scrollHeight||h;var s=Math.min(w/cw,h/ch,1);c.style.transform='scale('+s+')';c.style.width=cw+'px';c.style.height=ch+'px'}window.addEventListener('load',fit);window.addEventListener('resize',fit);setTimeout(fit,50);setTimeout(fit,300)})();</script></body></html>`;
}
