// App.js
// Tindahan, a money tracker for public market vendors.
// Built to learn React Native with Expo. Three screens, Entry to record money,
// Dashboard for today's totals in Business, Personal, and Withdrawal tabs, and
// Account to edit the profile, change the PIN, and request premium.
// Records are saved on the phone first so the app works with no signal, then
// synced both ways with Supabase whenever there is internet.
// The same code also runs in a PC web browser through Expo for web.
// Premium, 99 pesos a month, adds withdrawals and personal expenses.

import { useState, useEffect } from "react";
import {
  StyleSheet, Text, View, TextInput, TouchableOpacity, ScrollView,
  SafeAreaView, ActivityIndicator, AppState, Platform,
} from "react-native";
import { supabase } from "./lib/supabase";
import { notify, confirmAction } from "./lib/notify";
import {
  readLocal, updateLocal, syncRecords, newId, nowIso,
  readProfile, refreshProfile, isPremium, PREMIUM_KINDS,
} from "./lib/sync";
import AuthScreen from "./AuthScreen";

// What premium includes, shown wherever a vendor can upgrade
const PREMIUM_BENEFITS = [
  "Record withdrawals, money taken from the business for home",
  "Record personal expenses, separate from the business",
  "See what is really left after the household takes its share",
  "Full history and monthly reports, coming soon",
];
const PAYMENT_NOTE = "After you request, the Tindahan owner will contact you about payment.";

// How each record type is shown
const KINDS = {
  in: { button: "MONEY IN", note: "benta, sales", sign: "+", saved: "Money in " },
  out: { button: "MONEY OUT", note: "gastos sa negosyo", sign: "-", saved: "Money out " },
  withdrawal: { button: "KINUHA", note: "withdrawal for home", sign: "-", saved: "Withdrawal " },
  personal: { button: "PERSONAL", note: "personal expense", sign: "-", saved: "Personal expense " },
};

// The three dashboard tabs and the record types each one shows
const TABS = [
  { key: "business", label: "BUSINESS", kinds: ["in", "out"] },
  { key: "personal", label: "PERSONAL", kinds: ["personal"] },
  { key: "withdrawal", label: "WITHDRAWAL", kinds: ["withdrawal"] },
];

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

// A date like Oct 30, 2026
function shortDate(value) {
  return new Date(value).toLocaleDateString("en-PH", {
    year: "numeric", month: "short", day: "numeric",
  });
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
  // which screen is visible, "entry", "dashboard", or "account"
  const [screen, setScreen] = useState("entry");
  // which dashboard tab is open
  const [tab, setTab] = useState("business");
  // every saved record
  const [records, setRecords] = useState([]);
  // the entry form
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState("in");
  // "syncing", "synced", "offline", or "disabled"
  const [syncStatus, setSyncStatus] = useState("syncing");
  // the vendor's own account from the last sync
  const [profile, setProfile] = useState(null);
  // premium records waiting on the phone because premium lapsed
  const [heldBack, setHeldBack] = useState(0);
  // the account screen forms
  const [editUsername, setEditUsername] = useState("");
  const [editMarket, setEditMarket] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [busy, setBusy] = useState(false);
  // the vendor's open premium request, or null
  const [request, setRequest] = useState(null);

  // Load records and account from the phone, sync, and sync again on return
  useEffect(() => {
    Promise.all([readLocal(user.id), readProfile(user.id)])
      .then(([savedRecords, savedProfile]) => {
        setRecords(savedRecords);
        setProfile(savedProfile);
      })
      .catch(() => notify("Storage problem", "Could not load saved records."))
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
      const result = await syncRecords(user.id);
      if (result !== null) {
        setRecords(result.records);
        setProfile(result.profile);
        setHeldBack(result.heldBack);
        setSyncStatus(result.profile.disabled ? "disabled" : "synced");
      }
    } catch (error) {
      setSyncStatus("offline");
    }
  }

  const premium = isPremium(profile);
  const disabled = Boolean(profile && profile.disabled);
  const ownerPremium = Boolean(profile && profile.role === "owner" && profile.owner_premium);
  const paidUntil = profile && profile.premium_until && new Date(profile.premium_until) > new Date()
    ? profile.premium_until
    : null;
  const daysLeft = paidUntil ? Math.ceil((new Date(paidUntil) - new Date()) / 86400000) : 0;
  const username = (profile && profile.username) || user.user_metadata?.username || user.email;

  // The short status shown in the tag next to the greeting
  function tierLabel() {
    if (ownerPremium) return "Premium, owner";
    if (premium) return "Premium, " + daysLeft + (daysLeft === 1 ? " day" : " days");
    return "Free";
  }

  // Open a screen, the account screen loads its forms and the open request
  function openScreen(next) {
    setScreen(next);
    if (next === "account") {
      setEditUsername(username);
      setEditMarket((profile && profile.market_name) || "");
      loadRequest();
    }
  }

  // Shown when a free vendor taps a premium feature
  function askUpgrade() {
    confirmAction(
      "Premium feature",
      "Premium is 99 pesos a month and adds withdrawals and personal expenses. See premium in your account?",
      "Open account",
      () => openScreen("account")
    );
  }

  // ----- entry -----

  // Pick a record type, premium types ask free vendors to upgrade instead
  function chooseKind(nextKind) {
    if (PREMIUM_KINDS.includes(nextKind) && !premium) {
      askUpgrade();
      return;
    }
    setKind(nextKind);
  }

  // Validate the form and save one new record
  async function saveRecord() {
    if (disabled) {
      notify("Account disabled", "Your account is disabled, so new records cannot be saved. Contact the Tindahan owner.");
      return;
    }
    if (PREMIUM_KINDS.includes(kind) && !premium) {
      setKind("in");
      askUpgrade();
      return;
    }
    const value = parseFloat(amount);
    if (isNaN(value) || value <= 0) {
      notify("Check the amount", "Please enter a number bigger than zero.");
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
      notify("Storage problem", "Could not save the record.");
      return;
    }
    runSync();
    setAmount("");
    setDescription("");
    notify("Saved", KINDS[kind].saved + pesos(value));
  }

  // ----- dashboard -----

  // Delete one record, after a long press on the phone or a click on the web
  function confirmDelete(record) {
    confirmAction(
      "Delete this record?",
      record.description + ", " + pesos(record.amount),
      "Delete",
      async () => {
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
      }
    );
  }

  const todays = records.filter((r) => !r.deleted && r.record_date === todayString());
  const unsyncedCount = records.filter((r) => !r.synced).length;

  // Today's total for one record type
  function total(recordKind) {
    return todays.filter((r) => r.kind === recordKind).reduce((sum, r) => sum + r.amount, 0);
  }
  const moneyIn = total("in");
  const moneyOut = total("out");
  const net = moneyIn - moneyOut;
  const withdrawn = total("withdrawal");
  const personalSpent = total("personal");
  const cashLeft = net - withdrawn - personalSpent;
  const hasHouseholdRecords = withdrawn > 0 || personalSpent > 0;

  // The words shown for each sync status
  function syncLabel() {
    if (syncStatus === "syncing") return "Nagsi-sync, syncing...";
    if (syncStatus === "disabled") return "Account disabled. Your records are safe on this phone.";
    if (syncStatus === "offline") return "Offline, " + unsyncedCount + " naka-save sa phone. Tap to retry.";
    if (heldBack > 0) {
      return "Naka-sync, " + heldBack + " premium record" + (heldBack === 1 ? "" : "s")
        + " waiting until premium is renewed";
    }
    return "Naka-sync, all records backed up";
  }

  // The color for an amount depends on its record type
  function amountStyle(recordKind) {
    if (recordKind === "in") return styles.amountIn;
    if (recordKind === "withdrawal") return styles.amountWithdrawal;
    if (recordKind === "personal") return styles.amountPersonal;
    return styles.amountOut;
  }

  // ----- account -----

  // Load the vendor's open premium request, if any
  async function loadRequest() {
    const { data } = await supabase
      .from("premium_requests")
      .select("id, created_at")
      .eq("status", "pending")
      .maybeSingle();
    setRequest(data || null);
  }

  // Save a new username and market, needs internet
  async function saveProfile() {
    const cleanUser = editUsername.trim().toLowerCase();
    const cleanMarket = editMarket.trim();
    if (cleanUser.length < 3) {
      notify("Username too short", "Use at least 3 letters.");
      return;
    }
    if (cleanMarket.length === 0) {
      notify("Market required", "Please enter the name of your market.");
      return;
    }
    setBusy(true);
    try {
      if (cleanUser !== username) {
        const { data: available, error: checkError } = await supabase.rpc(
          "username_available", { check_name: cleanUser }
        );
        if (checkError) throw checkError;
        if (!available) {
          notify("Username taken", "Please choose a different username.");
          return;
        }
      }
      const { error } = await supabase
        .from("profiles")
        .update({ username: cleanUser, market_name: cleanMarket })
        .eq("id", user.id);
      if (error) throw error;
      setProfile(await refreshProfile(user.id));
      notify("Saved", "Your profile is updated.");
    } catch (error) {
      notify("Could not save", "Check your internet and try again.");
    } finally {
      setBusy(false);
    }
  }

  // Change the PIN, typed twice so a typo cannot lock the vendor out
  async function changePin() {
    if (newPin.length < 6) {
      notify("PIN too short", "Use at least 6 numbers or letters.");
      return;
    }
    if (newPin !== confirmPin) {
      notify("PINs do not match", "Type the same new PIN in both boxes.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: newPin });
    setBusy(false);
    if (error) {
      notify("Could not change the PIN", error.message);
      return;
    }
    setNewPin("");
    setConfirmPin("");
    notify("PIN changed", "Use your new PIN the next time you log in.");
  }

  // Ask the owner for premium
  async function requestPremium() {
    setBusy(true);
    const { error } = await supabase.rpc("request_premium");
    setBusy(false);
    if (error) {
      notify("Could not send the request", "Check your internet and try again.");
      return;
    }
    await loadRequest();
    notify("Request sent", PAYMENT_NOTE);
  }

  // Cancel an open premium request
  function cancelRequest() {
    confirmAction("Cancel your premium request?", "You can request again anytime.", "Cancel request", async () => {
      await supabase.rpc("cancel_premium_request");
      setRequest(null);
    });
  }

  // Log out, the session listener in App switches back to the login screen
  function logout() {
    confirmAction(
      "Log out?",
      "Your records stay saved on this device.",
      "Log out",
      () => supabase.auth.signOut()
    );
  }

  // ----- screens -----

  function renderHeader(title) {
    return (
      <View>
        <View style={styles.headerRow}>
          <Text style={styles.title}>{title}</Text>
          <Text style={premium ? styles.tagPremium : styles.tagFree}>{tierLabel()}</Text>
        </View>
        {disabled && (
          <Text style={styles.bannerDanger}>
            Your account is disabled. Your records are safe, but new records cannot be saved.
            Contact the Tindahan owner.
          </Text>
        )}
      </View>
    );
  }

  function renderEntry() {
    return (
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {renderHeader("Tindahan")}
        <Text style={styles.greeting} numberOfLines={1}>Kumusta, {username}</Text>
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
        <View style={styles.kindGrid}>
          {Object.keys(KINDS).map((k) => {
            const locked = PREMIUM_KINDS.includes(k) && !premium;
            return (
              <TouchableOpacity
                key={k}
                style={[
                  styles.kindButton,
                  locked && styles.kindLocked,
                  kind === k && styles["kindActive_" + k],
                ]}
                onPress={() => chooseKind(k)}
              >
                <Text style={[styles.kindText, kind === k && styles.kindTextActive]}>
                  {KINDS[k].button}
                </Text>
                <Text style={[styles.kindNote, kind === k && styles.kindTextActive]}>
                  {locked ? "Premium" : KINDS[k].note}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <TouchableOpacity style={styles.saveButton} onPress={saveRecord}>
          <Text style={styles.saveText}>I-SAVE</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  function renderUpgradeCard(message) {
    return (
      <View style={styles.upgradeCard}>
        <Text style={styles.upgradeTitle}>{message}</Text>
        <Text style={styles.upgradePrice}>Premium, 99 pesos a month</Text>
        <TouchableOpacity style={styles.primaryButton} onPress={() => openScreen("account")}>
          <Text style={styles.primaryButtonText}>SEE PREMIUM</Text>
        </TouchableOpacity>
      </View>
    );
  }

  function renderRecords(kinds) {
    const list = todays.filter((r) => kinds.includes(r.kind));
    if (list.length === 0) {
      return <Text style={styles.empty}>Wala pang record ngayong araw.</Text>;
    }
    return (
      <View>
        <Text style={styles.hint}>
          {Platform.OS === "web" ? "Click a record to delete it" : "Long press a record to delete it"}
        </Text>
        {list.map((item) => (
          <TouchableOpacity
            key={item.id}
            onLongPress={() => confirmDelete(item)}
            onPress={Platform.OS === "web" ? () => confirmDelete(item) : undefined}
          >
            <View style={styles.recordRow}>
              <View style={styles.recordInfo}>
                <Text style={styles.recordText}>{item.description}</Text>
                <Text style={styles.recordNote}>{KINDS[item.kind].note}</Text>
              </View>
              <Text style={amountStyle(item.kind)}>
                {KINDS[item.kind].sign + pesos(item.amount)}
              </Text>
            </View>
          </TouchableOpacity>
        ))}
      </View>
    );
  }

  function renderTotal(label, value, style) {
    return (
      <View style={styles.totalBox}>
        <Text style={styles.totalLabel}>{label}</Text>
        <Text style={style}>{pesos(value)}</Text>
      </View>
    );
  }

  function renderDashboard() {
    const current = TABS.find((t) => t.key === tab);
    const lockedTab = tab !== "business" && !premium && !hasHouseholdRecords;
    return (
      <ScrollView contentContainerStyle={styles.body}>
        {renderHeader("Ngayong araw")}
        <TouchableOpacity onPress={runSync}>
          <Text style={syncStatus === "offline" || syncStatus === "disabled" ? styles.syncBad : styles.syncOk}>
            {syncLabel()}
          </Text>
        </TouchableOpacity>

        <View style={styles.tabBar}>
          {TABS.map((t) => (
            <TouchableOpacity
              key={t.key}
              style={[styles.tabButton, tab === t.key && styles.tabActive]}
              onPress={() => setTab(t.key)}
            >
              <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {(premium || hasHouseholdRecords) && (
          <View style={styles.cashLeft}>
            <Text style={styles.cashLeftLabel}>Natira, cash left</Text>
            <Text style={cashLeft >= 0 ? styles.amountIn : styles.amountOut}>{pesos(cashLeft)}</Text>
          </View>
        )}

        {tab === "business" && (
          <View>
            {renderTotal("Money in", moneyIn, styles.amountIn)}
            {renderTotal("Money out", moneyOut, styles.amountOut)}
            {renderTotal("Kita, business net", net, net >= 0 ? styles.amountIn : styles.amountOut)}
          </View>
        )}
        {tab === "personal" && !lockedTab && renderTotal("Personal na gastos", personalSpent, styles.amountPersonal)}
        {tab === "withdrawal" && !lockedTab && renderTotal("Kinuha para sa bahay", withdrawn, styles.amountWithdrawal)}

        {lockedTab
          ? renderUpgradeCard(tab === "personal"
            ? "Keep personal spending separate from the business."
            : "See how much the household takes from the business.")
          : renderRecords(current.kinds)}
      </ScrollView>
    );
  }

  function renderAccount() {
    return (
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {renderHeader("Account")}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Profile</Text>
          <Text style={styles.label}>Username</Text>
          <TextInput
            style={styles.input}
            value={editUsername}
            onChangeText={setEditUsername}
            autoCapitalize="none"
          />
          <Text style={styles.label}>Palengke, market name</Text>
          <TextInput style={styles.input} value={editMarket} onChangeText={setEditMarket} />
          <Text style={styles.hint}>Email, {user.email}</Text>
          <TouchableOpacity style={styles.primaryButton} onPress={saveProfile} disabled={busy}>
            <Text style={styles.primaryButtonText}>SAVE PROFILE</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Change PIN</Text>
          <Text style={styles.label}>New PIN, at least 6</Text>
          <TextInput style={styles.input} value={newPin} onChangeText={setNewPin} secureTextEntry />
          <Text style={styles.label}>Type the new PIN again</Text>
          <TextInput style={styles.input} value={confirmPin} onChangeText={setConfirmPin} secureTextEntry />
          <TouchableOpacity style={styles.primaryButton} onPress={changePin} disabled={busy}>
            <Text style={styles.primaryButtonText}>CHANGE PIN</Text>
          </TouchableOpacity>
        </View>

        <View style={[styles.card, styles.premiumCard]}>
          <Text style={styles.cardTitle}>Premium</Text>
          {ownerPremium ? (
            <Text style={styles.cardText}>
              Owner premium is on. You can switch it off in the admin dashboard to see the free view.
            </Text>
          ) : premium ? (
            <Text style={styles.cardText}>
              Premium until {shortDate(paidUntil)}, {daysLeft} {daysLeft === 1 ? "day" : "days"} left.
              To add more time, contact the Tindahan owner.
            </Text>
          ) : (
            <Text style={styles.cardText}>You are on the free plan. Premium is 99 pesos a month.</Text>
          )}
          {PREMIUM_BENEFITS.map((b) => (
            <Text key={b} style={styles.benefit}>{"\u2713  "}{b}</Text>
          ))}
          {!premium && (request ? (
            <View>
              <Text style={styles.requestNote}>
                Request sent {shortDate(request.created_at)}. {PAYMENT_NOTE}
              </Text>
              <TouchableOpacity onPress={cancelRequest}>
                <Text style={styles.linkText}>Cancel request</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity style={styles.premiumButton} onPress={requestPremium} disabled={busy}>
              <Text style={styles.premiumButtonText}>REQUEST PREMIUM</Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity style={styles.logoutButton} onPress={logout}>
          <Text style={styles.logoutText}>LOG OUT</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  return (
    <View style={styles.page}>
      <SafeAreaView style={styles.container}>
        <View style={styles.screen}>
          {screen === "entry" && renderEntry()}
          {screen === "dashboard" && renderDashboard()}
          {screen === "account" && renderAccount()}
        </View>
        <View style={styles.nav}>
          {[["entry", "ENTRY"], ["dashboard", "DASHBOARD"], ["account", "ACCOUNT"]].map(([key, label]) => (
            <TouchableOpacity
              key={key}
              style={[styles.navButton, screen === key && styles.navActive]}
              onPress={() => openScreen(key)}
            >
              <Text style={[styles.navText, screen === key && styles.navTextActive]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </SafeAreaView>
    </View>
  );
}

// Styles, large text and big touch targets for elderly and low literacy users
const GREEN = "#2d5016";
const MANGO = "#f2b21b";
const styles = StyleSheet.create({
  // the page fills the window, on a wide PC screen the app is a column in the middle
  page: { flex: 1, backgroundColor: "#e8e2d5" },
  container: { flex: 1, width: "100%", maxWidth: 560, alignSelf: "center", backgroundColor: "#f5f1e8" },
  screen: { flex: 1 },
  body: { padding: 20, paddingTop: 40, paddingBottom: 40 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#f5f1e8" },

  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  title: { fontSize: 32, fontWeight: "bold", color: GREEN, flexShrink: 1 },
  greeting: { fontSize: 20, color: "#333", marginTop: 6 },
  tagPremium: {
    backgroundColor: MANGO, color: "#4d3500", fontWeight: "bold", fontSize: 14,
    paddingVertical: 5, paddingHorizontal: 10, borderRadius: 6, overflow: "hidden", flexShrink: 0,
  },
  tagFree: {
    backgroundColor: "#dfe3dd", color: "#4f5d52", fontWeight: "bold", fontSize: 14,
    paddingVertical: 5, paddingHorizontal: 10, borderRadius: 6, overflow: "hidden", flexShrink: 0,
  },
  bannerDanger: {
    backgroundColor: "#a93a26", color: "white", fontSize: 16, fontWeight: "bold",
    padding: 12, borderRadius: 10, marginTop: 12,
  },

  label: { fontSize: 18, color: "#555", marginBottom: 6, marginTop: 14 },
  hint: { fontSize: 15, color: "#777", marginTop: 12, marginBottom: 6 },
  input: {
    backgroundColor: "white", borderRadius: 10, padding: 14,
    fontSize: 22, borderWidth: 1, borderColor: "#ccc",
  },

  // four equal record type buttons in a two by two grid
  kindGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", marginTop: 20, rowGap: 10 },
  kindButton: {
    width: "48.5%", minHeight: 78, paddingVertical: 12, paddingHorizontal: 8,
    borderRadius: 10, backgroundColor: "white", borderWidth: 2, borderColor: "#cfd4ce",
    alignItems: "center", justifyContent: "center",
  },
  kindLocked: { backgroundColor: "#eceeea", borderStyle: "dashed" },
  kindActive_in: { backgroundColor: "#2e7d32", borderColor: "#2e7d32" },
  kindActive_out: { backgroundColor: "#c62828", borderColor: "#c62828" },
  kindActive_withdrawal: { backgroundColor: "#ef6c00", borderColor: "#ef6c00" },
  kindActive_personal: { backgroundColor: "#6a1b9a", borderColor: "#6a1b9a" },
  kindText: { fontSize: 19, fontWeight: "bold", color: "#333", textAlign: "center" },
  kindNote: { fontSize: 13, color: "#666", marginTop: 3, textAlign: "center" },
  kindTextActive: { color: "white" },

  saveButton: { marginTop: 26, backgroundColor: GREEN, padding: 20, borderRadius: 12, alignItems: "center" },
  saveText: { fontSize: 26, fontWeight: "bold", color: "white" },

  syncOk: { fontSize: 15, color: "#2e7d32", marginTop: 8 },
  syncBad: { fontSize: 15, color: "#e65100", marginTop: 8, fontWeight: "bold" },

  // the business, personal, withdrawal switch at the top of the dashboard
  tabBar: {
    flexDirection: "row", marginTop: 16, backgroundColor: "#e8e2d5",
    borderRadius: 10, padding: 4,
  },
  tabButton: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: "center" },
  tabActive: { backgroundColor: GREEN },
  tabText: { fontSize: 14, fontWeight: "bold", color: "#555" },
  tabTextActive: { color: "white" },

  cashLeft: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    backgroundColor: "#fff8e1", borderLeftWidth: 6, borderLeftColor: MANGO,
    borderRadius: 10, padding: 14, marginTop: 14,
  },
  cashLeftLabel: { fontSize: 18, fontWeight: "bold", color: "#4d3500" },

  totalBox: {
    backgroundColor: "white", borderRadius: 10, padding: 16, marginTop: 10,
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
  },
  totalLabel: { fontSize: 19, color: "#333", flexShrink: 1 },
  amountIn: { fontSize: 21, fontWeight: "bold", color: "#2e7d32" },
  amountOut: { fontSize: 21, fontWeight: "bold", color: "#c62828" },
  amountWithdrawal: { fontSize: 21, fontWeight: "bold", color: "#ef6c00" },
  amountPersonal: { fontSize: 21, fontWeight: "bold", color: "#6a1b9a" },

  recordRow: {
    backgroundColor: "white", borderRadius: 8, padding: 14, marginBottom: 8,
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
  },
  recordInfo: { flex: 1, marginRight: 10 },
  recordText: { fontSize: 18, color: "#333" },
  recordNote: { fontSize: 14, color: "#777" },
  empty: { fontSize: 17, color: "#777", marginTop: 16 },

  upgradeCard: {
    backgroundColor: "white", borderRadius: 12, padding: 18, marginTop: 14,
    borderWidth: 2, borderColor: MANGO,
  },
  upgradeTitle: { fontSize: 19, color: "#333", fontWeight: "bold" },
  upgradePrice: { fontSize: 16, color: "#4d3500", marginTop: 6 },

  card: { backgroundColor: "white", borderRadius: 12, padding: 18, marginTop: 16 },
  premiumCard: { borderWidth: 2, borderColor: MANGO },
  cardTitle: { fontSize: 22, fontWeight: "bold", color: GREEN },
  cardText: { fontSize: 17, color: "#333", marginTop: 8, marginBottom: 6 },
  benefit: { fontSize: 16, color: "#333", marginTop: 6 },
  requestNote: { fontSize: 16, color: "#4d3500", marginTop: 14, backgroundColor: "#fff8e1", padding: 12, borderRadius: 8 },
  linkText: { fontSize: 16, color: "#c62828", fontWeight: "bold", marginTop: 10 },
  primaryButton: { marginTop: 16, backgroundColor: GREEN, padding: 16, borderRadius: 10, alignItems: "center" },
  primaryButtonText: { fontSize: 18, fontWeight: "bold", color: "white" },
  premiumButton: { marginTop: 16, backgroundColor: MANGO, padding: 16, borderRadius: 10, alignItems: "center" },
  premiumButtonText: { fontSize: 18, fontWeight: "bold", color: "#4d3500" },
  logoutButton: {
    marginTop: 20, padding: 14, borderRadius: 10,
    borderWidth: 2, borderColor: "#c62828", alignItems: "center",
  },
  logoutText: { fontSize: 18, fontWeight: "bold", color: "#c62828" },

  nav: { flexDirection: "row", borderTopWidth: 1, borderColor: "#ccc" },
  navButton: { flex: 1, paddingVertical: 16, alignItems: "center", backgroundColor: "#e8e2d5" },
  navActive: { backgroundColor: GREEN },
  navText: { fontSize: 15, fontWeight: "bold", color: "#333" },
  navTextActive: { color: "white" },
});
