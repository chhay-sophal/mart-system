import bcrypt from "bcryptjs";
import { env } from "../env";

export function hashPassword(password: string) {
  return bcrypt.hash(password, env.PASSWORD_BCRYPT_COST);
}

export function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export function hashPin(pin: string) {
  return bcrypt.hash(pin, env.PIN_BCRYPT_COST);
}

export function verifyPin(pin: string, hash: string) {
  return bcrypt.compare(pin, hash);
}

export function hashDeviceSecret(secret: string) {
  return bcrypt.hash(secret, env.PASSWORD_BCRYPT_COST);
}

export function verifyDeviceSecret(secret: string, hash: string) {
  return bcrypt.compare(secret, hash);
}
