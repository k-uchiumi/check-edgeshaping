import type { Env } from './env';
import type { ProgressRecord } from './workflow';
import { TOTAL_STEPS, PROGRESS_TTL_SECONDS } from './workflow';
import { buildPublicView } from './display';

export { CheckWorkflow } from './workflow';

const SESSION_COOKIE_NAME = 'ces_sid';
const SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 400; // 400日（Cookieの実務上の上限に合わせる）
const SESSION_USED_TTL_SECONDS = 60 * 60 * 24 * 400;
const SESSION_LIMIT = 5; // 項目1-a（2026-09-24、1→5に変更）

/** 項目1-b: ホスト名を正規化（小文字化＋先頭www.除去）してドメインキャッシュのキーにする */
function normalizeDomain(hostname: string): string {
  let h = hostname.toLowerCase();
  if (h.startsWith('www.')) h = h.slice(4);
  return h;
}

function json(data: unknown, status = 200, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...(extraHeaders || {}) },
  });
}

function parseCookies(request: Request): Record<string, string> {
  const header = request.headers.get('Cookie') || '';
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // POST /api/diagnose { url: string } → 診断を開始し、診断IDを返す
    if (request.method === 'POST' && url.pathname === '/api/diagnose') {
      let body: any;
      try {
        body = await request.json();
      } catch {
        return json({ message: '不正なリクエストです' }, 400);
      }
      const targetUrl = typeof body?.url === 'string' ? body.url.trim() : '';
      if (!targetUrl) {
        return json({ message: 'URLを指定してください' }, 400);
      }

      let normalized = targetUrl;
      if (!/^https?:\/\//i.test(normalized)) {
        normalized = `https://${normalized}`;
      }
      let parsedTarget: URL;
      try {
        parsedTarget = new URL(normalized);
      } catch {
        return json({ message: 'URLの形式が正しくありません' }, 400);
      }

      // Cookie未発行なら発行する（ドメインキャッシュ命中時も発行する）
      const cookies = parseCookies(request);
      let sessionId = cookies[SESSION_COOKIE_NAME];
      let setCookieHeader: string | undefined;
      if (!sessionId) {
        sessionId = crypto.randomUUID();
        setCookieHeader = `${SESSION_COOKIE_NAME}=${sessionId}; Path=/; Max-Age=${SESSION_COOKIE_MAX_AGE_SECONDS}; HttpOnly; Secure; SameSite=Lax`;
      }

      // 項目1-b: 同一ドメインが24時間以内に診断済みなら、新規診断を行わずその結果をそのまま返す。
      // セッションの回数（項目1-a）は消費しない。
      const domainKey = normalizeDomain(parsedTarget.hostname);
      const cachedDiagnosisId = await env.CHECK_PROGRESS.get(`domain:${domainKey}`);
      if (cachedDiagnosisId) {
        const cachedRaw = await env.CHECK_PROGRESS.get(`diag:${cachedDiagnosisId}`);
        if (cachedRaw) {
          const cachedProgress = JSON.parse(cachedRaw) as ProgressRecord;
          const previousResultAt = new Date(cachedProgress.startedAt).toLocaleString('ja-JP', {
            timeZone: 'Asia/Tokyo',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          });
          return json(
            { diagnosisId: cachedDiagnosisId, reused: true, previousResultAt },
            200,
            setCookieHeader ? { 'Set-Cookie': setCookieHeader } : undefined
          );
        }
        // レコードがTTL満了等で既に無い場合は、通常どおり新規診断に進む
      }

      // 項目1-a: セッション単位の上限（5回）。理由を説明せず「診断は5回までです」で拒否する。
      const usedRaw = await env.CHECK_PROGRESS.get(`session-used:${sessionId}`);
      const usedCount = usedRaw ? parseInt(usedRaw, 10) || 0 : 0;
      if (usedCount >= SESSION_LIMIT) {
        return json(
          { message: '診断は5回までです' },
          429,
          setCookieHeader ? { 'Set-Cookie': setCookieHeader } : undefined
        );
      }

      const diagnosisId = crypto.randomUUID();

      // 項目1-a（前回指示書）: Workflow起動前に初期の進捗レコードを書いておく。Workflow側の
      // 初回書き込みを待たずに画面が /api/diagnose/:id/public を叩いても404にならないようにするため。
      const initialProgress: ProgressRecord = {
        status: 'running',
        diagnosisId,
        targetUrl: normalized,
        total: TOTAL_STEPS,
        done: 0,
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await env.CHECK_PROGRESS.put(`diag:${diagnosisId}`, JSON.stringify(initialProgress), {
        expirationTtl: PROGRESS_TTL_SECONDS,
      });

      // 項目1-b/1-c: ドメイン→診断IDのマッピング（24時間、PROGRESS_TTL_SECONDSと同期）
      await env.CHECK_PROGRESS.put(`domain:${domainKey}`, diagnosisId, {
        expirationTtl: PROGRESS_TTL_SECONDS,
      });

      await env.CHECK_WORKFLOW.create({
        id: diagnosisId,
        params: { targetUrl: normalized, diagnosisId },
      });

      await env.CHECK_PROGRESS.put(`session-used:${sessionId}`, String(usedCount + 1), {
        expirationTtl: SESSION_USED_TTL_SECONDS,
      });

      return json({ diagnosisId }, 202, setCookieHeader ? { 'Set-Cookie': setCookieHeader } : undefined);
    }

    // GET /api/diagnose/:id → 進捗・結果を返す（内部用。httpStatus等を含む詳細データ。
    // 指示書§4.5「問い合わせフォーム送信時に添付」用データ。画面（フロント）は絶対に
    // こちらを直接描画しないこと（A5違反になる）。
    const statusMatch = url.pathname.match(/^\/api\/diagnose\/([A-Za-z0-9-]+)$/);
    if (request.method === 'GET' && statusMatch) {
      const diagnosisId = statusMatch[1];
      const raw = await env.CHECK_PROGRESS.get(`diag:${diagnosisId}`);
      if (!raw) {
        return json({ message: '指定された診断IDが見つかりません' }, 404);
      }
      const progress = JSON.parse(raw) as ProgressRecord;
      return json(progress);
    }

    // GET /api/diagnose/:id/public → 画面が使う、絞り込み済みの公開用データ（A5対応）。
    // ボット名と到達/未到達の2値、robots.txt拒否の有無のみ。ステータスコード・category等は含まない。
    const publicMatch = url.pathname.match(/^\/api\/diagnose\/([A-Za-z0-9-]+)\/public$/);
    if (request.method === 'GET' && publicMatch) {
      const diagnosisId = publicMatch[1];
      const raw = await env.CHECK_PROGRESS.get(`diag:${diagnosisId}`);
      if (!raw) {
        return json({ message: '指定された診断IDが見つかりません' }, 404);
      }
      const progress = JSON.parse(raw) as ProgressRecord;
      return json(buildPublicView(progress));
    }

    // それ以外は静的アセット（フロント）を返す
    return env.ASSETS.fetch(request);
  },
};
