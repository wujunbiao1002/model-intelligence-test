'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Artifact } from '@/types';
import { toDocument } from '@/lib/artifact';

// Artworks render on a fixed desktop-sized canvas and are scaled down as a whole,
// so thumbnails look like the full page shrunk instead of a reflowed or scrolling layout.
const BASE_WIDTH = 1280;
const BASE_HEIGHT = 800;

// `fill`: the parent decides the box size (e.g. stretched to a sibling's height); the canvas
// is fitted inside it and centered instead of the box following a fixed 16:10 ratio.
export default function ArtifactFrame({ artifact, title, className = '', fill = false }: { artifact: Artifact; title: string; className?: string; fill?: boolean }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const srcDoc = useMemo(() => toDocument(artifact), [artifact]);

  useEffect(() => {
    const element = boxRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setBox({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const scale = fill && box.height > 0 ? Math.min(box.width / BASE_WIDTH, box.height / BASE_HEIGHT) : box.width / BASE_WIDTH;
  const left = fill ? (box.width - BASE_WIDTH * scale) / 2 : 0;
  const top = fill ? Math.max(0, (box.height - BASE_HEIGHT * scale) / 2) : 0;

  return (
    <div ref={boxRef} className={`relative w-full overflow-hidden ${fill ? 'h-full bg-line/30' : 'aspect-[16/10] bg-white'} ${className}`}>
      {scale > 0 && (
        <iframe
          title={title}
          srcDoc={srcDoc}
          sandbox="allow-scripts"
          loading="lazy"
          tabIndex={-1}
          className="pointer-events-none absolute border-0 bg-white"
          style={{ left, top, width: BASE_WIDTH, height: BASE_HEIGHT, transform: `scale(${scale})`, transformOrigin: 'top left' }}
        />
      )}
    </div>
  );
}
