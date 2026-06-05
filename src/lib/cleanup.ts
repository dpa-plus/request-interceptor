import fs from 'fs/promises';
import { prisma } from './prisma.js';
import { listAllMediaFiles } from './mediaStorage.js';
import {
  getAuthHeaderRetentionDays,
  redactSensitiveHeaders,
  REDACTED_VALUE,
} from './headerRedaction.js';
import {
  defaultLogRetentionDays,
  defaultMediaRetentionDays,
  normalizeRetentionDays,
} from './retentionConfig.js';

// Media files orphaned from any DB row are deleted after this many days
const MEDIA_ORPHAN_GRACE_DAYS = 1;

interface CleanupConfig {
  logRetentionDays: number;
  credentialRetentionDays: number;
  mediaRetentionDays: number;
}

async function getCleanupConfig(): Promise<CleanupConfig> {
  const config = await prisma.config.findUnique({ where: { id: 'default' } }) as any;
  return {
    logRetentionDays: normalizeRetentionDays(config?.logRetentionDays, defaultLogRetentionDays()),
    credentialRetentionDays: getAuthHeaderRetentionDays(config?.credentialRetentionDays),
    mediaRetentionDays: normalizeRetentionDays(config?.mediaRetentionDays, defaultMediaRetentionDays()),
  };
}

/**
 * Delete request logs older than the retention period.
 * Also deletes associated AiRequest records.
 */
async function deleteOldLogs(retentionDays: number): Promise<number> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

  // First delete AiRequests that are linked to old logs
  const oldLogs = await prisma.requestLog.findMany({
    where: { createdAt: { lt: cutoffDate } },
    select: { aiRequestId: true },
  });

  const aiRequestIds = oldLogs
    .map((log) => log.aiRequestId)
    .filter((id): id is string => id !== null);

  if (aiRequestIds.length > 0) {
    await prisma.aiRequest.deleteMany({
      where: { id: { in: aiRequestIds } },
    });
  }

  // Then delete the old logs
  const result = await prisma.requestLog.deleteMany({
    where: { createdAt: { lt: cutoffDate } },
  });

  return result.count;
}

/**
 * Remove authorization headers from logs older than the retention period.
 * A retention of 0 redacts all stored sensitive header values on the next
 * cleanup run, which also covers changing the setting from N days to immediate.
 */
async function sanitizeOldAuthHeaders(retentionDays: number): Promise<number> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

  const logsToSanitize = await prisma.requestLog.findMany({
    where: {
      createdAt: { lt: cutoffDate },
      headers: { not: '' },
    },
    select: { id: true, headers: true },
  });

  let sanitizedCount = 0;

  for (const log of logsToSanitize) {
    if (!log.headers) continue;

    try {
      const headers = JSON.parse(log.headers) as Record<string, unknown>;
      const redacted = redactSensitiveHeaders(headers);
      const wasModified = Object.keys(redacted).some(
        (k) => redacted[k] === REDACTED_VALUE && headers[k] !== REDACTED_VALUE
      );

      if (wasModified) {
        await prisma.requestLog.update({
          where: { id: log.id },
          data: { headers: JSON.stringify(redacted) },
        });
        sanitizedCount++;
      }
    } catch {
      // Skip logs with invalid JSON headers
    }
  }

  return sanitizedCount;
}

async function sanitizeOldAuthResponseHeaders(retentionDays: number): Promise<number> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

  const logsToSanitize = await prisma.requestLog.findMany({
    where: {
      createdAt: { lt: cutoffDate },
      responseHeaders: { not: null },
    },
    select: { id: true, responseHeaders: true },
  });

  let sanitizedCount = 0;

  for (const log of logsToSanitize) {
    if (!log.responseHeaders) continue;

    try {
      const headers = JSON.parse(log.responseHeaders) as Record<string, unknown>;
      const redacted = redactSensitiveHeaders(headers);
      const wasModified = Object.keys(redacted).some(
        (k) => redacted[k] === REDACTED_VALUE && headers[k] !== REDACTED_VALUE
      );

      if (wasModified) {
        await prisma.requestLog.update({
          where: { id: log.id },
          data: { responseHeaders: JSON.stringify(redacted) },
        });
        sanitizedCount++;
      }
    } catch {
      // Skip logs with invalid JSON headers
    }
  }

  return sanitizedCount;
}

async function deleteExpiredMedia(retentionDays: number): Promise<number> {
  const files = await listAllMediaFiles();
  if (files.length === 0) return 0;

  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  let deleted = 0;
  for (const f of files) {
    if (f.mtimeMs >= cutoff) continue;
    try {
      await fs.unlink(f.fullPath);
      deleted++;
    } catch {
      // ignore
    }
  }
  return deleted;
}

/**
 * Garbage-collect media files that are no longer referenced by any AiRequest row.
 * A file is considered orphaned only if it hasn't been referenced AND its mtime is
 * older than MEDIA_ORPHAN_GRACE_DAYS (so newly-stored files aren't deleted before
 * the row that references them is committed).
 */
async function deleteOrphanMedia(): Promise<number> {
  const files = await listAllMediaFiles();
  if (files.length === 0) return 0;

  // Build a set of referenced hashes by scanning AiRequest blob columns.
  // We cursor-paginate AND pre-filter on `contains: 'media:'` so we never
  // load rows that don't reference media at all. Without this, the original
  // implementation loaded every AiRequest row's messages+fullRequest+fullResponse
  // (avg ~400 KB/row, max 40 MB for image-gen responses) into Node memory,
  // which OOM'd the container at boot once /data/media was non-empty.
  const referenced = new Set<string>();
  const HASH_RE = /media:([a-f0-9]{64})\.[a-z0-9]{1,8}/gi;
  const PAGE_SIZE = 25;
  const where = {
    OR: [
      { messages: { contains: 'media:' } },
      { fullRequest: { contains: 'media:' } },
      { fullResponse: { contains: 'media:' } },
    ],
  };
  let cursor: string | undefined;
  while (true) {
    const batch = await prisma.aiRequest.findMany({
      where,
      take: PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { id: 'asc' },
      select: { id: true, messages: true, fullRequest: true, fullResponse: true },
    });
    if (batch.length === 0) break;
    for (const row of batch) {
      for (const blob of [row.messages, row.fullRequest, row.fullResponse]) {
        if (!blob) continue;
        HASH_RE.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = HASH_RE.exec(blob)) !== null) {
          referenced.add(m[1].toLowerCase());
        }
      }
    }
    cursor = batch[batch.length - 1].id;
    if (batch.length < PAGE_SIZE) break;
  }

  const graceCutoff = Date.now() - MEDIA_ORPHAN_GRACE_DAYS * 24 * 60 * 60 * 1000;
  let deleted = 0;
  for (const f of files) {
    if (referenced.has(f.hash)) continue;
    if (f.mtimeMs >= graceCutoff) continue;
    try {
      await fs.unlink(f.fullPath);
      deleted++;
    } catch {
      // ignore
    }
  }
  return deleted;
}

/**
 * Run all cleanup tasks.
 */
export async function runCleanup(): Promise<void> {
  console.log('[Cleanup] Starting cleanup job...');

  try {
    const cleanupConfig = await getCleanupConfig();

    const deletedLogs = await deleteOldLogs(cleanupConfig.logRetentionDays);
    if (deletedLogs > 0) {
      console.log(`[Cleanup] Deleted ${deletedLogs} logs older than ${cleanupConfig.logRetentionDays} days`);
    }

    const sanitizedHeaders = await sanitizeOldAuthHeaders(cleanupConfig.credentialRetentionDays);
    if (sanitizedHeaders > 0) {
      console.log(`[Cleanup] Sanitized auth headers in ${sanitizedHeaders} logs older than ${cleanupConfig.credentialRetentionDays} days`);
    }

    const sanitizedResponseHeaders = await sanitizeOldAuthResponseHeaders(cleanupConfig.credentialRetentionDays);
    if (sanitizedResponseHeaders > 0) {
      console.log(`[Cleanup] Sanitized auth response headers in ${sanitizedResponseHeaders} logs older than ${cleanupConfig.credentialRetentionDays} days`);
    }

    const expiredMedia = await deleteExpiredMedia(cleanupConfig.mediaRetentionDays);
    if (expiredMedia > 0) {
      console.log(`[Cleanup] Deleted ${expiredMedia} media files older than ${cleanupConfig.mediaRetentionDays} days`);
    }

    const orphanMedia = await deleteOrphanMedia();
    if (orphanMedia > 0) {
      console.log(`[Cleanup] Deleted ${orphanMedia} orphan media files`);
    }

    console.log('[Cleanup] Cleanup job completed');
  } catch (error) {
    console.error('[Cleanup] Error during cleanup:', error);
  }
}

/**
 * Start the cleanup scheduler.
 * Runs cleanup every hour.
 */
export function startCleanupScheduler(): void {
  // Run immediately on startup
  runCleanup();

  // Then run every hour
  const HOUR_MS = 60 * 60 * 1000;
  setInterval(runCleanup, HOUR_MS);

  console.log('[Cleanup] Scheduler started (runs every hour)');
  console.log('[Cleanup] Retention settings are read from database config with env defaults');
}
