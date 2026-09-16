import { prisma } from "../../prisma";
import { notFound } from "../../lib/httpError";
import type { updateStoreSchema } from "./stores.schema";
import type { z } from "zod";

export async function listStoresForUser(user: { id: string; isSuperAdmin: boolean }) {
  if (user.isSuperAdmin) {
    return prisma.store.findMany({ orderBy: { name: "asc" } });
  }

  return prisma.store.findMany({
    where: { userRoles: { some: { userId: user.id, isActive: true } } },
    orderBy: { name: "asc" },
  });
}

export async function getStoreOrThrow(storeId: string) {
  const store = await prisma.store.findUnique({ where: { id: storeId } });
  if (!store) throw notFound("Store not found");
  return store;
}

export async function updateStore(storeId: string, input: z.infer<typeof updateStoreSchema>) {
  await getStoreOrThrow(storeId);
  return prisma.store.update({ where: { id: storeId }, data: input });
}

export async function getStoreSettings(storeId: string): Promise<Record<string, string>> {
  const rows = await prisma.storeSetting.findMany({ where: { storeId } });
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

export async function putStoreSettings(
  storeId: string,
  settings: Record<string, string>
): Promise<Record<string, string>> {
  await getStoreOrThrow(storeId);

  await prisma.$transaction(
    Object.entries(settings).map(([key, value]) =>
      prisma.storeSetting.upsert({
        where: { storeId_key: { storeId, key } },
        create: { storeId, key, value },
        update: { value },
      })
    )
  );

  return getStoreSettings(storeId);
}
