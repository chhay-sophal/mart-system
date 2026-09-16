import { prisma } from "../../prisma";
import { forbidden } from "../../lib/httpError";
import { listStoresForUser } from "../stores/stores.service";

type ReportUser = { id: string; isSuperAdmin: boolean };

/** Every store the caller can see, narrowed to one if `storeId` was requested and is actually accessible to them. */
async function resolveAccessibleStoreIds(user: ReportUser, storeId?: string): Promise<string[]> {
  const stores = await listStoresForUser(user);
  const accessibleIds = stores.map((store) => store.id);

  if (storeId) {
    if (!accessibleIds.includes(storeId)) throw forbidden("No access to this store");
    return [storeId];
  }

  return accessibleIds;
}

export async function listNegativeStock(user: ReportUser, storeId?: string) {
  const storeIds = await resolveAccessibleStoreIds(user, storeId);

  const rows = await prisma.storeProduct.findMany({
    where: { storeId: { in: storeIds }, stock: { lt: 0 } },
    include: { product: true, store: true },
    orderBy: { stock: "asc" },
  });

  return Promise.all(
    rows.map(async (row) => {
      const recentMovements = await prisma.stockMovement.findMany({
        where: { storeId: row.storeId, productId: row.productId },
        orderBy: { createdAt: "desc" },
        take: 5,
      });

      return {
        storeId: row.storeId,
        storeName: row.store.name,
        productId: row.productId,
        productName: row.product.name,
        barcode: row.product.barcode,
        stock: row.stock,
        recentMovements,
      };
    })
  );
}
