export interface Store {
  id: string;
  name: string;
  code: string;
  address: string | null;
  phone: string | null;
  timezone: string;
  isActive: boolean;
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
