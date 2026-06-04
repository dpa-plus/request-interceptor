import crypto from 'crypto';

/**
 * Stable 12-char fingerprint of a system prompt, used by the UI to color
 * requests that share the same prompt. Returns null when the prompt is
 * empty, so the UI can render "no fingerprint" naturally.
 */
export function hashSystemPrompt(systemPrompt: string | null | undefined): string | null {
  if (!systemPrompt) return null;
  return crypto.createHash('sha256').update(systemPrompt).digest('hex').slice(0, 12);
}
