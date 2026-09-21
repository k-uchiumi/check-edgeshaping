#!/usr/bin/env node
/**
 * verify-acceptance.mjs
 *
 * GET /api/diagnose/:id の最終レスポンス（status:"complete" または "site_not_found"）のJSONを
 * 受け取り、開発指示書 §5 の受け入れ条件 A1〜A4, A6, A7 を機械的にチェックする。
 * 「コードを読まずに判定できる形にする」（指示書§5冒頭）ための検証スクリプト。
 *
 * 使い方:
 *   curl -s http://localhost:8787/api/diagnose/<id> | node scripts/verify-acceptance.mjs
 *   node scripts/verify-acceptance.mjs path/to/result.json
 *
 * 注意（限界）:
 *   - A1は「results配列68件＋existenceCheck＋robotsTxt」の3点セットの有無で判定する。
 *     リダイレクト追従やA7の429/503リトライで発生する実際のHTTPリクエスト数までは
 *     このJSONだけでは追えない（sendProbeが内部で吸収しているため）。
 *   - A7はretryCountとverdictの整合性のみを見る。Retry-Afterヘッダーへの追従自体は
 *     ソースコード（src/probe.ts）で実装済みだが、このスクリプトでは再現しない。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

function readStdin() {
  return new Promise((res) => {
    let data = '';
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => res(data));
  });
}

function loadDictionaryUAs() {
  const src = readFileSync(resolve(__dirname, '../src/dictionary.generated.ts'), 'utf8');
  const uas = [...src.matchAll(/"ua":\s*"([^"]+)"/g)].map((m) => m[1]);
  return uas;
}

const results = [];
function check(id, pass, detail) {
  results.push({ id, pass, detail });
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${id}: ${detail}`);
}

async function main() {
  const argPath = process.argv[2];
  const raw = argPath ? readFileSync(argPath, 'utf8') : await readStdin();
  const data = JSON.parse(raw);

  if (data.status === 'site_not_found') {
    // A6: 存在確認が2xx以外のとき、本診断のリクエストが1件も発生しない
    const noProbes = !data.results || data.results.length === 0;
    check('A6', noProbes, `存在確認失敗時のprobe件数=${data.results?.length ?? 0}（0件が正）`);
    console.log('(この実行はsite_not_foundのため、A1〜A4・A7は対象外)');
    return;
  }

  if (data.status !== 'complete') {
    console.log(`status="${data.status}" — 完了前のレスポンスです。診断完了後に再実行してください。`);
    return;
  }

  const bots = data.results || [];
  const dictUAs = loadDictionaryUAs();

  // A1: 辞書68件ぶんのprobe結果 + 存在確認 + robots.txt の3点セットが揃っているか
  const a1 = bots.length === 68 && !!data.existenceCheck && !!data.robotsTxt;
  check('A1', a1, `probe結果=${bots.length}件 / existenceCheck=${!!data.existenceCheck} / robotsTxt=${!!data.robotsTxt}`);

  // A2: 連続するリクエストの送信間隔の最小値が1000ms以上
  let minInterval = Infinity;
  for (let i = 1; i < bots.length; i++) {
    const diff = new Date(bots[i].sentAt).getTime() - new Date(bots[i - 1].sentAt).getTime();
    if (diff < minInterval) minInterval = diff;
  }
  check('A2', bots.length < 2 || minInterval >= 1000, `最小間隔=${minInterval}ms`);

  // A3: 同時実行数が常に1（前のリクエストが終わってから次が始まっている）
  let overlapFound = false;
  for (let i = 1; i < bots.length; i++) {
    if (new Date(bots[i].sentAt).getTime() < new Date(bots[i - 1].finishedAt).getTime()) {
      overlapFound = true;
      break;
    }
  }
  check('A3', !overlapFound, overlapFound ? '重なりあり' : '重なりなし');

  // A4: 送信したUA文字列68件が辞書ファイルの値と完全一致
  const sentUAs = bots.map((b) => b.ua);
  const sentSet = new Set(sentUAs);
  const dictSet = new Set(dictUAs);
  const missing = dictUAs.filter((u) => !sentSet.has(u));
  const extra = sentUAs.filter((u) => !dictSet.has(u));
  const dupes = sentUAs.length !== sentSet.size;
  check(
    'A4',
    missing.length === 0 && extra.length === 0 && !dupes,
    `不足=${missing.length}件 / 余分=${extra.length}件 / 重複=${dupes}`
  );

  // A7: 429/503を受けたケースで、retryCountとverdictが整合しているか
  const rateLimited = bots.filter((b) => b.retryCount > 0);
  const inconsistent = rateLimited.filter((b) => b.retryCount >= 3 && b.verdict !== '中断_判定不能');
  check(
    'A7',
    inconsistent.length === 0,
    rateLimited.length === 0
      ? '今回の実行では429/503は発生しなかった（该当なし）'
      : `429/503発生${rateLimited.length}件中、不整合${inconsistent.length}件`
  );

  console.log('');
  console.log('A5（画面出力にステータスコード等を含まないか）はUIが無いため対象外（実装順序4で確認）');
}

main().catch((e) => {
  console.error('検証スクリプトエラー:', e);
  process.exit(1);
});
