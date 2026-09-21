/**
 * robots.txt の取得・解析。指示書 §4.2 ③・§4.4「robots.txtによる拒否」に対応。
 * 実装は RFC 9309 (Robots Exclusion Protocol) の一般的な解釈に準拠：
 *   - グループ選択: 対象ボットのUser-agentトークンに完全一致（大文字小文字無視）するグループを
 *     優先。無ければ '*' グループ。どちらも無ければ制限なし（許可）
 *   - グループ内では、パスに一致する最長のAllow/Disallowパターンを採用。
 *     長さが同じ場合はAllow優先（Googleの実装に準拠。RFC自体は同点時の挙動を規定していない）
 *   - ワイルドカード `*` と行末アンカー `$` に対応
 *
 * robots.txt自体の取得は、存在確認と同じブラウザUAを使う（指示書に個別UA指定が無いため。
 * robots.txtはボット向けUAで出し分けされることは通常無い一般公開ファイルという前提）。
 */
import { createHostValidator, ssrfSafeFetch } from './ssrf';
import { EXISTENCE_CHECK_HEADERS } from './headers';

export interface RobotsFetchResult {
  fetched: boolean;
  httpStatus: number | null;
  reason: string;
  body: string | null;
}

export async function fetchRobotsTxt(
  targetUrl: string,
  hostValidator: ReturnType<typeof createHostValidator>
): Promise<RobotsFetchResult> {
  let robotsUrl: string;
  try {
    const origin = new URL(targetUrl).origin;
    robotsUrl = `${origin}/robots.txt`;
  } catch {
    return { fetched: false, httpStatus: null, reason: 'invalid_target_url', body: null };
  }

  const result = await ssrfSafeFetch(robotsUrl, {
    headers: EXISTENCE_CHECK_HEADERS,
    timeoutMs: 10_000,
    maxRedirects: 5,
    hostValidator,
  });

  if (!result.ok) {
    // 4xx/5xx/タイムアウト等はすべて「取得できず」として扱う（診断表示上の情報用途のため、
    // 実クロール時のような「5xxは一時的に全面拒否とみなす」という保守的解釈は採らない）。
    return { fetched: false, httpStatus: null, reason: result.reason, body: null };
  }

  if (!result.response.ok) {
    // 4xx等: robots.txtが存在しない = 制限なし
    return { fetched: false, httpStatus: result.response.status, reason: `http_${result.response.status}`, body: null };
  }

  const body = await result.response.text();
  return { fetched: true, httpStatus: result.response.status, reason: 'ok', body };
}

interface PathRule {
  pattern: string;
  isAllow: boolean;
}

export interface RobotsRuleset {
  groups: Map<string, PathRule[]>; // key: 小文字化したUser-agentトークン、'*'含む
}

export function parseRobotsTxt(body: string): RobotsRuleset {
  const groups = new Map<string, PathRule[]>();
  const lines = body.split(/\r\n|\r|\n/);

  let currentAgents: string[] = [];
  let sawRuleSinceLastAgent = false;

  for (const rawLine of lines) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;

    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const field = line.slice(0, colonIdx).trim().toLowerCase();
    const value = line.slice(colonIdx + 1).trim();

    if (field === 'user-agent') {
      const token = value.toLowerCase();
      if (sawRuleSinceLastAgent) {
        // 直前にDisallow/Allowが出た後の新しいUser-agentは、新しいグループの開始
        currentAgents = [token];
        sawRuleSinceLastAgent = false;
      } else {
        currentAgents.push(token);
      }
      if (!groups.has(token)) groups.set(token, []);
      continue;
    }

    if (field === 'disallow' || field === 'allow') {
      if (currentAgents.length === 0) continue; // User-agent未指定のルールは無視
      sawRuleSinceLastAgent = true;
      const isAllow = field === 'allow';
      // Disallow: （空値）は「制限なし」を意味するため、パターンとしては登録しない
      if (field === 'disallow' && value === '') continue;
      for (const agent of currentAgents) {
        const list = groups.get(agent) ?? [];
        list.push({ pattern: value, isAllow });
        groups.set(agent, list);
      }
      continue;
    }
    // sitemap / crawl-delay 等は本ツールでは未使用
  }

  return { groups };
}

function patternToRegExp(pattern: string): RegExp {
  // REP拡張: `*` は任意文字列、`$` は行末アンカー。それ以外はリテラルとしてエスケープ。
  let out = '^';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') {
      out += '.*';
    } else if (c === '$' && i === pattern.length - 1) {
      out += '$';
    } else {
      out += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  if (!pattern.endsWith('$')) {
    // 末尾$が無ければ前方一致
  } else {
    out = out; // 既に$を付与済み
  }
  return new RegExp(out);
}

function findGroup(ruleset: RobotsRuleset, botToken: string): PathRule[] | null {
  const exact = ruleset.groups.get(botToken.toLowerCase());
  if (exact) return exact;
  const wildcard = ruleset.groups.get('*');
  if (wildcard) return wildcard;
  return null;
}

/**
 * 指定パスが、指定ボットに対してrobots.txt上でDisallowされているかを判定する。
 * ルールが無い（グループ自体が無い）場合は false（制限なし）。
 */
export function isDisallowedForBot(ruleset: RobotsRuleset, botToken: string, path: string): boolean {
  const rules = findGroup(ruleset, botToken);
  if (!rules || rules.length === 0) return false;

  let best: { length: number; isAllow: boolean } | null = null;
  for (const rule of rules) {
    const re = patternToRegExp(rule.pattern);
    if (re.test(path)) {
      const length = rule.pattern.length;
      if (!best || length > best.length || (length === best.length && rule.isAllow)) {
        best = { length, isAllow: rule.isAllow };
      }
    }
  }
  if (!best) return false;
  return !best.isAllow;
}
