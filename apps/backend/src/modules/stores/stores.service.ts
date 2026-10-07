import { prisma } from "../../prisma";
import { notFound } from "../../lib/httpError";
import type { updateStoreSchema } from "./stores.schema";
import type { z } from "zod";

// Each store comes back with `role`: this user's role there, so the IMS
// frontend can gate role-specific UI (e.g. the Settings nav item) without a
// separate request. A super admin has no UserStoreRole row anywhere (their
// access isn't store-scoped) but acts as ADMIN everywhere, so that's what's
// reported for every store.
export async function listStoresForUser(user: { id: string; isSuperAdmin: boolean }) {
  if (user.isSuperAdmin) {
    const stores = await prisma.store.findMany({ orderBy: { name: "asc" } });
    return stores.map((store) => ({ ...store, role: "ADMIN" as const }));
  }

  const stores = await prisma.store.findMany({
    where: { userRoles: { some: { userId: user.id, isActive: true } } },
    include: { userRoles: { where: { userId: user.id, isActive: true }, select: { role: true } } },
    orderBy: { name: "asc" },
  });

  return stores.map(({ userRoles, ...store }) => ({ ...store, role: userRoles[0]?.role ?? null }));
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
