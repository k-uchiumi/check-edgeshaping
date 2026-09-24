import { WorkflowEntrypoint, WorkflowStep } from 'cloudflare:workers';
import type { WorkflowEvent } from 'cloudflare:workers';
import { createHostValidator } from './ssrf';
import { sendProbe, type ProbeResult } from './probe';
import { fetchRobotsTxt, parseRobotsTxt, isDisallowedForBot, type RobotsFetchResult } from './robots';
import { EXISTENCE_CHECK_HEADERS } from './headers';
import { BOT_DICTIONARY } from './dictionary.generated';
import { appendDiagnosisRow } from './sheets';
import type { Env } from './env';

export interface CheckWorkflowParams {
  targetUrl: string;
  diagnosisId: string;
}

export type ProgressStatus = 'running' | 'site_not_found' | 'complete' | 'error';

export interface FinalBotResult extends ProbeResult {
  /** robots.txt上でこのボットに対してDisallowされているか（エッジでのブロックとは別軸。§4.4） */
  robotsDisallowed: boolean;
}

export interface RobotsSummary {
  fetched: boolean;
  httpStatus: number | null;
  reason: string;
}

export interface ProgressRecord {
  status: ProgressStatus;
  diagnosisId: string;
  targetUrl: string;
  total: number; // 1(存在確認) + 68(本診断) + 1(robots.txt) = 70。指示書A1参照
  done: number;
  startedAt: string;
  updatedAt: string;
  existenceCheck?: { ok: boolean; httpStatus: number | null; reason: string };
  robotsTxt?: RobotsSummary;
  results?: FinalBotResult[];
  errorMessage?: string;
}

export const TOTAL_STEPS = 1 + BOT_DICTIONARY.length + 1; // 70
export const PROGRESS_TTL_SECONDS = 60 * 60 * 24; // 24時間で失効（項目1-c、2026-09-24。同一ドメイン24時間キャッシュ表示のため6時間から延長。問い合わせ添付用の永続化は実装順序5でSheetsへ）

async function writeProgress(env: Env, record: ProgressRecord) {
  await env.CHECK_PROGRESS.put(`diag:${record.diagnosisId}`, JSON.stringify(record), {
    expirationTtl: PROGRESS_TTL_SECONDS,
  });
}

// 項目2: 進捗の書き込みは必ずstep.do経由にする。Workflowsはstep.sleepからの再開時に
// run()を先頭から再実行するため、step外の処理は毎回やり直される。step名は再実行しても
// 変わらない一意な名前にすること。
async function persistProgress(env: Env, step: WorkflowStep, name: string, record: ProgressRecord): Promise<void> {
  await step.do(name, async () => {
    await writeProgress(env, record);
  });
}

export class CheckWorkflow extends WorkflowEntrypoint<Env, CheckWorkflowParams> {
  async run(event: WorkflowEvent<CheckWorkflowParams>, step: WorkflowStep) {
    const { targetUrl, diagnosisId } = event.payload;
    const hostValidator = createHostValidator();

    // 初期の進捗レコードは POST /api/diagnose 側（index.ts）で書き込み済み（項目1-a）。
    let progress: ProgressRecord = {
      status: 'running',
      diagnosisId,
      targetUrl,
      total: TOTAL_STEPS,
      done: 0,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // ① 存在確認（1回、通常のブラウザUA）
    const existence = await step.do('existence-check', async () => {
      return await sendProbe({
        targetUrl,
        ua: EXISTENCE_CHECK_HEADERS['User-Agent'],
        seq: 0,
        hostValidator,
        baseHeaders: EXISTENCE_CHECK_HEADERS,
      });
    });

    progress = {
      ...progress,
      done: 1,
      updatedAt: new Date().toISOString(),
      existenceCheck: {
        ok: existence.httpStatus !== null && existence.httpStatus >= 200 && existence.httpStatus < 300,
        httpStatus: existence.httpStatus,
        reason: existence.reason,
      },
    };

    // ② 2xx以外 → 診断に入らず終了（A6）
    if (!progress.existenceCheck!.ok) {
      progress.status = 'site_not_found';
      await persistProgress(this.env, step, 'progress-existence', progress);
      return progress;
    }
    await persistProgress(this.env, step, 'progress-existence', progress);

    // ③ 本診断（68件、直列、1秒間隔）— A1〜A4, A7
    const results: ProbeResult[] = [];
    for (let i = 0; i < BOT_DICTIONARY.length; i++) {
      const entry = BOT_DICTIONARY[i];

      // 直前のリクエストから最低1秒空ける（A2）。既存ステップの再送を防ぐため、
      // sleepにも一意な名前を振る。
      await step.sleep(`spacing-${i}`, '1 second');

      const probeResult = await step.do(`probe-${i}-${entry.ua}`, async () => {
        return await sendProbe({
          targetUrl,
          ua: entry.ua,
          seq: i + 1,
          hostValidator,
        });
      });

      results.push(probeResult);
      progress = {
        ...progress,
        done: 2 + i,
        updatedAt: new Date().toISOString(),
      };
      await persistProgress(this.env, step, `progress-probe-${i}`, progress);
    }

    // ④ robots.txt を1回取得し、各ボットへのDisallowを解析（実装順序3）
    await step.sleep('spacing-robots', '1 second');
    const robotsFetch: RobotsFetchResult = await step.do('fetch-robots-txt', async () => {
      return await fetchRobotsTxt(targetUrl, hostValidator);
    });

    const robotsSummary: RobotsSummary = {
      fetched: robotsFetch.fetched,
      httpStatus: robotsFetch.httpStatus,
      reason: robotsFetch.reason,
    };

    const targetPath = (() => {
      try {
        return new URL(targetUrl).pathname || '/';
      } catch {
        return '/';
      }
    })();

    const ruleset = robotsFetch.fetched && robotsFetch.body ? parseRobotsTxt(robotsFetch.body) : null;

    const finalResults: FinalBotResult[] = results.map((r) => ({
      ...r,
      robotsDisallowed: ruleset ? isDisallowedForBot(ruleset, r.ua, targetPath) : false,
    }));

    progress = {
      ...progress,
      status: 'complete',
      done: TOTAL_STEPS,
      updatedAt: new Date().toISOString(),
      robotsTxt: robotsSummary,
      results: finalResults,
    };
    await persistProgress(this.env, step, 'progress-complete', progress);

    // ⑤ Google Sheetsへの保存（実装順序5。§4.5「ドメイン×日付で蓄積」「問い合わせ添付用データ」）
    // 環境変数未設定（ローカル開発時など）の場合は保存をスキップする（診断自体は失敗させない）。
    if (this.env.GOOGLE_SHEETS_CLIENT_EMAIL && this.env.GOOGLE_SHEETS_PRIVATE_KEY && this.env.GOOGLE_SHEET_ID) {
      await step.do(
        'save-to-sheets',
        { retries: { limit: 2, delay: '5 seconds', backoff: 'exponential' } },
        async () => {
          const reachedCount = finalResults.filter((r) => r.verdict === '到達').length;
          const blockedCount = finalResults.filter((r) => r.verdict === 'ブロック').length;
          const undeterminedCount = finalResults.filter(
            (r) => r.verdict === '判定不能' || r.verdict === '中断_判定不能'
          ).length;
          const domain = (() => {
            try {
              return new URL(targetUrl).hostname;
            } catch {
              return targetUrl;
            }
          })();

          await appendDiagnosisRow(
            {
              clientEmail: this.env.GOOGLE_SHEETS_CLIENT_EMAIL!,
              privateKey: this.env.GOOGLE_SHEETS_PRIVATE_KEY!,
              spreadsheetId: this.env.GOOGLE_SHEET_ID!,
            },
            {
              diagnosisId,
              targetUrl,
              domain,
              timestampJst: new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }),
              existenceOk: true,
              reachedCount,
              blockedCount,
              undeterminedCount,
              robotsTxtFetched: robotsSummary.fetched,
              detailsJson: JSON.stringify({ existence, robots: robotsSummary, results: finalResults }),
            }
          );
        }
      );
    }

    return progress;
  }
}
