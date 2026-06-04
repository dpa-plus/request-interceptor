import {
  MediaRef,
  storeDataUrl,
  storeBase64,
  buildMediaUrl,
  readMediaFile,
  mimeFromExt,
  parseMediaUrl,
} from './mediaStorage.js';

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; media: MediaRef }
  | { type: 'audio'; media: MediaRef; format?: string; transcript?: string }
  | { type: 'video'; media: MediaRef }
  | { type: 'file'; media: MediaRef; filename?: string }
  | { type: 'file_annotation'; hash: string; name?: string; parts: ContentPart[] }
  | { type: 'reasoning'; text: string }
  | { type: 'tool_use'; toolCallId: string; name: string; input: unknown }
  | { type: 'tool_result'; toolCallId: string; content: string | ContentPart[]; isError?: boolean };

/**
 * Walk a parsed request/response body in place and replace every inline
 * base64/data-URL media blob with a `media:<hash>.<ext>` pseudo-URL after
 * persisting the bytes via mediaStorage. Mutates the input — callers don't
 * need to read the return value.
 *
 * Recognized shapes:
 * - OpenAI/OpenRouter `image_url.url` data URLs
 * - Anthropic `image.source.{type:base64, media_type, data}` blocks
 * - OpenAI `input_audio.{data, format}` blocks (raw base64)
 * - OpenAI `audio.data` output blocks (raw base64, format on parent message)
 * - OpenRouter `file.file_data` data URLs (PDFs etc., snake + camelCase)
 * - Anthropic `document.source.{type:base64, media_type, data}` blocks
 * - OpenRouter image-output `images[].image_url.url` data URLs
 * - OpenRouter PDF `annotations[].file.content[]` (image_url data URLs nested)
 * - OpenAI `video_url.url` data URLs
 */
export async function stripInlineMedia(node: unknown): Promise<void> {
  if (node === null || node === undefined) return;
  if (typeof node !== 'object') return;

  if (Array.isArray(node)) {
    await Promise.all(node.map((item) => stripInlineMedia(item)));
    return;
  }

  const obj = node as Record<string, unknown>;

  // Generic: any object holding a data:-URL on `url` (covers image_url, video_url, etc.)
  if (typeof obj.url === 'string' && obj.url.startsWith('data:')) {
    const ref = await storeDataUrl(obj.url);
    if (ref) obj.url = buildMediaUrl(ref);
  }

  const t = obj.type;

  // Anthropic image / document blocks: source.{type:'base64', media_type, data}
  if ((t === 'image' || t === 'document') && obj.source && typeof obj.source === 'object') {
    const src = obj.source as Record<string, unknown>;
    if (src.type === 'base64' && typeof src.data === 'string' && !src.data.startsWith('media:')) {
      const mime = typeof src.media_type === 'string' ? src.media_type : 'application/octet-stream';
      const ref = await storeBase64(src.data, mime);
      if (ref) src.data = buildMediaUrl(ref);
    }
  }

  // OpenAI input_audio: { input_audio: { data: '<base64>', format: 'wav' } }
  if (t === 'input_audio' && obj.input_audio && typeof obj.input_audio === 'object') {
    await stripRawBase64Field(obj.input_audio as Record<string, unknown>);
  }

  // OpenRouter file (PDF) input: { file: { filename, file_data: 'data:...' } } incl. camelCase
  if (t === 'file' && obj.file && typeof obj.file === 'object') {
    const f = obj.file as Record<string, unknown>;
    for (const key of ['file_data', 'fileData']) {
      const v = f[key];
      if (typeof v === 'string' && v.startsWith('data:')) {
        const ref = await storeDataUrl(v);
        if (ref) f[key] = buildMediaUrl(ref);
      }
    }
  }

  // OpenAI output audio: { audio: { data: '<base64>', format, transcript } } on message
  if (obj.audio && typeof obj.audio === 'object' && !Array.isArray(obj.audio)) {
    const a = obj.audio as Record<string, unknown>;
    // Skip tiny strings — those are message IDs / transcripts, not audio bytes
    if (typeof a.data === 'string' && a.data.length > 100) {
      await stripRawBase64Field(a);
    }
  }

  // Recurse in parallel into all children
  await Promise.all(Object.keys(obj).map((key) => stripInlineMedia(obj[key])));
}

/**
 * Persist a raw-base64 `data` field with a sibling `format` to media storage
 * and replace the data with a media: ref. Shared between OpenAI input_audio
 * (input side) and audio output blocks.
 */
async function stripRawBase64Field(holder: Record<string, unknown>): Promise<void> {
  if (typeof holder.data !== 'string' || holder.data.startsWith('media:')) return;
  const format = typeof holder.format === 'string' ? holder.format : 'wav';
  const mime = `audio/${format === 'mp3' ? 'mpeg' : format}`;
  const ref = await storeBase64(holder.data, mime);
  if (ref) holder.data = buildMediaUrl(ref);
}

/**
 * Extract structured content parts from a message's content field.
 * Handles all known input shapes (OpenAI/OpenRouter array, Anthropic array, plain string).
 *
 * Expects the body to have already passed through `stripInlineMedia`, so any
 * inline base64 has been replaced with `media:<hash>.<ext>` URLs.
 */
export function extractContentParts(content: unknown): ContentPart[] {
  if (content === null || content === undefined) return [];
  if (typeof content === 'string') {
    return content ? [{ type: 'text', text: content }] : [];
  }
  if (!Array.isArray(content)) return [];

  const out: ContentPart[] = [];
  for (const part of content) {
    if (!part || typeof part !== 'object') continue;
    const p = part as Record<string, unknown>;
    const type = p.type;

    if (type === 'text' && typeof p.text === 'string') {
      out.push({ type: 'text', text: p.text });
      continue;
    }

    // OpenAI/OpenRouter image input
    if (type === 'image_url' && p.image_url && typeof p.image_url === 'object') {
      const iu = p.image_url as Record<string, unknown>;
      const media = mediaFromUrlField(iu.url, 'image');
      if (media) out.push({ type: 'image', media });
      continue;
    }
    // camelCase variant
    if (type === 'image_url' && (p as any).imageUrl && typeof (p as any).imageUrl === 'object') {
      const iu = (p as any).imageUrl as Record<string, unknown>;
      const media = mediaFromUrlField(iu.url, 'image');
      if (media) out.push({ type: 'image', media });
      continue;
    }

    // Anthropic image
    if (type === 'image' && p.source && typeof p.source === 'object') {
      const src = p.source as Record<string, unknown>;
      const media = mediaFromAnthropicSource(src, 'image');
      if (media) out.push({ type: 'image', media });
      continue;
    }

    // OpenAI input audio
    if (type === 'input_audio' && p.input_audio && typeof p.input_audio === 'object') {
      const ia = p.input_audio as Record<string, unknown>;
      const format = typeof ia.format === 'string' ? ia.format : undefined;
      const mime = format ? `audio/${format === 'mp3' ? 'mpeg' : format}` : 'audio/wav';
      const media = mediaFromUrlField(ia.data, 'audio', mime);
      if (media) out.push({ type: 'audio', media, format });
      continue;
    }
    if (type === 'input_audio' && (p as any).inputAudio && typeof (p as any).inputAudio === 'object') {
      const ia = (p as any).inputAudio as Record<string, unknown>;
      const format = typeof ia.format === 'string' ? ia.format : undefined;
      const mime = format ? `audio/${format === 'mp3' ? 'mpeg' : format}` : 'audio/wav';
      const media = mediaFromUrlField(ia.data, 'audio', mime);
      if (media) out.push({ type: 'audio', media, format });
      continue;
    }

    // Anthropic audio (rare, but present in some formats)
    if (type === 'audio' && p.source && typeof p.source === 'object') {
      const src = p.source as Record<string, unknown>;
      const media = mediaFromAnthropicSource(src, 'audio');
      if (media) out.push({ type: 'audio', media });
      continue;
    }

    // OpenRouter video input
    if (type === 'video_url' && p.video_url && typeof p.video_url === 'object') {
      const vu = p.video_url as Record<string, unknown>;
      const media = mediaFromUrlField(vu.url, 'video');
      if (media) out.push({ type: 'video', media });
      continue;
    }
    if (type === 'video_url' && (p as any).videoUrl && typeof (p as any).videoUrl === 'object') {
      const vu = (p as any).videoUrl as Record<string, unknown>;
      const media = mediaFromUrlField(vu.url, 'video');
      if (media) out.push({ type: 'video', media });
      continue;
    }

    // OpenRouter PDF / file input
    if (type === 'file' && p.file && typeof p.file === 'object') {
      const f = p.file as Record<string, unknown>;
      const filename = typeof f.filename === 'string' ? f.filename : undefined;
      const dataField = (typeof f.file_data === 'string' ? f.file_data : undefined)
        ?? (typeof (f as any).fileData === 'string' ? (f as any).fileData : undefined);
      const media = mediaFromUrlField(dataField, 'application/octet-stream');
      if (media) out.push({ type: 'file', media, filename });
      continue;
    }

    // Anthropic document (PDF)
    if (type === 'document' && p.source && typeof p.source === 'object') {
      const src = p.source as Record<string, unknown>;
      const media = mediaFromAnthropicSource(src, 'application/pdf');
      if (media) out.push({ type: 'file', media });
      continue;
    }

    // Anthropic tool_use / tool_result
    if (type === 'tool_use' && typeof p.id === 'string') {
      out.push({
        type: 'tool_use',
        toolCallId: p.id as string,
        name: typeof p.name === 'string' ? p.name : '',
        input: p.input ?? {},
      });
      continue;
    }
    if (type === 'tool_result' && typeof p.tool_use_id === 'string') {
      const inner = p.content;
      const content = typeof inner === 'string' ? inner : extractContentParts(inner);
      out.push({
        type: 'tool_result',
        toolCallId: p.tool_use_id as string,
        content,
        isError: p.is_error === true,
      });
      continue;
    }
  }
  return out;
}

function mediaFromUrlField(raw: unknown, kindHint: string, mimeHint?: string): MediaRef | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  // media:<hash>.<ext> — local reference
  if (raw.startsWith('media:')) {
    const rest = raw.slice(6);
    const dot = rest.lastIndexOf('.');
    if (dot < 0) return null;
    return { hash: rest.slice(0, dot), ext: rest.slice(dot + 1) };
  }
  // External URL — keep as link (not downloaded)
  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    return { url: raw, mime: mimeHint };
  }
  // Stray data: URL (should have been stripped, but defensive)
  if (raw.startsWith('data:')) {
    return { url: raw, mime: mimeHint };
  }
  // Bare base64 (e.g. input_audio.data that was somehow not stripped) — leave as-is, can't be displayed
  return { mime: mimeHint };
}

function mediaFromAnthropicSource(src: Record<string, unknown>, kindHint: string): MediaRef | null {
  if (src.type === 'base64' && typeof src.data === 'string') {
    if (src.data.startsWith('media:')) {
      const rest = src.data.slice(6);
      const dot = rest.lastIndexOf('.');
      if (dot < 0) return null;
      const mime = typeof src.media_type === 'string' ? src.media_type : undefined;
      return { hash: rest.slice(0, dot), ext: rest.slice(dot + 1), mime };
    }
    return { mime: typeof src.media_type === 'string' ? src.media_type : kindHint };
  }
  if (src.type === 'url' && typeof src.url === 'string') {
    return { url: src.url, mime: typeof src.media_type === 'string' ? src.media_type : undefined };
  }
  return null;
}

/**
 * Extract `images[]` (OpenRouter/OpenAI image-output) from a response message
 * into ContentParts. The images array contains `{type:'image_url', image_url:{url}}`.
 * Expects inline data URLs to already be stripped to `media:` refs.
 */
export function extractImagesField(images: unknown): ContentPart[] {
  if (!Array.isArray(images)) return [];
  const out: ContentPart[] = [];
  for (const img of images) {
    if (!img || typeof img !== 'object') continue;
    const i = img as Record<string, unknown>;
    const iu = (i.image_url ?? (i as any).imageUrl) as Record<string, unknown> | undefined;
    if (iu && typeof iu === 'object') {
      const media = mediaFromUrlField(iu.url, 'image');
      if (media) out.push({ type: 'image', media });
    }
  }
  return out;
}

/**
 * Extract `annotations[]` from an OpenRouter response message (PDF parse results).
 */
export function extractFileAnnotations(annotations: unknown): ContentPart[] {
  if (!Array.isArray(annotations)) return [];
  const out: ContentPart[] = [];
  for (const ann of annotations) {
    if (!ann || typeof ann !== 'object') continue;
    const a = ann as Record<string, unknown>;
    if (a.type !== 'file' || !a.file || typeof a.file !== 'object') continue;
    const f = a.file as Record<string, unknown>;
    const hash = typeof f.hash === 'string' ? f.hash : '';
    if (!hash) continue;
    const name = typeof f.name === 'string' ? f.name : undefined;
    const parts = extractContentParts(f.content);
    out.push({ type: 'file_annotation', hash, name, parts });
  }
  return out;
}

/**
 * Reverse of `stripInlineMedia`: walk a stored body and rehydrate
 * `media:<hash>.<ext>` references back into data URLs.
 * Used by the replay endpoint so we can send the original payload upstream.
 */
export async function rehydrateInlineMedia(node: unknown): Promise<unknown> {
  if (node === null || node === undefined) return node;
  if (typeof node === 'string') {
    const ref = parseMediaUrl(node);
    if (!ref) return node;
    const bytes = await readMediaFile(ref.hash, ref.ext);
    if (!bytes) return node;
    return `data:${mimeFromExt(ref.ext)};base64,${bytes.toString('base64')}`;
  }
  if (Array.isArray(node)) {
    return Promise.all(node.map((item) => rehydrateInlineMedia(item)));
  }
  if (typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    const entries = await Promise.all(
      Object.keys(obj).map(async (k) => [k, await rehydrateInlineMedia(obj[k])] as const)
    );
    return Object.fromEntries(entries);
  }
  return node;
}
