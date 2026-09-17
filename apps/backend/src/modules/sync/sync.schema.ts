import { z } from "zod";

const orderItemSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().positive(),
  priceAtSale: z.number().nonnegative(),
  currency: z.enum(["USD", "KHR"]),
});

export const saleCompletedPayloadSchema = z.object({
  clientOrderUuid: z.string().min(1),
  items: z.array(orderItemSchema).min(1),
  paymentMethod: z.enum(["CASH", "KHQR", "CARD"]),
  totalAmount: z.number().nonnegative(),
  amountPaidUsd: z.number().nonnegative(),
  amountPaidKhr: z.number().nonnegative(),
  changeGivenKhr: z.number().nonnegative(),
  cashierUserId: z.string().optional(),
  khqrMd5Hash: z.string().optional(),
  khqrQrString: z.string().optional(),
  khqrBankName: z.string().optional(),
});

export const saleVoidedPayloadSchema = z.object({
  clientOrderUuid: z.string().min(1),
});

// Only the envelope is validated strictly here — `payload` is deliberately
// z.unknown() and gets checked per-event, inside sync.service.ts's
// applyEvent(). A push batches up to 100 events from a terminal's outbox in
// one request; validating the whole array atomically meant a single
// malformed payload (e.g. an empty-items sale) 400'd the entire batch,
// permanently blocking every OTHER, perfectly valid event queued behind it
// (the sidecar just retries the identical batch forever). Each event's
// payload now stands on its own — one bad apple reports back as a single
// per-event "error" result instead of taking the whole push down.
const eventEnvelopeSchema = z.object({
  eventId: z.string().min(1),
  terminalId: z.string().min(1),
  sequenceNo: z.number().int(),
  eventType: z.enum(["SALE_COMPLETED", "SALE_VOIDED"]),
  payload: z.unknown(),
  createdAt: z.string(),
});

export const syncPushSchema = z.object({
  events: z.array(eventEnvelopeSchema).min(1).max(100),
});

export const syncPullQuerySchema = z.object({
  since: z.string().optional(),
});

export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;
export type SaleCompletedPayload = z.infer<typeof saleCompletedPayloadSchema>;
export type SaleVoidedPayload = z.infer<typeof saleVoidedPayloadSchema>;
