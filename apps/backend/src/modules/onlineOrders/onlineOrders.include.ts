import type { Prisma } from "@prisma/client";

/** What every online-order read loads: lines, the branch name, and its KHQR payments (newest first). */
export const ORDER_INCLUDE = {
  items: true,
  store: { select: { name: true } },
  paymentTransactions: { orderBy: { createdAt: "desc" } },
} as const;

export type OrderWithItems = Prisma.OnlineOrderGetPayload<{ include: typeof ORDER_INCLUDE }>;
