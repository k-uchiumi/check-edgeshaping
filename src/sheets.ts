/**
 * Google Sheetsへの保存。k-uchiumi/Vercel の src/app/api/check/route.ts から
 * getGoogleAccessToken / appendSpreadsheetValues のロジックを移植（Web Crypto + fetch による
 * サービスアカウントJWT認証。check.mareinterno.com と同方式）。移植元は書き換えていない。
 *
 * 必要な環境変数（wrangler secret putで設定。値そのものはこのリポジトリに含めない）:
 *   GOOGLE_SHEETS_CLIENT_EMAIL: サービスアカウントのメールアドレス
 *   GOOGLE_SHEETS_PRIVATE_KEY : サービスアカウントの秘密鍵（PEM形式）
 *   GOOGLE_SHEET_ID           : 保存先スプレッドシートのID
 *
 * 保存先シート（タブ）名は SHEET_TAB_NAME 定数を参照。事前にスプレッドシート側で
 * 同名のタブを作成しておくこと。
 */

export const SHEET_TAB_NAME = 'diagnoses';

async function getGoogleAccessToken(clientEmail: string, privateKey: string, scope: string): Promise<string> {
  const pemHeader = '-----BEGIN PRIVATE KEY-----';
  const pemFooter = '-----END PRIVATE KEY-----';

  let pemContents = privateKey.trim();
  if (pemContents.startsWith(pemHeader)) {
    pemContents = pemContents.substring(pemHeader.length);
  }
  if (pemContents.endsWith(pemFooter)) {
    pemContents = pemContents.substring(0, pemContents.length - pemFooter.length);
  }
  pemContents = pemContents.replace(/\s+/g, '');

  const binaryDerString = atob(pemContents);
  const binaryDer = new Uint8Array(binaryDerString.length);
  for (let i = 0; i < binaryDerString.length; i++) {
    binaryDer[i] = binaryDerString.charCodeAt(i);
  }

  const importedKey = await crypto.subtle.importKey(
    'pkcs8',
    binaryDer.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: { name: 'SHA-256' } },
    false,
    ['sign']
  );

  const header = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: clientEmail,
    scope,
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };

  const base64url = (source: string | ArrayBuffer): string => {
    let binary = '';
    if (typeof source === 'string') {
      binary = btoa(unescape(encodeURIComponent(source)));
    } else {
      const bytes = new Uint8Array(source);
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      binary = btoa(binary);
    }
    return binary.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  };

  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(payload));
  const tokenInput = `${encodedHeader}.${encodedPayload}`;

  const encoder = new TextEncoder();
  const data = encoder.encode(tokenInput);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', importedKey, data);
  const encodedSignature = base64url(signature);
  const jwt = `${tokenInput}.${encodedSignature}`;

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Failed to get OAuth token: ${response.status} ${errText}`);
  }

  const tokenData = (await response.json()) as { access_token: string };
  return tokenData.access_token;
}

async function appendSpreadsheetValues(
  accessToken: string,
  spreadsheetId: string,
  range: string,
  values: unknown[][]
) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
    range
  )}:append?valueInputOption=USER_ENTERED`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ values }),
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Google Sheets APPEND error: ${response.status} ${err}`);
  }
  return await response.json();
}

export interface SheetsCredentials {
  clientEmail: string;
  privateKey: string;
  spreadsheetId: string;
}

export interface DiagnosisSheetRow {
  diagnosisId: string;
  targetUrl: string;
  domain: string;
  timestampJst: string;
  existenceOk: boolean;
  reachedCount: number;
  blockedCount: number;
  undeterminedCount: number;
  robotsTxtFetched: boolean;
  detailsJson: string; // 全件の応答コード・ヘッダー・遮断元推定を含むJSON（§4.5）
}

export async function appendDiagnosisRow(creds: SheetsCredentials, row: DiagnosisSheetRow): Promise<void> {
  const accessToken = await getGoogleAccessToken(
    creds.clientEmail,
    creds.privateKey,
    'https://www.googleapis.com/auth/spreadsheets'
  );
  await appendSpreadsheetValues(accessToken, creds.spreadsheetId, `${SHEET_TAB_NAME}!A1`, [
    [
      row.timestampJst,
      row.domain,
      row.targetUrl,
      row.diagnosisId,
      row.existenceOk,
      row.reachedCount,
      row.blockedCount,
      row.undeterminedCount,
      row.robotsTxtFetched,
      row.detailsJson,
    ],
  ]);
}
