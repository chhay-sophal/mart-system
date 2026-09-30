import { describe, expect, it } from "vitest";
import type { OpeningHours } from "@mart-system/shared-types";
import { isOpenAt, isValidPickupSlot, nextOpening, pickupSlots, zonedInstant } from "../src/lib/hours";

const TZ = "Asia/Phnom_Penh"; // UTC+7, no DST
// 2026-10-05 is a Monday.
const at = (y: number, mo: number, d: number, h: number, mi = 0) => zonedInstant(TZ, y, mo, d, h, mi);

const HOURS: OpeningHours = {
  mon: { open: "07:00", close: "22:00" },
  tue: { open: "07:00", close: "22:00" },
  wed: { open: "07:00", close: "22:00" },
  thu: { open: "07:00", close: "22:00" },
  fri: { open: "07:00", close: "24:00" },
  sat: { open: "18:00", close: "02:00" },
  sun: null,
};

describe("zonedInstant", () => {
  it("converts the store's wall time to the right instant", () => {
    expect(at(2026, 10, 5, 7).toISOString()).toBe("2026-10-05T00:00:00.000Z");
    expect(at(2026, 10, 5, 3).toISOString()).toBe("2026-10-04T20:00:00.000Z");
  });

  it("handles DST in zones that have it", () => {
    // 2026-03-29 01:00 UTC is when London moves to BST (UTC+1).
    expect(zonedInstant("Europe/London", 2026, 3, 29, 12, 0).toISOString()).toBe("2026-03-29T11:00:00.000Z");
    expect(zonedInstant("Europe/London", 2026, 1, 15, 12, 0).toISOString()).toBe("2026-01-15T12:00:00.000Z");
  });
});

describe("isOpenAt", () => {
  it("follows each day's hours, including past-midnight spill and closed days", () => {
    expect(isOpenAt(HOURS, TZ, at(2026, 10, 5, 6, 59))).toBe(false);
    expect(isOpenAt(HOURS, TZ, at(2026, 10, 5, 7))).toBe(true);
    expect(isOpenAt(HOURS, TZ, at(2026, 10, 5, 21, 59))).toBe(true);
    expect(isOpenAt(HOURS, TZ, at(2026, 10, 5, 22))).toBe(false);
    expect(isOpenAt(HOURS, TZ, at(2026, 10, 9, 23, 59))).toBe(true); // Fri until 24:00
    expect(isOpenAt(HOURS, TZ, at(2026, 10, 10, 23))).toBe(true); // Sat 18:00–02:00
    expect(isOpenAt(HOURS, TZ, at(2026, 10, 11, 1, 30))).toBe(true); // Sunday 01:30, Saturday's spill
    expect(isOpenAt(HOURS, TZ, at(2026, 10, 11, 12))).toBe(false); // Sunday closed
  });
});

describe("nextOpening", () => {
  it("returns now when open, later today, or skips closed days", () => {
    const noon = at(2026, 10, 5, 12);
    expect(nextOpening(HOURS, TZ, noon)).toEqual(noon);
    expect(nextOpening(HOURS, TZ, at(2026, 10, 5, 5))).toEqual(at(2026, 10, 5, 7));
    expect(nextOpening(HOURS, TZ, at(2026, 10, 5, 22, 30))).toEqual(at(2026, 10, 6, 7));
    // Sunday afternoon (closed) → Monday 07:00.
    expect(nextOpening(HOURS, TZ, at(2026, 10, 11, 15))).toEqual(at(2026, 10, 12, 7));
  });

  it("returns null for a store that never opens", () => {
    const closed = Object.fromEntries(Object.keys(HOURS).map((k) => [k, null])) as OpeningHours;
    expect(nextOpening(closed, TZ, at(2026, 10, 5, 12))).toBeNull();
  });
});

describe("pickupSlots", () => {
  it("offers aligned 30-minute slots from 30 minutes ahead, inside hours, through tomorrow", () => {
    const slots = pickupSlots(HOURS, TZ, at(2026, 10, 5, 20, 10));
    // Today: earliest is 20:40 → first aligned slot 21:00; 21:30 is the last that fits before 22:00.
    expect(slots[0]).toEqual(at(2026, 10, 5, 21));
    expect(slots[1]).toEqual(at(2026, 10, 5, 21, 30));
    // Then tomorrow 07:00 → 21:30, and nothing from the day after.
    expect(slots[2]).toEqual(at(2026, 10, 6, 7));
    expect(slots.at(-1)).toEqual(at(2026, 10, 6, 21, 30));
    expect(slots).toHaveLength(2 + 30);
  });

  it("includes past-midnight slots and skips closed days", () => {
    // Saturday 17:00: Saturday 18:00 → Sunday 01:30 (runs past midnight), Sunday itself closed.
    const slots = pickupSlots(HOURS, TZ, at(2026, 10, 10, 17));
    expect(slots[0]).toEqual(at(2026, 10, 10, 18));
    expect(slots.at(-1)).toEqual(at(2026, 10, 11, 1, 30));
    expect(slots).toHaveLength(16);
  });

  it("offers nothing when hours aren't listed", () => {
    expect(pickupSlots(null, TZ, at(2026, 10, 5, 12))).toEqual([]);
  });
});

describe("isValidPickupSlot", () => {
  const now = at(2026, 10, 5, 12);
  it("accepts an offered slot, with a little grace for one picked a few minutes ago", () => {
    expect(isValidPickupSlot(HOURS, TZ, at(2026, 10, 5, 13), now)).toBe(true);
    expect(isValidPickupSlot(HOURS, TZ, at(2026, 10, 5, 12, 30), at(2026, 10, 5, 12, 10))).toBe(true);
  });

  it("rejects slots that are misaligned, too soon, outside hours, or beyond tomorrow", () => {
    expect(isValidPickupSlot(HOURS, TZ, at(2026, 10, 5, 13, 15), now)).toBe(false);
    expect(isValidPickupSlot(HOURS, TZ, at(2026, 10, 5, 12), now)).toBe(false);
    expect(isValidPickupSlot(HOURS, TZ, at(2026, 10, 5, 21, 45), now)).toBe(false);
    expect(isValidPickupSlot(HOURS, TZ, at(2026, 10, 5, 22), now)).toBe(false);
    expect(isValidPickupSlot(HOURS, TZ, at(2026, 10, 7, 9), now)).toBe(false);
    expect(isValidPickupSlot(null, TZ, at(2026, 10, 5, 13), now)).toBe(false);
    expect(isValidPickupSlot(HOURS, TZ, new Date("nope"), now)).toBe(false);
  });
});
