// App.js
// Tindahan, a money tracker for public market vendors.
// Built to learn React Native with Expo. Three screens, Entry to record money,
// Dashboard for today's totals in Business, Personal, and Withdrawal tabs, and
// Schedule for premium bill reminders, and Account to edit the profile,
// change the PIN, set reminders, and get premium.
// Records are saved on the phone first so the app works with no signal, then
// synced both ways with Supabase whenever there is internet.
// The same code also runs in a PC web browser through Expo for web.
// Premium, 99 pesos a month or 999 a year, adds withdrawals and personal expenses.
// Vendors pay by GCash in their own GCash app, then send the reference number
// for the owner to check and approve.

import { useState, useEffect } from "react";
import {
  StyleSheet, Text, View, TextInput, TouchableOpacity, ScrollView,
  SafeAreaView, ActivityIndicator, AppState, Platform,
} from "react-native";
import { supabase } from "./lib/supabase";
import { notify, confirmAction } from "./lib/notify";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  readLocal, updateLocal, syncRecords, newId, nowIso,
  readProfile, refreshProfile, isPremium, PREMIUM_KINDS, readSchedules,
} from "./lib/sync";
import {
  alarmsSupported, alarmsUnavailable, readReminderSettings, saveReminderSettings,
  askPermission, refreshReminders, notifyNow, testReminder,
} from "./lib/notifications";
import AuthScreen from "./AuthScreen";
import ScheduleScreen from "./ScheduleScreen";

// The color palette, shared by every screen
const SLATE = "#1E293B";      // text, active navigation, structure
const PAGE = "#F8FAFC";       // background
const CARD = "#FFFFFF";       // cards and inputs
const LINE = "#E2E8F0";       // borders
const MUTED = "#64748B";      // secondary text
const EMERALD = "#059669";    // money in, growth, main actions
const INDIGO = "#2563EB";     // premium, withdrawals
const CRIMSON = "#DC2626";    // money out, errors, alerts

// What premium includes, shown wherever a vendor can upgrade
const PREMIUM_BENEFITS = [
  "Record withdrawals, money taken from the business for home",
  "Record personal expenses, separate from the business",
  "See what is really left after the household takes its share",
  "Full history and monthly reports, coming soon",
];
const DEFAULT_APPROVAL = "Payments are approved within 2 to 4 hours.";

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

// 09615689971 is shown as 0961 568 9971, easier to type into GCash
function spacedNumber(number) {
  return number.length === 11
    ? number.slice(0, 4) + " " + number.slice(4, 7) + " " + number.slice(7)
    : number;
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
        <ActivityIndicator size="large" color={EMERALD} />
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
  // the vendor's latest premium request, pending or recently rejected, or null
  const [request, setRequest] = useState(null);
  // GCash payment details and prices from the database
  const [payment, setPayment] = useState(null);
  const [plan, setPlan] = useState("monthly");
  const [reference, setReference] = useState("");
  // premium schedules, reminder settings, and how many alarms are set
  const [schedules, setSchedules] = useState([]);
  const [reminderSettings, setReminderSettings] = useState({ enabled: true, sound: true });
  const [alarmStatus, setAlarmStatus] = useState(null);
  // shown once when the owner approves a premium payment
  const [welcome, setWelcome] = useState(false);

  // Load records and account from the phone, sync, and sync again on return
  useEffect(() => {
    Promise.all([readLocal(user.id), readProfile(user.id), readSchedules(user.id)])
      .then(([savedRecords, savedProfile, savedSchedules]) => {
        setRecords(savedRecords);
        setProfile(savedProfile);
        setSchedules(savedSchedules);
        resetAlarms(savedSchedules, savedProfile);
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
        setSchedules(result.schedules);
        setProfile(result.profile);
        setHeldBack(result.heldBack);
        setSyncStatus(result.profile.disabled ? "disabled" : "synced");
        resetAlarms(result.schedules, result.profile);
        checkWelcome(result.profile);
      }
    } catch (error) {
      setSyncStatus("offline");
    }
  }

  // Set the phone alarms again from the latest schedules and premium status
  async function resetAlarms(list, prof) {
    try {
      const status = await refreshReminders({
        userId: user.id, schedules: list, profile: prof, premium: isPremium(prof),
      });
      setAlarmStatus(status);
    } catch (error) {
      setAlarmStatus({ count: 0, reason: "error" });
    }
  }

  // After a schedule is added, paid, or deleted, set the alarms from the phone's
  // own copy right away, so it works offline, then sync when there is internet
  async function afterScheduleChange() {
    resetAlarms(await readSchedules(user.id), profile);
    runSync();
  }

  // After the owner approves a payment, welcome the vendor to premium once
  async function checkWelcome(prof) {
    if (!prof || !prof.premium_until || new Date(prof.premium_until) <= new Date()) return;
    if (prof.role === "owner" && prof.owner_premium) return;
    const key = "tindahan_welcomed_" + user.id;
    const seen = await AsyncStorage.getItem(key);
    if (seen !== null && new Date(seen) >= new Date(prof.premium_until)) return;
    await AsyncStorage.setItem(key, prof.premium_until);
    setWelcome(true);
    notifyNow("Welcome to Tindahan Premium", "Your payment is approved. Salamat, enjoy your new features.");
  }

  const premium = isPremium(profile);
  const disabled = Boolean(profile && profile.disabled);
  const ownerPremium = Boolean(profile && profile.role === "owner" && profile.owner_premium);
  const paidUntil = profile && profile.premium_until && new Date(profile.premium_until) > new Date()
    ? profile.premium_until
    : null;
  const daysLeft = paidUntil ? Math.ceil((new Date(paidUntil) - new Date()) / 86400000) : 0;
  const username = (profile && profile.username) || user.user_metadata?.username || user.email;

  // The short status shown in the tag next to the title
  function tierLabel() {
    if (ownerPremium) return "Premium, owner";
    if (premium) return "Premium, " + daysLeft + (daysLeft === 1 ? " day" : " days");
    return "Free";
  }

  // Open a screen, the account screen loads its forms, the request, and payment details
  function openScreen(next) {
    setScreen(next);
    if (next === "account") {
      setEditUsername(username);
      setEditMarket((profile && profile.market_name) || "");
      loadRequest();
      loadPayment();
      readReminderSettings(user.id).then(setReminderSettings);
    }
  }

  // Shown when a free vendor taps a premium feature
  function askUpgrade() {
    confirmAction(
      "Premium feature",
      "Premium adds withdrawals and personal expenses, 99 pesos a month or 999 a year. See premium in your account?",
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

  // Load the vendor's latest request, a pending one, or a rejection from the last week
  async function loadRequest() {
    const { data } = await supabase
      .from("premium_requests")
      .select("id, status, plan, amount, reference_number, note, created_at, closed_at")
      .in("status", ["pending", "rejected"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const weekAgo = Date.now() - 7 * 86400000;
    const recent = data && (data.status === "pending"
      || new Date(data.closed_at || data.created_at).getTime() > weekAgo);
    setRequest(recent ? data : null);
  }

  // Load the GCash number, name, and prices set by the owner
  async function loadPayment() {
    const { data } = await supabase
      .from("app_settings")
      .select("gcash_number, gcash_name, monthly_price, annual_price, approval_note")
      .single();
    setPayment(data || null);
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

  // Send the GCash reference number for the owner to check and approve
  async function sendForApproval() {
    const digits = reference.replace(/\D/g, "");
    if (digits.length < 8) {
      notify("Reference number needed", "Type the reference number from your GCash receipt.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.rpc("request_premium", {
      chosen_plan: plan, reference: digits,
    });
    setBusy(false);
    if (error) {
      notify("Could not send", error.message.includes("reference_once")
        ? "This reference number was already used. Check your GCash receipt."
        : "Check your internet and try again.");
      return;
    }
    setReference("");
    await loadRequest();
    notify("Sent for approval", (payment && payment.approval_note) || DEFAULT_APPROVAL);
  }

  // Cancel an open request, only meant for vendors who have not paid yet
  function cancelRequest() {
    confirmAction(
      "Cancel your request?",
      "Only cancel if you have not paid yet. You can send again anytime.",
      "Cancel request",
      async () => {
        await supabase.rpc("cancel_premium_request");
        setRequest(null);
      }
    );
  }

  // Turn reminders or their sound on and off, then set the alarms again
  async function changeReminders(field) {
    const next = { ...reminderSettings, [field]: !reminderSettings[field] };
    if (field === "enabled" && next.enabled) {
      const allowed = await askPermission();
      if (!allowed) {
        notify("Notifications are off", "Allow notifications for Tindahan in your phone settings to get reminders.");
      }
    }
    await saveReminderSettings(user.id, next);
    setReminderSettings(next);
    resetAlarms(schedules, profile);
  }

  // Send a test reminder in 5 seconds
  async function sendTest() {
    const sent = await testReminder(user.id);
    notify(sent ? "Test sent" : "Notifications are off",
      sent ? "A test reminder will appear in 5 seconds."
        : "Allow notifications for Tindahan in your phone settings to get reminders.");
    resetAlarms(schedules, profile);
  }

  // What the reminder settings card says about the alarms
  function alarmLabel() {
    if (!alarmStatus) return "Checking reminders...";
    if (alarmStatus.reason === "off") return "Reminders are off.";
    if (alarmStatus.reason === "permission") return "Notifications are blocked. Turn them on in your phone settings.";
    if (alarmStatus.reason === "error") return "Could not set reminders. Close and open the app again.";
    return alarmStatus.count + (alarmStatus.count === 1 ? " reminder" : " reminders") + " set for the next 30 days.";
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
        <Text style={styles.upgradePrice}>Premium, 99 pesos a month or 999 a year</Text>
        <TouchableOpacity style={styles.premiumButton} onPress={() => openScreen("account")}>
          <Text style={styles.premiumButtonText}>GET PREMIUM</Text>
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

  // The premium card, status, then either the waiting request or the GCash payment form
  function renderPremiumCard() {
    const monthly = payment ? payment.monthly_price : 99;
    const annual = payment ? payment.annual_price : 999;
    const saving = monthly * 12 - annual;
    const price = plan === "annual" ? annual : monthly;
    const approval = (payment && payment.approval_note) || DEFAULT_APPROVAL;
    const pending = request && request.status === "pending";
    const rejected = request && request.status === "rejected";
    return (
      <View style={[styles.card, styles.premiumCard]}>
        <Text style={styles.cardTitle}>Premium</Text>
        {ownerPremium ? (
          <Text style={styles.cardText}>
            Owner premium is on. You can switch it off in the admin dashboard to see the free view.
          </Text>
        ) : premium ? (
          <Text style={styles.cardText}>
            Premium until {shortDate(paidUntil)}, {daysLeft} {daysLeft === 1 ? "day" : "days"} left.
            You can add more time below.
          </Text>
        ) : (
          <Text style={styles.cardText}>You are on the free plan.</Text>
        )}
        {!premium && PREMIUM_BENEFITS.map((b) => (
          <Text key={b} style={styles.benefit}>{"\u2713  "}{b}</Text>
        ))}

        {!ownerPremium && pending && (
          <View style={styles.waitBox}>
            <Text style={styles.waitTitle}>Waiting for approval</Text>
            <Text style={styles.waitText}>
              {request.plan === "annual" ? "1 year" : "1 month"}, P {request.amount},
              reference {request.reference_number}
            </Text>
            <Text style={styles.waitText}>Sent {shortDate(request.created_at)}. {approval}</Text>
            <TouchableOpacity onPress={cancelRequest}>
              <Text style={styles.linkText}>Cancel request</Text>
            </TouchableOpacity>
          </View>
        )}

        {!ownerPremium && !pending && (
          <View>
            {rejected && (
              <Text style={styles.rejectBox}>
                Your last payment was not approved. {request.note} Check the reference number
                on your GCash receipt and send it again.
              </Text>
            )}
            <Text style={styles.stepTitle}>{premium ? "Add more time" : "Choose a plan"}</Text>
            <View style={styles.planRow}>
              {[
                ["monthly", "Monthly", "P " + monthly, "30 days"],
                ["annual", "Annual", "P " + annual, "1 year, save P " + saving],
              ].map(([key, name, cost, detail]) => (
                <TouchableOpacity
                  key={key}
                  style={[styles.planCard, plan === key && styles.planActive]}
                  onPress={() => setPlan(key)}
                >
                  <Text style={[styles.planName, plan === key && styles.planTextActive]}>{name}</Text>
                  <Text style={[styles.planPrice, plan === key && styles.planTextActive]}>{cost}</Text>
                  <Text style={[styles.planDetail, plan === key && styles.planTextActive]}>{detail}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {payment && payment.gcash_number ? (
              <View style={styles.payBox}>
                <Text style={styles.payStep}>1. Open GCash and send P {price} to</Text>
                <Text style={styles.payNumber} selectable>{spacedNumber(payment.gcash_number)}</Text>
                <Text style={styles.payName}>{payment.gcash_name}</Text>
                <Text style={styles.payStep}>2. Type the reference number from your GCash receipt</Text>
                <TextInput
                  style={styles.input}
                  value={reference}
                  onChangeText={setReference}
                  keyboardType="number-pad"
                  placeholder="halimbawa, 1234 567 890123"
                />
                <Text style={styles.payStep}>3. Tap send. {approval}</Text>
                <TouchableOpacity style={styles.premiumButton} onPress={sendForApproval} disabled={busy}>
                  <Text style={styles.premiumButtonText}>I PAID, SEND FOR APPROVAL</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <Text style={styles.hint}>Payment details are loading. Check your internet if this stays.</Text>
            )}
          </View>
        )}
      </View>
    );
  }

  function renderSchedule() {
    return (
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <ScheduleScreen
          user={user}
          schedules={schedules}
          onSchedules={setSchedules}
          onRecords={setRecords}
          afterChange={afterScheduleChange}
          premium={premium}
          header={renderHeader("Schedule")}
          upgrade={renderUpgradeCard("Never miss a bill. Get reminded before kuryente, rent, and suppliers are due.")}
        />
      </ScrollView>
    );
  }

  function renderReminderCard() {
    if (!alarmsSupported) {
      return (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Reminders</Text>
          <Text style={styles.cardText}>
            {alarmsUnavailable === "expo-go"
              ? "Reminder alarms need the installed Tindahan app. They are turned off while testing in Expo Go."
              : "Reminder alarms ring on your phone. Open Tindahan on your phone to set them."}
          </Text>
        </View>
      );
    }
    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Reminders</Text>
        {[["enabled", "Remind me about schedules"], ["sound", "Play a sound"]].map(([field, label]) => (
          <TouchableOpacity key={field} style={styles.toggleRow} onPress={() => changeReminders(field)}>
            <Text style={styles.toggleLabel}>{label}</Text>
            <View style={[styles.toggle, reminderSettings[field] && styles.toggleOn]}>
              <View style={[styles.knob, reminderSettings[field] && styles.knobOn]} />
            </View>
          </TouchableOpacity>
        ))}
        <Text style={styles.hint}>{alarmLabel()}</Text>
        <TouchableOpacity style={styles.outlineButton} onPress={sendTest}>
          <Text style={styles.outlineButtonText}>SEND A TEST REMINDER</Text>
        </TouchableOpacity>
      </View>
    );
  }

  function renderWelcome() {
    return (
      <View style={styles.welcomeOverlay}>
        <View style={styles.welcomeCard}>
          <Text style={styles.welcomeTag}>PREMIUM</Text>
          <Text style={styles.welcomeTitle}>Welcome to Tindahan Premium</Text>
          <Text style={styles.welcomeText}>
            Your payment is approved, salamat. You now have premium until {shortDate(profile.premium_until)}.
          </Text>
          {["Withdrawals and personal expenses", "Schedules with reminders for your bills", "What is really left after the household share"].map((b) => (
            <Text key={b} style={styles.welcomeBenefit}>{"\u2713  "}{b}</Text>
          ))}
          <TouchableOpacity style={styles.welcomeButton} onPress={() => { setWelcome(false); openScreen("schedule"); }}>
            <Text style={styles.welcomeButtonText}>SET UP MY FIRST SCHEDULE</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setWelcome(false)}>
            <Text style={styles.welcomeLater}>Later</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  function renderAccount() {
    return (
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {renderHeader("Account")}

        {renderPremiumCard()}

        {premium && renderReminderCard()}

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
          {screen === "schedule" && renderSchedule()}
          {screen === "account" && renderAccount()}
        </View>
        <View style={styles.nav}>
          {[["entry", "ENTRY"], ["dashboard", "TODAY"], ["schedule", "SCHEDULE"], ["account", "ACCOUNT"]].map(([key, label]) => (
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
      {welcome && profile && renderWelcome()}
    </View>
  );
}

// Styles, large text and big touch targets for elderly and low literacy users
const styles = StyleSheet.create({
  // the page fills the window, on a wide PC screen the app is a column in the middle
  page: { flex: 1, backgroundColor: "#E2E8F0" },
  container: { flex: 1, width: "100%", maxWidth: 560, alignSelf: "center", backgroundColor: PAGE },
  screen: { flex: 1 },
  body: { padding: 20, paddingTop: 40, paddingBottom: 40 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: PAGE },

  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  title: { fontSize: 32, fontWeight: "bold", color: SLATE, flexShrink: 1 },
  greeting: { fontSize: 20, color: SLATE, marginTop: 6 },
  tagPremium: {
    backgroundColor: INDIGO, color: "white", fontWeight: "bold", fontSize: 14,
    paddingVertical: 5, paddingHorizontal: 10, borderRadius: 6, overflow: "hidden", flexShrink: 0,
  },
  tagFree: {
    backgroundColor: LINE, color: MUTED, fontWeight: "bold", fontSize: 14,
    paddingVertical: 5, paddingHorizontal: 10, borderRadius: 6, overflow: "hidden", flexShrink: 0,
  },
  bannerDanger: {
    backgroundColor: CRIMSON, color: "white", fontSize: 16, fontWeight: "bold",
    padding: 12, borderRadius: 10, marginTop: 12,
  },

  label: { fontSize: 18, color: MUTED, marginBottom: 6, marginTop: 14 },
  hint: { fontSize: 15, color: MUTED, marginTop: 12, marginBottom: 6 },
  input: {
    backgroundColor: CARD, borderRadius: 10, padding: 14, color: SLATE,
    fontSize: 22, borderWidth: 1, borderColor: LINE,
  },

  // four equal record type buttons in a two by two grid
  kindGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", marginTop: 20, rowGap: 10 },
  kindButton: {
    width: "48.5%", minHeight: 78, paddingVertical: 12, paddingHorizontal: 8,
    borderRadius: 10, backgroundColor: CARD, borderWidth: 2, borderColor: LINE,
    alignItems: "center", justifyContent: "center",
  },
  kindLocked: { backgroundColor: "#F1F5F9", borderStyle: "dashed" },
  kindActive_in: { backgroundColor: EMERALD, borderColor: EMERALD },
  kindActive_out: { backgroundColor: CRIMSON, borderColor: CRIMSON },
  kindActive_withdrawal: { backgroundColor: INDIGO, borderColor: INDIGO },
  kindActive_personal: { backgroundColor: SLATE, borderColor: SLATE },
  kindText: { fontSize: 19, fontWeight: "bold", color: SLATE, textAlign: "center" },
  kindNote: { fontSize: 13, color: MUTED, marginTop: 3, textAlign: "center" },
  kindTextActive: { color: "white" },

  saveButton: { marginTop: 26, backgroundColor: EMERALD, padding: 20, borderRadius: 12, alignItems: "center" },
  saveText: { fontSize: 26, fontWeight: "bold", color: "white" },

  syncOk: { fontSize: 15, color: EMERALD, marginTop: 8 },
  syncBad: { fontSize: 15, color: CRIMSON, marginTop: 8, fontWeight: "bold" },

  // the business, personal, withdrawal switch at the top of the dashboard
  tabBar: { flexDirection: "row", marginTop: 16, backgroundColor: LINE, borderRadius: 10, padding: 4 },
  tabButton: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: "center" },
  tabActive: { backgroundColor: SLATE },
  tabText: { fontSize: 14, fontWeight: "bold", color: MUTED },
  tabTextActive: { color: "white" },

  cashLeft: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    backgroundColor: "#ECFDF5", borderLeftWidth: 6, borderLeftColor: EMERALD,
    borderRadius: 10, padding: 14, marginTop: 14,
  },
  cashLeftLabel: { fontSize: 18, fontWeight: "bold", color: SLATE },

  totalBox: {
    backgroundColor: CARD, borderRadius: 10, padding: 16, marginTop: 10,
    borderWidth: 1, borderColor: LINE,
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
  },
  totalLabel: { fontSize: 19, color: SLATE, flexShrink: 1 },
  amountIn: { fontSize: 21, fontWeight: "bold", color: EMERALD },
  amountOut: { fontSize: 21, fontWeight: "bold", color: CRIMSON },
  amountWithdrawal: { fontSize: 21, fontWeight: "bold", color: INDIGO },
  amountPersonal: { fontSize: 21, fontWeight: "bold", color: SLATE },

  recordRow: {
    backgroundColor: CARD, borderRadius: 8, padding: 14, marginBottom: 8,
    borderWidth: 1, borderColor: LINE,
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
  },
  recordInfo: { flex: 1, marginRight: 10 },
  recordText: { fontSize: 18, color: SLATE },
  recordNote: { fontSize: 14, color: MUTED },
  empty: { fontSize: 17, color: MUTED, marginTop: 16 },

  upgradeCard: {
    backgroundColor: CARD, borderRadius: 12, padding: 18, marginTop: 14,
    borderWidth: 2, borderColor: INDIGO,
  },
  upgradeTitle: { fontSize: 19, color: SLATE, fontWeight: "bold" },
  upgradePrice: { fontSize: 16, color: INDIGO, marginTop: 6 },

  card: {
    backgroundColor: CARD, borderRadius: 12, padding: 18, marginTop: 16,
    borderWidth: 1, borderColor: LINE,
  },
  premiumCard: { borderWidth: 2, borderColor: INDIGO },
  cardTitle: { fontSize: 22, fontWeight: "bold", color: SLATE },
  cardText: { fontSize: 17, color: SLATE, marginTop: 8, marginBottom: 6 },
  benefit: { fontSize: 16, color: SLATE, marginTop: 6 },
  stepTitle: { fontSize: 18, fontWeight: "bold", color: SLATE, marginTop: 18 },

  // the monthly and annual plan picker
  planRow: { flexDirection: "row", gap: 10, marginTop: 10 },
  planCard: {
    flex: 1, borderWidth: 2, borderColor: LINE, borderRadius: 10,
    padding: 12, alignItems: "center", backgroundColor: CARD,
  },
  planActive: { backgroundColor: INDIGO, borderColor: INDIGO },
  planName: { fontSize: 16, fontWeight: "bold", color: SLATE },
  planPrice: { fontSize: 24, fontWeight: "bold", color: SLATE, marginTop: 2 },
  planDetail: { fontSize: 13, color: MUTED, marginTop: 2, textAlign: "center" },
  planTextActive: { color: "white" },

  // the GCash payment steps
  payBox: { marginTop: 14, backgroundColor: "#EFF6FF", borderRadius: 10, padding: 14 },
  payStep: { fontSize: 16, color: SLATE, marginTop: 10, marginBottom: 6 },
  payNumber: { fontSize: 28, fontWeight: "bold", color: INDIGO, letterSpacing: 1 },
  payName: { fontSize: 16, color: SLATE },
  waitBox: { marginTop: 14, backgroundColor: "#EFF6FF", borderRadius: 10, padding: 14 },
  waitTitle: { fontSize: 18, fontWeight: "bold", color: INDIGO },
  waitText: { fontSize: 16, color: SLATE, marginTop: 6 },
  rejectBox: {
    fontSize: 16, color: "white", backgroundColor: CRIMSON,
    padding: 12, borderRadius: 8, marginTop: 14,
  },
  linkText: { fontSize: 16, color: CRIMSON, fontWeight: "bold", marginTop: 12 },

  primaryButton: { marginTop: 16, backgroundColor: EMERALD, padding: 16, borderRadius: 10, alignItems: "center" },
  primaryButtonText: { fontSize: 18, fontWeight: "bold", color: "white" },
  premiumButton: { marginTop: 16, backgroundColor: INDIGO, padding: 16, borderRadius: 10, alignItems: "center" },
  premiumButtonText: { fontSize: 18, fontWeight: "bold", color: "white" },
  logoutButton: {
    marginTop: 20, padding: 14, borderRadius: 10,
    borderWidth: 2, borderColor: CRIMSON, alignItems: "center",
  },
  logoutText: { fontSize: 18, fontWeight: "bold", color: CRIMSON },

  nav: { flexDirection: "row", borderTopWidth: 1, borderColor: LINE, backgroundColor: CARD },
  navButton: { flex: 1, paddingVertical: 16, alignItems: "center" },
  navActive: { backgroundColor: SLATE },
  navText: { fontSize: 13, fontWeight: "bold", color: MUTED },
  navTextActive: { color: "white" },

  // reminder settings
  toggleRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingVertical: 12, borderBottomWidth: 1, borderColor: LINE,
  },
  toggleLabel: { fontSize: 18, color: SLATE, flexShrink: 1 },
  toggle: { width: 56, height: 32, borderRadius: 16, backgroundColor: LINE, padding: 3 },
  toggleOn: { backgroundColor: EMERALD },
  knob: { width: 26, height: 26, borderRadius: 13, backgroundColor: "white" },
  knobOn: { marginLeft: 24 },
  outlineButton: {
    marginTop: 12, padding: 14, borderRadius: 10, alignItems: "center",
    borderWidth: 2, borderColor: INDIGO,
  },
  outlineButtonText: { fontSize: 16, fontWeight: "bold", color: INDIGO },

  // the welcome to premium screen
  welcomeOverlay: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(30, 41, 59, 0.85)", justifyContent: "center", padding: 20,
  },
  welcomeCard: {
    backgroundColor: CARD, borderRadius: 16, padding: 24,
    width: "100%", maxWidth: 480, alignSelf: "center",
    borderTopWidth: 8, borderTopColor: INDIGO,
  },
  welcomeTag: { fontSize: 14, fontWeight: "bold", color: INDIGO, letterSpacing: 2 },
  welcomeTitle: { fontSize: 28, fontWeight: "bold", color: SLATE, marginTop: 6 },
  welcomeText: { fontSize: 17, color: SLATE, marginTop: 10, marginBottom: 8 },
  welcomeBenefit: { fontSize: 16, color: SLATE, marginTop: 6 },
  welcomeButton: { marginTop: 20, backgroundColor: EMERALD, padding: 16, borderRadius: 10, alignItems: "center" },
  welcomeButtonText: { fontSize: 17, fontWeight: "bold", color: "white" },
  welcomeLater: { fontSize: 16, color: MUTED, fontWeight: "bold", textAlign: "center", marginTop: 14 },
});
