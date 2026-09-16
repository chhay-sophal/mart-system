import { Prisma } from "@prisma/client";

/** Convert a Prisma Decimal to a plain number at the API boundary. Safe at retail scale (well under MAX_SAFE_INTEGER). */
export function toApiNumber(value: Prisma.Decimal | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return typeof value === "number" ? value : value.toNumber();
}

export function toDecimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value);
}
