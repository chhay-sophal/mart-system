import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../prisma";
import { voidOrderInTx } from "../orders/orders.service";
import { fromMinorUnits, toMinorUnits } from "../../lib/money";
import {
  saleCompletedPayloadSchema,
  saleVoidedPayloadSchema,
  type EventEnvelope,
  type SaleCompletedPayload,
  type SaleVoidedPayload,
} from "./sync.schema";

interface TerminalContext {
  id: string;
  storeId: string;
}

export type PushEventResult =
  | { eventId: string; status: "applied"; orderId: string }
  | { eventId: string; status: "duplicate"; orderId: string }
  | { eventId: string; status: "error"; error: string };

/** Thrown internally to unwind the speculative transaction when the eventId claim loses the race. */
class DuplicateEventError extends Error {}

async function applySaleCompleted(
  tx: Prisma.TransactionClient,
  terminal: TerminalContext,
  event: EventEnvelope,
  payload: SaleCompletedPayload
): Promise<string> {
  const order = await tx.order.create({
    data: {
      storeId: terminal.storeId,
      terminalId: terminal.id,
      clientOrderUuid: payload.clientOrderUuid,
      cashierUserId: payload.cashierUserId ?? null,
      totalAmountMinor: toMinorUnits(payload.totalAmount, payload.currency),
      currency: payload.currency,
      paymentMethod: payload.paymentMethod,
      bankName: payload.bankName ?? null,
      amountPaidUsdMinor: toMinorUnits(payload.amountPaidUsd, "USD"),
      amountPaidKhrMinor: toMinorUnits(payload.amountPaidKhr, "KHR"),
      changeGivenKhrMinor: toMinorUnits(payload.changeGivenKhr, "KHR"),
      status: "COMPLETED",
      createdAt: new Date(event.createdAt),
      syncedAt: new Date(),
      items: {
        create: payload.items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
          priceAtSaleMinor: toMinorUnits(item.priceAtSale, item.currency),
          discountMinor: toMinorUnits(item.discount, item.currency),
          currency: item.currency,
        })),
      },
    },
  });

  for (const item of payload.items) {
    await tx.stockMovement.create({
      data: {
        storeId: terminal.storeId,
        productId: item.productId,
        terminalId: terminal.id,
        delta: -item.quantity,
        reason: "SALE",
        sourceEventId: event.eventId,
      },
    });
    // No pre-check: the goods already left the store. Negative stock is an
    // accepted, reportable state (Phase 5 reconciliation), not an error here.
    await tx.storeProduct.update({
      where: { storeId_productId: { storeId: terminal.storeId, productId: item.productId } },
      data: { stock: { decrement: item.quantity } },
    });
  }

  if (payload.khqrMd5Hash) {
    // By the time a sale reaches sync, payment already cleared (POS polled
    // Bakong and only calls checkout once it saw PAID) — record it as such.
    await tx.paymentTransaction.create({
      data: {
        orderId: order.id,
        md5Hash: payload.khqrMd5Hash,
        qrString: payload.khqrQrString ?? "",
        bankName: payload.khqrBankName ?? null,
        currency: payload.currency,
        amountMinor: toMinorUnits(payload.totalAmount, payload.currency),
        status: "PAID",
      },
    });
  }

  return order.id;
}

async function applySaleVoided(
  tx: Prisma.TransactionClient,
  terminal: TerminalContext,
  event: EventEnvelope,
  payload: SaleVoidedPayload
): Promise<string> {
  const order = await tx.order.findUnique({
    where: { clientOrderUuid: payload.clientOrderUuid },
    include: { items: true },
  });

  if (!order || order.storeId !== terminal.storeId) {
    throw new Error("Order not found for void — the original sale may not be synced yet");
  }

  // Idempotent: a sale already voided (by an earlier attempt, or in IMS) is left alone.
  await voidOrderInTx(tx, order, { terminalId: terminal.id, sourceEventId: event.eventId });

  return order.id;
}

async function applyEvent(terminal: TerminalContext, event: EventEnvelope): Promise<PushEventResult> {
  // Validated per-event, not as part of the whole-batch schema (see
  // sync.schema.ts) — an invalid payload here reports back as this one
  // event's own "error" result and never opens a transaction, instead of
  // rejecting the entire push and blocking every other event behind it.
  const payloadSchema = event.eventType === "SALE_COMPLETED" ? saleCompletedPayloadSchema : saleVoidedPayloadSchema;
  const parsedPayload = payloadSchema.safeParse(event.payload);
  if (!parsedPayload.success) {
    const reason = parsedPayload.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    return { eventId: event.eventId, status: "error", error: `Invalid ${event.eventType} payload — ${reason}` };
  }

  try {
    const orderId = await prisma.$transaction(async (tx) => {
      const resultOrderId =
        event.eventType === "SALE_COMPLETED"
          ? await applySaleCompleted(tx, terminal, event, parsedPayload.data as SaleCompletedPayload)
          : await applySaleVoided(tx, terminal, event, parsedPayload.data as SaleVoidedPayload);

      // Claim the eventId inside the same transaction as the business effect it
      // records, so a rolled-back claim (duplicate) also rolls back that effect.
      // No native enum type or ::type cast on SQLite/libSQL — eventType binds as
      // plain text, and the JSON payload (already JSON.stringify'd) as plain
      // TEXT. now() is Postgres-only; bind an explicit JS Date instead.
      const now = new Date();
      const claimed = await tx.$queryRaw<Array<{ id: string }>>`
        INSERT INTO "SyncEvent"
          ("id", "eventId", "terminalId", "storeId", "eventType", "sequenceNo", "payload", "status", "appliedAt", "resultOrderId", "createdAt")
        VALUES
          (${crypto.randomUUID()}, ${event.eventId}, ${terminal.id}, ${terminal.storeId},
           ${event.eventType}, ${event.sequenceNo}, ${JSON.stringify(event.payload)},
           'APPLIED', ${now}, ${resultOrderId}, ${now})
        ON CONFLICT ("eventId") DO NOTHING
        RETURNING "id"
      `;

      if (claimed.length === 0) throw new DuplicateEventError();

      // Best-effort gap-detection bookkeeping — never required for correctness.
      await tx.syncCursor.upsert({
        where: { terminalId: terminal.id },
        create: { terminalId: terminal.id, lastAppliedSeq: event.sequenceNo },
        update: { lastAppliedSeq: event.sequenceNo },
      });

      return resultOrderId;
    });

    return { eventId: event.eventId, status: "applied", orderId };
  } catch (err) {
    if (err instanceof DuplicateEventError) {
      const existing = await prisma.syncEvent.findUnique({ where: { eventId: event.eventId } });
      return { eventId: event.eventId, status: "duplicate", orderId: existing?.resultOrderId ?? "" };
    }

    // A retry can also race in fast enough that Order.clientOrderUuid's own
    // uniqueness fires before the transaction ever reaches the eventId claim —
    // that's the same "already applied" signal, just from a different table.
    if (
      event.eventType === "SALE_COMPLETED" &&
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      const existingOrder = await prisma.order.findUnique({
        where: { clientOrderUuid: (parsedPayload.data as SaleCompletedPayload).clientOrderUuid },
      });
      if (existingOrder) {
        return { eventId: event.eventId, status: "duplicate", orderId: existingOrder.id };
      }
    }

    return { eventId: event.eventId, status: "error", error: err instanceof Error ? err.message : "Unknown error" };
  }
}

export async function pushEvents(terminal: TerminalContext, events: EventEnvelope[]): Promise<PushEventResult[]> {
  const results: PushEventResult[] = [];
  // Sequential, not Promise.all: events must apply in the order the terminal
  // sent them (its own local sequence_no order) so e.g. a SALE followed by its
  // VOID in the same batch resolves correctly.
  for (const event of events) {
    results.push(await applyEvent(terminal, event));
  }
  return results;
}

export interface ProductUpsert {
  productId: string;
  name: string;
  barcode: string | null;
  priceOverride: number | null;
  defaultPrice: number;
  /** Currency of the price the terminal sells at: priceOverride's if set, else defaultPrice's. */
  currency: "USD" | "KHR";
  /** This store's cost price, in StoreProduct's own currency (not necessarily the same as `currency` above). */
  costPrice: number;
  stock: number;
  isDeleted: boolean;
}

export interface StaffRosterUpsert {
  userId: string;
  name: string;
  role: string;
  pinHash: string;
  isActive: boolean;
}

export interface OrderItemUpsert {
  productId: string;
  quantity: number;
  priceAtSale: number;
  /** Item discount for the whole line, in `currency`. */
  discount: number;
  currency: "USD" | "KHR";
}

export interface OrderUpsert {
  clientOrderUuid: string;
  terminalId: string;
  /** For display on a register that didn't ring this sale up itself. */
  terminalName: string;
  cashierUserId: string | null;
  paymentMethod: string;
  bankName: string | null;
  total: number;
  currency: "USD" | "KHR";
  amountPaidUsd: number;
  amountPaidKhr: number;
  changeGivenKhr: number;
  status: string;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
  items: OrderItemUpsert[];
}

// Caps a single pull response so a terminal catching up on months of history
// (first pairing, or after being offline a long time) paginates across
// several 20s ticks instead of one huge payload.
const ORDER_PULL_BATCH_SIZE = 500;

interface OrderUpsertPage {
  orders: OrderUpsert[];
  /**
   * Set only when this page was truncated by the batch cap: the shared pull
   * cursor (see pullCatalog below) must stop here, at the last order actually
   * sent, rather than jumping to "now" -- otherwise the next pull's `since`
   * would skip every order still waiting behind the cap. null means every
   * matching order fit in this page, so the cursor is free to advance to now.
   */
  cursorCeiling: Date | null;
}

async function getOrderUpserts(storeId: string, sinceDate: Date | null): Promise<OrderUpsertPage> {
  // One extra row, never sent, just to detect truncation.
  const rows = await prisma.order.findMany({
    where: {
      storeId,
      ...(sinceDate ? { updatedAt: { gt: sinceDate } } : {}),
    },
    include: { items: true, terminal: { select: { name: true } } },
    orderBy: { updatedAt: "asc" },
    take: ORDER_PULL_BATCH_SIZE + 1,
  });

  const truncated = rows.length > ORDER_PULL_BATCH_SIZE;
  const page = truncated ? rows.slice(0, ORDER_PULL_BATCH_SIZE) : rows;

  const orders = page.map((order) => ({
    clientOrderUuid: order.clientOrderUuid,
    terminalId: order.terminalId,
    terminalName: order.terminal.name,
    cashierUserId: order.cashierUserId,
    paymentMethod: order.paymentMethod,
    bankName: order.bankName,
    total: fromMinorUnits(order.totalAmountMinor, order.currency),
    currency: order.currency,
    amountPaidUsd: fromMinorUnits(order.amountPaidUsdMinor, "USD"),
    amountPaidKhr: fromMinorUnits(order.amountPaidKhrMinor, "KHR"),
    changeGivenKhr: fromMinorUnits(order.changeGivenKhrMinor, "KHR"),
    status: order.status,
    isDeleted: order.isDeleted,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    items: order.items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      priceAtSale: fromMinorUnits(item.priceAtSaleMinor, item.currency),
      discount: fromMinorUnits(item.discountMinor, item.currency),
      currency: item.currency,
    })),
  }));

  return { orders, cursorCeiling: truncated ? page[page.length - 1]!.updatedAt : null };
}

/**
 * Store-wide settings managed in IMS, sent in full on every pull (a handful
 * of fields). null = never set in IMS, and the terminal keeps its local value.
 * Shop name, address, phone, image and Bakong merchant details aren't here:
 * they are branch-specific and set on each register (issue #5).
 */
export interface StoreSettingsSnapshot {
  mainCurrency: string | null;
  locale: string | null;
  exchangeRate: string | null;
}

async function getStoreSettingsSnapshot(storeId: string): Promise<StoreSettingsSnapshot> {
  const rows = await prisma.storeSetting.findMany({
    where: { storeId, key: { in: ["main_currency", "locale", "exchange_rate"] } },
  });
  const setting = (key: string) => rows.find((row) => row.key === key)?.value ?? null;
  return {
    mainCurrency: setting("main_currency"),
    locale: setting("locale"),
    exchangeRate: setting("exchange_rate"),
  };
}

export async function pullCatalog(
  storeId: string,
  since?: string
): Promise<{
  cursor: string;
  productUpserts: ProductUpsert[];
  staffRoster: StaffRosterUpsert[];
  storeSettings: StoreSettingsSnapshot;
  orderUpserts: OrderUpsert[];
}> {
  // The cursor this pull hands back for next time -- normally "now", but see
  // the orderUpserts/cursorCeiling handling below, which can hold it back.
  const now = new Date();
  const sinceDate = since ? new Date(since) : null;

  const rows = await prisma.storeProduct.findMany({
    where: {
      storeId,
      ...(sinceDate
        ? { OR: [{ updatedAt: { gt: sinceDate } }, { product: { updatedAt: { gt: sinceDate } } }] }
        : {}),
    },
    include: { product: true },
  });

  const productUpserts: ProductUpsert[] = rows.map((row) => ({
    productId: row.productId,
    name: row.product.name,
    barcode: row.product.barcode,
    priceOverride: row.priceOverrideMinor !== null ? fromMinorUnits(row.priceOverrideMinor, row.currency) : null,
    defaultPrice: fromMinorUnits(row.product.defaultPriceMinor, row.product.currency),
    currency: row.priceOverrideMinor !== null ? row.currency : row.product.currency,
    costPrice: fromMinorUnits(row.costPriceMinor, row.currency),
    stock: row.stock,
    isDeleted: row.product.isDeleted,
  }));

  // Same roster shape auth.service.ts's pinLogin() scans server-side — this is
  // what lets a POS terminal verify a PIN locally, offline, against a synced
  // cache instead of needing a live call for every unlock. isActive is NOT
  // filtered to true here (unlike pinLogin's live check) — a deactivation has
  // to show up as a delta row (isActive: false) so the terminal actually
  // learns about it, the same way isDeleted products still come through above.
  const roster = await prisma.userStoreRole.findMany({
    where: {
      storeId,
      pinHash: { not: null },
      ...(sinceDate ? { updatedAt: { gt: sinceDate } } : {}),
    },
    include: { user: { select: { name: true } } },
  });

  const staffRoster: StaffRosterUpsert[] = roster.map((row) => ({
    userId: row.userId,
    name: row.user.name,
    role: row.role,
    pinHash: row.pinHash!,
    isActive: row.isActive,
  }));

  const storeSettings = await getStoreSettingsSnapshot(storeId);
  const { orders: orderUpserts, cursorCeiling } = await getOrderUpserts(storeId, sinceDate);
  // A truncated order page holds the shared cursor at the last order actually
  // sent, not "now" -- otherwise the next pull's `since` would skip every
  // order still waiting behind the batch cap (see getOrderUpserts above).
  const cursor = (cursorCeiling ?? now).toISOString();

  return { cursor, productUpserts, staffRoster, storeSettings, orderUpserts };
}
