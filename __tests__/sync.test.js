// Offline first storage and two way sync, the rules that keep vendor money safe.
// The tests run in order and share one fake server, like a vendor's real day.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { tables, account, net, reset } from "./helpers/fakeSupabase";
import {
  readLocal, updateLocal, readSchedules, updateSchedules, syncRecords, readProfile, isPremium, newId, nowIso,
} from "../lib/sync";

const U = "user-1";
const days = (n) => new Date(Date.now() + n * 86400000).toISOString();
const mk = (amount, kind = "in", scope = "business") => ({
  id: newId(), record_date: "2026-09-30", kind, scope, amount, description: "x",
  updated_at: nowIso(), deleted: false, synced: false,
});

beforeAll(async () => {
  reset();
  await AsyncStorage.clear();
});

describe("records", () => {
  test("an old style record gets a stable id once", async () => {
    await AsyncStorage.setItem("tindahan_records_" + U,
      JSON.stringify([{ id: "1727000000000", date: "2026-09-30", kind: "out", amount: 120, description: "pamasahe" }]));
    const first = await readLocal(U);
    const second = await readLocal(U);
    expect(first[0].id).toHaveLength(36);
    expect(second[0].id).toBe(first[0].id);
  });

  test("offline, a sale is kept on the phone and sync reports offline", async () => {
    net.online = false;
    await updateLocal(U, (l) => [mk(500), ...l]);
    await expect(syncRecords(U)).rejects.toThrow();
    expect((await readLocal(U)).filter((r) => !r.synced)).toHaveLength(2);
    net.online = true;
  });

  test("back online, everything is pushed and the account is saved for offline use", async () => {
    const res = await syncRecords(U);
    expect(tables.records.size).toBe(2);
    expect(res.records.every((r) => r.synced)).toBe(true);
    expect(res.heldBack).toBe(0);
    expect(res.refused).toBe(false);
    expect((await readProfile(U)).disabled).toBe(false);
    expect(isPremium(res.profile)).toBe(false);
  });

  test("a record saved while a sync is running is not lost", async () => {
    const running = syncRecords(U);
    await updateLocal(U, (l) => [mk(77), ...l]);
    await running;
    await syncRecords(U);
    expect(await readLocal(U)).toHaveLength(3);
    expect(tables.records.size).toBe(3);
  });

  test("a premium vendor syncs personal money", async () => {
    account.premium_until = days(10);
    await updateLocal(U, (l) => [mk(300, "in", "personal"), mk(80, "out", "personal"), ...l]);
    const res = await syncRecords(U);
    expect(isPremium(res.profile)).toBe(true);
    expect(tables.records.size).toBe(5);
    expect(res.heldBack).toBe(0);
  });

  test("when premium lapses offline, personal money waits but business sales still sync", async () => {
    net.online = false;
    await updateLocal(U, (l) => [mk(200, "out", "personal"), mk(900, "in"), ...l]);
    account.premium_until = days(-1);
    net.online = true;
    const res = await syncRecords(U);
    expect(isPremium(res.profile)).toBe(false);
    expect(res.heldBack).toBe(1);
    expect(tables.records.size).toBe(6);
    const waiting = (await readLocal(U)).filter((r) => !r.synced);
    expect(waiting).toHaveLength(1);
    expect(waiting[0].scope).toBe("personal");
  });

  test("a lapsed vendor can still delete an old personal record", async () => {
    const old = [...tables.records.values()].find((r) => r.scope === "personal");
    await updateLocal(U, (l) => l.map((r) => (r.id === old.id ? { ...r, deleted: true, updated_at: nowIso(), synced: false } : r)));
    await syncRecords(U);
    expect(tables.records.get(old.id).deleted).toBe(true);
  });

  test("after renewal the waiting personal record syncs", async () => {
    account.premium_until = days(30);
    const res = await syncRecords(U);
    expect(res.heldBack).toBe(0);
    expect(tables.records.size).toBe(7);
    expect((await readLocal(U)).every((r) => r.synced)).toBe(true);
  });

  test("a disabled account is reported, its new record stays safe, and syncs after enabling", async () => {
    account.disabled = true;
    await updateLocal(U, (l) => [mk(55), ...l]);
    let res = await syncRecords(U);
    expect(res.refused).toBe(true);
    expect(res.profile.disabled).toBe(true);
    expect((await readLocal(U)).some((r) => !r.synced && r.amount === 55)).toBe(true);
    account.disabled = false;
    res = await syncRecords(U);
    expect(res.refused).toBe(false);
    expect(tables.records.size).toBe(8);
  });
});

describe("old app versions", () => {
  const OLD = "old-phone";

  test("old personal expenses and withdrawals convert on first load, once", async () => {
    await AsyncStorage.setItem("tindahan_records_" + OLD, JSON.stringify([
      { id: "11111111-1111-1111-1111-111111111111", record_date: "2026-10-01", kind: "personal", amount: 80, description: "gamot", updated_at: "2026-10-01T00:00:00.000Z" },
      { id: "22222222-2222-2222-2222-222222222222", record_date: "2026-10-01", kind: "withdrawal", amount: 200, description: "kinuha", updated_at: "2026-10-01T00:00:00.000Z" },
      { id: "33333333-3333-3333-3333-333333333333", record_date: "2026-10-01", kind: "in", amount: 500, description: "benta", updated_at: "2026-10-01T00:00:00.000Z" },
    ]));
    const rows = Object.fromEntries((await readLocal(OLD)).map((r) => [r.description, r]));
    expect([rows.gamot.scope, rows.gamot.kind]).toEqual(["personal", "out"]);
    expect([rows.kinuha.scope, rows.kinuha.kind]).toEqual(["business", "out"]);
    expect([rows.benta.scope, rows.benta.kind]).toEqual(["business", "in"]);
    // the converted rows are saved on the phone, so the next read is identical
    const stored = JSON.parse(await AsyncStorage.getItem("tindahan_records_" + OLD));
    expect(stored.map((r) => r.kind).sort()).toEqual(["in", "out", "out"]);
    expect(await readLocal(OLD)).toEqual(Object.values(rows).sort((x, y) => (x.id < y.id ? -1 : 1)));
  });

  test("an old personal schedule converts too", async () => {
    await AsyncStorage.setItem("tindahan_schedules_" + OLD, JSON.stringify([
      { id: "44444444-4444-4444-4444-444444444444", title: "Tuition", amount: 1500, kind: "personal", due_date: "2026-10-15", anchor_day: 15, remind_time: "07:00", repeat: "monthly", done: false, updated_at: "2026-10-01T00:00:00.000Z" },
    ]));
    const [s] = await readSchedules(OLD);
    expect([s.scope, s.kind]).toEqual(["personal", "out"]);
  });
});

describe("schedules", () => {
  const S = "user-9";
  const sched = (title) => ({
    id: newId(), title, amount: 850, kind: "out", scope: "business", due_date: "2026-10-15", anchor_day: 15,
    remind_time: "07:00", repeat: "monthly", done: false, updated_at: nowIso(), deleted: false, synced: false,
  });

  beforeAll(() => { account.premium_until = days(30); account.disabled = false; });

  test("a premium vendor's schedule syncs", async () => {
    await updateSchedules(S, (l) => [sched("Kuryente"), ...l]);
    const res = await syncRecords(S);
    expect(res.schedules.length).toBeGreaterThan(0);
    expect(res.schedules.every((s) => s.synced)).toBe(true);
    expect([...tables.schedules.values()].some((s) => s.title === "Kuryente")).toBe(true);
  });

  test("after a lapse, a schedule edit waits but a money record still syncs", async () => {
    net.online = false;
    await updateSchedules(S, (l) => l.map((s) => ({ ...s, amount: 900, updated_at: nowIso(), synced: false })));
    await updateLocal(S, (l) => [{ ...mk(900, "out"), description: "Kuryente paid" }, ...l]);
    account.premium_until = days(-1);
    net.online = true;
    const res = await syncRecords(S);
    expect(res.heldBack).toBe(1);
    expect([...tables.records.values()].some((r) => r.description === "Kuryente paid")).toBe(true);
    expect((await readSchedules(S))[0]).toMatchObject({ amount: 900, synced: false });
  });

  test("a lapsed vendor can still delete a schedule", async () => {
    await updateSchedules(S, (l) => l.map((s) => ({ ...s, deleted: true, updated_at: nowIso(), synced: false })));
    const res = await syncRecords(S);
    expect(res.heldBack).toBe(0);
    expect([...tables.schedules.values()].find((s) => s.title === "Kuryente").deleted).toBe(true);
  });

  test("a new phone gets its schedules back, including the delete", async () => {
    account.premium_until = days(30);
    await updateSchedules(S, (l) => [sched("Stall rent"), ...l]);
    await syncRecords(S);
    await AsyncStorage.clear();
    const res = await syncRecords(S);
    const titles = Object.fromEntries(res.schedules.map((s) => [s.title, s]));
    expect(Object.keys(titles).sort()).toEqual(["Kuryente", "Stall rent"]);
    expect(titles.Kuryente.deleted).toBe(true);
  });
});

describe("who is premium", () => {
  const soon = days(5);
  test.each([
    ["owner with owner premium on", { role: "owner", owner_premium: true }, true],
    ["owner with it switched off", { role: "owner", owner_premium: false }, false],
    ["owner switched off but paid", { role: "owner", owner_premium: false, premium_until: soon }, true],
    ["a vendor cannot use owner premium", { role: "vendor", owner_premium: true }, false],
    ["a lapsed vendor", { role: "vendor", premium_until: days(-1) }, false],
    ["no account loaded yet", null, false],
  ])("%s", (_name, profile, expected) => {
    expect(isPremium(profile)).toBe(expected);
  });
});
