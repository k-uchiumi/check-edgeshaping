/**
 * 個々のプローブ（1リクエスト）の送信と判定。指示書 §4.3 の判定表に対応。
 *
 * §4.5「裏に持つデータ」対応: 遮断元の推定・応答ヘッダーを内部用フィールドとして保持する。
 * これらは画面には一切出さず（§4.4「見せないもの」）、問い合わせフォーム添付・Sheets保存
 * （実装順序5）にのみ使う。
 */
import { createHostValidator, ssrfSafeFetch } from './ssrf';

export type Verdict = '到達' | 'ブロック' | '中断_判定不能' | '判定不能';

export type BlockingSourceGuess = 'cloudflare' | 'known_waf_or_plugin' | 'server_waf_or_other' | 'unknown';

export interface ProbeResult {
  ua: string;
  seq: number;
  sentAt: string; // ISO8601
  finishedAt: string;
  httpStatus: number | null;
  verdict: Verdict;
  reason: string; // 内部用（画面には出さない。問い合わせ添付データ用）
  finalUrl: string | null;
  retryCount: number;
  /** 内部用。応答ヘッダーの主要なもののみ（全ヘッダーではなく、判定に使ったもの中心）。画面には出さない。 */
  responseHeaders: Record<string, string> | null;
  /** 内部用。遮断元の推定（ヒューリスティック、確定情報ではない）。画面には出さない。 */
  blockingSourceGuess: BlockingSourceGuess | null;
}

const CHALLENGE_BODY_MARKERS = [
  // Cloudflare
  'Just a moment...',
  'cf-chl-',
  'Checking your browser before accessing',
  'Attention Required! | Cloudflare',
  // 汎用CAPTCHA/チャレンジベンダー
  'captcha-delivery.com', // DataDome
  'Please verify you are a human', // 各種
  'window._cf_chl_opt',
  '/cdn-cgi/challenge-platform/',
];

/**
 * チャレンジ応答の簡易検出。
 * 既知パターンによるヒューリスティックであり、実運用ログでの継続的な見直しが前提
 * （§4.3「challenge応答」の判定基準に厳密な文字列指定が指示書になかったため、
 * 一般的に知られているシグナルで実装。要確認事項として報告済み・現状のマーカーで確定 2026-09-21）。
 */
function isChallengeResponse(status: number, headers: Headers, bodySnippet: string): boolean {
  if (headers.get('cf-mitigated')) return true;
  return CHALLENGE_BODY_MARKERS.some((marker) => bodySnippet.includes(marker));
}

// 遮断元推定に使う既知ヘッダー・シグネチャ（ヒューリスティック。指示書に明示指定は無く、
// 「外から叩く以外に確認手段がない」（指示書§2）性質上、推定の域を出ない前提で実装）。
const KNOWN_WAF_HEADER_SIGNATURES: Array<{ header: string; label: string }> = [
  { header: 'x-sucuri-id', label: 'Sucuri' },
  { header: 'x-sucuri-cache', label: 'Sucuri' },
  { header: 'x-wptotalcache-waf', label: 'WP-Total-Cache/WAF' },
  { header: 'x-mod-security', label: 'ModSecurity' },
  { header: 'x-firewall-block', label: 'unknown-firewall' },
  { header: 'x-siteground-waf', label: 'SiteGround WAF' },
];

function guessBlockingSource(status: number, headers: Headers): BlockingSourceGuess {
  const isBlockingStatus = [401, 403, 406, 429, 451, 503].includes(status);
  if (!isBlockingStatus) return 'unknown';

  if (headers.get('cf-mitigated') || headers.get('cf-ray') || (headers.get('server') || '').toLowerCase() === 'cloudflare') {
    return 'cloudflare';
  }
  for (const sig of KNOWN_WAF_HEADER_SIGNATURES) {
    if (headers.get(sig.header)) return 'known_waf_or_plugin';
  }
  // Cloudflare/既知シグネチャのいずれにも一致しないブロック。指示書§2の仮説どおり
  // レンタルサーバー側WAF等の可能性が高いが、ヘッダーだけでは確定できないため
  // 'server_waf_or_other' として保留する。
  return 'server_waf_or_other';
}

function snapshotHeaders(headers: Headers): Record<string, string> {
  const keysOfInterest = [
    'server',
    'cf-ray',
    'cf-mitigated',
    'retry-after',
    'x-sucuri-id',
    'x-sucuri-cache',
    'x-wptotalcache-waf',
    'x-mod-security',
    'x-firewall-block',
    'x-siteground-waf',
    'content-type',
  ];
  const out: Record<string, string> = {};
  for (const key of keysOfInterest) {
    const v = headers.get(key);
    if (v) out[key] = v;
  }
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface SendProbeParams {
  targetUrl: string;
  ua: string;
  seq: number;
  hostValidator: ReturnType<typeof createHostValidator>;
  baseHeaders?: Record<string, string>;
}

const BACKOFF_SCHEDULE_MS = [2000, 4000, 8000]; // 429/503時: 2秒→4秒→8秒、最大3回

/**
 * 1件のプローブを送信する。429/503はこの関数の内部でRetry-After優先の
 * バックオフ再試行を行い（最大3回）、それでも解決しなければ「判定不能（サーバー側の制限）」。
 */
export async function sendProbe(params: SendProbeParams): Promise<ProbeResult> {
  const { targetUrl, ua, seq, hostValidator } = params;
  const sentAt = new Date().toISOString();
  const headers: Record<string, string> = {
    ...(params.baseHeaders || {}),
    'User-Agent': ua,
  };

  let retryCount = 0;
  for (;;) {
    const result = await ssrfSafeFetch(targetUrl, {
      headers,
      timeoutMs: 10_000,
      maxRedirects: 5,
      hostValidator,
    });

    if (!result.ok) {
      return {
        ua,
        seq,
        sentAt,
        finishedAt: new Date().toISOString(),
        httpStatus: null,
        verdict: '判定不能',
        reason: result.reason,
        finalUrl: null,
        retryCount,
        responseHeaders: null,
        blockingSourceGuess: null,
      };
    }

    const { response, finalUrl } = result;
    const status = response.status;

    if (status === 429 || status === 503) {
      if (retryCount >= BACKOFF_SCHEDULE_MS.length) {
        return {
          ua,
          seq,
          sentAt,
          finishedAt: new Date().toISOString(),
          httpStatus: status,
          verdict: '中断_判定不能',
          reason: 'rate_limited_retries_exhausted',
          finalUrl,
          retryCount,
          responseHeaders: snapshotHeaders(response.headers),
          blockingSourceGuess: guessBlockingSource(status, response.headers),
        };
      }
      const retryAfterHeader = response.headers.get('retry-after');
      let delayMs = BACKOFF_SCHEDULE_MS[retryCount];
      if (retryAfterHeader) {
        const asSeconds = Number(retryAfterHeader);
        if (!Number.isNaN(asSeconds)) {
          delayMs = asSeconds * 1000;
        } else {
          const asDate = Date.parse(retryAfterHeader);
          if (!Number.isNaN(asDate)) {
            delayMs = Math.max(0, asDate - Date.now());
          }
        }
      }
      retryCount += 1;
      await sleep(delayMs);
      continue; // 同一UAで再送
    }

    if (status >= 200 && status < 300) {
      return {
        ua,
        seq,
        sentAt,
        finishedAt: new Date().toISOString(),
        httpStatus: status,
        verdict: '到達',
        reason: 'ok',
        finalUrl,
        retryCount,
        responseHeaders: snapshotHeaders(response.headers),
        blockingSourceGuess: 'unknown',
      };
    }

    if (status === 401 || status === 403 || status === 406 || status === 451) {
      return {
        ua,
        seq,
        sentAt,
        finishedAt: new Date().toISOString(),
        httpStatus: status,
        verdict: 'ブロック',
        reason: `http_${status}`,
        finalUrl,
        retryCount,
        responseHeaders: snapshotHeaders(response.headers),
        blockingSourceGuess: guessBlockingSource(status, response.headers),
      };
    }

    // それ以外のステータス: 本文冒頭を見てチャレンジ応答か確認
    let bodySnippet = '';
    try {
      const text = await response.text();
      bodySnippet = text.slice(0, 4096);
    } catch {
      // 本文取得失敗時はヘッダーのみで判定
    }
    if (isChallengeResponse(status, response.headers, bodySnippet)) {
      return {
        ua,
        seq,
        sentAt,
        finishedAt: new Date().toISOString(),
        httpStatus: status,
        verdict: 'ブロック',
        reason: 'challenge_response',
        finalUrl,
        retryCount,
        responseHeaders: snapshotHeaders(response.headers),
        blockingSourceGuess: guessBlockingSource(status, response.headers),
      };
    }

    // 想定外のステータスコード。指示書の判定表に無い値のため「判定不能」とする。
    return {
      ua,
      seq,
      sentAt,
      finishedAt: new Date().toISOString(),
      httpStatus: status,
      verdict: '判定不能',
      reason: `unhandled_status_${status}`,
      finalUrl,
      retryCount,
      responseHeaders: snapshotHeaders(response.headers),
      blockingSourceGuess: 'unknown',
    };
  }
}
