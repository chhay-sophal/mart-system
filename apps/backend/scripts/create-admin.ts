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
// Usage: pnpm create-admin -- prompts for the store name/code and admin
// email/name interactively. Safe to re-run: upserts by store code / admin
// email, but will NOT reprint a password for a user that already exists.

import crypto from "node:crypto";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { hashPassword, hashPin } from "../src/lib/hash";
import { prisma } from "../src/prisma";

async function promptRequired(rl: readline.Interface, label: string): Promise<string> {
  while (true) {
    const value = (await rl.question(`${label}: `)).trim();
    if (value) return value;
    console.log("This is required.");
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
  let storeName: string, storeCode: string, adminEmail: string, adminName: string;
  try {
    storeName = await promptRequired(rl, "Store name");
    storeCode = await promptRequired(rl, "Store code");
    adminEmail = await promptRequired(rl, "Admin email");
    adminName = await promptRequired(rl, "Admin name");
  } finally {
    rl.close();
  }

  const store = await prisma.store.upsert({
    where: { code: storeCode },
    create: { code: storeCode, name: storeName },
    update: { name: storeName },
  });

  const existingAdmin = await prisma.user.findUnique({ where: { email: adminEmail } });

  if (existingAdmin) {
    await prisma.userStoreRole.upsert({
      where: { userId_storeId: { userId: existingAdmin.id, storeId: store.id } },
      create: { userId: existingAdmin.id, storeId: store.id, role: "ADMIN" },
      update: { role: "ADMIN", isActive: true },
    });
    console.log(`\nStore ready: ${store.name} (${store.code})`);
    console.log(`Admin ${adminEmail} already existed -- left their password/PIN untouched.`);
    return;
  }

  const password = randomPassword();
  const pin = randomPin();

  const admin = await prisma.user.create({
    data: {
      email: adminEmail,
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
  console.log(`Admin login:  ${adminEmail} / ${password}`);
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
