// App.js
// Tindahan, a money tracker for public market vendors, first working version.
// Built to learn React Native with Expo. Two screens, an entry screen where the
// vendor records money in or money out, and a dashboard showing today's totals.
// Records are saved with AsyncStorage so they survive closing the app.
// Vendors log in with Supabase first, and each vendor's records are kept
// separately on the phone under their own user id.

import { useState, useEffect } from "react";
import {
  StyleSheet, Text, View, TextInput, TouchableOpacity,
  FlatList, Alert, SafeAreaView, ActivityIndicator,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./lib/supabase";
import AuthScreen from "./AuthScreen";

// Each vendor's records are stored under their own key on the phone,
// so two vendors sharing one phone never see each other's records
function storageKey(userId) {
  return "tindahan_records_" + userId;
}

// Format a number as Philippine pesos, for example 1250 becomes P 1,250.00
function pesos(amount) {
  return "P " + amount.toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// Today's date as a simple string like 2026-09-30, used to filter the dashboard
function todayString() {
  return new Date().toISOString().slice(0, 10);
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
  const STORAGE_KEY = storageKey(user.id);
  const username = user.user_metadata?.username || user.email;

  // which screen is visible, "entry" or "dashboard"
  const [screen, setScreen] = useState("entry");
  // the list of all saved records
  const [records, setRecords] = useState([]);
  // form state for the entry screen
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState("in"); // "in" is money in, "out" is money out

  // Load saved records from the phone storage once when the app opens
  useEffect(() => {
    loadRecords();
  }, []);

  // Read the records from AsyncStorage, if any exist
  async function loadRecords() {
    try {
      const saved = await AsyncStorage.getItem(STORAGE_KEY);
      if (saved !== null) {
        setRecords(JSON.parse(saved));
      }
    } catch (error) {
      Alert.alert("Storage problem", "Could not load saved records.");
    }
  }

  // Write the full record list to AsyncStorage
  async function persist(newRecords) {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(newRecords));
    } catch (error) {
      Alert.alert("Storage problem", "Could not save the record.");
    }
  }

  // Validate the form and save one new record
  function saveRecord() {
    const value = parseFloat(amount);
    if (isNaN(value) || value <= 0) {
      Alert.alert("Check the amount", "Please enter a number bigger than zero.");
      return;
    }
    const record = {
      id: Date.now().toString(),
      date: todayString(),
      kind: kind,
      amount: value,
      description: description.trim() || "No description",
    };
    const newRecords = [record, ...records];
    setRecords(newRecords);
    persist(newRecords);
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
        onPress: () => {
          const newRecords = records.filter((r) => r.id !== record.id);
          setRecords(newRecords);
          persist(newRecords);
        },
      },
    ]);
  }

  // Today's records and totals for the dashboard
  const todays = records.filter((r) => r.date === todayString());
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
  title: { fontSize: 34, fontWeight: "bold", color: "#2d5016", marginBottom: 20 },
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
});
