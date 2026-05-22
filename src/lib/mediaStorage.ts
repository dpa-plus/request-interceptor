import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';

const MEDIA_ROOT = process.env.MEDIA_DIR || '/data/media';

export interface MediaRef {
  hash?: string;
  ext?: string;
  mime?: string;
  size?: number;
  url?: string;
  filename?: string;
}

// MIME → extension. Extend as needed; falls back to 'bin'.
const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'audio/wav': 'wav',
  'audio/wave': 'wav',
  'audio/x-wav': 'wav',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/aac': 'aac',
  'audio/ogg': 'ogg',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
  'audio/m4a': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aiff': 'aiff',
  'audio/x-aiff': 'aiff',
  'video/mp4': 'mp4',
  'video/mpeg': 'mpeg',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'application/pdf': 'pdf',
};

const EXT_TO_MIME: Record<string, string> = Object.fromEntries(
  Object.entries(MIME_TO_EXT).map(([m, e]) => [e, m])
);

function extFromMime(mime: string): string {
  return MIME_TO_EXT[mime.toLowerCase()] || 'bin';
}

export function mimeFromExt(ext: string): string {
  return EXT_TO_MIME[ext.toLowerCase()] || 'application/octet-stream';
}

function shardedPath(hash: string, ext: string): string {
  return path.join(MEDIA_ROOT, hash.slice(0, 2), hash.slice(2, 4), `${hash}.${ext}`);
}

export function getMediaFilePath(hash: string, ext: string): string {
  return shardedPath(hash, ext);
}

export function buildMediaUrl(ref: MediaRef): string {
  return `media:${ref.hash}.${ref.ext}`;
}

export function parseMediaUrl(value: string): { hash: string; ext: string } | null {
  if (typeof value !== 'string' || !value.startsWith('media:')) return null;
  const rest = value.slice(6);
  const dot = rest.lastIndexOf('.');
  if (dot < 0) return null;
  const hash = rest.slice(0, dot);
  const ext = rest.slice(dot + 1);
  if (!/^[a-f0-9]{64}$/.test(hash)) return null;
  return { hash, ext };
}

/**
 * Parse a data: URL into mime + raw bytes.
 * Returns null if the string is not a valid data URL.
 */
function parseDataUrl(dataUrl: string): { mime: string; bytes: Buffer } | null {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return null;
  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx < 0) return null;
  const header = dataUrl.slice(5, commaIdx);
  const payload = dataUrl.slice(commaIdx + 1);
  const isBase64 = header.endsWith(';base64');
  const mime = (isBase64 ? header.slice(0, -7) : header) || 'application/octet-stream';
  try {
    const bytes = isBase64 ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload));
    return { mime, bytes };
  } catch {
    return null;
  }
}

async function writeIfMissing(filePath: string, bytes: Buffer): Promise<void> {
  try {
    await fs.access(filePath);
    return;
  } catch {
    // not present
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  // Best-effort atomic write
  const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  await fs.writeFile(tmp, bytes);
  try {
    await fs.rename(tmp, filePath);
  } catch (err) {
    // If rename failed because target already exists (race), drop tmp
    try { await fs.unlink(tmp); } catch {}
  }
}

export async function storeBytes(bytes: Buffer, mime: string): Promise<MediaRef> {
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  const ext = extFromMime(mime);
  const filePath = shardedPath(hash, ext);
  await writeIfMissing(filePath, bytes);
  return { hash, ext, mime, size: bytes.length };
}

export async function storeDataUrl(dataUrl: string): Promise<MediaRef | null> {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) return null;
  return storeBytes(parsed.bytes, parsed.mime);
}

/**
 * Store a raw base64 string (without data: prefix) and given mime/format.
 * Used for fields like input_audio.data where format is separate.
 */
export async function storeBase64(base64: string, mime: string): Promise<MediaRef | null> {
  try {
    const bytes = Buffer.from(base64, 'base64');
    if (bytes.length === 0) return null;
    return storeBytes(bytes, mime);
  } catch {
    return null;
  }
}

export async function readMediaFile(hash: string, ext: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(shardedPath(hash, ext));
  } catch {
    return null;
  }
}

export async function deleteMediaFile(hash: string, ext: string): Promise<boolean> {
  try {
    await fs.unlink(shardedPath(hash, ext));
    return true;
  } catch {
    return false;
  }
}

/**
 * List all stored media files as {hash, ext, fullPath, mtimeMs}.
 */
export async function listAllMediaFiles(): Promise<Array<{ hash: string; ext: string; fullPath: string; mtimeMs: number }>> {
  const out: Array<{ hash: string; ext: string; fullPath: string; mtimeMs: number }> = [];
  let firstLevel: string[];
  try {
    firstLevel = await fs.readdir(MEDIA_ROOT);
  } catch {
    return out;
  }
  for (const a of firstLevel) {
    const aPath = path.join(MEDIA_ROOT, a);
    let secondLevel: string[];
    try { secondLevel = await fs.readdir(aPath); } catch { continue; }
    for (const b of secondLevel) {
      const bPath = path.join(aPath, b);
      let files: string[];
      try { files = await fs.readdir(bPath); } catch { continue; }
      for (const f of files) {
        const dot = f.lastIndexOf('.');
        if (dot < 0) continue;
        const hash = f.slice(0, dot);
        const ext = f.slice(dot + 1);
        if (!/^[a-f0-9]{64}$/.test(hash)) continue;
        const full = path.join(bPath, f);
        try {
          const st = await fs.stat(full);
          out.push({ hash, ext, fullPath: full, mtimeMs: st.mtimeMs });
        } catch {
          // skip
        }
      }
    }
  }
  return out;
}
