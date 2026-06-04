// Ten visually-distinct tailwind hues for clustering AI requests by their
// system prompt fingerprint. Picked to remain legible on the dark theme and
// reasonably tellable apart for protanopic/deuteranopic viewers (the 2-char
// label provides a second discrimination channel).
export interface PromptColor {
  dot: string;       // background class for the leading dot / border
  chipBg: string;    // chip background
  chipText: string;  // chip text
  border: string;    // optional left-border class on the row
}

export const PROMPT_PALETTE: PromptColor[] = [
  { dot: 'bg-rose-400',    chipBg: 'bg-rose-500/15',    chipText: 'text-rose-300',    border: 'border-rose-400' },
  { dot: 'bg-amber-400',   chipBg: 'bg-amber-500/15',   chipText: 'text-amber-300',   border: 'border-amber-400' },
  { dot: 'bg-yellow-300',  chipBg: 'bg-yellow-500/15',  chipText: 'text-yellow-200',  border: 'border-yellow-300' },
  { dot: 'bg-lime-400',    chipBg: 'bg-lime-500/15',    chipText: 'text-lime-300',    border: 'border-lime-400' },
  { dot: 'bg-emerald-400', chipBg: 'bg-emerald-500/15', chipText: 'text-emerald-300', border: 'border-emerald-400' },
  { dot: 'bg-cyan-400',    chipBg: 'bg-cyan-500/15',    chipText: 'text-cyan-300',    border: 'border-cyan-400' },
  { dot: 'bg-sky-400',     chipBg: 'bg-sky-500/15',     chipText: 'text-sky-300',     border: 'border-sky-400' },
  { dot: 'bg-indigo-400',  chipBg: 'bg-indigo-500/15',  chipText: 'text-indigo-300',  border: 'border-indigo-400' },
  { dot: 'bg-fuchsia-400', chipBg: 'bg-fuchsia-500/15', chipText: 'text-fuchsia-300', border: 'border-fuchsia-400' },
  { dot: 'bg-pink-400',    chipBg: 'bg-pink-500/15',    chipText: 'text-pink-300',    border: 'border-pink-400' },
];

/**
 * Deterministically map a system-prompt hash to one of the palette entries.
 */
export function colorForHash(hash: string | null | undefined): PromptColor | null {
  if (!hash || hash.length < 2) return null;
  const idx = parseInt(hash.slice(0, 2), 16);
  if (Number.isNaN(idx)) return null;
  return PROMPT_PALETTE[idx % PROMPT_PALETTE.length];
}

/**
 * 2-char base36-style label derived from the next byte of the hash. Cheap
 * second discriminator so users can still tell two requests apart when their
 * colors happen to collide.
 */
export function labelForHash(hash: string | null | undefined): string | null {
  if (!hash || hash.length < 4) return null;
  return hash.slice(2, 4).toUpperCase();
}
