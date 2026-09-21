#!/usr/bin/env node
/**
 * build-dictionary.mjs
 *
 * CDN版マスター辞書（ai-bots-dictionary.js / AI_BOTS + CATEGORY_KEYS）から、
 * check.edgeshap.ing 用の軽量辞書（UA文字列・ボット名・category の3項目のみ）を
 * 生成する。指示書 §4.1 の工程。
 *
 * 除外ルール：
 *   description が空文字（''）のエントリは category が未確定のため除外する。
 *   2026-09時点のマスターでは 'Google'（フォールバック観測用エントリ）のみが該当し、
 *   69件 - 1件 = 68件 が指示書A1の想定件数と一致する。
 *
 * 使い方:
 *   node scripts/build-dictionary.mjs [マスターファイルへのパス]
 *   省略時は既定パス（下記 DEFAULT_MASTER_PATH）を使う。
 *
 * 出力: src/dictionary.generated.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// TODO: CDN版マスターの本来の置き場所が未確定（current-state.md 参照:
// 「CDN版（Workers/Lambda）をリポジトリに取り込むかの検討」が保留中）。
// 確定後はこのデフォルトパスを更新すること。
const DEFAULT_MASTER_PATH = resolve(
  __dirname,
  '../../クラウドフレア版/ai-bot-tracker/ai-bots-dictionary.js'
);

const masterPath = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_MASTER_PATH;

const src = readFileSync(masterPath, 'utf8');

// AI_BOTS オブジェクトの中身を取り出す（'export const AI_BOTS = { ... };' の { ... }）
const aiBotsMatch = src.match(/export const AI_BOTS = \{([\s\S]*?)\n\};/);
if (!aiBotsMatch) {
  throw new Error('AI_BOTS の定義が見つかりません: ' + masterPath);
}
const aiBotsBody = aiBotsMatch[1];

// CATEGORY_KEYS オブジェクトの中身を取り出す
const categoryMatch = src.match(/export const CATEGORY_KEYS = \{([\s\S]*?)\n\};/);
if (!categoryMatch) {
  throw new Error('CATEGORY_KEYS の定義が見つかりません: ' + masterPath);
}
const categoryBody = categoryMatch[1];

const categoryKeys = {};
for (const m of categoryBody.matchAll(/'([^']+)':\s*'([^']+)'/g)) {
  categoryKeys[m[1]] = m[2];
}

// エントリ行: 'KEY': { company: '...', name: '...', description: '...'(, ipRange: '...')? },
// コメントアウトされた行（行頭が // または /* ... */ の中）は対象外。
const entryRegex = /^\s*'([^']+)':\s*\{[^}]*?\bname:\s*'((?:[^'\\]|\\.)*)'[^}]*?\bdescription:\s*'((?:[^'\\]|\\.)*)'[^}]*?\},?\s*$/gm;

const entries = [];
const skippedEmpty = [];
for (const m of aiBotsBody.matchAll(entryRegex)) {
  const [, ua, name, description] = m;
  if (description === '') {
    skippedEmpty.push(ua);
    continue;
  }
  const category = categoryKeys[description];
  if (!category) {
    throw new Error(`category未対応のdescriptionです: '${description}' (UA: ${ua})`);
  }
  entries.push({ ua, name, category });
}

console.log(`抽出件数: ${entries.length}件（description空欄により除外: ${skippedEmpty.length}件 = [${skippedEmpty.join(', ')}]）`);

if (entries.length !== 68) {
  console.warn(`警告: 抽出件数が指示書想定の68件と一致しません（実際: ${entries.length}件）。マスターの内容を確認してください。`);
}

const outPath = resolve(__dirname, '../src/dictionary.generated.ts');
const header = `/**
 * このファイルは自動生成です。手で編集しないこと。
 * 生成元: ${masterPath}
 * 生成コマンド: node scripts/build-dictionary.mjs
 * 生成日時: ${new Date().toISOString()}
 */

export type BotCategory = 'learning' | 'crawl' | 'search_rag' | 'user_trigger' | 'ads';

export interface BotDictEntry {
  /** UA文字列。プローブ送信時にHTTPヘッダーへそのまま設定する（1バイトも変えない）。 */
  ua: string;
  /** ボット名（表示用・内部用） */
  name: string;
  /** 用途分類。表示順の制御にのみ使用し、画面には出さない（指示書§4.4）。 */
  category: BotCategory;
}

export const BOT_DICTIONARY: BotDictEntry[] = ${JSON.stringify(entries, null, 2)};
`;

writeFileSync(outPath, header, 'utf8');
console.log(`書き出し完了: ${outPath}`);
