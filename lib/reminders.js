// lib/reminders.js
// When each schedule's reminders go off, and how a schedule moves forward
// after it is paid. Pure calculation, no phone or network, so it is easy to test.
//
// The rules, all at the vendor's chosen reminder time:
//   daily     every day
//   weekly    the day before the due date
//   monthly   3, 2, and 1 day before the due date, and on the due date
//   one time  the day before the due date, and on the due date
//   overdue   every day for up to 7 days after the due date, until paid
// Premium also gets a renewal reminder 3 days and 1 day before it ends.

export const REPEATS = ["none", "daily", "weekly", "monthly"];
const OVERDUE_DAYS = 7;
const RENEWAL_HOUR = 9;
// phones limit how many alarms one app may hold, iPhones allow 64, so keep under that
export const MAX_REMINDERS = 60;
// how far ahead alarms are set, the app refreshes them every time it opens
export const WINDOW_DAYS = 30;

// "2026-10-15" into a local date at midnight
export function parseDay(value) {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// a local date into "2026-10-15"
export function dayString(date) {
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return date.getFullYear() + "-" + m + "-" + d;
}

// a date some whole days later, safe across month ends
export function addDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

// the same day next month, or the last day of a shorter month, 31 becomes Feb 28
export function nextMonthly(date, anchorDay) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const lastDay = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(anchorDay, lastDay));
}

// the next due date after a repeating schedule is paid, or null for one time schedules
export function nextDueDate(schedule) {
  const due = parseDay(schedule.due_date);
  if (schedule.repeat === "daily") return dayString(addDays(due, 1));
  if (schedule.repeat === "weekly") return dayString(addDays(due, 7));
  if (schedule.repeat === "monthly") return dayString(nextMonthly(due, schedule.anchor_day));
  return null;
}

// a day at the reminder time, "07:30" on Oct 15 becomes Oct 15 7:30 AM
function atTime(day, remindTime) {
  const [h, m] = remindTime.split(":").map(Number);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m);
}

// how many whole days from today to the due date, negative when overdue
export function daysUntilDue(schedule, now) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((parseDay(schedule.due_date) - today) / 86400000);
}

// every reminder for one schedule between now and the end of the window
export function remindersFor(schedule, now) {
  if (schedule.done || schedule.deleted) return [];
  const due = parseDay(schedule.due_date);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const windowEnd = addDays(today, WINDOW_DAYS);
  const days = [];

  if (schedule.repeat === "daily") {
    // every day from the due date on, an unpaid daily bill keeps reminding
    const start = due > today ? due : today;
    const when = due < today ? "overdue" : "today";
    for (let d = start; d <= windowEnd; d = addDays(d, 1)) {
      days.push({ day: d, when: when });
    }
  } else {
    const before = schedule.repeat === "weekly" ? [1]
      : schedule.repeat === "monthly" ? [3, 2, 1, 0]
      : [1, 0];
    before.forEach((n) => {
      days.push({ day: addDays(due, -n), when: n === 0 ? "today" : n + "before" });
    });
    // unpaid after the due date, a daily nudge for up to a week
    for (let n = 1; n <= OVERDUE_DAYS; n += 1) {
      days.push({ day: addDays(due, n), when: "overdue" });
    }
  }

  return days
    .map(({ day, when }) => ({ at: atTime(day, schedule.remind_time), when }))
    .filter((r) => r.at > now && r.at <= atTime(windowEnd, "23:59"))
    .map((r) => ({
      id: schedule.id + "_" + dayString(r.at),
      at: r.at,
      title: reminderTitle(schedule, r.when),
      body: reminderBody(schedule),
    }));
}

// the headline of a reminder, in Tagalog and English like the rest of the app
function reminderTitle(schedule, when) {
  if (when === "today") return schedule.title + ", due today, ngayon na";
  if (when === "overdue") return schedule.title + " is overdue, lampas na";
  const n = Number(when.replace("before", ""));
  return schedule.title + " due " + (n === 1 ? "tomorrow, bukas" : "in " + n + " days");
}

// the second line, the amount and what to do
function reminderBody(schedule) {
  const amount = "P " + Number(schedule.amount).toLocaleString("en-PH", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
  const verb = schedule.kind === "in" ? "to receive" : "to pay";
  return amount + " " + verb + ". Open Tindahan and tap Paid once done.";
}

// renewal reminders 3 days and 1 day before paid premium ends, not for owner premium
export function renewalReminders(profile, now) {
  if (!profile || !profile.premium_until) return [];
  if (profile.role === "owner" && profile.owner_premium) return [];
  const ends = new Date(profile.premium_until);
  if (ends <= now) return [];
  const endDay = new Date(ends.getFullYear(), ends.getMonth(), ends.getDate());
  return [3, 1]
    .map((n) => {
      const d = addDays(endDay, -n);
      return {
        id: "renewal_" + n,
        at: new Date(d.getFullYear(), d.getMonth(), d.getDate(), RENEWAL_HOUR, 0),
        title: "Premium ends in " + n + (n === 1 ? " day" : " days"),
        body: "When premium ends, schedules and reminders stop. Your records stay safe.",
      };
    })
    .filter((r) => r.at > now);
}

// everything to set as alarms, soonest first, kept under the phone's limit
export function buildReminderPlan(schedules, profile, now, premium) {
  const fromSchedules = premium
    ? schedules.flatMap((s) => remindersFor(s, now))
    : [];
  return [...fromSchedules, ...renewalReminders(profile, now)]
    .sort((a, b) => a.at - b.at)
    .slice(0, MAX_REMINDERS);
}
