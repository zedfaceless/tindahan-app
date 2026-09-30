// Reminder timing, how schedules move forward after paying, and renewal reminders.
import {
  remindersFor, nextDueDate, renewalReminders, buildReminderPlan, dayString, MAX_REMINDERS,
} from "../lib/reminders";

const at = (d) => dayString(d) + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
const now = new Date(2026, 9, 1, 6, 0); // Oct 1 2026, 6:00 AM
const base = { id: "s", title: "Kuryente", amount: 850, kind: "out", scope: "business", remind_time: "07:00", done: false, deleted: false };

describe("when reminders go off", () => {
  test("monthly reminds 3, 2, 1 days before and on the due day, then a week of overdue nudges", () => {
    const r = remindersFor({ ...base, repeat: "monthly", due_date: "2026-10-15", anchor_day: 15 }, now);
    expect(r.slice(0, 4).map((x) => at(x.at))).toEqual([
      "2026-10-12 07:00", "2026-10-13 07:00", "2026-10-14 07:00", "2026-10-15 07:00",
    ]);
    expect(r).toHaveLength(4 + 7);
    expect(r[0].title).toBe("Kuryente due in 3 days");
    expect(r[2].title).toMatch(/due tomorrow/);
    expect(r[3].title).toMatch(/due today/);
    expect(r[0].body).toMatch(/^P 850\.00 to pay/);
  });

  test("weekly reminds only the day before", () => {
    const r = remindersFor({ ...base, repeat: "weekly", due_date: "2026-10-07", anchor_day: 7 }, now).map((x) => at(x.at));
    expect(r[0]).toBe("2026-10-06 07:00");
    expect(r).not.toContain("2026-10-07 07:00");
  });

  test("one time reminds the day before and on the day", () => {
    const r = remindersFor({ ...base, repeat: "none", due_date: "2026-10-05", anchor_day: 5 }, now).map((x) => at(x.at));
    expect(r.slice(0, 2)).toEqual(["2026-10-04 07:00", "2026-10-05 07:00"]);
  });

  test("daily reminds every day for the 30 day window", () => {
    const r = remindersFor({ ...base, repeat: "daily", due_date: "2026-10-01", anchor_day: 1 }, now);
    expect(at(r[0].at)).toBe("2026-10-01 07:00");
    expect(r).toHaveLength(31);
  });

  test("reminders already in the past are skipped", () => {
    const late = new Date(2026, 9, 12, 8, 0);
    const r = remindersFor({ ...base, repeat: "monthly", due_date: "2026-10-15", anchor_day: 15 }, late);
    expect(at(r[0].at)).toBe("2026-10-13 07:00");
  });

  test("done, deleted, and long overdue schedules set nothing", () => {
    expect(remindersFor({ ...base, repeat: "none", due_date: "2026-10-05", anchor_day: 5, done: true }, now)).toEqual([]);
    expect(remindersFor({ ...base, repeat: "monthly", due_date: "2026-10-05", anchor_day: 5, deleted: true }, now)).toEqual([]);
    expect(remindersFor({ ...base, repeat: "none", due_date: "2026-10-15", anchor_day: 15 }, new Date(2026, 9, 30))).toEqual([]);
  });
});

describe("the next due date after paying", () => {
  test.each([
    ["daily across a month end", { repeat: "daily", due_date: "2026-10-31", anchor_day: 31 }, "2026-11-01"],
    ["weekly across a year end", { repeat: "weekly", due_date: "2026-12-29", anchor_day: 29 }, "2027-01-05"],
    ["monthly on the 31st becomes Feb 28", { repeat: "monthly", due_date: "2027-01-31", anchor_day: 31 }, "2027-02-28"],
    ["and returns to the 31st in March", { repeat: "monthly", due_date: "2027-02-28", anchor_day: 31 }, "2027-03-31"],
    ["a leap year February has 29 days", { repeat: "monthly", due_date: "2028-01-30", anchor_day: 30 }, "2028-02-29"],
    ["a one time schedule has no next date", { repeat: "none", due_date: "2026-10-05", anchor_day: 5 }, null],
  ])("%s", (_name, schedule, expected) => {
    expect(nextDueDate(schedule)).toBe(expected);
  });
});

describe("premium renewal and the full plan", () => {
  const profile = { role: "vendor", premium_until: new Date(2026, 9, 20, 15, 0).toISOString() };

  test("renewal reminders 3 days and 1 day before premium ends", () => {
    expect(renewalReminders(profile, now).map((x) => at(x.at))).toEqual(["2026-10-17 09:00", "2026-10-19 09:00"]);
  });

  test("no renewal reminder for owner premium or free vendors", () => {
    expect(renewalReminders({ ...profile, role: "owner", owner_premium: true }, now)).toEqual([]);
    expect(renewalReminders({ role: "vendor", premium_until: null }, now)).toEqual([]);
  });

  test("never more than the phone limit, soonest first, each with its own id", () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ ...base, id: "d" + i, repeat: "daily", due_date: "2026-10-01", anchor_day: 1 }));
    const plan = buildReminderPlan(many, profile, now, true);
    expect(plan).toHaveLength(MAX_REMINDERS);
    expect(plan.every((p, i) => i === 0 || plan[i - 1].at <= p.at)).toBe(true);
    expect(new Set(plan.map((p) => p.id)).size).toBe(plan.length);
  });

  test("a free vendor gets no schedule alarms", () => {
    const many = [{ ...base, repeat: "daily", due_date: "2026-10-01", anchor_day: 1 }];
    expect(buildReminderPlan(many, { role: "vendor", premium_until: null }, now, false)).toEqual([]);
  });
});
