import { Prisma } from "@prisma/client";
import { prisma } from "../../prisma";
import { conflict, notFound } from "../../lib/httpError";
import type { createCategorySchema, updateCategorySchema } from "./categories.schema";
import type { z } from "zod";
import type { Category } from "@prisma/client";

type CreateCategoryInput = z.infer<typeof createCategorySchema>;
type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;

type CategoryWithCount = Category & { _count: { products: number } };

const PRODUCT_COUNT_INCLUDE = { _count: { select: { products: { where: { isDeleted: false } } } } } as const;

function toCategoryView(row: CategoryWithCount) {
  return {
    id: row.id,
    name: row.name,
    productCount: row._count.products,
    isDeleted: row.isDeleted,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Names are unique across active and archived categories alike -- an
 * archived one with the same name should be restored, not duplicated. */
function toNameConflict(err: unknown): unknown {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    return conflict("A category with that name already exists (it may be archived)");
  }
  return err;
}

export async function listCategories(includeDeleted = false) {
  const rows = await prisma.category.findMany({
    where: includeDeleted ? {} : { isDeleted: false },
    include: PRODUCT_COUNT_INCLUDE,
    orderBy: { name: "asc" },
  });
  return rows.map(toCategoryView);
}

async function getCategoryOrThrow(categoryId: string) {
  const row = await prisma.category.findUnique({
    where: { id: categoryId },
    include: PRODUCT_COUNT_INCLUDE,
  });
  if (!row || row.isDeleted) throw notFound("Category not found");
  return row;
}

export async function getCategory(categoryId: string) {
  return toCategoryView(await getCategoryOrThrow(categoryId));
}

export async function createCategory(input: CreateCategoryInput) {
  try {
    const row = await prisma.category.create({ data: { name: input.name } });
    return toCategoryView({ ...row, _count: { products: 0 } });
  } catch (err) {
    throw toNameConflict(err);
  }
}

export async function updateCategory(categoryId: string, input: UpdateCategoryInput) {
  await getCategoryOrThrow(categoryId);
  try {
    const row = await prisma.category.update({
      where: { id: categoryId },
      data: { name: input.name },
      include: PRODUCT_COUNT_INCLUDE,
    });
    return toCategoryView(row);
  } catch (err) {
    throw toNameConflict(err);
  }
}

/** Same rule as suppliers: removed outright while no product uses it,
 * archived (soft-deleted) once one does, so those products keep showing
 * their category while the picker stops offering it. */
export async function deleteCategory(categoryId: string) {
  const row = await getCategoryOrThrow(categoryId);
  if (row._count.products === 0) {
    await prisma.category.delete({ where: { id: categoryId } });
  } else {
    await prisma.category.update({ where: { id: categoryId }, data: { isDeleted: true } });
  }
}

export async function restoreCategory(categoryId: string) {
  const existing = await prisma.category.findUnique({ where: { id: categoryId } });
  if (!existing) throw notFound("Category not found");
  const row = await prisma.category.update({
    where: { id: categoryId },
    data: { isDeleted: false },
    include: PRODUCT_COUNT_INCLUDE,
  });
  return toCategoryView(row);
}
