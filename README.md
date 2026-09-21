# check-edgeshaping (check.edgeshap.ing)

開発指示書: `check-edgeshaping-開発指示書.md`（2026-09-20付、使い捨て。恒久的な仕様はEdgeShaping仕様書側へ）

## 現在の進捗（実装順序 1〜4 完了、ここで一度停止）

- [x] 1. 辞書の吐き出し（`scripts/build-dictionary.mjs` → `src/dictionary.generated.ts`）
- [x] 2. 存在確認＋本診断のプローブ処理（`src/workflow.ts`, `src/probe.ts`, `src/ssrf.ts`）
- [x] 3. robots.txt 解析（`src/robots.ts`）
- [x] 4. 結果表示（画面）（`public/index.html`, `src/display.ts`, `GET /api/diagnose/:id/public`）
- [x] 5. 保存（Google Sheets）と問い合わせフォーム連携

指示書の実装順序（1〜5）はすべて完了しています。

## アーキテクチャ（雛形からの変更点）

当初の想定（k-uchiumi/Vercel と同じ Next.js 15 + next-on-pages + Cloudflare Pages）から、
以下の理由で変更しました（2026-09-21 確認・決定）：

- `@cloudflare/next-on-pages` は Cloudflare 公式が2026年時点でアーカイブ済み・新規プロジェクトへの
  採用を推奨していない
- Cloudflare は新規Next.jsプロジェクトについて Pages ではなく Workers（OpenNextアダプタ経由）を推奨
- 本ツールの核心要件（69〜70リクエストを1秒間隔・直列・非同期実行し、診断IDで進捗を返す）は
  Cloudflare Workflows（`step.sleep` による間隔制御、`step.do` によるステップの永続化・リトライ）
  とネイティブに相性が良く、Workers側でのサポートが明確

### 採用した構成

- **画面**: Cloudflare Workers の静的アセット機能（素のHTML。Next.js不使用）
- **診断ジョブ**: Cloudflare Workflows（`src/workflow.ts` の `CheckWorkflow`）
- **進捗取得**: Workers KV（`CHECK_PROGRESS`）に診断IDをキーとして進捗・結果を書き込み、
  `GET /api/diagnose/:id` がそれを読んで返す
  - 検討: Workflows に2026-09-15追加されたばかりの `instance.subscribe()`
    （ステップイベントのストリーミングAPI）も選択肢だったが、公開から日が浅くドキュメントも薄いため、
    今回は実績のあるKVポーリング方式を採用。要望があれば `subscribe()` 方式への切り替えも可能
- **保存（最終結果の永続化）**: Google Sheets（check.mareinterno.com と同方式）— 実装順序5で対応
- **移植元**: k-uchiumi/Vercel の `src/app/api/check/route.ts` から `ssrfSafeFetch` と
  存在確認用のブラウザヘッダー一式のみを移植（`src/ssrf.ts`, `src/headers.ts`）。
  移植元リポジトリ（本番）は書き換えていない
  - 移植時の変更点: 元実装は毎リクエストDNS over HTTPSで検証していたが、本ツールは同一URLに
    69〜70リクエスト送るため、ホスト名ごとに検証結果をキャッシュする方式に変更
    （`createHostValidator()`、診断開始時に対象ホストを1回だけ検証。リダイレクトで
    別ホストに飛んだ場合のみ再検証）

## 辞書について（実装順序1の詳細）

マスター: `../クラウドフレア版/ai-bot-tracker/ai-bots-dictionary.js`（2026.09更新版）

- マスターの `AI_BOTS` は69件。うち `'Google'`（フォールバック観測用、`description: ''`）は
  category未確定のため除外し、68件を抽出（指示書A1の想定件数と一致）
- `CATEGORY_KEYS`（マスターに既存）で日本語description→英語category（5分類）に変換
- マスターの本来の置き場所は未確定（EdgeShaping側 current-state.md 「CDN版をリポジトリに
  取り込むかの検討」が保留中）。確定したら `scripts/build-dictionary.mjs` の
  `DEFAULT_MASTER_PATH` を更新すること

再生成: `npm run build:dictionary`（または `node scripts/build-dictionary.mjs [マスターへのパス]`）

## robots.txt解析について（実装順序3の詳細）

`src/robots.ts`。RFC 9309（Robots Exclusion Protocol）の一般的解釈で実装：

- グループ選択: ボットのUser-agentトークン（辞書のUA文字列と同一のキーを使用。例: `GPTBot`）に
  完全一致するグループを優先。無ければ `*` グループ。どちらも無ければ「robots.txt上の制限なし」
- グループ内では、診断対象パスに一致する最長のAllow/Disallowパターンを採用（同点はAllow優先。
  Googleの実装に準拠）。`*`ワイルドカードと`$`行末アンカーに対応
- 取得は存在確認と同じブラウザUAを使用（指示書に個別UA指定が無いため。robots.txt自体は
  ボット向けUAでの出し分けが一般的ではないという前提での判断）
- 取得失敗（4xx/5xx/タイムアウト等）は「制限なし」として扱う（診断表示用の情報であり、
  実クロール時のような保守的解釈=5xxは全面拒否、は採用していない）
- パーサーの単体テスト（グループ分割・ワイルドカード・末尾アンカー・複数UA共有グループ）は
  手元で実行し、想定どおりの結果を確認済み（このリポジトリには未同梱。必要なら追加可能）

結果は各ボットの`FinalBotResult.robotsDisallowed`に格納し、エッジでのブロック結果
（`verdict`）とは別フィールドとして持つ（§4.4「エッジでのブロックとは区別して表示」に対応）。

## 受け入れ条件の自動検証（`scripts/verify-acceptance.mjs`）

`GET /api/diagnose/:id` の完了後レスポンスJSONを渡すと、A1〜A4, A6, A7を自動判定します
（EdgeShaping既存の「受け入れ条件はビルド時grep／数値検証に紐づける」方針を踏襲）。

```bash
curl -s http://localhost:8787/api/diagnose/<診断ID> | npm run verify --silent
```

限界: リダイレクト追従・429/503リトライで発生する実際のHTTPリクエスト数まではJSON上から
完全には追えません（詳細はスクリプト冒頭コメント）。

## 要確認・要検証事項（報告のみ、実装は未反映または暫定）

1. **KV Namespaceは未作成**: `wrangler.jsonc` の `id` が `REPLACE_ME_AFTER_KV_NAMESPACE_CREATE`
   のまま。下記セットアップ手順で作成・反映すること
2. **Cloudflare Workersプラン**: 1診断あたり最大69〜70件の外部fetch（サブリクエスト）が発生する。
   Free プランは1invocationあたり外部サブリクエスト50件までのため、Workflowの各ステップ
   （step.do単位）が別invocationとして数えられる設計にしているので理論上は問題にならない想定だが、
   実運用前に実際のプラン・挙動を確認すること
3. **git identity未設定**: このマシンにはgitのuser.name/user.emailがglobalに設定されていないため、
   コミットは未実施。コミット前に `git config user.name` / `user.email` を設定すること（下記参照）
4. **`wrangler dev`のローカル動作確認は未実施**（実行はご本人側でお願いします。手順は下記）。
   なお動作確認の過程で、Claude側の作業環境（デバイス連携フォルダ経由のマウント）で
   `wrangler dev` を起動したところ `SQLite ... disk I/O error` で起動失敗しました。
   これはWorkflows/KVのローカルエミュレーションが使うSQLiteファイルが、ネットワーク越し
   マウントのファイルロックに対応できないための環境固有の問題とみられ、ご本人のMac上で
   直接（Finder上のパスで）実行する分には発生しない可能性が高いです。万一同じエラーが出た場合は
   `rm -rf .wrangler` してから再実行するか、`WRANGLER_STATE_PATH` を明示的にローカルディスク上の
   パスに向けてみてください

## セットアップ・動作確認手順

```bash
cd ~/Desktop/Claude/check-edgeshaping   # 実際のパスに合わせてください
npm install
npm run build:dictionary
npm run typecheck                       # 確認済み: エラーなし

# gitコミットする場合（このマシンにglobal設定が無いため初回のみ）
git config user.name "内海賢一"          # お好みの表記に
git config user.email "mareinterno.uchiumi@gmail.com"

# KV Namespaceを作成し、出力されたidをwrangler.jsoncの2箇所（本番用・--preview用）に反映
wrangler kv namespace create check-edgeshaping-progress
wrangler kv namespace create check-edgeshaping-progress --preview

npm run dev   # http://localhost:8787 でローカル起動
```

別ターミナルで動作確認（A1〜A4, A6, A7）:

```bash
# 診断開始（実在するURLで試してください）
curl -s -X POST http://localhost:8787/api/diagnose \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com"}'
# => {"diagnosisId":"..."}

# 進捗確認（68件×1秒間隔+robots.txtで概ね70秒かかります。数回ポーリングしてください）
curl -s http://localhost:8787/api/diagnose/<上で得たID>

# status:"complete" になったら、その結果JSONをそのままverifyスクリプトへ
curl -s http://localhost:8787/api/diagnose/<診断ID> | npm run verify --silent
```

A6（存在しないURLで本診断に入らないこと）の確認:

```bash
curl -s -X POST http://localhost:8787/api/diagnose \
  -H "Content-Type: application/json" \
  -d '{"url":"https://this-domain-should-not-exist-xyz123.example"}'
# 数秒後に status:"site_not_found" になり、results が空であることを確認
```

A7（429/503時のバックオフ）の確認: 429を返すテスト用エンドポイント
（例: `https://httpstat.us/429`）を対象URLにして同様に実行し、該当ボットの
`retryCount` と `verdict`（3回再試行後も429なら`中断_判定不能`）を確認してください。


## 結果表示について（実装順序4の詳細）

### データの流れとA5対応

`GET /api/diagnose/:id`（内部用・httpStatus等を含む詳細データ、実装順序5で問い合わせ添付用に使用予定）
とは別に、`GET /api/diagnose/:id/public`（`src/display.ts` の `buildPublicView()`）を新設。
**画面（`public/index.html`）はpublicエンドポイントしか呼ばない。** publicエンドポイントが返すのは
ボット名・到達/未到達（2値）・robots.txt拒否の有無・進捗件数のみで、ステータスコード・
ヘッダー名・辞書のcategoryは一切含まない。

検証: `public/index.html`（静的ファイル）に対する `grep -niE "cf-|403|WAF|learning|search_rag|user_trigger"`
は0件を確認済み。publicエンドポイントの出力サンプルもcategory等を含まないことを確認済み
（ただし実機での `wrangler dev` 経由の動作確認はご本人側で実施予定）。

### 表示順・グルーピングについて（確定 2026-09-21）

指示書§4.4「categoryは表示順の制御にだけ使い、画面には出さない」を厳密解釈し、
**画面上に「学習」「その他」等のセクション見出しは一切出さない**（category由来の情報を
見出しとして見せることも「画面に出す」に該当すると判断）。この解釈で確定。
学習→Googlebot→検索・エージェント→その他の順に**フラットな1本のリストとして**並べているだけで、
利用者から見て区切りは分からない。

### 「判定不能」の扱い（確定 2026-09-21）

指示書の画面仕様は「届いている／届いていない」の2値のみを規定しており、「判定不能」を
独立した第3の表示状態とする記述が無かったため、`verdict==='到達'` 以外
（ブロック／判定不能／中断_判定不能）をすべて「届いていない」に畳み込んで表示することで確定
（`src/display.ts` 内にコメントで明記）。

### IP偽装（スプーフィング）判定について

含まれていない。指示書§3「やらないこと」に明記の「IPベースの許可・拒否の検出」に該当するため、
意図的に未実装。本ツールはCloudflare Workersから偽装UAでアクティブにプローブする設計上、
送信元IPは常にCloudflareのIPであり、OpenAI/Anthropic等の公式IPレンジとは一致しない
（そもそも一致させようがない）。マスター辞書の`ipRange`フィールド（各社公式IPレンジの
参照URL）は、EdgeShaping本体（受信ログを解析してボット詐称を検知する側）で使うものであり、
本ツール（送信側）では使用していない。

### 問い合わせ導線（CTA）

1件でも「届いていない」があれば `#cta` ブロックを表示する実装は完了。ただしリンク先
（`#ctaLink` の `href`）は実装順序5（問い合わせフォーム連携）まで仮のプレースホルダー
（`href="#"`）。実際の問い合わせフォームのURLが分かり次第、差し替える。


## 保存（Google Sheets）と問い合わせフォーム連携について（実装順序5の詳細）

### Google Sheets保存

`src/sheets.ts`。check.mareinterno.com（k-uchiumi/Vercel）と同方式（サービスアカウントの
秘密鍵でJWTを自前署名しGoogle OAuth2トークンを取得→Sheets APIへAPPEND。Web Crypto + fetchのみで
外部ライブラリ不使用）。移植元は書き換えていない。

診断完了ごとに `diagnoses` タブへ1行追記：タイムスタンプ(JST) / ドメイン / URL / 診断ID /
存在確認結果 / 到達件数 / ブロック件数 / 判定不能件数 / robots.txt取得可否 / 詳細JSON
（全68件の応答コード・応答ヘッダー・遮断元推定・robots.txt判定を含む。§4.5「裏に持つデータ」
「問い合わせフォーム送信時に添付」用）。

セットアップ:
1. Google Cloudでサービスアカウントを作成し、JSONキーを発行
2. 保存先スプレッドシートを作成し、`diagnoses` という名前のタブ（シート）を用意
3. スプレッドシートをサービスアカウントのメールアドレスに「編集者」権限で共有
4. 以下を `wrangler secret put` で設定（値はこのリポジトリ・wrangler.jsoncには含めない）:
   ```bash
   wrangler secret put GOOGLE_SHEETS_CLIENT_EMAIL
   wrangler secret put GOOGLE_SHEETS_PRIVATE_KEY   # PEM形式。改行はそのまま貼り付けでOK
   wrangler secret put GOOGLE_SHEET_ID              # スプレッドシートのID（URLの/d/と/editの間）
   ```
5. ローカル開発（`wrangler dev`）時は `.dev.vars` に同名の変数を書くか、上記3つが未設定のまま
   実行するとSheets保存はスキップされる（診断自体は失敗しない設計。`src/workflow.ts` 参照）

### 実行制限（§4.6 同一セッション1回）

Cookie（`ces_sid`、HttpOnly・Secure・SameSite=Lax・有効期限400日）でセッションを識別し、
Workers KV（`session-used:<sessionId>`）に使用済みフラグを立てる方式で実装（`src/index.ts`）。
2回目以降のPOSTは理由を説明せず「診断は1回のみです」で拒否する（指示書の指定文言どおり）。

### 問い合わせフォーム連携

指定いただいたURL: `https://mareinterno.com/inquiry/`

このフォームの実際のHTML（fieldのname属性・action URL・送信方式）は、Claude側のネットワーク
制限（プロキシで対象ドメインへの直接アクセスがブロックされる）により確認できませんでした。
WebFetch経由でページ内容の概要は取得でき、フォームには「性・名・会社名・メールアドレス・
問い合わせ内容（プルダウン）・補足」の項目があり、プルダウンには**「AIbotの可視化をしたい」
という、本ツールの用途にそのまま合致する選択肢が既に存在する**ことを確認しました。

未知のフォーム実装に対してフィールド名を推測してURLパラメータでの自動プリフィルを試みるのは
不確実なため、今回は確実に動作する形として、CTAリンクに診断IDをクエリパラメータで付与するだけに
留めています（`https://mareinterno.com/inquiry/?diag=<診断ID>`）。問い合わせが来た際は、
このIDでSheetsの該当行を検索すれば診断詳細を参照できます。

もしこのフォームの「補足」欄や「問い合わせ内容」プルダウンをURLパラメータで自動入力できる
（プラグインの仕様として対応している）ようであれば、そのフィールドのname属性を教えていただければ
自動プリフィルへ拡張できます。
