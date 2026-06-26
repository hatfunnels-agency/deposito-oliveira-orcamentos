// Upload de conversao OFFLINE ("Venda Confirmada") para o Google Ads via
// DATA MANAGER API (events:ingest). Substitui o legado
// ConversionUploadService.uploadClickConversions do Google Ads API, que o
// Google bloqueou para integracoes novas em 2026 ("use the Data Manager API").
//
// Schema validado em produção (validateOnly) em 2026-06-26.
// Server-only: usa o refresh token OAuth (escopo .../auth/datamanager).
// Nunca importar de um componente 'use client'.

const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const DATA_MANAGER_INGEST_URL = "https://datamanager.googleapis.com/v1/events:ingest";

const DEVELOPER_TOKEN = process.env.GOOGLE_ADS_DEVELOPER_TOKEN || "";
const CLIENT_ID = process.env.GOOGLE_ADS_CLIENT_ID || "";
const CLIENT_SECRET = process.env.GOOGLE_ADS_CLIENT_SECRET || "";
const REFRESH_TOKEN = process.env.GOOGLE_ADS_REFRESH_TOKEN || "";
const LOGIN_CUSTOMER_ID = (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || "").replace(/\D/g, ""); // MCC
const CUSTOMER_ID = (process.env.GOOGLE_ADS_CUSTOMER_ID || "").replace(/\D/g, ""); // conta do Deposito
// "Venda Confirmada (Offline)" — id da conversion action na conta 8874192074.
const CONVERSION_ACTION_ID = process.env.GOOGLE_ADS_CONVERSION_ACTION_ID || "7650060478";

export function googleAdsConfigurado(): boolean {
  return Boolean(CLIENT_ID && CLIENT_SECRET && REFRESH_TOKEN && LOGIN_CUSTOMER_ID && CUSTOMER_ID);
}

async function getAccessToken(): Promise<string> {
  const resp = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
    cache: "no-store",
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`OAuth token falhou (${resp.status}): ${t}`);
  }
  const data = await resp.json();
  return data.access_token as string;
}

// Carimbo "agora" no fuso de Sao Paulo (UTC-3, sem horario de verao desde
// 2019), no formato RFC 3339 exigido pela Data Manager API:
// "yyyy-mm-ddThh:mm:ss-03:00".
export function agoraSaoPaulo(): string {
  const now = new Date(Date.now() - 3 * 3600 * 1000); // desloca pra wall-clock BR
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${now.getUTCFullYear()}-${p(now.getUTCMonth() + 1)}-${p(now.getUTCDate())}T` +
    `${p(now.getUTCHours())}:${p(now.getUTCMinutes())}:${p(now.getUTCSeconds())}-03:00`
  );
}

export type OfflineConversionInput = {
  gclid: string;
  value: number;
  orderId?: string; // vira transactionId (dedupe da venda no Google)
  conversionDateTime?: string; // RFC 3339; default: agora (Sao Paulo)
  validateOnly?: boolean; // true = só valida, não grava (para testes)
};

export async function uploadConversaoOffline(
  input: OfflineConversionInput,
): Promise<{ ok: boolean; detail?: string }> {
  if (!googleAdsConfigurado()) return { ok: false, detail: "google ads nao configurado" };

  const token = await getAccessToken();

  const event: Record<string, unknown> = {
    destinationReferences: ["dest1"],
    eventSource: "WEB",
    eventTimestamp: input.conversionDateTime || agoraSaoPaulo(),
    currency: "BRL",
    conversionValue: input.value,
    adIdentifiers: { gclid: input.gclid },
  };
  if (input.orderId) event.transactionId = input.orderId;

  const payload = {
    destinations: [
      {
        reference: "dest1",
        loginAccount: { accountType: "GOOGLE_ADS", accountId: LOGIN_CUSTOMER_ID },
        operatingAccount: { accountType: "GOOGLE_ADS", accountId: CUSTOMER_ID },
        productDestinationId: CONVERSION_ACTION_ID,
      },
    ],
    events: [event],
    validateOnly: input.validateOnly ?? false,
  };

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  // O developer-token + login-customer-id foram aceitos no teste de validação.
  if (DEVELOPER_TOKEN) {
    headers["developer-token"] = DEVELOPER_TOKEN;
    headers["login-customer-id"] = LOGIN_CUSTOMER_ID;
  }

  const resp = await fetch(DATA_MANAGER_INGEST_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  const data = await resp.json().catch(() => null);
  if (!resp.ok) return { ok: false, detail: `HTTP ${resp.status}: ${JSON.stringify(data)}` };
  return { ok: true };
}
