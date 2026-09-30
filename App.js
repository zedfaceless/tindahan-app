// App.js
// Tindahan, a money tracker for public market vendors, first working version.
// Built to learn React Native with Expo. Two screens, an entry screen where the
// vendor records money in or money out, and a dashboard showing today's totals.
// Records are saved on the phone first so the app works with no signal, then
// synced both ways with Supabase whenever there is internet.
// Vendors log in with Supabase first, and each vendor's records are kept
// separately on the phone under their own user id.

import { useState, useEffect } from "react";
import {
  StyleSheet, Text, View, TextInput, TouchableOpacity,
  FlatList, Alert, SafeAreaView, ActivityIndicator, AppState,
} from "react-native";
import { supabase } from "./lib/supabase";
import { readLocal, updateLocal, syncRecords, newId, nowIso } from "./lib/sync";
import AuthScreen from "./AuthScreen";

// Format a number as Philippine pesos, for example 1250 becomes P 1,250.00
function pesos(amount) {
  return "P " + amount.toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// Today's date in the phone's own time zone, like 2026-09-30.
// Local time matters, a UTC date would count early morning sales as yesterday.
function todayString() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return now.getFullYear() + "-" + month + "-" + day;
}

// The top of the app, shows a loading screen, then login, then the tracker
export default function App() {
  const [session, setSession] = useState(null);
  const [checking, setChecking] = useState(true);

  // Find out if a vendor is already logged in, then listen for login and logout
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setChecking(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  if (checking) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#2d5016" />
      </View>
    );
  }
  if (!session) {
    return <AuthScreen />;
  }
  return <Tracker key={session.user.id} user={session.user} />;
}

// The money tracker itself, shown only to a logged in vendor
function Tracker({ user }) {
  const username = user.user_metadata?.username || user.email;

  // which screen is visible, "entry" or "dashboard"
  const [screen, setScreen] = useState("entry");
  // the list of all saved records
  const [records, setRecords] = useState([]);
  // form state for the entry screen
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState("in"); // "in" is money in, "out" is money out
  // "syncing", "synced", or "offline", shown on the dashboard
  const [syncStatus, setSyncStatus] = useState("syncing");

  // Load records from the phone, sync, and sync again whenever the app returns
  useEffect(() => {
    readLocal(user.id)
      .then(setRecords)
      .catch(() => Alert.alert("Storage problem", "Could not load saved records."))
      .finally(runSync);
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        runSync();
      }
    });
    return () => listener.remove();
  }, []);

  // Sync with the server, failures just mean offline, records stay safe on the phone
  async function runSync() {
    setSyncStatus("syncing");
    try {
      const merged = await syncRecords(user.id);
      if (merged !== null) {
        setRecords(merged);
        setSyncStatus("synced");
      }
    } catch (error) {
      setSyncStatus("offline");
    }
  }

  // Validate the form and save one new record
  async function saveRecord() {
    const value = parseFloat(amount);
    if (isNaN(value) || value <= 0) {
      Alert.alert("Check the amount", "Please enter a number bigger than zero.");
      return;
    }
    const record = {
      id: newId(),
      record_date: todayString(),
      kind: kind,
      amount: value,
      description: description.trim() || "No description",
      updated_at: nowIso(),
      deleted: false,
      synced: false,
    };
    try {
      const next = await updateLocal(user.id, (list) => [record, ...list]);
      setRecords(next);
    } catch (error) {
      Alert.alert("Storage problem", "Could not save the record.");
      return;
    }
    runSync();
    // clear the form so the next record is fast to enter
    setAmount("");
    setDescription("");
    Alert.alert("Saved", (kind === "in" ? "Money in " : "Money out ") + pesos(value));
  }

  // Delete one record after the vendor long presses it on the dashboard
  function confirmDelete(record) {
    Alert.alert("Delete this record?", record.description + ", " + pesos(record.amount), [
      { text: "Cancel" },
      {
        text: "Delete",
        onPress: async () => {
          // marked as deleted instead of erased, so the delete can sync too
          const next = await updateLocal(user.id, (list) =>
            list.map((r) =>
              r.id === record.id
                ? { ...r, deleted: true, updated_at: nowIso(), synced: false }
                : r
            )
          );
          setRecords(next);
          runSync();
        },
      },
    ]);
  }

  // Today's records and totals for the dashboard
  const todays = records.filter((r) => !r.deleted && r.record_date === todayString());
  const unsyncedCount = records.filter((r) => !r.synced).length;

  // The words shown for each sync status
  function syncLabel() {
    if (syncStatus === "syncing") {
      return "Nagsi-sync, syncing...";
    }
    if (syncStatus === "offline") {
      return "Offline, " + unsyncedCount + " naka-save sa phone. Tap to retry.";
    }
    return "Naka-sync, all records backed up";
  }
  const moneyIn = todays.filter((r) => r.kind === "in")
    .reduce((sum, r) => sum + r.amount, 0);
  const moneyOut = todays.filter((r) => r.kind === "out")
    .reduce((sum, r) => sum + r.amount, 0);
  const net = moneyIn - moneyOut;

  // Log out, the session listener in App switches back to the login screen
  function logout() {
    Alert.alert("Log out?", "Your records stay saved on this phone.", [
      { text: "Cancel" },
      { text: "Log out", onPress: () => supabase.auth.signOut() },
    ]);
  }

  // ----- the entry screen -----
  function renderEntry() {
    return (
      <View style={styles.body}>
        <Text style={styles.title}>Tindahan</Text>
        <Text style={styles.label}>Kumusta, {username}</Text>
        <Text style={styles.label}>Ilagay ang halaga, enter the amount</Text>
        <TextInput
          style={styles.input}
          value={amount}
          onChangeText={setAmount}
          keyboardType="numeric"
          placeholder="0.00"
        />
        <Text style={styles.label}>Para saan, description</Text>
        <TextInput
          style={styles.input}
          value={description}
          onChangeText={setDescription}
          placeholder="halimbawa, benta, pamasahe, kuryente"
        />
        <View style={styles.row}>
          <TouchableOpacity
            style={[styles.kindButton, kind === "in" && styles.kindIn]}
            onPress={() => setKind("in")}
          >
            <Text style={styles.kindText}>MONEY IN</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.kindButton, kind === "out" && styles.kindOut]}
            onPress={() => setKind("out")}
          >
            <Text style={styles.kindText}>MONEY OUT</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity style={styles.saveButton} onPress={saveRecord}>
          <Text style={styles.saveText}>I-SAVE</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ----- the dashboard screen -----
  function renderDashboard() {
    return (
      <View style={styles.body}>
        <Text style={styles.title}>Ngayong araw, today</Text>
        <TouchableOpacity onPress={runSync}>
          <Text style={syncStatus === "offline" ? styles.syncOffline : styles.syncOk}>
            {syncLabel()}
          </Text>
        </TouchableOpacity>
        <View style={styles.totalBox}>
          <Text style={styles.totalLabel}>Money in</Text>
          <Text style={styles.totalIn}>{pesos(moneyIn)}</Text>
        </View>
        <View style={styles.totalBox}>
          <Text style={styles.totalLabel}>Money out</Text>
          <Text style={styles.totalOut}>{pesos(moneyOut)}</Text>
        </View>
        <View style={styles.totalBox}>
          <Text style={styles.totalLabel}>Kita, net</Text>
          <Text style={net >= 0 ? styles.totalIn : styles.totalOut}>
            {pesos(net)}
          </Text>
        </View>
        <Text style={styles.label}>Long press a record to delete it</Text>
        <FlatList
          data={todays}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <TouchableOpacity onLongPress={() => confirmDelete(item)}>
              <View style={styles.recordRow}>
                <Text style={styles.recordText}>{item.description}</Text>
                <Text style={item.kind === "in" ? styles.totalIn : styles.totalOut}>
                  {(item.kind === "in" ? "+" : "-") + pesos(item.amount)}
                </Text>
              </View>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <Text style={styles.label}>Wala pang record ngayong araw.</Text>
          }
        />
        <TouchableOpacity style={styles.logoutButton} onPress={logout}>
          <Text style={styles.logoutText}>LOG OUT</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {screen === "entry" ? renderEntry() : renderDashboard()}
      <View style={styles.nav}>
        <TouchableOpacity
          style={[styles.navButton, screen === "entry" && styles.navActive]}
          onPress={() => setScreen("entry")}
        >
          <Text style={[styles.navText, screen === "entry" && styles.navTextActive]}>ENTRY</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.navButton, screen === "dashboard" && styles.navActive]}
          onPress={() => setScreen("dashboard")}
        >
          <Text style={[styles.navText, screen === "dashboard" && styles.navTextActive]}>DASHBOARD</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

// Styles, large text and big touch targets for elderly and low literacy users
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f5f1e8" },
  body: { flex: 1, padding: 20, paddingTop: 50 },
  title: { fontSize: 34, fontWeight: "bold", color: "#2d5016", marginBottom: 12 },
  label: { fontSize: 18, color: "#555", marginBottom: 6, marginTop: 10 },
  input: {
    backgroundColor: "white", borderRadius: 10, padding: 16,
    fontSize: 24, borderWidth: 1, borderColor: "#ccc",
  },
  row: { flexDirection: "row", marginTop: 20, gap: 10 },
  kindButton: {
    flex: 1, padding: 18, borderRadius: 10, backgroundColor: "#ddd",
    alignItems: "center",
  },
  kindIn: { backgroundColor: "#4caf50" },
  kindOut: { backgroundColor: "#e53935" },
  kindText: { fontSize: 20, fontWeight: "bold", color: "white" },
  saveButton: {
    marginTop: 30, backgroundColor: "#2d5016", padding: 22,
    borderRadius: 12, alignItems: "center",
  },
  saveText: { fontSize: 26, fontWeight: "bold", color: "white" },
  totalBox: {
    backgroundColor: "white", borderRadius: 10, padding: 16,
    marginBottom: 10, flexDirection: "row", justifyContent: "space-between",
  },
  totalLabel: { fontSize: 20, color: "#333" },
  totalIn: { fontSize: 22, fontWeight: "bold", color: "#2e7d32" },
  totalOut: { fontSize: 22, fontWeight: "bold", color: "#c62828" },
  recordRow: {
    backgroundColor: "white", borderRadius: 8, padding: 14, marginBottom: 8,
    flexDirection: "row", justifyContent: "space-between",
  },
  recordText: { fontSize: 18, color: "#333", flex: 1, marginRight: 10 },
  nav: { flexDirection: "row", borderTopWidth: 1, borderColor: "#ccc" },
  navButton: { flex: 1, padding: 18, alignItems: "center", backgroundColor: "#e8e2d5" },
  navActive: { backgroundColor: "#2d5016" },
  navText: { fontSize: 18, fontWeight: "bold", color: "#333" },
  navTextActive: { color: "white" },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#f5f1e8" },
  logoutButton: {
    marginTop: 10, padding: 14, borderRadius: 10,
    borderWidth: 2, borderColor: "#c62828", alignItems: "center",
  },
  logoutText: { fontSize: 18, fontWeight: "bold", color: "#c62828" },
  syncOk: { fontSize: 16, color: "#2e7d32", marginBottom: 12 },
  syncOffline: { fontSize: 16, color: "#e65100", marginBottom: 12, fontWeight: "bold" },
});
