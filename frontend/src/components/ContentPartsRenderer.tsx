import { useState } from 'react';

export type MediaRef = {
  hash?: string;
  ext?: string;
  mime?: string;
  size?: number;
  url?: string;
  filename?: string;
};

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

function mediaSrc(m: MediaRef): string | null {
  if (m.hash && m.ext) return `/api/media/${m.hash}.${m.ext}`;
  if (m.url) return m.url;
  return null;
}

function isYouTubeUrl(u: string): string | null {
  try {
    const url = new URL(u);
    if (url.hostname.includes('youtube.com') && url.searchParams.get('v')) {
      return `https://www.youtube.com/embed/${url.searchParams.get('v')}`;
    }
    if (url.hostname === 'youtu.be') {
      const id = url.pathname.slice(1);
      if (id) return `https://www.youtube.com/embed/${id}`;
    }
  } catch {}
  return null;
}

export function ContentPartsRenderer({ parts }: { parts: ContentPart[] }) {
  return (
    <div className="space-y-2">
      {parts.map((p, i) => (
        <ContentPartView key={i} part={p} />
      ))}
    </div>
  );
}

function ContentPartView({ part }: { part: ContentPart }) {
  if (part.type === 'text') {
    return (
      <div className="whitespace-pre-wrap break-words text-xs text-gray-300">
        {part.text}
      </div>
    );
  }

  if (part.type === 'reasoning') {
    return <ReasoningBlock text={part.text} />;
  }

  if (part.type === 'image') {
    const src = mediaSrc(part.media);
    if (!src) return <MediaPlaceholder kind="image" media={part.media} />;
    return (
      <a href={src} target="_blank" rel="noreferrer" className="inline-block">
        <img
          src={src}
          alt="image"
          loading="lazy"
          className="max-h-72 max-w-full rounded border border-[#30363d] bg-[#0d1117] object-contain"
        />
      </a>
    );
  }

  if (part.type === 'audio') {
    const src = mediaSrc(part.media);
    return (
      <div className="space-y-1">
        {src ? (
          <audio controls src={src} className="w-full max-w-md" />
        ) : (
          <MediaPlaceholder kind="audio" media={part.media} />
        )}
        {part.transcript && (
          <div className="text-xs text-gray-400 italic whitespace-pre-wrap">
            <span className="text-gray-500">Transcript:</span> {part.transcript}
          </div>
        )}
      </div>
    );
  }

  if (part.type === 'video') {
    const src = mediaSrc(part.media);
    if (!src) return <MediaPlaceholder kind="video" media={part.media} />;
    const yt = isYouTubeUrl(src);
    if (yt) {
      return (
        <iframe
          src={yt}
          className="w-full max-w-xl aspect-video rounded border border-[#30363d]"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      );
    }
    return <video controls src={src} className="max-h-72 max-w-full rounded border border-[#30363d]" />;
  }

  if (part.type === 'file') {
    const src = mediaSrc(part.media);
    const name = part.filename || part.media.filename || 'file';
    const isPdf = part.media.mime === 'application/pdf' || part.media.ext === 'pdf' || name.toLowerCase().endsWith('.pdf');
    return (
      <div className="border border-[#30363d] rounded bg-[#0d1117] p-2">
        <div className="flex items-center gap-2 text-xs">
          <span className="text-gray-500">{isPdf ? 'PDF' : 'File'}:</span>
          {src ? (
            <a href={src} target="_blank" rel="noreferrer" className="text-[#58a6ff] hover:underline truncate">
              {name}
            </a>
          ) : (
            <span className="text-gray-400">{name}</span>
          )}
          {part.media.size != null && (
            <span className="text-gray-600">({(part.media.size / 1024).toFixed(1)} KB)</span>
          )}
        </div>
        {isPdf && src && (
          <PdfPreview src={src} />
        )}
      </div>
    );
  }

  if (part.type === 'file_annotation') {
    return (
      <div className="border border-amber-800/40 bg-amber-900/10 rounded p-2 space-y-1">
        <div className="text-xs text-amber-400 font-medium">
          Parsed file{part.name ? `: ${part.name}` : ''} <span className="text-gray-500 font-mono">({part.hash.slice(0, 12)}…)</span>
        </div>
        <div className="pl-2 border-l-2 border-amber-800/40">
          <ContentPartsRenderer parts={part.parts} />
        </div>
      </div>
    );
  }

  if (part.type === 'tool_use') {
    return (
      <div className="font-mono text-xs">
        <div className="text-amber-300">
          <span className="text-gray-500">→ tool </span>
          <span className="font-bold">{part.name}</span>
        </div>
        <pre className="mt-1 pl-3 border-l-2 border-amber-800/40 text-gray-300 whitespace-pre-wrap break-words">
          {typeof part.input === 'string' ? part.input : JSON.stringify(part.input, null, 2)}
        </pre>
      </div>
    );
  }

  if (part.type === 'tool_result') {
    return (
      <div className="font-mono text-xs">
        <div className={part.isError ? 'text-red-400' : 'text-amber-300'}>
          ← tool result {part.isError && <span className="text-red-500">(error)</span>}
        </div>
        <div className="mt-1 pl-3 border-l-2 border-amber-800/40">
          {typeof part.content === 'string' ? (
            <pre className="text-gray-300 whitespace-pre-wrap break-words">{part.content}</pre>
          ) : (
            <ContentPartsRenderer parts={part.content} />
          )}
        </div>
      </div>
    );
  }

  return null;
}

function MediaPlaceholder({ kind, media }: { kind: string; media: MediaRef }) {
  return (
    <div className="text-xs text-gray-500 italic">
      [{kind}{media.mime ? ` · ${media.mime}` : ''}{media.size != null ? ` · ${(media.size / 1024).toFixed(1)} KB` : ''}]
      {media.url && (
        <a href={media.url} target="_blank" rel="noreferrer" className="ml-2 text-[#58a6ff] hover:underline">
          open
        </a>
      )}
    </div>
  );
}

function ReasoningBlock({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="border border-purple-800/40 bg-purple-900/10 rounded">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left px-2 py-1 text-xs text-purple-300 hover:bg-purple-900/20 flex items-center gap-1"
      >
        <span>{expanded ? '▾' : '▸'}</span>
        <span className="font-medium">Reasoning</span>
        <span className="text-gray-500">({text.length.toLocaleString()} chars)</span>
      </button>
      {expanded && (
        <pre className="px-3 pb-2 text-xs text-purple-200/80 whitespace-pre-wrap break-words font-mono">
          {text}
        </pre>
      )}
    </div>
  );
}

function PdfPreview({ src }: { src: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen(!open)}
        className="text-xs text-[#58a6ff] hover:underline"
      >
        {open ? 'Hide preview' : 'Show inline preview'}
      </button>
      {open && (
        <object data={src} type="application/pdf" className="w-full h-80 mt-1 rounded border border-[#30363d]">
          <a href={src} target="_blank" rel="noreferrer" className="text-[#58a6ff]">Open PDF</a>
        </object>
      )}
    </div>
  );
}
