import type { UserRole } from "@mart-system/shared-types";
import { Prisma } from "@prisma/client";
import { prisma } from "../../prisma";
import { conflict, notFound } from "../../lib/httpError";
import { hashPassword, hashPin, verifyPin } from "../../lib/hash";
import type { createStaffSchema, updateStaffSchema } from "./staff.schema";
import type { z } from "zod";

type CreateStaffInput = z.infer<typeof createStaffSchema>;
type UpdateStaffInput = z.infer<typeof updateStaffSchema>;

function toStaffView(row: { userId: string; role: UserRole; isActive: boolean; pinHash: string | null; user: { email: string; name: string } }) {
  return {
    userId: row.userId,
    email: row.user.email,
    name: row.user.name,
    role: row.role,
    isActive: row.isActive,
    hasPinSet: row.pinHash !== null,
  };
}

export async function listStaff(storeId: string) {
  const rows = await prisma.userStoreRole.findMany({
    where: { storeId },
    include: { user: { select: { email: true, name: true } } },
    orderBy: { user: { name: "asc" } },
  });
  return rows.map(toStaffView);
}

/** Enforced whenever a PIN is set/reset — PINs must be unique among a store's active roster. */
async function assertPinAvailable(storeId: string, pin: string, excludeUserId?: string) {
  const roster = await prisma.userStoreRole.findMany({
    where: {
      storeId,
      isActive: true,
      pinHash: { not: null },
      ...(excludeUserId ? { userId: { not: excludeUserId } } : {}),
    },
  });

  for (const row of roster) {
    if (await verifyPin(pin, row.pinHash!)) {
      throw conflict("That PIN is already in use by another staff member at this store");
    }
  }
}

export async function createStaff(storeId: string, input: CreateStaffInput) {
  if (input.pin) await assertPinAvailable(storeId, input.pin);

  const existingUser = await prisma.user.findUnique({ where: { email: input.email } });

  if (existingUser) {
    const existingRole = await prisma.userStoreRole.findUnique({
      where: { userId_storeId: { userId: existingUser.id, storeId } },
    });
    if (existingRole) throw conflict("This user already has a role at this store");

    const role = await prisma.userStoreRole.create({
      data: {
        userId: existingUser.id,
        storeId,
        role: input.role,
        pinHash: input.pin ? await hashPin(input.pin) : null,
      },
      include: { user: { select: { email: true, name: true } } },
    });
    return toStaffView(role);
  }

  const passwordHash = await hashPassword(input.password);
  const pinHash = input.pin ? await hashPin(input.pin) : null;

  const role = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { email: input.email, name: input.name, passwordHash },
    });
    return tx.userStoreRole.create({
      data: { userId: user.id, storeId, role: input.role, pinHash },
      include: { user: { select: { email: true, name: true } } },
    });
  });

  return toStaffView(role);
}

async function getStaffRoleOrThrow(storeId: string, userId: string) {
  const role = await prisma.userStoreRole.findUnique({
    where: { userId_storeId: { userId, storeId } },
    include: { user: { select: { email: true, name: true } } },
  });
  if (!role) throw notFound("Staff member not found at this store");
  return role;
}

/**
 * name/email/password live on the global User row (shared across every store
 * that person has a role at); role/isActive/pin are per-store, on
 * UserStoreRole. One call here can touch both, in that order, so a PIN
 * collision (checked first) never leaves the User half of the edit applied.
 */
export async function updateStaff(storeId: string, userId: string, input: UpdateStaffInput) {
  await getStaffRoleOrThrow(storeId, userId);

  if (input.pin) await assertPinAvailable(storeId, input.pin, userId);

  if (input.name !== undefined || input.email !== undefined || input.password !== undefined) {
    try {
      await prisma.user.update({
        where: { id: userId },
        data: {
          name: input.name,
          email: input.email,
          passwordHash: input.password !== undefined ? await hashPassword(input.password) : undefined,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw conflict("That email is already used by another account");
      }
      throw err;
    }
  }

  const roleData: Prisma.UserStoreRoleUpdateInput = {};
  if (input.role !== undefined) roleData.role = input.role;
  if (input.isActive !== undefined) roleData.isActive = input.isActive;
  if (input.pin) roleData.pinHash = await hashPin(input.pin);

  const role = await prisma.userStoreRole.update({
    where: { userId_storeId: { userId, storeId } },
    data: roleData,
    include: { user: { select: { email: true, name: true } } },
  });
  return toStaffView(role);
}

export async function resetStaffPin(storeId: string, userId: string, pin: string) {
  await getStaffRoleOrThrow(storeId, userId);
  await assertPinAvailable(storeId, pin, userId);

  const role = await prisma.userStoreRole.update({
    where: { userId_storeId: { userId, storeId } },
    data: { pinHash: await hashPin(pin) },
    include: { user: { select: { email: true, name: true } } },
  });
  return toStaffView(role);
}

export async function deactivateStaff(storeId: string, userId: string) {
  await getStaffRoleOrThrow(storeId, userId);
  await prisma.userStoreRole.update({
    where: { userId_storeId: { userId, storeId } },
    data: { isActive: false },
  });
}
