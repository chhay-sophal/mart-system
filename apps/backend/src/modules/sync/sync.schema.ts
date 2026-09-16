import { z } from "zod";

const orderItemSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().positive(),
  priceAtSale: z.number().nonnegative(),
  currency: z.enum(["USD", "KHR"]),
});

const saleCompletedPayloadSchema = z.object({
  clientOrderUuid: z.string().min(1),
  items: z.array(orderItemSchema).min(1),
  paymentMethod: z.enum(["CASH", "KHQR", "CARD"]),
  totalAmount: z.number().nonnegative(),
  amountPaidUsd: z.number().nonnegative(),
  amountPaidKhr: z.number().nonnegative(),
  changeGivenKhr: z.number().nonnegative(),
  khqrMd5Hash: z.string().optional(),
  khqrQrString: z.string().optional(),
  khqrBankName: z.string().optional(),
});

const saleVoidedPayloadSchema = z.object({
  clientOrderUuid: z.string().min(1),
});

const outboxEventSchema = z.discriminatedUnion("eventType", [
  z.object({
    eventId: z.string().min(1),
    terminalId: z.string().min(1),
    sequenceNo: z.number().int(),
    eventType: z.literal("SALE_COMPLETED"),
    payload: saleCompletedPayloadSchema,
    createdAt: z.string(),
  }),
  z.object({
    eventId: z.string().min(1),
    terminalId: z.string().min(1),
    sequenceNo: z.number().int(),
    eventType: z.literal("SALE_VOIDED"),
    payload: saleVoidedPayloadSchema,
    createdAt: z.string(),
  }),
]);

export const syncPushSchema = z.object({
  events: z.array(outboxEventSchema).min(1).max(100),
});

export const syncPullQuerySchema = z.object({
  since: z.string().optional(),
});

export type OutboxEventInput = z.infer<typeof outboxEventSchema>;
