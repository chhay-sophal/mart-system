import { BakongKHQR, IndividualInfo, khqrData, type KhqrOptionalData } from "bakong-khqr";
import type { Currency, KhqrStatus } from "@mart-system/shared-types";
import { prisma } from "../../prisma";
import { badRequest, conflict, HttpError, notFound } from "../../lib/httpError";
import { toMinorUnits } from "../../lib/money";
import { logger } from "../../lib/logger";

const BAKONG_RENEW_TOKEN_URL = "https://api-bakong.nbc.gov.kh/v1/renew_token";
const BAKONG_CHECK_STATUS_URL = "https://api-bakong.nbc.gov.kh/v1/check_transaction_by_md5";
// A KHQR is valid this long (it's written into the QR itself).
const KHQR_LIFETIME_MS = 5 * 60 * 1000;
// A payment made just before expiry can take a moment to show up at Bakong,
// so an unpaid QR is only called EXPIRED this long after its expiry.
const KHQR_EXPIRY_GRACE_MS = 2 * 60 * 1000;
// Bakong limits how many status checks a token may make, while registers may
// ask every few seconds (older versions with no limit at all). So Bakong
// itself is asked about any one QR at most every 20 seconds, the last answer
// reused in between -- except when the cashier presses Check payment (the
// customer says they've paid), which may ask again after 3 seconds.
const BAKONG_CHECK_INTERVAL_MS = 20 * 1000;
const BAKONG_MANUAL_CHECK_INTERVAL_MS = 3 * 1000;

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
  terminal: { id: string; storeId: string },
  input: {
    amount: number;
    currency: Currency;
    bakongAccountId?: string;
    merchantName?: string;
    merchantCity?: string;
    storePhone?: string;
  }
): Promise<{ qrString: string; md5Hash: string; amount: number; currency: Currency; expiresAt: string }> {
  const { storeId } = terminal;
  const currency: Currency = input.currency === "KHR" ? "KHR" : "USD";
  const amount = currency === "KHR" ? Math.round(input.amount) : Math.round(input.amount * 100) / 100;

  const cfg = await getStoreSettingsMap(storeId);

  const optionalData: KhqrOptionalData = {
    currency: currency === "KHR" ? khqrData.currency.khr : khqrData.currency.usd,
    amount,
    expirationTimestamp: Date.now() + KHQR_LIFETIME_MS,
  };
  const mobileNumber = toBakongMobile(input.storePhone || cfg.store_phone);
  if (mobileNumber) optionalData.mobileNumber = mobileNumber;

  const accountId = input.bakongAccountId || cfg.bakong_account_id || "";
  const individualInfo = new IndividualInfo(
    accountId,
    input.merchantName || cfg.bakong_merchant_name || "Mini Mart",
    input.merchantCity || cfg.bakong_merchant_city || "Phnom Penh",
    optionalData
  );

  const khqrEngine = new BakongKHQR();
  const result = khqrEngine.generateIndividual(individualInfo);
  if (!result?.data || result.status?.code !== 0) {
    throw new HttpError(500, result?.status?.message ?? "Bakong SDK rejected the request");
  }

  // Recorded before it's handed out, so its payment can later be confirmed
  // against exactly what was issued (checkKhqrStatus, and sync).
  const expiresAt = new Date(optionalData.expirationTimestamp!);
  await prisma.issuedKhqr.create({
    data: {
      md5Hash: result.data.md5,
      storeId,
      terminalId: terminal.id,
      qrString: result.data.qr,
      accountId,
      currency,
      amountMinor: toMinorUnits(amount, currency),
      expiresAt,
    },
  });

  return { qrString: result.data.qr, md5Hash: result.data.md5, amount, currency, expiresAt: expiresAt.toISOString() };
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

// Several registers can hit an expired token at the same moment. Renewing once
// per store at a time (and reusing a token another request has just obtained)
// keeps them from replacing each other's tokens in turn.
const pendingRenewals = new Map<string, Promise<string>>();

function renewTokenOnce(storeId: string, rejectedToken?: string): Promise<string> {
  const pending = pendingRenewals.get(storeId);
  if (pending) return pending;
  const renewal = (async () => {
    const current = await prisma.bakongCredential.findUnique({ where: { storeId } });
    if (current?.apiToken && current.apiToken !== rejectedToken) return current.apiToken;
    return renewBakongToken(storeId);
  })().finally(() => pendingRenewals.delete(storeId));
  pendingRenewals.set(storeId, renewal);
  return renewal;
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

type BakongTransaction = { amount?: number | string; currency?: string; toAccountId?: string };
type BakongStatusBody = { responseCode?: number; errorCode?: number | null; responseMessage?: string; data?: BakongTransaction };

// Why Bakong's record of the payment doesn't match the QR as issued, or null.
// Each field is only compared when Bakong's response includes it. Amount and
// currency must match; the receiving account is only logged when it differs,
// since how Bakong formats it in this response isn't documented and a format
// difference must never block a real payment.
function paymentMismatch(
  issued: { md5Hash: string; amountMinor: number; currency: Currency; accountId: string },
  paid: BakongTransaction | undefined
): string | null {
  if (!paid) return null;
  if (paid.currency && paid.currency.toUpperCase() !== issued.currency) {
    return `paid in ${paid.currency}, issued in ${issued.currency}`;
  }
  const amount = Number(paid.amount);
  if (paid.amount !== undefined && paid.amount !== null && Number.isFinite(amount) && toMinorUnits(amount, issued.currency) !== issued.amountMinor) {
    return "the paid amount differs from the QR's";
  }
  if (paid.toAccountId && issued.accountId && paid.toAccountId.trim().toLowerCase() !== issued.accountId.trim().toLowerCase()) {
    console.warn(
      `[khqr] ${issued.md5Hash.slice(0, 8)}: Bakong reports receiving account "${paid.toAccountId}", the QR was issued for "${issued.accountId}"`
    );
  }
  return null;
}

// "No such transaction (yet)" -- the normal answer while the customer hasn't
// paid. Anything else that isn't success is an error (token, request limit,
// outage...) and must not be mistaken for "not paid yet".
function isNotFound(body: BakongStatusBody | null): boolean {
  if (!body || body.errorCode === undefined || body.errorCode === null || body.errorCode === 1) return true;
  return /not\s*(be\s*)?found/i.test(body.responseMessage ?? "");
}

// Asks Bakong about one QR with the store's token, renewing it (once per
// store) and retrying if it has expired.
async function askBakong(storeId: string, md5Hash: string): Promise<{ response: Response; body: BakongStatusBody | null }> {
  const credential = await prisma.bakongCredential.findUnique({ where: { storeId } });
  let token = credential?.apiToken ?? (await renewTokenOnce(storeId));
  let response = await callBakongCheckStatus(token, md5Hash);
  if (response.status === 401) {
    token = await renewTokenOnce(storeId, token);
    response = await callBakongCheckStatus(token, md5Hash);
  }
  const body = (await response.json().catch(() => null)) as BakongStatusBody | null;
  return { response, body };
}

// Bakong confirmed this QR paid: the issued QR, and the payment of any sale
// already synced for it (e.g. one a cashier confirmed by hand).
async function markKhqrPaid(md5Hash: string) {
  await prisma.issuedKhqr.updateMany({ where: { md5Hash, status: { not: "PAID" } }, data: { status: "PAID", paidAt: new Date() } });
  await prisma.paymentTransaction.updateMany({ where: { md5Hash, status: { not: "PAID" } }, data: { status: "PAID" } });
}

// When Bakong was last asked about each QR, and what the register was told:
// the status, or the error (so a throttled check repeats the error rather
// than hiding it behind "pending").
const lastBakongCheck = new Map<string, { at: number; status?: KhqrStatus; error?: HttpError }>();

/**
 * Whether a KHQR this store issued has been paid. Only QRs recorded by
 * generateKhqr are answered for, and a payment only counts when it matches
 * the QR as issued; the result is saved, so a paid QR stays PAID (and a paid
 * QR whose sale never arrived can be found later). Bakong is asked at most
 * every 20 seconds per QR (3 when `manual`: the cashier pressed Check
 * payment), and its errors are reported, not read as unpaid.
 */
export async function checkKhqrStatus(
  storeId: string,
  md5Hash: string,
  { manual = false }: { manual?: boolean } = {}
): Promise<KhqrStatus> {
  const issued = await prisma.issuedKhqr.findUnique({ where: { md5Hash } });
  if (!issued || issued.storeId !== storeId) throw notFound("This store issued no KHQR with that reference");
  if (issued.status === "PAID") return "PAID";

  const now = Date.now();
  const interval = manual ? BAKONG_MANUAL_CHECK_INTERVAL_MS : BAKONG_CHECK_INTERVAL_MS;
  const last = lastBakongCheck.get(md5Hash);
  if (last && now - last.at < interval) {
    if (last.error) throw last.error;
    return last.status!;
  }

  const { response, body } = await askBakong(storeId, md5Hash);
  const ref = md5Hash.slice(0, 8);
  if (!response.ok) {
    console.warn(`[khqr] ${ref}: Bakong HTTP ${response.status}`, body?.responseMessage ?? "");
    const error = new HttpError(502, `Bakong: ${body?.responseMessage || `HTTP ${response.status}`}`);
    lastBakongCheck.set(md5Hash, { at: now, error });
    throw error;
  }

  if (body?.responseCode === 0) {
    const mismatch = paymentMismatch(issued, body.data);
    if (mismatch) {
      console.warn(`[khqr] ${ref}: payment refused, ${mismatch}`, body.data);
      const error = conflict(`Bakong reports a payment for this QR that doesn't match it: ${mismatch}`);
      lastBakongCheck.set(md5Hash, { at: now, error });
      throw error;
    }
    await markKhqrPaid(md5Hash);
    lastBakongCheck.delete(md5Hash);
    return "PAID";
  }

  if (!isNotFound(body)) {
    console.warn(`[khqr] ${ref}: Bakong error ${body?.errorCode}: ${body?.responseMessage ?? ""}`);
    const error = new HttpError(502, `Bakong: ${body?.responseMessage || `error ${body?.errorCode}`}`);
    lastBakongCheck.set(md5Hash, { at: now, error });
    throw error;
  }

  // Still checked with Bakong after expiry (it can flip to PAID if a late
  // payment does arrive), but reported as EXPIRED so a register stops waiting.
  let status: KhqrStatus = "PENDING";
  if (now > issued.expiresAt.getTime() + KHQR_EXPIRY_GRACE_MS) {
    if (issued.status !== "EXPIRED") {
      await prisma.issuedKhqr.update({ where: { md5Hash }, data: { status: "EXPIRED" } });
    }
    status = "EXPIRED";
  }
  lastBakongCheck.set(md5Hash, { at: now, status });
  return status;
}

/** Forget the per-QR Bakong check times (tests). */
export function resetBakongCheckThrottle() {
  lastBakongCheck.clear();
}

// A synced KHQR sale whose payment the backend hasn't confirmed itself
// (PaymentTransaction PENDING) -- typically one a cashier confirmed by hand
// when the register couldn't check (no connection, Bakong's limit). Such
// payments are re-checked with Bakong in the background, slowly so they cost
// little of its limit: PAID once Bakong confirms one, or EXPIRED -- Bakong
// never saw it, someone should look -- if it still hasn't 30 minutes after
// the QR expired. A Bakong error leaves it for a later round.
const REVERIFY_INTERVAL_MS = 5 * 60 * 1000;
const REVERIFY_GIVE_UP_AFTER_EXPIRY_MS = 30 * 60 * 1000;

export type ReverifyOutcome = "PAID" | "PENDING" | "EXPIRED" | "ERROR";

/** Re-checks the longest-waiting unconfirmed KHQR payment; null when there's none. */
export async function reverifyUnconfirmedKhqrPayment(): Promise<{ md5Hash: string; outcome: ReverifyOutcome } | null> {
  const payment = await prisma.paymentTransaction.findFirst({
    where: { status: "PENDING" },
    orderBy: { updatedAt: "asc" },
    include: { order: { select: { storeId: true } } },
  });
  if (!payment) return null;

  const { md5Hash } = payment;
  const ref = md5Hash.slice(0, 8);
  const issued = await prisma.issuedKhqr.findUnique({ where: { md5Hash } });
  // Moves it to the back of the queue (updatedAt), so one that can't be
  // settled yet doesn't block the others.
  const later = () => prisma.paymentTransaction.update({ where: { id: payment.id }, data: { status: "PENDING" } });
  const flag = async (why: string) => {
    logger.warn(`[khqr] ${ref}: unconfirmed payment flagged for review: ${why}`);
    await prisma.paymentTransaction.update({ where: { id: payment.id }, data: { status: "EXPIRED" } });
  };

  try {
    const { response, body } = await askBakong(issued?.storeId ?? payment.order.storeId, md5Hash);
    if (response.ok && body?.responseCode === 0) {
      const mismatch = issued ? paymentMismatch(issued, body.data) : null;
      if (mismatch) {
        await flag(`Bakong's record doesn't match the QR: ${mismatch}`);
        return { md5Hash, outcome: "EXPIRED" };
      }
      await markKhqrPaid(md5Hash);
      logger.info(`[khqr] ${ref}: unconfirmed payment confirmed by Bakong`);
      return { md5Hash, outcome: "PAID" };
    }
    if (response.ok && isNotFound(body)) {
      const deadline = (issued?.expiresAt ?? payment.createdAt).getTime() + REVERIFY_GIVE_UP_AFTER_EXPIRY_MS;
      if (Date.now() > deadline) {
        await flag("Bakong has no record of this payment");
        return { md5Hash, outcome: "EXPIRED" };
      }
      await later();
      return { md5Hash, outcome: "PENDING" };
    }
    logger.warn(`[khqr] ${ref}: re-check failed, Bakong ${response.status} ${body?.errorCode ?? ""} ${body?.responseMessage ?? ""}`);
  } catch (err) {
    logger.warn(`[khqr] ${ref}: re-check failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  await later();
  return { md5Hash, outcome: "ERROR" };
}

/** Runs reverifyUnconfirmedKhqrPayment every few minutes (server start; not in tests). */
export function startKhqrReverifier() {
  const timer = setInterval(() => {
    reverifyUnconfirmedKhqrPayment().catch((err) => logger.error(err, "[khqr] re-check round failed"));
  }, REVERIFY_INTERVAL_MS);
  timer.unref();
}
