import type { UserRole } from "@mart-system/shared-types";
import { prisma } from "../../prisma";
import { env } from "../../env";
import { hashPassword, verifyPassword, verifyPin } from "../../lib/hash";
import {
  hashToken,
  signAccessToken,
  signCashierSessionToken,
  signRefreshToken,
  verifyRefreshToken,
} from "../../lib/jwt";
import { parseDurationMs } from "../../lib/duration";
import { unauthorized } from "../../lib/httpError";
import { pinLoginLimiter } from "../../middleware/rateLimiter";

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

async function issueTokenPair(user: { id: string; email: string; isSuperAdmin: boolean }): Promise<TokenPair> {
  const accessToken = signAccessToken({ sub: user.id, email: user.email, isSuperAdmin: user.isSuperAdmin });

  const refreshRow = await prisma.refreshToken.create({
    data: {
      userId: user.id,
      // Placeholder — replaced immediately below once we know the row id (jti).
      tokenHash: "pending",
      expiresAt: new Date(Date.now() + parseDurationMs(env.REFRESH_TOKEN_TTL)),
    },
  });

  const refreshToken = signRefreshToken({ sub: user.id, jti: refreshRow.id });
  await prisma.refreshToken.update({ where: { id: refreshRow.id }, data: { tokenHash: hashToken(refreshToken) } });

  return { accessToken, refreshToken };
}

export async function registerUserWithPassword(input: {
  email: string;
  password: string;
  name: string;
  isSuperAdmin?: boolean;
}) {
  const passwordHash = await hashPassword(input.password);
  return prisma.user.create({
    data: {
      email: input.email,
      passwordHash,
      name: input.name,
      isSuperAdmin: input.isSuperAdmin ?? false,
    },
  });
}

export async function login(email: string, password: string): Promise<TokenPair> {
  const user = await prisma.user.findUnique({ where: { email } });
  // Same error for unknown email and wrong password — don't let the response shape reveal which one it was.
  if (!user || !user.isActive) throw unauthorized("Invalid email or password");

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) throw unauthorized("Invalid email or password");

  return issueTokenPair(user);
}

export async function refreshTokens(rawRefreshToken: string): Promise<TokenPair> {
  let payload;
  try {
    payload = verifyRefreshToken(rawRefreshToken);
  } catch {
    throw unauthorized("Invalid or expired refresh token");
  }

  const row = await prisma.refreshToken.findUnique({ where: { id: payload.jti } });
  if (!row || row.tokenHash !== hashToken(rawRefreshToken)) {
    throw unauthorized("Invalid refresh token");
  }

  if (row.revokedAt) {
    // Reuse of an already-rotated-out token: treat as compromised and kill the
    // user's entire refresh lineage rather than just this one token.
    await prisma.refreshToken.updateMany({
      where: { userId: row.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    throw unauthorized("Refresh token reuse detected — all sessions revoked");
  }

  if (row.expiresAt.getTime() < Date.now()) {
    throw unauthorized("Refresh token expired");
  }

  const user = await prisma.user.findUnique({ where: { id: row.userId } });
  if (!user || !user.isActive) throw unauthorized("Account is no longer active");

  const newTokens = await issueTokenPair(user);
  const newPayload = verifyRefreshToken(newTokens.refreshToken);

  await prisma.refreshToken.update({
    where: { id: row.id },
    data: { revokedAt: new Date(), replacedByTokenId: newPayload.jti },
  });

  return newTokens;
}

export async function logout(rawRefreshToken: string): Promise<void> {
  const tokenHash = hashToken(rawRefreshToken);
  await prisma.refreshToken.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export interface PinLoginResult {
  sessionToken: string;
  userId: string;
  role: UserRole;
}

export async function pinLogin(params: {
  terminalId: string;
  storeId: string;
  pin: string;
}): Promise<PinLoginResult> {
  const limiterKey = `${params.terminalId}:${params.storeId}`;
  pinLoginLimiter.assertAllowed(limiterKey);

  const roster = await prisma.userStoreRole.findMany({
    where: { storeId: params.storeId, isActive: true, pinHash: { not: null } },
  });

  for (const role of roster) {
    // pinHash is guaranteed non-null by the query filter above.
    if (await verifyPin(params.pin, role.pinHash!)) {
      pinLoginLimiter.recordSuccess(limiterKey);
      const sessionToken = signCashierSessionToken({
        sub: role.userId,
        storeId: params.storeId,
        terminalId: params.terminalId,
        role: role.role,
      });
      return { sessionToken, userId: role.userId, role: role.role };
    }
  }

  pinLoginLimiter.recordFailure(limiterKey);
  throw unauthorized("Invalid PIN");
}
