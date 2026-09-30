import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { buildApp } from "../src/app";
import { FIXTURE_PASSWORD, resetDatabase, seedFixtures } from "./helpers";

const app = buildApp();

beforeEach(async () => {
  await resetDatabase();
});

async function loginAsAdmin() {
  const res = await request(app)
    .post("/api/auth/login")
    .send({ email: "admin@test.local", password: FIXTURE_PASSWORD });
  return res.body.accessToken as string;
}

const HOURS = {
  mon: { open: "07:00", close: "22:00" },
  tue: { open: "07:00", close: "22:00" },
  wed: { open: "07:00", close: "22:00" },
  thu: { open: "07:00", close: "22:00" },
  fri: { open: "07:00", close: "24:00" },
  sat: { open: "18:00", close: "02:00" },
  sun: null,
};

describe("store opening hours and location", () => {
  it("saves hours and a map pin, shows them publicly, and clears them again", async () => {
    const { store } = await seedFixtures();
    const token = await loginAsAdmin();

    const save = await request(app)
      .patch(`/api/stores/${store.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ openingHours: HOURS, latitude: 11.5564, longitude: 104.9282 });
    expect(save.status).toBe(200);
    expect(save.body).toMatchObject({ openingHours: HOURS, latitude: 11.5564, longitude: 104.9282 });

    const pub = await request(app).get(`/api/public/stores/${store.id}`);
    expect(pub.body).toMatchObject({ openingHours: HOURS, latitude: 11.5564, longitude: 104.9282 });

    const clear = await request(app)
      .patch(`/api/stores/${store.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ openingHours: null, latitude: null, longitude: null });
    expect(clear.status).toBe(200);
    expect(clear.body).toMatchObject({ openingHours: null, latitude: null, longitude: null });
  });

  it("leaves hours untouched when a patch doesn't mention them", async () => {
    const { store } = await seedFixtures();
    const token = await loginAsAdmin();
    await request(app).patch(`/api/stores/${store.id}`).set("Authorization", `Bearer ${token}`).send({ openingHours: HOURS });

    const rename = await request(app)
      .patch(`/api/stores/${store.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Renamed Branch" });
    expect(rename.status).toBe(200);
    expect(rename.body).toMatchObject({ name: "Renamed Branch", openingHours: HOURS });
  });

  it("rejects malformed hours and half a map pin", async () => {
    const { store } = await seedFixtures();
    const token = await loginAsAdmin();
    const patch = (body: object) =>
      request(app).patch(`/api/stores/${store.id}`).set("Authorization", `Bearer ${token}`).send(body);

    expect((await patch({ openingHours: { ...HOURS, mon: { open: "7am", close: "22:00" } } })).status).toBe(400);
    expect((await patch({ openingHours: { ...HOURS, mon: { open: "09:00", close: "09:00" } } })).status).toBe(400);
    expect((await patch({ openingHours: { ...HOURS, mon: { open: "24:00", close: "02:00" } } })).status).toBe(400);
    const { sun: _omitted, ...missingSunday } = HOURS;
    expect((await patch({ openingHours: missingSunday })).status).toBe(400);
    expect((await patch({ latitude: 11.5 })).status).toBe(400);
    expect((await patch({ latitude: 11.5, longitude: null })).status).toBe(400);
    expect((await patch({ latitude: 95, longitude: 104.9 })).status).toBe(400);
  });
});
