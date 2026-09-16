import crypto from "node:crypto";
import { prisma } from "../../prisma";
import { notFound } from "../../lib/httpError";
import { hashDeviceSecret } from "../../lib/hash";
import type { createTerminalSchema, updateTerminalSchema } from "./terminals.schema";
import type { z } from "zod";

type CreateTerminalInput = z.infer<typeof createTerminalSchema>;
type UpdateTerminalInput = z.infer<typeof updateTerminalSchema>;

function toTerminalView(terminal: {
  id: string;
  name: string;
  pairedAt: Date;
  lastSeenAt: Date | null;
  isActive: boolean;
}) {
  return {
    id: terminal.id,
    name: terminal.name,
    pairedAt: terminal.pairedAt,
    lastSeenAt: terminal.lastSeenAt,
    isActive: terminal.isActive,
  };
}

function generateDeviceSecret() {
  return crypto.randomBytes(24).toString("base64url");
}

export async function listTerminals(storeId: string) {
  const terminals = await prisma.terminal.findMany({ where: { storeId }, orderBy: { name: "asc" } });
  return terminals.map(toTerminalView);
}

export async function pairTerminal(storeId: string, input: CreateTerminalInput) {
  const deviceSecret = generateDeviceSecret();
  const terminal = await prisma.terminal.create({
    data: { storeId, name: input.name, deviceCredentialHash: await hashDeviceSecret(deviceSecret) },
  });
  return { ...toTerminalView(terminal), deviceSecret };
}

async function getTerminalOrThrow(storeId: string, terminalId: string) {
  const terminal = await prisma.terminal.findUnique({ where: { id: terminalId } });
  if (!terminal || terminal.storeId !== storeId) throw notFound("Terminal not found at this store");
  return terminal;
}

export async function updateTerminal(storeId: string, terminalId: string, input: UpdateTerminalInput) {
  await getTerminalOrThrow(storeId, terminalId);
  const terminal = await prisma.terminal.update({ where: { id: terminalId }, data: input });
  return toTerminalView(terminal);
}

export async function rotateTerminalSecret(storeId: string, terminalId: string) {
  await getTerminalOrThrow(storeId, terminalId);
  const deviceSecret = generateDeviceSecret();
  const terminal = await prisma.terminal.update({
    where: { id: terminalId },
    data: { deviceCredentialHash: await hashDeviceSecret(deviceSecret) },
  });
  return { ...toTerminalView(terminal), deviceSecret };
}
