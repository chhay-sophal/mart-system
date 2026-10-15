// Creates a real store + admin account directly in the database.
//
// This is deliberately separate from prisma/seed.ts, which creates a rich
// set of fake demo data (a hardcoded "Main Store", a publicly-known admin
// password, a terminal secret literally named "do-not-use-in-prod", and 21
// fake products) -- fine for local dev, but never safe to run against a
// real database. This script creates only the minimum needed to get into
// IMS for the first time: one real store and one real admin account with a
// randomly generated password + PIN, printed once. No demo products, no
// demo terminal -- a real terminal gets paired through IMS's own pairing
// flow (which already generates a real random device secret), and real
// products get added through IMS afterward.
//
// Usage: pnpm create-admin [--project <name>] -- prompts for the store
// name/code and admin username/name (plus an optional email) interactively.
// With --project lysin, the database is the one in .env.lysin.production
// instead of .env. Safe to re-run: upserts by store code / admin username,
// but will NOT reprint a password for a user that already exists.

import crypto from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { config } from "dotenv";
import { z, type ZodType } from "zod";
import { usernameSchema } from "../src/modules/staff/staff.schema";

const { values: args } = parseArgs({ options: { project: { type: "string" } } });

// Must load before src/env.ts is imported below: its `dotenv/config` never
// overrides a variable that's already set, so the project's values win and
// .env only fills in anything the project file leaves out.
if (args.project) {
  const envFile = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", `.env.${args.project}.production`);
  if (!existsSync(envFile)) {
    console.error(`No env file for project "${args.project}": ${envFile}`);
    process.exit(1);
  }
  config({ path: envFile, override: true, quiet: true });
  console.log(`Using ${path.basename(envFile)}\n`);
}

// Dynamic imports so they run after the project env file is loaded above.
const { hashPassword, hashPin } = await import("../src/lib/hash");
const { prisma } = await import("../src/prisma");

async function promptRequired(rl: readline.Interface, label: string): Promise<string> {
  while (true) {
    const value = (await rl.question(`${label}: `)).trim();
    if (value) return value;
    console.log("This is required.");
  }
}

async function promptValid<T>(rl: readline.Interface, label: string, schema: ZodType<T>, optional = false): Promise<T | undefined> {
  while (true) {
    const value = (await rl.question(`${label}: `)).trim();
    if (!value && optional) return undefined;
    const parsed = schema.safeParse(value);
    if (parsed.success) return parsed.data;
    console.log(parsed.error.issues[0]?.message ?? "Invalid value.");
  }
}

function randomPassword(): string {
  return crypto.randomBytes(18).toString("base64url"); // ~24 chars, URL-safe
}

function randomPin(): string {
  return String(crypto.randomInt(0, 10000)).padStart(4, "0");
}

async function main() {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  let storeName: string, storeCode: string, adminUsername: string, adminName: string, adminEmail: string | undefined;
  try {
    storeName = await promptRequired(rl, "Store name");
    storeCode = await promptRequired(rl, "Store code");
    adminUsername = (await promptValid(rl, "Admin username", usernameSchema))!;
    adminName = await promptRequired(rl, "Admin name");
    adminEmail = await promptValid(rl, "Admin email (optional)", z.string().email("Not a valid email."), true);
  } finally {
    rl.close();
  }

  const store = await prisma.store.upsert({
    where: { code: storeCode },
    create: { code: storeCode, name: storeName },
    update: { name: storeName },
  });

  const existingAdmin = await prisma.user.findUnique({ where: { username: adminUsername } });

  if (existingAdmin) {
    await prisma.userStoreRole.upsert({
      where: { userId_storeId: { userId: existingAdmin.id, storeId: store.id } },
      create: { userId: existingAdmin.id, storeId: store.id, role: "ADMIN" },
      update: { role: "ADMIN", isActive: true },
    });
    console.log(`\nStore ready: ${store.name} (${store.code})`);
    console.log(`Admin ${adminUsername} already existed -- left their password/PIN untouched.`);
    return;
  }

  const password = randomPassword();
  const pin = randomPin();

  const admin = await prisma.user.create({
    data: {
      username: adminUsername,
      email: adminEmail ?? null,
      name: adminName,
      isSuperAdmin: true,
      passwordHash: await hashPassword(password),
    },
  });

  await prisma.userStoreRole.create({
    data: { userId: admin.id, storeId: store.id, role: "ADMIN", pinHash: await hashPin(pin) },
  });

  console.log("\nAdmin created.\n");
  console.log(`Store:        ${store.name} (${store.code}) — id ${store.id}`);
  console.log(`Admin login:  ${adminUsername} / ${password}`);
  console.log(`Admin PIN:    ${pin}`);
  console.log("\nThese are shown once and are not recoverable -- save them now, then change the password on first login.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
