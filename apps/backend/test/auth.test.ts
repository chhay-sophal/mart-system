import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { buildApp } from "../src/app";
import { FIXTURE_PASSWORD, FIXTURE_PIN, FIXTURE_TERMINAL_SECRET, resetDatabase, seedFixtures } from "./helpers";

const app = buildApp();

beforeEach(async () => {
  await resetDatabase();
});

describe("POST /api/auth/login", () => {
  it("returns an access+refresh pair for correct credentials", async () => {
    await seedFixtures();
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "admin@test.local", password: FIXTURE_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.refreshToken).toEqual(expect.any(String));
  });

  it("rejects a wrong password with 401", async () => {
    await seedFixtures();
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "admin@test.local", password: "wrong-password" });
    expect(res.status).toBe(401);
  });

  it("rejects an unknown email with the same 401 (no enumeration)", async () => {
    await seedFixtures();
    const wrongPassword = await request(app)
      .post("/api/auth/login")
      .send({ email: "admin@test.local", password: "wrong" });
    const unknownEmail = await request(app)
      .post("/api/auth/login")
      .send({ email: "nobody@test.local", password: "wrong" });

    expect(unknownEmail.status).toBe(401);
    expect(unknownEmail.body.error).toBe(wrongPassword.body.error);
  });
});

describe("POST /api/auth/refresh", () => {
  it("rotates the refresh token and rejects replay of the old one", async () => {
    await seedFixtures();
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: "admin@test.local", password: FIXTURE_PASSWORD });

    const firstRefresh = login.body.refreshToken as string;

    const rotated = await request(app).post("/api/auth/refresh").send({ refreshToken: firstRefresh });
    expect(rotated.status).toBe(200);
    expect(rotated.body.refreshToken).not.toBe(firstRefresh);

    const replay = await request(app).post("/api/auth/refresh").send({ refreshToken: firstRefresh });
    expect(replay.status).toBe(401);

    // Reuse detection should have revoked the whole chain, including the token just issued.
    const secondRotated = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken: rotated.body.refreshToken });
    expect(secondRotated.status).toBe(401);
  });
});

describe("POST /api/auth/pin-login", () => {
  it("rejects a request with no terminal credentials before checking the PIN", async () => {
    const { store } = await seedFixtures();
    const res = await request(app)
      .post("/api/auth/pin-login")
      .send({ terminalId: "does-not-matter", storeId: store.id, pin: FIXTURE_PIN });
    expect(res.status).toBe(401);
  });

  it("accepts a valid device credential + correct PIN", async () => {
    const { store, terminal } = await seedFixtures();
    const res = await request(app)
      .post("/api/auth/pin-login")
      .set("X-Terminal-Id", terminal.id)
      .set("X-Terminal-Secret", FIXTURE_TERMINAL_SECRET)
      .send({ terminalId: terminal.id, storeId: store.id, pin: FIXTURE_PIN });

    expect(res.status).toBe(200);
    expect(res.body.sessionToken).toEqual(expect.any(String));
    expect(res.body.role).toBe("ADMIN");
  });

  it("rejects a valid device credential + wrong PIN", async () => {
    const { store, terminal } = await seedFixtures();
    const res = await request(app)
      .post("/api/auth/pin-login")
      .set("X-Terminal-Id", terminal.id)
      .set("X-Terminal-Secret", FIXTURE_TERMINAL_SECRET)
      .send({ terminalId: terminal.id, storeId: store.id, pin: "9999" });
    expect(res.status).toBe(401);
  });

  it("locks out after repeated failed attempts", async () => {
    const { store, terminal } = await seedFixtures();

    let last;
    for (let i = 0; i < 6; i++) {
      last = await request(app)
        .post("/api/auth/pin-login")
        .set("X-Terminal-Id", terminal.id)
        .set("X-Terminal-Secret", FIXTURE_TERMINAL_SECRET)
        .send({ terminalId: terminal.id, storeId: store.id, pin: "0000" });
    }
    expect(last!.status).toBe(429);
  });
});
