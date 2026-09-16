import { BakongKHQR, IndividualInfo, khqrData, type KhqrOptionalData } from "bakong-khqr";
import type { Currency, KhqrStatus } from "@mart-system/shared-types";
import { prisma } from "../../prisma";
import { badRequest, HttpError } from "../../lib/httpError";

const BAKONG_RENEW_TOKEN_URL = "https://api-bakong.nbc.gov.kh/v1/renew_token";
const BAKONG_CHECK_STATUS_URL = "https://api-bakong.nbc.gov.kh/v1/check_transaction_by_md5";

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Bakong expects a bare "855..." mobile number — swap a leading 0 for the country code.
function toBakongMobile(phone: string | undefined): string | undefined {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (!digits) return undefined;
  return digits.startsWith("0") ? `855${digits.slice(1)}` : digits;
}

async function getStoreSettingsMap(storeId: string): Promise<Record<string, string>> {
  const rows = await prisma.storeSetting.findMany({ where: { storeId } });
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

export async function getBakongCredentialView(storeId: string) {
  const credential = await prisma.bakongCredential.findUnique({ where: { storeId } });
  return { registeredEmail: credential?.registeredEmail ?? null, hasToken: Boolean(credential?.apiToken) };
}

export async function setBakongRegisteredEmail(storeId: string, registeredEmail: string) {
  await prisma.bakongCredential.upsert({
    where: { storeId },
    create: { storeId, registeredEmail },
    update: { registeredEmail },
  });
  return getBakongCredentialView(storeId);
}

export async function generateKhqr(
  storeId: string,
  input: { amount: number; currency: Currency }
): Promise<{ qrString: string; md5Hash: string; amount: number; currency: Currency }> {
  const currency: Currency = input.currency === "KHR" ? "KHR" : "USD";
  const amount = currency === "KHR" ? Math.round(input.amount) : Math.round(input.amount * 100) / 100;

  const cfg = await getStoreSettingsMap(storeId);

  const optionalData: KhqrOptionalData = {
    currency: currency === "KHR" ? khqrData.currency.khr : khqrData.currency.usd,
    amount,
    expirationTimestamp: Date.now() + 5 * 60 * 1000,
  };
  const mobileNumber = toBakongMobile(cfg.store_phone);
  if (mobileNumber) optionalData.mobileNumber = mobileNumber;

  const individualInfo = new IndividualInfo(
    cfg.bakong_account_id ?? "",
    cfg.bakong_merchant_name ?? "Mini Mart",
    cfg.bakong_merchant_city ?? "Phnom Penh",
    optionalData
  );

  const khqrEngine = new BakongKHQR();
  const result = khqrEngine.generateIndividual(individualInfo);
  if (!result?.data || result.status?.code !== 0) {
    throw new HttpError(500, result?.status?.message ?? "Bakong SDK rejected the request");
  }

  return { qrString: result.data.qr, md5Hash: result.data.md5, amount, currency };
}

async function renewBakongToken(storeId: string): Promise<string> {
  const credential = await prisma.bakongCredential.findUnique({ where: { storeId } });
  const email = credential?.registeredEmail;
  if (!email) throw badRequest("This store has no Bakong registered email configured yet");

  const response = await fetchWithTimeout(
    BAKONG_RENEW_TOKEN_URL,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) },
    8000
  );
  const body = (await response.json().catch(() => null)) as { data?: { token?: string }; token?: string } | null;
  const token = body?.data?.token ?? body?.token;
  if (!response.ok || !token) throw new HttpError(502, "Bakong did not return a token");

  await prisma.bakongCredential.upsert({
    where: { storeId },
    create: { storeId, registeredEmail: email, apiToken: token, apiTokenUpdatedAt: new Date() },
    update: { apiToken: token, apiTokenUpdatedAt: new Date() },
  });

  return token;
}

function callBakongCheckStatus(token: string, md5Hash: string): Promise<Response> {
  return fetchWithTimeout(
    BAKONG_CHECK_STATUS_URL,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ md5: md5Hash }),
    },
    4000
  );
}

export async function checkKhqrStatus(storeId: string, md5Hash: string): Promise<KhqrStatus> {
  const credential = await prisma.bakongCredential.findUnique({ where: { storeId } });
  let token = credential?.apiToken ?? undefined;
  if (!token) token = await renewBakongToken(storeId);

  let response = await callBakongCheckStatus(token, md5Hash);
  if (response.status === 401) {
    // Cached token expired — renew once and retry, matching the old app's behavior.
    token = await renewBakongToken(storeId);
    response = await callBakongCheckStatus(token, md5Hash);
  }

  if (!response.ok) throw new HttpError(502, "Failed to reach Bakong");

  const body = (await response.json().catch(() => null)) as { responseCode?: number } | null;
  return body?.responseCode === 0 ? "PAID" : "PENDING";
}
