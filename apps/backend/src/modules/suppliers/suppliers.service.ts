import { prisma } from "../../prisma";
import { notFound } from "../../lib/httpError";
import type { createSupplierSchema, updateSupplierSchema } from "./suppliers.schema";
import type { z } from "zod";
import type { Supplier } from "@prisma/client";

type CreateSupplierInput = z.infer<typeof createSupplierSchema>;
type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>;

type SupplierWithCount = Supplier & { _count: { products: number } };

const PRODUCT_COUNT_INCLUDE = { _count: { select: { products: { where: { isDeleted: false } } } } } as const;

function toSupplierView(row: SupplierWithCount) {
  return {
    id: row.id,
    name: row.name,
    phone1: row.phone1,
    phone2: row.phone2,
    email: row.email,
    address: row.address,
    productCount: row._count.products,
    isDeleted: row.isDeleted,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listSuppliers(includeDeleted = false) {
  const rows = await prisma.supplier.findMany({
    where: includeDeleted ? {} : { isDeleted: false },
    include: PRODUCT_COUNT_INCLUDE,
    orderBy: { name: "asc" },
  });
  return rows.map(toSupplierView);
}

async function getSupplierOrThrow(supplierId: string) {
  const row = await prisma.supplier.findUnique({
    where: { id: supplierId },
    include: PRODUCT_COUNT_INCLUDE,
  });
  if (!row || row.isDeleted) throw notFound("Supplier not found");
  return row;
}

export async function getSupplier(supplierId: string) {
  return toSupplierView(await getSupplierOrThrow(supplierId));
}

export async function createSupplier(input: CreateSupplierInput) {
  const row = await prisma.supplier.create({
    data: {
      name: input.name,
      phone1: input.phone1,
      phone2: input.phone2 ?? null,
      email: input.email ?? null,
      address: input.address ?? null,
    },
  });
  return toSupplierView({ ...row, _count: { products: 0 } });
}

export async function updateSupplier(supplierId: string, input: UpdateSupplierInput) {
  await getSupplierOrThrow(supplierId);
  const row = await prisma.supplier.update({
    where: { id: supplierId },
    data: {
      name: input.name,
      phone1: input.phone1,
      phone2: input.phone2,
      email: input.email,
      address: input.address,
    },
    include: PRODUCT_COUNT_INCLUDE,
  });
  return toSupplierView(row);
}

/** A supplier with no linked products can be removed outright -- nothing
 * references it, so there's no history to preserve. Once a product points at
 * it, a hard delete would either orphan that link or cascade into deleting
 * the product, so it's archived (soft-deleted) instead: products keep their
 * supplierId (an archived supplier still identifies who used to supply
 * something), while listSuppliers/getSupplier hide it and the create/edit
 * picker won't offer it. */
export async function deleteSupplier(supplierId: string) {
  const row = await getSupplierOrThrow(supplierId);
  if (row._count.products === 0) {
    await prisma.supplier.delete({ where: { id: supplierId } });
  } else {
    await prisma.supplier.update({ where: { id: supplierId }, data: { isDeleted: true } });
  }
}
