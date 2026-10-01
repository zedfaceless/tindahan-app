// Phone alarms. In Expo Go on Android the notification package must never load,
// since it crashes the app there. In the installed app, alarms are set properly.

function fakeNotifications() {
  const scheduled = [];
  const log = [];
  const perm = { granted: true };
  const channels = {};
  return {
    scheduled, log, perm, channels,
    SchedulableTriggerInputTypes: { DATE: "date", TIME_INTERVAL: "timeInterval" },
    AndroidImportance: { NONE: 2, HIGH: 6, MAX: 7 },
    setNotificationHandler: () => log.push("handler"),
    setNotificationChannelAsync: async (id, options) => { log.push("channel:" + id); channels[id] = { id, ...options }; },
    getNotificationChannelAsync: async (id) => channels[id] || null,
    getAllScheduledNotificationsAsync: async () => [...scheduled],
    getPermissionsAsync: async () => ({ ...perm }),
    requestPermissionsAsync: async () => ({ ...perm }),
    cancelAllScheduledNotificationsAsync: async () => { scheduled.length = 0; },
    cancelScheduledNotificationAsync: async (id) => {
      const i = scheduled.findIndex((x) => x.identifier === id);
      if (i >= 0) scheduled.splice(i, 1);
    },
    scheduleNotificationAsync: async (req) => { scheduled.push(req); return req.identifier || "x"; },
  };
}

const linking = jest.fn(async () => {});

// load lib/notifications fresh, as a given kind of app on a given phone
function load(environment, os) {
  let mod;
  const notif = fakeNotifications();
  const loaded = { notifications: false };
  // the app loads expo-notifications on first use, so clear every cached module first,
  // otherwise a later test would still talk to an earlier test's fake phone
  jest.resetModules();
  jest.isolateModules(() => {
    jest.doMock("react-native", () => ({ Platform: { OS: os }, Linking: { openSettings: linking } }));
    jest.doMock("expo-constants", () => ({
      __esModule: true, default: { executionEnvironment: environment },
      ExecutionEnvironment: { StoreClient: "storeClient", Standalone: "standalone", Bare: "bare" },
    }));
    jest.doMock("expo-notifications", () => { loaded.notifications = true; return notif; });
    mod = require("../lib/notifications");
  });
  return { N: mod, notif, loaded };
}

const inDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d; };
const ds = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const kuryente = {
  id: "k1", title: "Kuryente", amount: 850, kind: "out", scope: "business", due_date: ds(inDays(10)),
  anchor_day: inDays(10).getDate(), remind_time: "07:00", repeat: "monthly", done: false, deleted: false,
};
const profile = { role: "vendor", premium_until: inDays(20).toISOString() };

describe("inside Expo Go on Android", () => {
  test("the notification package is never loaded, and every action is skipped safely", async () => {
    const { N, loaded } = load("storeClient", "android");
    expect(N.alarmsUnavailable).toBe("expo-go");
    expect(await N.refreshReminders({ userId: "u", schedules: [kuryente], profile, premium: true }))
      .toEqual({ count: 0, reason: "expo-go" });
    expect(await N.askPermission()).toBe(false);
    expect(await N.testReminder("u")).toBe(false);
    await N.notifyNow("Welcome", "hi");
    expect(await N.sendNow("u")).toBe(false);
    expect(await N.reminderHealth("u")).toEqual({ supported: false, reason: "expo-go" });
    expect(loaded.notifications).toBe(false);
  });
});

describe("on the web", () => {
  test("alarms are reported as unavailable", async () => {
    const { N } = load("standalone", "web");
    expect(N.alarmsUnavailable).toBe("web");
    expect((await N.refreshReminders({ userId: "u", schedules: [], profile, premium: true })).reason).toBe("web");
  });
});

describe("in the installed app", () => {
  let N, notif;
  beforeEach(() => { ({ N, notif } = load("standalone", "android")); });

  test("alarms are set on the sound channel, with the renewal reminder", async () => {
    const r = await N.refreshReminders({ userId: "a", schedules: [kuryente], profile, premium: true });
    expect(r.reason).toBeNull();
    expect(r.count).toBeGreaterThan(0);
    expect(r.count).toBe(notif.scheduled.length);
    expect(notif.log).toEqual(expect.arrayContaining(["channel:tindahan-reminders", "channel:tindahan-reminders-quiet"]));
    expect(notif.scheduled.every((s) => s.trigger.type === "date" && s.trigger.channelId === "tindahan-reminders")).toBe(true);
    expect(notif.scheduled.some((s) => s.identifier.startsWith("renewal_"))).toBe(true);
  });

  test("sound off moves alarms to the quiet channel", async () => {
    await N.saveReminderSettings("b", { enabled: true, sound: false });
    await N.refreshReminders({ userId: "b", schedules: [kuryente], profile, premium: true });
    expect(notif.scheduled.length).toBeGreaterThan(0);
    expect(notif.scheduled.every((s) => s.trigger.channelId === "tindahan-reminders-quiet" && s.content.sound === false)).toBe(true);
  });

  test("reminders off clears every alarm", async () => {
    await N.saveReminderSettings("c", { enabled: false, sound: true });
    expect((await N.refreshReminders({ userId: "c", schedules: [kuryente], profile, premium: true })).reason).toBe("off");
    expect(notif.scheduled).toHaveLength(0);
  });

  test("no permission means no alarms, and the reason is reported", async () => {
    notif.perm.granted = false;
    expect((await N.refreshReminders({ userId: "d", schedules: [kuryente], profile, premium: true })).reason).toBe("permission");
    expect(notif.scheduled).toHaveLength(0);
  });

  test("two refreshes at the same time leave no duplicate alarms", async () => {
    await Promise.all([1, 2].map(() => N.refreshReminders({ userId: "e", schedules: [kuryente], profile, premium: true })));
    const ids = notif.scheduled.map((s) => s.identifier);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("after premium lapses, only the renewal reminder remains", async () => {
    await N.refreshReminders({ userId: "f", schedules: [kuryente], profile, premium: false });
    expect(notif.scheduled.length).toBeGreaterThan(0);
    expect(notif.scheduled.every((s) => s.identifier.startsWith("renewal_"))).toBe(true);
  });

  test("send now shows a notification at once, on the reminders channel, with no schedule", async () => {
    expect(await N.sendNow("g")).toBe(true);
    expect(notif.scheduled).toHaveLength(1);
    expect(notif.scheduled[0].trigger).toEqual({ channelId: "tindahan-reminders" });
    expect(notif.scheduled[0].content.title).toBe("Tindahan notification test");
  });

  test("the status check reports permission, the category, and how many reminders wait", async () => {
    await N.refreshReminders({ userId: "h", schedules: [kuryente], profile, premium: true });
    const health = await N.reminderHealth("h");
    expect(health.waiting).toBeGreaterThan(0);
    expect(health).toEqual({ supported: true, enabled: true, permission: true, categoryOn: true, waiting: notif.scheduled.length });
  });

  test("a category switched off in phone settings is reported as off", async () => {
    await N.reminderHealth("i");
    notif.channels["tindahan-reminders"].importance = notif.AndroidImportance.NONE;
    expect((await N.reminderHealth("i")).categoryOn).toBe(false);
  });

  test("blocked notifications are reported as blocked", async () => {
    notif.perm.granted = false;
    expect((await N.reminderHealth("j")).permission).toBe(false);
  });

  test("the settings button opens Tindahan's page in phone settings", async () => {
    await N.openPhoneSettings();
    expect(linking).toHaveBeenCalled();
  });

  test("a test reminder survives the reminder refresh that follows it, the bug found on a real phone", async () => {
    expect(await N.testReminder("k")).toBe(true);
    await N.refreshReminders({ userId: "k", schedules: [kuryente], profile, premium: true });
    const ids = notif.scheduled.map((x) => x.identifier || "");
    expect(ids.some((id) => id.startsWith("test_"))).toBe(true);
    expect(ids.some((id) => id.startsWith("k1_"))).toBe(true);
  });

  test("a refresh still removes old schedule reminders that no longer apply", async () => {
    await N.refreshReminders({ userId: "l", schedules: [kuryente], profile, premium: true });
    expect(notif.scheduled.some((x) => x.identifier.startsWith("k1_"))).toBe(true);
    await N.refreshReminders({ userId: "l", schedules: [], profile, premium: true });
    expect(notif.scheduled.some((x) => (x.identifier || "").startsWith("k1_"))).toBe(false);
  });
});
