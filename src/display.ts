/**
 * 画面表示用のデータ整形。指示書 §4.4 に対応。
 *
 * 重要な制約（指示書に明記）:
 *   - category は表示順の制御にのみ使い、画面には出さない（グループ見出し等も含め非表示）
 *   - 利用者に見せるのは「ボット名」と「届いている／届いていない」の2値のみ
 *   - ステータスコード・ヘッダー名・設定手順・辞書のcategoryは画面に一切出さない
 *
 * 「判定不能」の扱い: 指示書の画面仕様は2値（到達／未到達）のみを規定しており、
 * 「判定不能」を独立した第3の表示状態として扱う記述が無いため、ここでは
 * 「到達」以外（ブロック／判定不能／中断_判定不能）をすべて「届いていない」に畳み込む。
 */
import { BOT_DICTIONARY, type BotDictEntry } from './dictionary.generated';
import type { ProgressRecord } from './workflow';

export interface PublicBotResult {
  name: string;
  reached: boolean;
  robotsDisallowed: boolean;
}

export interface PublicDiagnosisView {
  status: ProgressRecord['status'];
  progress?: { done: number; total: number };
  message?: string;
  bots?: PublicBotResult[];
  hasAnyBlocked?: boolean;
  /** 問い合わせフォームへの導線に添える診断ID（§4.5の添付連携用）。機微情報ではないため公開可。 */
  diagnosisId?: string;
}

function displayPriority(entry: BotDictEntry): number {
  if (entry.category === 'learning') return 0;
  if (entry.ua === 'Googlebot') return 1;
  if (entry.category === 'search_rag' || entry.category === 'user_trigger') return 2;
  return 3; // その他（crawl, ads、Googlebot以外）
}

const DICTIONARY_ORDER_INDEX = new Map(BOT_DICTIONARY.map((e, i) => [e.ua, i]));
const DICTIONARY_BY_UA = new Map(BOT_DICTIONARY.map((e) => [e.ua, e]));

export function buildPublicView(progress: ProgressRecord): PublicDiagnosisView {
  if (progress.status === 'running') {
    return { status: 'running', progress: { done: progress.done, total: progress.total } };
  }

  if (progress.status === 'site_not_found') {
    return { status: 'site_not_found', message: 'URLが存在しない、またはサイトが応答しません' };
  }

  if (progress.status === 'error') {
    return { status: 'error', message: '診断中にエラーが発生しました' };
  }

  // complete
  const results = progress.results ?? [];
  const sorted = [...results].sort((a, b) => {
    const entryA = DICTIONARY_BY_UA.get(a.ua);
    const entryB = DICTIONARY_BY_UA.get(b.ua);
    const pA = entryA ? displayPriority(entryA) : 3;
    const pB = entryB ? displayPriority(entryB) : 3;
    if (pA !== pB) return pA - pB;
    const iA = DICTIONARY_ORDER_INDEX.get(a.ua) ?? 0;
    const iB = DICTIONARY_ORDER_INDEX.get(b.ua) ?? 0;
    return iA - iB;
  });

  const bots: PublicBotResult[] = sorted.map((r) => ({
    name: DICTIONARY_BY_UA.get(r.ua)?.name ?? r.ua,
    reached: r.verdict === '到達',
    robotsDisallowed: r.robotsDisallowed,
  }));

  return {
    status: 'complete',
    bots,
    hasAnyBlocked: bots.some((b) => !b.reached),
    diagnosisId: progress.diagnosisId,
  };
}
