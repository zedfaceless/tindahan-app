// ScheduleScreen.js
// Premium schedules. Vendors set up their own bills and expected payments,
// kuryente, stall rent, a supplier, with a due date, a reminder time, and an
// optional daily, weekly, or monthly repeat. Tapping Paid adds the money record
// automatically and moves a repeating schedule to its next due date.

import { useState } from "react";
import { StyleSheet, Text, View, TextInput, TouchableOpacity, Platform } from "react-native";
import { notify, confirmAction } from "./lib/notify";
import { updateLocal, updateSchedules, newId, nowIso } from "./lib/sync";
import { nextDueDate, daysUntilDue, parseDay, dayString, addDays } from "./lib/reminders";

const SLATE = "#1E293B";
const CARD = "#FFFFFF";
const LINE = "#E2E8F0";
const MUTED = "#64748B";
const EMERALD = "#059669";
const INDIGO = "#2563EB";
const CRIMSON = "#DC2626";

// The four record types a schedule can create when paid
const TYPES = [
  ["out", "Money out"],
  ["in", "Money in"],
  ["withdrawal", "Withdrawal"],
  ["personal", "Personal"],
];
const TYPE_LABEL = { out: "money out", in: "money in", withdrawal: "withdrawal", personal: "personal expense" };
const REPEAT_LABEL = { daily: "Daily", weekly: "Weekly", monthly: "Monthly" };

// What each repeat means, shown under the form so vendors know what to expect
const REMINDER_RULE = {
  none: "You will be reminded the day before and on the due date.",
  daily: "You will be reminded every day.",
  weekly: "You will be reminded the day before each due date.",
  monthly: "You will be reminded 3 days, 2 days, and 1 day before, and on the due date.",
};

function pesos(amount) {
  return "P " + Number(amount).toLocaleString("en-PH", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}

function longDate(value) {
  return parseDay(value).toLocaleDateString("en-PH", {
    weekday: "short", year: "numeric", month: "short", day: "numeric",
  });
}

// "07:30" shown as 7:30 AM
function timeLabel(value) {
  const [h, m] = value.split(":").map(Number);
  const hour = h % 12 === 0 ? 12 : h % 12;
  return hour + ":" + String(m).padStart(2, "0") + (h < 12 ? " AM" : " PM");
}

// how soon a schedule is due, in plain words
function dueWords(schedule) {
  const n = daysUntilDue(schedule, new Date());
  if (n === 0) return "Due today";
  if (n === 1) return "Due tomorrow";
  if (n > 1) return "Due in " + n + " days";
  return "Overdue by " + -n + (n === -1 ? " day" : " days");
}

// A blank form, due today at 7 AM, no repeat
function emptyForm() {
  return {
    id: null, title: "", amount: "", kind: "out",
    due: dayString(new Date()), time: "07:00", repeats: false, repeat: "monthly",
  };
}

export default function ScheduleScreen({ user, schedules, onSchedules, onRecords, afterChange, header, upgrade, premium }) {
  const [form, setForm] = useState(null);
  const [paying, setPaying] = useState(null);
  const [payAmount, setPayAmount] = useState("");

  // ----- form helpers -----

  function change(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  // move the due date by days or months, never into the past
  function moveDue(days, months) {
    const current = parseDay(form.due);
    let next = months
      ? new Date(current.getFullYear(), current.getMonth() + months, 1)
      : addDays(current, days);
    if (months) {
      const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
      next = new Date(next.getFullYear(), next.getMonth(), Math.min(current.getDate(), lastDay));
    }
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    change("due", dayString(next < start ? start : next));
  }

  // move the reminder time by hours or 15 minute steps, wrapping around the day
  function moveTime(hours, minutes) {
    const [h, m] = form.time.split(":").map(Number);
    const total = (((h + hours) * 60 + m + minutes) % 1440 + 1440) % 1440;
    change("time", String(Math.floor(total / 60)).padStart(2, "0") + ":" + String(total % 60).padStart(2, "0"));
  }

  // open the form for a new schedule, or to edit one
  function openForm(schedule) {
    setPaying(null);
    if (!schedule) {
      setForm(emptyForm());
      return;
    }
    setForm({
      id: schedule.id, title: schedule.title, amount: String(schedule.amount),
      kind: schedule.kind, due: schedule.due_date, time: schedule.remind_time,
      repeats: schedule.repeat !== "none",
      repeat: schedule.repeat === "none" ? "monthly" : schedule.repeat,
    });
  }

  // check the form and save the schedule on the phone, then sync and reset alarms
  async function saveForm() {
    const title = form.title.trim();
    const amount = parseFloat(form.amount);
    if (title.length === 0) {
      notify("Name needed", "Type what this is for, like Kuryente or stall rent.");
      return;
    }
    if (isNaN(amount) || amount <= 0) {
      notify("Check the amount", "Please enter a number bigger than zero.");
      return;
    }
    const row = {
      id: form.id || newId(),
      title: title,
      amount: amount,
      kind: form.kind,
      due_date: form.due,
      anchor_day: parseDay(form.due).getDate(),
      remind_time: form.time,
      repeat: form.repeats ? form.repeat : "none",
      done: false,
      updated_at: nowIso(),
      deleted: false,
      synced: false,
    };
    const next = await updateSchedules(user.id, (list) =>
      form.id ? list.map((s) => (s.id === form.id ? row : s)) : [row, ...list]
    );
    onSchedules(next);
    setForm(null);
    afterChange();
    notify("Saved", title + ", " + dueWords(row).toLowerCase() + ". " + REMINDER_RULE[row.repeat]);
  }

  // ----- paying -----

  function startPaying(schedule) {
    setForm(null);
    setPaying(schedule.id);
    setPayAmount(String(schedule.amount));
  }

  // add the money record, then move the schedule forward or mark it done
  async function savePayment(schedule) {
    const amount = parseFloat(payAmount);
    if (isNaN(amount) || amount <= 0) {
      notify("Check the amount", "Please enter a number bigger than zero.");
      return;
    }
    const record = {
      id: newId(),
      record_date: dayString(new Date()),
      kind: schedule.kind,
      amount: amount,
      description: schedule.title,
      updated_at: nowIso(),
      deleted: false,
      synced: false,
    };
    onRecords(await updateLocal(user.id, (list) => [record, ...list]));
    const next = nextDueDate(schedule);
    onSchedules(await updateSchedules(user.id, (list) =>
      list.map((s) => (s.id !== schedule.id ? s : {
        ...s,
        due_date: next || s.due_date,
        done: next === null,
        updated_at: nowIso(),
        synced: false,
      }))
    ));
    setPaying(null);
    afterChange();
    notify(
      "Paid, bayad na",
      pesos(amount) + " " + TYPE_LABEL[schedule.kind] + " added to today's records."
        + (next ? " Next due " + longDate(next) + "." : "")
    );
  }

  // delete a schedule, marked deleted so the delete syncs too
  function remove(schedule) {
    confirmAction("Delete this schedule?", schedule.title + ", " + pesos(schedule.amount), "Delete", async () => {
      onSchedules(await updateSchedules(user.id, (list) =>
        list.map((s) => (s.id === schedule.id ? { ...s, deleted: true, updated_at: nowIso(), synced: false } : s))
      ));
      afterChange();
    });
  }

  // ----- screens -----

  const active = schedules
    .filter((s) => !s.deleted && !s.done)
    .sort((a, b) => (a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0));
  const doneCount = schedules.filter((s) => !s.deleted && s.done).length;

  function renderForm() {
    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{form.id ? "Edit schedule" : "New schedule"}</Text>

        <Text style={styles.label}>Para saan, what is it for</Text>
        <TextInput
          style={styles.input}
          value={form.title}
          onChangeText={(v) => change("title", v)}
          placeholder="halimbawa, Kuryente, stall rent"
        />

        <Text style={styles.label}>Halaga, amount</Text>
        <TextInput
          style={styles.input}
          value={form.amount}
          onChangeText={(v) => change("amount", v)}
          keyboardType="numeric"
          placeholder="0.00"
        />

        <Text style={styles.label}>When paid, add it as</Text>
        <View style={styles.chipRow}>
          {TYPES.map(([key, label]) => (
            <TouchableOpacity
              key={key}
              style={[styles.chip, form.kind === key && styles.chipActive]}
              onPress={() => change("kind", key)}
            >
              <Text style={[styles.chipText, form.kind === key && styles.chipTextActive]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>Due date</Text>
        <Text style={styles.bigValue}>{longDate(form.due)}</Text>
        <View style={styles.stepRow}>
          <TouchableOpacity style={styles.step} onPress={() => moveDue(-1, 0)}><Text style={styles.stepText}>- 1 day</Text></TouchableOpacity>
          <TouchableOpacity style={styles.step} onPress={() => moveDue(1, 0)}><Text style={styles.stepText}>+ 1 day</Text></TouchableOpacity>
          <TouchableOpacity style={styles.step} onPress={() => moveDue(0, -1)}><Text style={styles.stepText}>- 1 month</Text></TouchableOpacity>
          <TouchableOpacity style={styles.step} onPress={() => moveDue(0, 1)}><Text style={styles.stepText}>+ 1 month</Text></TouchableOpacity>
        </View>

        <Text style={styles.label}>Reminder time</Text>
        <Text style={styles.bigValue}>{timeLabel(form.time)}</Text>
        <View style={styles.stepRow}>
          <TouchableOpacity style={styles.step} onPress={() => moveTime(-1, 0)}><Text style={styles.stepText}>- 1 hour</Text></TouchableOpacity>
          <TouchableOpacity style={styles.step} onPress={() => moveTime(1, 0)}><Text style={styles.stepText}>+ 1 hour</Text></TouchableOpacity>
          <TouchableOpacity style={styles.step} onPress={() => moveTime(0, -15)}><Text style={styles.stepText}>- 15 min</Text></TouchableOpacity>
          <TouchableOpacity style={styles.step} onPress={() => moveTime(0, 15)}><Text style={styles.stepText}>+ 15 min</Text></TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.checkRow} onPress={() => change("repeats", !form.repeats)}>
          <View style={[styles.checkbox, form.repeats && styles.checkboxOn]}>
            {form.repeats && <Text style={styles.checkMark}>{"\u2713"}</Text>}
          </View>
          <Text style={styles.checkLabel}>Ulitin, repeat this</Text>
        </TouchableOpacity>
        {form.repeats && (
          <View style={styles.chipRow}>
            {["daily", "weekly", "monthly"].map((key) => (
              <TouchableOpacity
                key={key}
                style={[styles.chip, styles.chipWide, form.repeat === key && styles.chipActive]}
                onPress={() => change("repeat", key)}
              >
                <Text style={[styles.chipText, form.repeat === key && styles.chipTextActive]}>{REPEAT_LABEL[key]}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
        <Text style={styles.rule}>
          {REMINDER_RULE[form.repeats ? form.repeat : "none"]} At {timeLabel(form.time)}.
          If it is not paid, a reminder comes every day for up to a week.
        </Text>

        <TouchableOpacity style={styles.primaryButton} onPress={saveForm}>
          <Text style={styles.primaryButtonText}>SAVE SCHEDULE</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setForm(null)}>
          <Text style={styles.cancel}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  function renderSchedule(s) {
    const n = daysUntilDue(s, new Date());
    const late = n < 0;
    return (
      <View key={s.id} style={[styles.card, late && styles.cardLate]}>
        <View style={styles.topRow}>
          <Text style={styles.scheduleTitle}>{s.title}</Text>
          <Text style={s.kind === "in" ? styles.amountIn : styles.amountOut}>{pesos(s.amount)}</Text>
        </View>
        <Text style={late ? styles.dueLate : n <= 1 ? styles.dueSoon : styles.dueText}>
          {dueWords(s)}, {longDate(s.due_date)}
        </Text>
        <Text style={styles.meta}>
          {s.repeat === "none" ? "One time" : "Repeats " + s.repeat}, reminder at {timeLabel(s.remind_time)},
          adds as {TYPE_LABEL[s.kind]}
        </Text>

        {paying === s.id ? (
          <View style={styles.payBox}>
            <Text style={styles.label}>How much was paid, pwedeng palitan</Text>
            <TextInput
              style={styles.input}
              value={payAmount}
              onChangeText={setPayAmount}
              keyboardType="numeric"
            />
            <TouchableOpacity style={styles.primaryButton} onPress={() => savePayment(s)}>
              <Text style={styles.primaryButtonText}>SAVE PAYMENT</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setPaying(null)}>
              <Text style={styles.cancel}>Cancel</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.paidButton} onPress={() => startPaying(s)}>
              <Text style={styles.paidText}>{s.kind === "in" ? "RECEIVED" : "PAID, BAYAD NA"}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.smallButton} onPress={() => openForm(s)}>
              <Text style={styles.smallText}>EDIT</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.smallButton} onPress={() => remove(s)}>
              <Text style={styles.deleteText}>DELETE</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  }

  return (
    <View>
      {header}
      {!premium ? upgrade : (
        <View>
          {Platform.OS === "web" && (
            <Text style={styles.webNote}>
              Reminder alarms ring on your phone. Here you can see and manage your schedules.
            </Text>
          )}
          {form ? renderForm() : (
            <TouchableOpacity style={styles.addButton} onPress={() => openForm(null)}>
              <Text style={styles.addText}>+ ADD SCHEDULE</Text>
            </TouchableOpacity>
          )}
          {active.length === 0 && !form && (
            <Text style={styles.empty}>
              Wala pang schedule. Add your bills, like kuryente or stall rent, and Tindahan
              will remind you before they are due.
            </Text>
          )}
          {active.map(renderSchedule)}
          {doneCount > 0 && (
            <Text style={styles.doneNote}>{doneCount} one time {doneCount === 1 ? "schedule" : "schedules"} paid and done.</Text>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: CARD, borderRadius: 12, padding: 16, marginTop: 14, borderWidth: 1, borderColor: LINE },
  cardLate: { borderColor: CRIMSON, borderWidth: 2 },
  cardTitle: { fontSize: 22, fontWeight: "bold", color: SLATE },
  label: { fontSize: 17, color: MUTED, marginTop: 14, marginBottom: 6 },
  input: {
    backgroundColor: CARD, borderRadius: 10, padding: 14, color: SLATE,
    fontSize: 22, borderWidth: 1, borderColor: LINE,
  },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  chip: {
    paddingVertical: 10, paddingHorizontal: 14, borderRadius: 20,
    borderWidth: 2, borderColor: LINE, backgroundColor: CARD,
  },
  chipWide: { flexGrow: 1, alignItems: "center" },
  chipActive: { backgroundColor: SLATE, borderColor: SLATE },
  chipText: { fontSize: 16, fontWeight: "bold", color: SLATE },
  chipTextActive: { color: "white" },
  bigValue: { fontSize: 24, fontWeight: "bold", color: SLATE },
  stepRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  step: {
    flexGrow: 1, paddingVertical: 12, borderRadius: 8,
    backgroundColor: "#F1F5F9", alignItems: "center", minWidth: "22%",
  },
  stepText: { fontSize: 15, fontWeight: "bold", color: SLATE },
  checkRow: { flexDirection: "row", alignItems: "center", marginTop: 18, gap: 12 },
  checkbox: {
    width: 32, height: 32, borderRadius: 6, borderWidth: 2, borderColor: SLATE,
    alignItems: "center", justifyContent: "center", backgroundColor: CARD,
  },
  checkboxOn: { backgroundColor: EMERALD, borderColor: EMERALD },
  checkMark: { color: "white", fontSize: 20, fontWeight: "bold" },
  checkLabel: { fontSize: 19, color: SLATE, fontWeight: "bold" },
  rule: { fontSize: 15, color: INDIGO, marginTop: 12, backgroundColor: "#EFF6FF", padding: 12, borderRadius: 8 },
  primaryButton: { marginTop: 16, backgroundColor: EMERALD, padding: 16, borderRadius: 10, alignItems: "center" },
  primaryButtonText: { fontSize: 18, fontWeight: "bold", color: "white" },
  cancel: { fontSize: 16, color: MUTED, fontWeight: "bold", textAlign: "center", marginTop: 14 },
  addButton: {
    marginTop: 16, padding: 16, borderRadius: 12, alignItems: "center",
    borderWidth: 2, borderColor: INDIGO, borderStyle: "dashed", backgroundColor: "#EFF6FF",
  },
  addText: { fontSize: 19, fontWeight: "bold", color: INDIGO },
  topRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 },
  scheduleTitle: { fontSize: 21, fontWeight: "bold", color: SLATE, flexShrink: 1 },
  amountIn: { fontSize: 20, fontWeight: "bold", color: EMERALD },
  amountOut: { fontSize: 20, fontWeight: "bold", color: CRIMSON },
  dueText: { fontSize: 17, color: SLATE, marginTop: 6 },
  dueSoon: { fontSize: 17, color: INDIGO, marginTop: 6, fontWeight: "bold" },
  dueLate: { fontSize: 17, color: CRIMSON, marginTop: 6, fontWeight: "bold" },
  meta: { fontSize: 14, color: MUTED, marginTop: 4 },
  actionRow: { flexDirection: "row", gap: 8, marginTop: 14 },
  paidButton: { flex: 2, backgroundColor: EMERALD, paddingVertical: 14, borderRadius: 10, alignItems: "center" },
  paidText: { fontSize: 16, fontWeight: "bold", color: "white" },
  smallButton: {
    flex: 1, paddingVertical: 14, borderRadius: 10, alignItems: "center",
    borderWidth: 1, borderColor: LINE,
  },
  smallText: { fontSize: 14, fontWeight: "bold", color: SLATE },
  deleteText: { fontSize: 14, fontWeight: "bold", color: CRIMSON },
  payBox: { marginTop: 10 },
  empty: { fontSize: 17, color: MUTED, marginTop: 18 },
  doneNote: { fontSize: 15, color: MUTED, marginTop: 14 },
  webNote: { fontSize: 15, color: INDIGO, marginTop: 12, backgroundColor: "#EFF6FF", padding: 12, borderRadius: 8 },
});
