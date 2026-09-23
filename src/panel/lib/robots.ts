import type { RobotsTxtResult } from '../../shared/types';

// robots.txt evaluation following RFC 9309 and Google's documented behavior:
// - the crawler obeys the group(s) naming it, falling back to "*"; groups for the same agent merge
// - the longest matching rule wins; on a tie, allow wins
// - "*" matches any sequence, "$" anchors the end of the URL; empty Disallow allows everything

export interface RobotsRule {
  type: 'allow' | 'disallow';
  pattern: string;
  line: number;
}

interface Group {
  agents: string[];
  rules: RobotsRule[];
}

export interface ParsedRobots {
  groups: Group[];
  sitemaps: string[];
}

export function parseRobots(text: string): ParsedRobots {
  const groups: Group[] = [];
  const sitemaps: string[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;

  text.split(/\r\n|\r|\n/).forEach((raw, index) => {
    const line = raw.replace(/#.*$/, '').trim();
    const sep = line.indexOf(':');
    if (sep < 0) return;
    const key = line.slice(0, sep).trim().toLowerCase();
    const value = line.slice(sep + 1).trim();

    if (key === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      return;
    }
    lastWasAgent = false;
    if (key === 'sitemap') {
      if (value) sitemaps.push(value);
    } else if ((key === 'allow' || key === 'disallow') && current && value) {
      current.rules.push({ type: key, pattern: value, line: index + 1 });
    }
  });
  return { groups, sitemaps };
}

function patternToRegex(pattern: string): RegExp {
  const anchored = pattern.endsWith('$');
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp('^' + body + (anchored ? '$' : ''));
}

export interface RobotsMatch {
  allowed: boolean;
  rule: RobotsRule | null;
  agent: string | null; // the user-agent group that applied
}

export function matchRobots(parsed: ParsedRobots, url: string, agent = 'googlebot'): RobotsMatch {
  let target: string;
  try {
    const u = new URL(url);
    if (u.pathname === '/robots.txt') return { allowed: true, rule: null, agent: null };
    target = u.pathname + u.search;
  } catch {
    return { allowed: true, rule: null, agent: null };
  }

  const named = parsed.groups.filter((g) => g.agents.includes(agent));
  const applicable = named.length ? named : parsed.groups.filter((g) => g.agents.includes('*'));
  const appliedAgent = named.length ? agent : applicable.length ? '*' : null;

  let best: RobotsRule | null = null;
  for (const rule of applicable.flatMap((g) => g.rules)) {
    if (!patternToRegex(rule.pattern).test(target)) continue;
    if (
      !best ||
      rule.pattern.length > best.pattern.length ||
      (rule.pattern.length === best.pattern.length && rule.type === 'allow')
    ) {
      best = rule;
    }
  }
  return { allowed: !best || best.type === 'allow', rule: best, agent: appliedAgent };
}

export type RobotsVerdict =
  | { state: 'allowed'; detail: string; match: RobotsMatch | null }
  | { state: 'blocked'; detail: string; match: RobotsMatch }
  | { state: 'unknown'; detail: string; serverError: boolean };

// How Google treats this page given the robots.txt fetch result.
export function robotsVerdict(result: RobotsTxtResult, pageUrl: string): RobotsVerdict {
  const { status } = result;
  if (status === null) return { state: 'unknown', detail: `Could not fetch robots.txt${result.error ? ` (${result.error})` : ''}`, serverError: false };
  if (status >= 500) return { state: 'unknown', detail: `robots.txt returns HTTP ${status}; Google pauses crawling the site while this lasts`, serverError: true };
  if (status >= 400) return { state: 'allowed', detail: `No robots.txt (HTTP ${status}), so everything may be crawled`, match: null };
  if (result.content === null) {
    return { state: 'allowed', detail: 'robots.txt returns an HTML page instead of a text file, so it has no rules', match: null };
  }
  const match = matchRobots(parseRobots(result.content), pageUrl);
  if (!match.rule) {
    const detail = match.agent ? `No rule for user-agent: ${match.agent} matches this URL` : 'No rules apply to Googlebot';
    return { state: 'allowed', detail, match };
  }
  const rule = `${match.rule.type === 'allow' ? 'Allow' : 'Disallow'}: ${match.rule.pattern} (line ${match.rule.line})`;
  return match.allowed
    ? { state: 'allowed', detail: `Allowed by ${rule}`, match }
    : { state: 'blocked', detail: `Blocked by ${rule}`, match };
}
