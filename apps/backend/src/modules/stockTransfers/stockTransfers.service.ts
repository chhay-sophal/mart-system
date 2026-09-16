import { prisma } from "../../prisma";
import { badRequest, forbidden, notFound } from "../../lib/httpError";
import { listStoresForUser } from "../stores/stores.service";
import type { createTransferSchema } from "./stockTransfers.schema";
import type { z } from "zod";
import type { Prisma } from "@prisma/client";

type CreateTransferInput = z.infer<typeof createTransferSchema>;
type TransferUser = { id: string; isSuperAdmin: boolean };

const MANAGE_ROLES = ["INVENTORY", "ADMIN"] as const;

const TRANSFER_INCLUDE = { fromStore: true, toStore: true, items: true } as const;
type TransferWithRelations = Prisma.StockTransferGetPayload<{ include: typeof TRANSFER_INCLUDE }>;

async function hasStoreRole(user: TransferUser, storeId: string, roles: readonly string[]): Promise<boolean> {
  if (user.isSuperAdmin) return true;
  const role = await prisma.userStoreRole.findUnique({
    where: { userId_storeId: { userId: user.id, storeId } },
  });
  return Boolean(role && role.isActive && roles.includes(role.role));
}

async function requireStoreRole(user: TransferUser, storeId: string, roles: readonly string[]) {
  if (!(await hasStoreRole(user, storeId, roles))) throw forbidden("Insufficient role for this store");
}

/** StockTransferItem has no direct Product relation — join by hand for display names. */
async function attachProductNames(items: TransferWithRelations["items"]) {
  const productIds = [...new Set(items.map((item) => item.productId))];
  const products = await prisma.product.findMany({ where: { id: { in: productIds } } });
  const nameById = new Map(products.map((product) => [product.id, product.name]));

  return items.map((item) => ({
    id: item.id,
    productId: item.productId,
    productName: nameById.get(item.productId) ?? "Unknown product",
    quantity: item.quantity,
  }));
}

async function toTransferView(row: TransferWithRelations) {
  return {
    id: row.id,
    fromStoreId: row.fromStoreId,
    fromStoreName: row.fromStore.name,
    toStoreId: row.toStoreId,
    toStoreName: row.toStore.name,
    status: row.status,
    requestedBy: row.requestedBy,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
    items: await attachProductNames(row.items),
  };
}

export async function listTransfers(user: TransferUser, storeId?: string) {
  const accessibleStoreIds = (await listStoresForUser(user)).map((store) => store.id);

  const where = storeId
    ? (() => {
        if (!accessibleStoreIds.includes(storeId)) throw forbidden("No access to this store");
        return { OR: [{ fromStoreId: storeId }, { toStoreId: storeId }] };
      })()
    : { OR: [{ fromStoreId: { in: accessibleStoreIds } }, { toStoreId: { in: accessibleStoreIds } }] };

  const rows = await prisma.stockTransfer.findMany({
    where,
    include: TRANSFER_INCLUDE,
    orderBy: { createdAt: "desc" },
  });
  return Promise.all(rows.map(toTransferView));
}

export async function createTransfer(user: TransferUser, input: CreateTransferInput) {
  if (input.fromStoreId === input.toStoreId) throw badRequest("fromStoreId and toStoreId must differ");
  await requireStoreRole(user, input.fromStoreId, MANAGE_ROLES);

  for (const item of input.items) {
    const storeProduct = await prisma.storeProduct.findUnique({
      where: { storeId_productId: { storeId: input.fromStoreId, productId: item.productId } },
    });
    if (!storeProduct) throw badRequest(`Product ${item.productId} is not stocked at the source store`);
  }

  const row = await prisma.stockTransfer.create({
    data: {
      fromStoreId: input.fromStoreId,
      toStoreId: input.toStoreId,
      requestedBy: user.id,
      items: { create: input.items.map((item) => ({ productId: item.productId, quantity: item.quantity })) },
    },
    include: TRANSFER_INCLUDE,
  });
  return toTransferView(row);
}

async function getTransferOrThrow(transferId: string) {
  const transfer = await prisma.stockTransfer.findUnique({ where: { id: transferId }, include: { items: true } });
  if (!transfer) throw notFound("Transfer not found");
  return transfer;
}

/**
 * The receiving store confirms receipt — this is what actually moves stock,
 * at both ends, in one transaction. The source side is allowed to go
 * negative (same no-block philosophy as a sale checkout); a find-or-create
 * on the destination StoreProduct handles a branch that never carried this
 * product before.
 */
export async function completeTransfer(user: TransferUser, transferId: string) {
  const transfer = await getTransferOrThrow(transferId);
  if (transfer.status !== "REQUESTED") throw badRequest(`Transfer is already ${transfer.status.toLowerCase()}`);
  await requireStoreRole(user, transfer.toStoreId, MANAGE_ROLES);

  const updated = await prisma.$transaction(async (tx) => {
    for (const item of transfer.items) {
      await tx.stockMovement.create({
        data: {
          storeId: transfer.fromStoreId,
          productId: item.productId,
          delta: -item.quantity,
          reason: "TRANSFER_OUT",
          refType: "StockTransfer",
          refId: transfer.id,
        },
      });
      await tx.storeProduct.update({
        where: { storeId_productId: { storeId: transfer.fromStoreId, productId: item.productId } },
        data: { stock: { decrement: item.quantity } },
      });

      await tx.storeProduct.upsert({
        where: { storeId_productId: { storeId: transfer.toStoreId, productId: item.productId } },
        create: { storeId: transfer.toStoreId, productId: item.productId, stock: item.quantity },
        update: { stock: { increment: item.quantity } },
      });
      await tx.stockMovement.create({
        data: {
          storeId: transfer.toStoreId,
          productId: item.productId,
          delta: item.quantity,
          reason: "TRANSFER_IN",
          refType: "StockTransfer",
          refId: transfer.id,
        },
      });
    }

    return tx.stockTransfer.update({
      where: { id: transferId },
      data: { status: "COMPLETED", completedAt: new Date() },
      include: TRANSFER_INCLUDE,
    });
  });

  return toTransferView(updated);
}

export async function cancelTransfer(user: TransferUser, transferId: string) {
  const transfer = await getTransferOrThrow(transferId);
  if (transfer.status !== "REQUESTED") throw badRequest(`Transfer is already ${transfer.status.toLowerCase()}`);

  const [hasFrom, hasTo] = await Promise.all([
    hasStoreRole(user, transfer.fromStoreId, MANAGE_ROLES),
    hasStoreRole(user, transfer.toStoreId, MANAGE_ROLES),
  ]);
  if (!hasFrom && !hasTo) throw forbidden("Insufficient role for this transfer");

  const updated = await prisma.stockTransfer.update({
    where: { id: transferId },
    data: { status: "CANCELLED" },
    include: TRANSFER_INCLUDE,
  });
  return toTransferView(updated);
}
