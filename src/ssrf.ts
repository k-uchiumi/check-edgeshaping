/**
 * SSRF対策（k-uchiumi/Vercel の src/app/api/check/route.ts からロジックを移植）。
 * 移植元は書き換えていない（本番のため禁止）。
 *
 * 移植時の変更点（本人指示 2026-09-21）：
 *   移植元は「fetchのたびに毎回DNS over HTTPSで検証」する設計だったが、
 *   本ツールは同一URLに対して1診断あたり69件のリクエストを送るため、
 *   ホスト名ごとに検証結果をキャッシュし、診断開始時に対象ホストを1回だけ検証する。
 *   リダイレクトで別ホストに飛んだ場合のみ、そのホストを新規に検証する。
 */

const SSRF_ALLOWED_SCHEMES = new Set(['http:', 'https:']);
const SSRF_BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata.google.internal',
]);
const SSRF_BLOCKED_HOSTNAME_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home.arpa'];

function ssrfIpv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v < 0 || v > 255) return null;
    n = (n << 8) | v;
  }
  return n >>> 0;
}

function ssrfInRangeV4(n: number, base: string, bits: number): boolean {
  const b = ssrfIpv4ToInt(base);
  if (b === null) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (n & mask) === (b & mask);
}

function ssrfIsPrivateIPv4(ip: string): boolean {
  const n = ssrfIpv4ToInt(ip);
  if (n === null) return false;
  return (
    ssrfInRangeV4(n, '0.0.0.0', 8) ||
    ssrfInRangeV4(n, '10.0.0.0', 8) ||
    ssrfInRangeV4(n, '100.64.0.0', 10) ||
    ssrfInRangeV4(n, '127.0.0.0', 8) ||
    ssrfInRangeV4(n, '169.254.0.0', 16) ||
    ssrfInRangeV4(n, '172.16.0.0', 12) ||
    ssrfInRangeV4(n, '192.0.0.0', 24) ||
    ssrfInRangeV4(n, '192.0.2.0', 24) ||
    ssrfInRangeV4(n, '192.168.0.0', 16) ||
    ssrfInRangeV4(n, '198.18.0.0', 15) ||
    ssrfInRangeV4(n, '198.51.100.0', 24) ||
    ssrfInRangeV4(n, '203.0.113.0', 24) ||
    ssrfInRangeV4(n, '224.0.0.0', 4) ||
    ssrfInRangeV4(n, '240.0.0.0', 4)
  );
}

function ssrfParseIPv6(host: string): number[] | null {
  let h = host.toLowerCase();
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  const v4Match = h.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (v4Match) {
    const v4 = v4Match[1];
    const octets = v4.split('.').map(Number);
    if (octets.some((o) => o < 0 || o > 255 || isNaN(o))) return null;
    const hex = `${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
    h = h.slice(0, h.length - v4.length) + hex;
  }
  if (!h.includes(':')) return null;
  const parts = h.split('::');
  if (parts.length > 2) return null;
  const head = parts[0] ? parts[0].split(':').filter(Boolean) : [];
  const tail = parts.length === 2 && parts[1] ? parts[1].split(':').filter(Boolean) : [];
  let groups: string[];
  if (parts.length === 2) {
    const missing = 8 - head.length - tail.length;
    if (missing < 0) return null;
    groups = [...head, ...Array(missing).fill('0'), ...tail];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;
  const nums = groups.map((g) => parseInt(g, 16));
  if (nums.some((n) => isNaN(n) || n < 0 || n > 0xffff)) return null;
  return nums;
}

function ssrfIsPrivateIPv6(host: string): boolean {
  const g = ssrfParseIPv6(host);
  if (!g) return false;
  const [g0, g1, g2, g3, g4, g5, g6, g7] = g;
  if (g.every((x) => x === 0)) return true;
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0 && g6 === 0 && g7 === 1) return true;
  if ((g0 & 0xffc0) === 0xfe80) return true;
  if ((g0 & 0xfe00) === 0xfc00) return true;
  if ((g0 & 0xff00) === 0xff00) return true;
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff) {
    const a = (g6 >> 8) & 0xff, b = g6 & 0xff, c = (g7 >> 8) & 0xff, d = g7 & 0xff;
    if (ssrfIsPrivateIPv4(`${a}.${b}.${c}.${d}`)) return true;
  }
  return false;
}

function ssrfIsBlockedIpLiteral(hostname: string): boolean {
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    return ssrfIsPrivateIPv6(hostname);
  }
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
    return ssrfIsPrivateIPv4(hostname);
  }
  if (hostname.includes(':')) {
    return ssrfIsPrivateIPv6(hostname);
  }
  return false;
}

function ssrfIsBlockedHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (SSRF_BLOCKED_HOSTNAMES.has(h)) return true;
  return SSRF_BLOCKED_HOSTNAME_SUFFIXES.some((suffix) => h.endsWith(suffix));
}

async function ssrfResolveHostnameIPs(hostname: string, signal: AbortSignal): Promise<string[]> {
  const ips: string[] = [];
  for (const type of ['A', 'AAAA']) {
    try {
      const res = await fetch(
        `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=${type}`,
        { headers: { Accept: 'application/dns-json' }, signal }
      );
      if (res.ok) {
        const data: any = await res.json();
        for (const ans of data.Answer || []) {
          if ((ans.type === 1 || ans.type === 28) && typeof ans.data === 'string') {
            ips.push(ans.data);
          }
        }
      }
    } catch (e) {
      // このレコードタイプのDoH解決失敗は「結果なし」として扱う
    }
  }
  return ips;
}

export type HostValidation = { ok: true } | { ok: false; reason: string };

/**
 * ホスト名単位で検証結果をキャッシュするバリデータを作る。
 * 1診断（1回のWorkflow実行）につき1つ生成し、69件のリクエスト全体で使い回す。
 */
export function createHostValidator() {
  const cache = new Map<string, HostValidation>();

  async function validateHost(hostname: string, signal: AbortSignal): Promise<HostValidation> {
    const cached = cache.get(hostname);
    if (cached) return cached;

    let result: HostValidation;
    if (ssrfIsBlockedIpLiteral(hostname)) {
      result = { ok: false, reason: 'blocked_ip_literal' };
    } else if (ssrfIsBlockedHostname(hostname)) {
      result = { ok: false, reason: 'blocked_hostname' };
    } else {
      const isLiteralIp =
        /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) || (hostname.startsWith('[') && hostname.endsWith(']'));
      if (isLiteralIp) {
        result = { ok: true };
      } else {
        const ips = await ssrfResolveHostnameIPs(hostname, signal);
        if (ips.length === 0) {
          result = { ok: false, reason: 'dns_resolution_failed' };
        } else {
          const blocked = ips.some((ip) => (ip.includes(':') ? ssrfIsPrivateIPv6(ip) : ssrfIsPrivateIPv4(ip)));
          result = blocked ? { ok: false, reason: 'blocked_resolved_ip' } : { ok: true };
        }
      }
    }
    cache.set(hostname, result);
    return result;
  }

  return { validateHost };
}

export type SafeFetchResult =
  | { ok: true; response: Response; finalUrl: string }
  | { ok: false; reason: string; status: number };

export interface SafeFetchOptions {
  headers: Record<string, string>;
  timeoutMs: number;
  maxRedirects: number;
  hostValidator: ReturnType<typeof createHostValidator>;
}

/**
 * SSRF対策込みの安全なfetch。redirectは手動フォローし、ホストが変わった場合のみ
 * そのホストを新規に検証する（同一ホストへの再訪問はキャッシュを使う）。
 */
export async function ssrfSafeFetch(initialUrl: string, opts: SafeFetchOptions): Promise<SafeFetchResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    let currentUrl = initialUrl;
    for (let hop = 0; hop <= opts.maxRedirects; hop++) {
      let parsed: URL;
      try {
        parsed = new URL(currentUrl);
      } catch {
        return { ok: false, reason: 'invalid_url', status: 400 };
      }
      if (!SSRF_ALLOWED_SCHEMES.has(parsed.protocol)) {
        return { ok: false, reason: 'blocked_scheme', status: 400 };
      }
      const validation = await opts.hostValidator.validateHost(parsed.hostname, controller.signal);
      if (!validation.ok) {
        return { ok: false, reason: validation.reason, status: 400 };
      }

      const res = await fetch(parsed.toString(), {
        headers: opts.headers,
        redirect: 'manual',
        signal: controller.signal,
      });

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        if (!location) {
          return { ok: false, reason: 'redirect_without_location', status: 502 };
        }
        currentUrl = new URL(location, parsed).toString();
        continue;
      }
      return { ok: true, response: res, finalUrl: parsed.toString() };
    }
    return { ok: false, reason: 'too_many_redirects', status: 508 };
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      return { ok: false, reason: 'timeout', status: 504 };
    }
    return { ok: false, reason: e?.message || 'fetch_failed', status: 502 };
  } finally {
    clearTimeout(timeoutId);
  }
}
