// HistoryScreen.js
// Review money in and money out for any day or date range, to track and plan.
// Money in on the left, money out on the right, each with its total on top.
// Free accounts look back 30 days, premium sees the full history and can
// switch between business and personal money.

import { useState, useMemo } from "react";
import { StyleSheet, Text, View, TouchableOpacity } from "react-native";
import { useTheme } from "./lib/theme";
import { parseDay, dayString, addDays } from "./lib/reminders";
import { longDay } from "./lib/statement";

const FREE_DAYS = 30;

function pesos(amount) {
  return "P " + Number(amount).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Oct 15, a short date for each record in a range
function shortDay(value) {
  return parseDay(value).toLocaleDateString("en-PH", { month: "short", day: "numeric" });
}

// move a "2026-10-15" date by days or months, kept between the limits
function moveDate(value, days, months, min, max) {
  const d = parseDay(value);
  let next = months
    ? new Date(d.getFullYear(), d.getMonth() + months, Math.min(d.getDate(),
        new Date(d.getFullYear(), d.getMonth() + months + 1, 0).getDate()))
    : addDays(d, days);
  let key = dayString(next);
  if (min && key < min) key = min;
  if (max && key > max) key = max;
  return key;
}

export default function HistoryScreen({ records, premium, header, onUpgrade }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const today = dayString(new Date());
  // free accounts cannot go further back than 30 days, today included
  const earliest = premium ? null : dayString(addDays(parseDay(today), -(FREE_DAYS - 1)));

  const [preset, setPreset] = useState("today");
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [scope, setScope] = useState("business");

  // the quick choices set both dates at once
  function choose(next) {
    setPreset(next);
    if (next === "today") { setFrom(today); setTo(today); }
    if (next === "7") { setFrom(dayString(addDays(parseDay(today), -6))); setTo(today); }
    if (next === "30") { setFrom(dayString(addDays(parseDay(today), -29))); setTo(today); }
  }

  // stepping a date, the start never passes the end
  function stepFrom(days, months) {
    const next = moveDate(from, days, months, earliest, to);
    setFrom(next);
  }
  function stepTo(days, months) {
    const next = moveDate(to, days, months, from, today);
    setTo(next);
  }

  const shownScope = premium ? scope : "business";
  const inRange = records.filter((r) => !r.deleted && r.scope === shownScope
    && r.record_date >= from && r.record_date <= to);
  const byNewest = (a, b) => (a.record_date < b.record_date ? 1 : a.record_date > b.record_date ? -1
    : a.updated_at < b.updated_at ? 1 : -1);
  const moneyIn = inRange.filter((r) => r.kind === "in").sort(byNewest);
  const moneyOut = inRange.filter((r) => r.kind === "out").sort(byNewest);
  const totalIn = moneyIn.reduce((s, r) => s + r.amount, 0);
  const totalOut = moneyOut.reduce((s, r) => s + r.amount, 0);
  const net = totalIn - totalOut;
  const oneDay = from === to;

  function renderStepper(label, value, onStep) {
    return (
      <View style={styles.stepper}>
        <Text style={styles.stepLabel}>{label}</Text>
        <Text style={styles.stepValue}>{longDay(value)}</Text>
        <View style={styles.stepRow}>
          {[["- 1 month", 0, -1], ["- 1 day", -1, 0], ["+ 1 day", 1, 0], ["+ 1 month", 0, 1]].map(([text, d, m]) => (
            <TouchableOpacity key={text} style={styles.step} onPress={() => onStep(d, m)}>
              <Text style={styles.stepText}>{text}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    );
  }

  function renderColumn(title, list, total, valueStyle) {
    return (
      <View style={styles.column}>
        <View style={styles.columnHead}>
          <Text style={styles.columnTitle}>{title}</Text>
          <Text style={[styles.columnTotal, valueStyle]}>{pesos(total)}</Text>
          <Text style={styles.columnCount}>{list.length} {list.length === 1 ? "record" : "records"}</Text>
        </View>
        {list.length === 0 ? (
          <Text style={styles.none}>Wala</Text>
        ) : list.map((r) => (
          <View key={r.id} style={styles.item}>
            {!oneDay && <Text style={styles.itemDate}>{shortDay(r.record_date)}</Text>}
            <Text style={styles.itemText}>{r.description}</Text>
            <Text style={[styles.itemAmount, valueStyle]}>{pesos(r.amount)}</Text>
          </View>
        ))}
      </View>
    );
  }

  return (
    <View>
      {header}

      {premium && (
        <View style={styles.chipRow}>
          {[["business", "NEGOSYO"], ["personal", "PERSONAL"]].map(([key, label]) => (
            <TouchableOpacity key={key} style={[styles.chip, scope === key && styles.chipActive]} onPress={() => setScope(key)}>
              <Text style={[styles.chipText, scope === key && styles.chipTextActive]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <View style={styles.chipRow}>
        {[["today", "TODAY"], ["7", "7 DAYS"], ["30", "30 DAYS"], ["custom", "PICK DATES"]].map(([key, label]) => (
          <TouchableOpacity key={key} style={[styles.chip, preset === key && styles.chipActive]} onPress={() => choose(key)}>
            <Text style={[styles.chipText, preset === key && styles.chipTextActive]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {preset === "custom" ? (
        <View style={styles.card}>
          {renderStepper("From", from, stepFrom)}
          {renderStepper("To", to, stepTo)}
        </View>
      ) : (
        <Text style={styles.range}>{oneDay ? longDay(from) : longDay(from) + " to " + longDay(to)}</Text>
      )}

      {!premium && (
        <TouchableOpacity onPress={onUpgrade}>
          <Text style={styles.limit}>Free shows the last 30 days. Premium shows all your history.</Text>
        </TouchableOpacity>
      )}

      <View style={styles.netRow}>
        <Text style={styles.netLabel}>{shownScope === "business" ? "Kita, net" : "Natira, net"}</Text>
        <Text style={[styles.netValue, net >= 0 ? styles.good : styles.bad]}>{pesos(net)}</Text>
      </View>

      <View style={styles.columns}>
        {renderColumn("MONEY IN", moneyIn, totalIn, styles.good)}
        {renderColumn("MONEY OUT", moneyOut, totalOut, styles.bad)}
      </View>
    </View>
  );
}

function makeStyles(c) {
  return StyleSheet.create({
    chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 },
    chip: {
      flexGrow: 1, paddingVertical: 10, paddingHorizontal: 10, borderRadius: 8, alignItems: "center",
      borderWidth: 2, borderColor: c.line, backgroundColor: c.card,
    },
    chipActive: { backgroundColor: c.strong, borderColor: c.strong },
    chipText: { fontSize: 13, fontWeight: "bold", color: c.text },
    chipTextActive: { color: c.onStrong },
    card: { backgroundColor: c.card, borderRadius: 12, padding: 14, marginTop: 12, borderWidth: 1, borderColor: c.line },
    stepper: { marginBottom: 10 },
    stepLabel: { fontSize: 15, color: c.muted },
    stepValue: { fontSize: 20, fontWeight: "bold", color: c.text, marginTop: 2 },
    stepRow: { flexDirection: "row", gap: 6, marginTop: 8 },
    step: { flex: 1, paddingVertical: 10, borderRadius: 8, backgroundColor: c.subtle, alignItems: "center" },
    stepText: { fontSize: 13, fontWeight: "bold", color: c.text },
    range: { fontSize: 16, color: c.text, marginTop: 12, textAlign: "center", fontWeight: "bold" },
    limit: { fontSize: 14, color: c.accent, marginTop: 10, textAlign: "center" },
    netRow: {
      flexDirection: "row", justifyContent: "space-between", alignItems: "center",
      backgroundColor: c.card, borderRadius: 10, padding: 14, marginTop: 14, borderWidth: 1, borderColor: c.line,
    },
    netLabel: { fontSize: 17, fontWeight: "bold", color: c.text },
    netValue: { fontSize: 20, fontWeight: "bold" },
    good: { color: c.good },
    bad: { color: c.bad },
    // money in and money out side by side
    columns: { flexDirection: "row", gap: 10, marginTop: 12, alignItems: "flex-start" },
    column: { flex: 1, backgroundColor: c.card, borderRadius: 12, borderWidth: 1, borderColor: c.line, overflow: "hidden" },
    columnHead: { padding: 12, borderBottomWidth: 1, borderColor: c.line, backgroundColor: c.subtle },
    columnTitle: { fontSize: 13, fontWeight: "bold", color: c.muted, letterSpacing: 1 },
    columnTotal: { fontSize: 19, fontWeight: "bold", marginTop: 4 },
    columnCount: { fontSize: 12, color: c.muted, marginTop: 2 },
    item: { paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderColor: c.line },
    itemDate: { fontSize: 12, color: c.muted },
    itemText: { fontSize: 15, color: c.text },
    itemAmount: { fontSize: 15, fontWeight: "bold", marginTop: 2 },
    none: { fontSize: 15, color: c.muted, padding: 12, textAlign: "center" },
  });
}
