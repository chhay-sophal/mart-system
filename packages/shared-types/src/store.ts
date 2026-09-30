export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

/**
 * One day's hours as "HH:MM" in the store's own timezone. `close` may be
 * "24:00" (open until midnight), or earlier than `open` for hours that run
 * past midnight (e.g. 18:00 → 02:00).
 */
export interface DayHours {
  open: string;
  close: string;
}

/** Every weekday present; `null` means closed that day. */
export type OpeningHours = Record<Weekday, DayHours | null>;

export interface Store {
  id: string;
  name: string;
  code: string;
  address: string | null;
  phone: string | null;
  timezone: string;
  isActive: boolean;
  /** Null until the store's hours have been entered in IMS. */
  openingHours: OpeningHours | null;
  latitude: number | null;
  longitude: number | null;
}

export type UserRole = "CASHIER" | "INVENTORY" | "ADMIN";

export interface UserStoreRole {
  userId: string;
  storeId: string;
  role: UserRole;
}

export interface Terminal {
  id: string;
  storeId: string;
  name: string;
  pairedAt: string;
  lastSeenAt: string | null;
  isActive: boolean;
}
