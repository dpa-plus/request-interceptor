import { prisma } from './prisma.js';

const LOG_RETENTION_DAYS = 30;
const AUTH_HEADER_RETENTION_DAYS = 3;

/**
 * Delete request logs older than the retention period.
 * Also deletes associated AiRequest records.
 */
async function deleteOldLogs(): Promise<number> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - LOG_RETENTION_DAYS);

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
 * This sanitizes sensitive data while keeping the log entries.
 */
async function sanitizeOldAuthHeaders(): Promise<number> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - AUTH_HEADER_RETENTION_DAYS);

  // Find logs with headers that might contain auth data
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
      const headers = JSON.parse(log.headers);
      let modified = false;

      // List of sensitive headers to redact
      const sensitiveHeaders = [
        'authorization',
        'x-api-key',
        'api-key',
        'x-auth-token',
        'cookie',
        'set-cookie',
      ];

      for (const key of Object.keys(headers)) {
        if (sensitiveHeaders.includes(key.toLowerCase())) {
          if (headers[key] !== '[REDACTED]') {
            headers[key] = '[REDACTED]';
            modified = true;
          }
        }
      }

      if (modified) {
        await prisma.requestLog.update({
          where: { id: log.id },
          data: { headers: JSON.stringify(headers) },
        });
        sanitizedCount++;
      }
    } catch {
      // Skip logs with invalid JSON headers
    }
  }

  return sanitizedCount;
}

/**
 * Run all cleanup tasks.
 */
export async function runCleanup(): Promise<void> {
  console.log('[Cleanup] Starting cleanup job...');

  try {
    const deletedLogs = await deleteOldLogs();
    if (deletedLogs > 0) {
      console.log(`[Cleanup] Deleted ${deletedLogs} logs older than ${LOG_RETENTION_DAYS} days`);
    }

    const sanitizedHeaders = await sanitizeOldAuthHeaders();
    if (sanitizedHeaders > 0) {
      console.log(`[Cleanup] Sanitized auth headers in ${sanitizedHeaders} logs older than ${AUTH_HEADER_RETENTION_DAYS} days`);
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
}
