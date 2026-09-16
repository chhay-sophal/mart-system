import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../prisma";
import { toApiNumber, toDecimal } from "../../lib/money";
import type { OutboxEventInput } from "./sync.schema";

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
  event: Extract<OutboxEventInput, { eventType: "SALE_COMPLETED" }>
): Promise<string> {
  const { payload } = event;

  const order = await tx.order.create({
    data: {
      storeId: terminal.storeId,
      terminalId: terminal.id,
      clientOrderUuid: payload.clientOrderUuid,
      totalAmount: toDecimal(payload.totalAmount),
      currency: "USD",
      paymentMethod: payload.paymentMethod,
      amountPaidUsd: toDecimal(payload.amountPaidUsd),
      amountPaidKhr: toDecimal(payload.amountPaidKhr),
      changeGivenKhr: toDecimal(payload.changeGivenKhr),
      status: "COMPLETED",
      createdAt: new Date(event.createdAt),
      syncedAt: new Date(),
      items: {
        create: payload.items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
          priceAtSale: toDecimal(item.priceAtSale),
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

  return order.id;
}

async function applySaleVoided(
  tx: Prisma.TransactionClient,
  terminal: TerminalContext,
  event: Extract<OutboxEventInput, { eventType: "SALE_VOIDED" }>
): Promise<string> {
  const order = await tx.order.findUnique({
    where: { clientOrderUuid: event.payload.clientOrderUuid },
    include: { items: true },
  });

  if (!order || order.storeId !== terminal.storeId) {
    throw new Error("Order not found for void — the original sale may not be synced yet");
  }

  if (order.status === "VOIDED") {
    return order.id; // Already voided by an earlier attempt — idempotent no-op.
  }

  await tx.order.update({ where: { id: order.id }, data: { status: "VOIDED" } });

  for (const item of order.items) {
    await tx.stockMovement.create({
      data: {
        storeId: terminal.storeId,
        productId: item.productId,
        terminalId: terminal.id,
        delta: item.quantity,
        reason: "VOID",
        sourceEventId: event.eventId,
      },
    });
    await tx.storeProduct.update({
      where: { storeId_productId: { storeId: terminal.storeId, productId: item.productId } },
      data: { stock: { increment: item.quantity } },
    });
  }

  return order.id;
}

async function applyEvent(terminal: TerminalContext, event: OutboxEventInput): Promise<PushEventResult> {
  try {
    const orderId = await prisma.$transaction(async (tx) => {
      const resultOrderId =
        event.eventType === "SALE_COMPLETED"
          ? await applySaleCompleted(tx, terminal, event)
          : await applySaleVoided(tx, terminal, event);

      // Claim the eventId inside the same transaction as the business effect it
      // records, so a rolled-back claim (duplicate) also rolls back that effect.
      const claimed = await tx.$queryRaw<Array<{ id: string }>>`
        INSERT INTO "SyncEvent"
          ("id", "eventId", "terminalId", "storeId", "eventType", "sequenceNo", "payload", "status", "appliedAt", "resultOrderId", "createdAt")
        VALUES
          (${crypto.randomUUID()}, ${event.eventId}, ${terminal.id}, ${terminal.storeId},
           ${event.eventType}::"SyncEventType", ${event.sequenceNo}, ${JSON.stringify(event.payload)}::jsonb,
           'APPLIED', now(), ${resultOrderId}, now())
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
        where: { clientOrderUuid: event.payload.clientOrderUuid },
      });
      if (existingOrder) {
        return { eventId: event.eventId, status: "duplicate", orderId: existingOrder.id };
      }
    }

    return { eventId: event.eventId, status: "error", error: err instanceof Error ? err.message : "Unknown error" };
  }
}

export async function pushEvents(terminal: TerminalContext, events: OutboxEventInput[]): Promise<PushEventResult[]> {
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
  stock: number;
  isDeleted: boolean;
}

export async function pullCatalog(
  storeId: string,
  since?: string
): Promise<{ cursor: string; productUpserts: ProductUpsert[] }> {
  const cursor = new Date().toISOString();
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
    priceOverride: row.priceOverride !== null ? toApiNumber(row.priceOverride) : null,
    defaultPrice: toApiNumber(row.product.defaultPrice),
    stock: row.stock,
    isDeleted: row.product.isDeleted,
  }));

  return { cursor, productUpserts };
}
