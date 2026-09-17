import type { Currency } from "@prisma/client";

/**
 * Money is stored as an integer in each currency's smallest whole unit — cents
 * for USD, plain Riel for KHR (Riel has no sub-unit in practice here). This
 * sidesteps SQLite/libSQL's lack of a native fixed-point decimal type (unlike
 * Postgres's NUMERIC(14,2)) entirely, rather than relying on Prisma's
 * client-side Decimal emulation on a connector where it isn't backed by the
 * database at all.
 */
export function toMinorUnits(amount: number, currency: Currency): number {
  return currency === "USD" ? Math.round(amount * 100) : Math.round(amount);
}

/** Convert a stored minor-units integer back to the plain decimal number the API has always returned. */
export function fromMinorUnits(minor: number | null | undefined, currency: Currency): number {
  if (minor === null || minor === undefined) return 0;
  return currency === "USD" ? minor / 100 : minor;
}
