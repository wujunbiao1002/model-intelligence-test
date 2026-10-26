// public/data is local monitor output for `next dev`; production data lives outside the export.
import { rm } from 'node:fs/promises';

await rm(new URL('../out/data', import.meta.url), { recursive: true, force: true });
