export interface Env {
  CHECK_WORKFLOW: Workflow<any>;
  CHECK_PROGRESS: KVNamespace;
  ASSETS: Fetcher;

  // Google Sheets保存用（wrangler secret putで設定。値はこのリポジトリに含めない）
  GOOGLE_SHEETS_CLIENT_EMAIL?: string;
  GOOGLE_SHEETS_PRIVATE_KEY?: string;
  GOOGLE_SHEET_ID?: string;
}
