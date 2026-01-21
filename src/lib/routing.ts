import { Request } from 'express';
import { prisma } from './prisma.js';

export type RouteSource = 'query_param' | 'header' | 'config_rule' | 'default';

export interface ResolvedTarget {
  targetUrl: string;
  source: RouteSource;
  ruleId?: string;
  ruleName?: string;
}

export interface RoutingError {
  error: true;
  message: string;
  code: 'NO_TARGET' | 'INVALID_URL';
}

const TARGET_QUERY_PARAM = '__target';
const TARGET_HEADER = 'x-target-url';

export function extractTargetFromQuery(req: Request): { targetUrl: string | null; cleanQuery: Record<string, any> } {
  const query = { ...req.query };
  const targetUrl = query[TARGET_QUERY_PARAM] as string | undefined;

  if (targetUrl) {
    delete query[TARGET_QUERY_PARAM];
  }

  return {
    targetUrl: targetUrl || null,
    cleanQuery: query,
  };
}

export function extractTargetFromHeader(req: Request): string | null {
  const headerValue = req.get(TARGET_HEADER);
  return headerValue || null;
}

export function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export async function resolveTarget(req: Request): Promise<ResolvedTarget | RoutingError> {
  // 1. Check query parameter first (highest priority)
  const { targetUrl: queryTarget } = extractTargetFromQuery(req);

  if (queryTarget) {
    if (!isValidUrl(queryTarget)) {
      return {
        error: true,
        message: `Invalid target URL: ${queryTarget}`,
        code: 'INVALID_URL',
      };
    }
    return {
      targetUrl: queryTarget,
      source: 'query_param',
    };
  }

  // 2. Check X-Target-URL header
  const headerTarget = extractTargetFromHeader(req);

  if (headerTarget) {
    if (!isValidUrl(headerTarget)) {
      return {
        error: true,
        message: `Invalid target URL in header: ${headerTarget}`,
        code: 'INVALID_URL',
      };
    }
    return {
      targetUrl: headerTarget,
      source: 'header',
    };
  }

  // 3. Check routing rules
  const rules = await prisma.routingRule.findMany({
    where: { enabled: true },
    orderBy: { priority: 'desc' },
  });

  for (const rule of rules) {
    if (matchesRule(req, rule)) {
      return {
        targetUrl: rule.targetUrl,
        source: 'config_rule',
        ruleId: rule.id,
        ruleName: rule.name,
      };
    }
  }

  // 3. Check default target from config
  const config = await prisma.config.findUnique({ where: { id: 'default' } });

  if (config?.defaultTargetUrl) {
    return {
      targetUrl: config.defaultTargetUrl,
      source: 'default',
    };
  }

  // No target found
  return {
    error: true,
    message: 'No target URL found. Provide __target query parameter, X-Target-URL header, configure a routing rule, or set a default target.',
    code: 'NO_TARGET',
  };
}

interface RoutingRule {
  matchType: string;
  matchPattern: string;
  matchHeader: string | null;
}

function matchesRule(req: Request, rule: RoutingRule): boolean {
  try {
    switch (rule.matchType) {
      case 'path_prefix':
        return req.path.startsWith(rule.matchPattern);

      case 'path_regex': {
        const pathRegex = new RegExp(rule.matchPattern);
        return pathRegex.test(req.path);
      }

      case 'header_regex': {
        if (!rule.matchHeader) return false;
        const headerValue = req.get(rule.matchHeader);
        if (!headerValue) return false;
        const headerRegex = new RegExp(rule.matchPattern);
        return headerRegex.test(headerValue);
      }

      default:
        return false;
    }
  } catch (e) {
    console.error(`Error matching rule ${rule.matchType}:`, e);
    return false;
  }
}

export function buildTargetUrl(baseTarget: string, path: string, query: Record<string, any>): string {
  const url = new URL(path, baseTarget);

  // Preserve original query params (excluding __target)
  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) {
      value.forEach(v => url.searchParams.append(key, String(v)));
    } else if (value !== undefined && value !== null) {
      url.searchParams.append(key, String(value));
    }
  }

  return url.toString();
}
