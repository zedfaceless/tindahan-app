// App.js
// Tindahan, a money tracker for public market vendors.
// Built to learn React Native with Expo. Three screens, Entry to record money,
// Dashboard for today's totals in Business, Personal, and Withdrawal tabs, and
// Schedule for premium bill reminders, and Account to edit the profile,
// change the PIN, set reminders, and get premium.
// Records are saved on the phone first so the app works with no signal, then
// synced both ways with Supabase whenever there is internet.
// The same code also runs in a PC web browser through Expo for web.
// Every record is business or personal money, and money in or money out.
// Free tracks business money, premium, 99 pesos a month or 999 a year, adds personal.
// Vendors pay by GCash in their own GCash app, then send the reference number
// for the owner to check and approve.

import { useState, useEffect, useMemo } from "react";
import {
  StyleSheet, Text, View, TextInput, TouchableOpacity, ScrollView,
  SafeAreaView, ActivityIndicator, AppState, Platform, Image, StatusBar, Linking,
} from "react-native";
import * as Application from "expo-application";
import { PRIVACY_URL, TERMS_URL, PLAY_BUILD } from "./lib/legal";
import { ThemeProvider, useTheme, EMERALD, INDIGO, CRIMSON } from "./lib/theme";
import { supabase } from "./lib/supabase";
import { notify, confirmAction } from "./lib/notify";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  readLocal, updateLocal, syncRecords, newId, nowIso,
  readProfile, refreshProfile, isPremium, scopeNeedsPremium, readSchedules,
} from "./lib/sync";
import {
  alarmsSupported, alarmsUnavailable, readReminderSettings, saveReminderSettings,
  askPermission, refreshReminders, notifyNow, testReminder,
  sendNow, reminderHealth, openPhoneSettings,
} from "./lib/notifications";
import { Ionicons } from "@expo/vector-icons";
import { buildStatementHtml, statementRecords, periodFor, longDay, earliestStart, PREMIUM_MONTHS, MAX_MONTHS } from "./lib/statement";
import { parseDay, dayString, addDays } from "./lib/reminders";
import HistoryScreen from "./HistoryScreen";
import SupportScreen from "./SupportScreen";
import { savePdf } from "./lib/exportPdf";
import AuthScreen from "./AuthScreen";
import ScheduleScreen from "./ScheduleScreen";

// Colors come from lib/theme.js, Light or Abyss

// What premium includes, shown wherever a vendor can upgrade
const PREMIUM_BENEFITS = [
  "Track personal money, separate from the business",
  "Schedules with reminders so you never miss a bill",
  "See your total income and expense in one place",
  "Full history and monthly reports, coming soon",
];
const DEFAULT_APPROVAL = "Payments are approved within 2 to 4 hours.";

// Money in or money out, the only two types
const KINDS = {
  in: { button: "MONEY IN", sign: "+", saved: "Money in " },
  out: { button: "MONEY OUT", sign: "-", saved: "Money out " },
};

// Business or personal, and the small note under each record
const SCOPES = {
  business: { label: "NEGOSYO", sub: "business", note: { in: "negosyo, benta", out: "negosyo, gastos" } },
  personal: { label: "PERSONAL", sub: "sarili", note: { in: "personal, pumasok", out: "personal, gastos" } },
};

// The two dashboard tabs
const TABS = [
  { key: "business", label: "NEGOSYO, BUSINESS" },
  { key: "personal", label: "PERSONAL" },
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

// The whole app shares one look, Light or Abyss
export default function App() {
  return (
    <ThemeProvider>
      <Root />
    </ThemeProvider>
  );
}

// The top of the app, shows a loading screen, then login, then the tracker
function Root() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
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
  return (
    <>
      <StatusBar barStyle={colors.statusBar} backgroundColor={colors.page} />
      {session ? <Tracker key={session.user.id} user={session.user} /> : <AuthScreen />}
    </>
  );
}

// The money tracker itself, shown only to a logged in vendor
function Tracker({ user }) {
  const { colors, mode: theme, setMode: setTheme } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
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
  const [scope, setScope] = useState("business");
  // "syncing", "synced", "offline", or "disabled"
  const [syncStatus, setSyncStatus] = useState("syncing");
  // the vendor's own account from the last sync
  const [profile, setProfile] = useState(null);
  // premium records waiting on the phone because premium lapsed
  const [heldBack, setHeldBack] = useState(0);
  // the account screen forms
  const [editFullName, setEditFullName] = useState("");
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
  // what the phone itself says about Tindahan's notifications
  const [health, setHealth] = useState(null);
  // deleting the account, opened with a button and confirmed by typing DELETE
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteText, setDeleteText] = useState("");
  const [deleting, setDeleting] = useState(false);
  // shown once when the owner approves a premium payment
  const [welcome, setWelcome] = useState(false);
  // income statements, a free vendor's latest request, and a premium vendor's choices
  const [statementRequest, setStatementRequest] = useState(null);
  const [statementScope, setStatementScope] = useState("business");
  const [statementMonths, setStatementMonths] = useState(1);
  // a premium vendor's own dates, when they choose CUSTOM
  const [customFrom, setCustomFrom] = useState(todayString());
  const [customTo, setCustomTo] = useState(todayString());
  // support tickets with a reply the vendor has not read yet
  const [supportUnread, setSupportUnread] = useState(0);

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
        checkStatement(result.profile);
        checkSupport();
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
    if (next === "dashboard") {
      loadStatementRequest();
    }
    if (next === "account") {
      setEditFullName((profile && profile.full_name) || "");
      setEditUsername(username);
      setEditMarket((profile && profile.market_name) || "");
      loadRequest();
      loadPayment();
      readReminderSettings(user.id).then(setReminderSettings);
      loadHealth();
    }
  }

  // Shown when a free vendor taps a premium feature
  function askUpgrade() {
    confirmAction(
      "Premium feature",
      PLAY_BUILD
        ? "Premium lets you track personal money too. Premium is coming soon to the Google Play version. See premium in your account?"
        : "Premium lets you track personal money too, 99 pesos a month or 999 a year. See premium in your account?",
      "Open account",
      () => openScreen("account")
    );
  }

  // ----- entry -----

  // Pick business or personal, personal asks free vendors to upgrade instead
  function chooseScope(nextScope) {
    if (scopeNeedsPremium(nextScope) && !premium) {
      askUpgrade();
      return;
    }
    setScope(nextScope);
  }

  // Validate the form and save one new record
  async function saveRecord() {
    if (disabled) {
      notify("Account disabled", "Your account is disabled, so new records cannot be saved. Contact the Tindahan owner.");
      return;
    }
    // a free vendor, or one whose premium lapsed, always saves business money
    const saveScope = premium ? scope : "business";
    const value = parseFloat(amount);
    if (isNaN(value) || value <= 0) {
      notify("Check the amount", "Please enter a number bigger than zero.");
      return;
    }
    const record = {
      id: newId(),
      record_date: todayString(),
      scope: saveScope,
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
    notify("Saved", (saveScope === "personal" ? "Personal, " : "Negosyo, ")
      + KINDS[kind].saved.toLowerCase() + pesos(value));
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

  // Today's total for business or personal, money in or money out
  function total(recordScope, recordKind) {
    return todays
      .filter((r) => r.scope === recordScope && r.kind === recordKind)
      .reduce((sum, r) => sum + r.amount, 0);
  }
  const businessIn = total("business", "in");
  const businessOut = total("business", "out");
  const personalIn = total("personal", "in");
  const personalOut = total("personal", "out");
  // the top totals add personal money only for premium vendors
  const allIn = businessIn + (premium ? personalIn : 0);
  const allOut = businessOut + (premium ? personalOut : 0);

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
    return recordKind === "in" ? styles.amountIn : styles.amountOut;
  }

  // ----- income statements -----

  // A free vendor's latest statement request, or null
  async function loadStatementRequest() {
    const { data } = await supabase
      .from("statement_requests")
      .select("id, status, period_start, period_end, note, created_at, decided_at")
      .in("status", ["pending", "approved", "rejected"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setStatementRequest(data || null);
    return data || null;
  }

  // Tell a free vendor once when the owner approves or rejects their request
  async function checkStatement(prof) {
    if (isPremium(prof)) return;
    const latest = await loadStatementRequest();
    if (!latest || latest.status === "pending") return;
    const key = "tindahan_statement_seen_" + user.id;
    const seen = await AsyncStorage.getItem(key);
    const now = latest.id + ":" + latest.status;
    if (seen === now) return;
    await AsyncStorage.setItem(key, now);
    if (latest.status === "approved") {
      notifyNow("Your statement is ready", "Open Tindahan, Today, to download your income statement.");
    } else {
      notifyNow("Statement request not approved", latest.note || "Open Tindahan to see why.");
    }
  }

  // A free vendor asks the owner for a one month statement
  async function requestStatement() {
    setBusy(true);
    const { error } = await supabase.rpc("request_statement");
    setBusy(false);
    if (error) {
      notify("Could not send the request", "Check your internet and try again.");
      return;
    }
    await loadStatementRequest();
    notify("Request sent", "The Tindahan owner will review it. You will get a notice when it is ready.");
  }

  function cancelStatement() {
    confirmAction("Cancel your statement request?", "You can request again anytime.", "Cancel request", async () => {
      await supabase.rpc("cancel_statement_request");
      setStatementRequest(null);
    });
  }

  // Build the PDF on the phone from the vendor's own records and share it
  async function downloadStatement(scope, start, end, confirmedOn) {
    if (statementRecords(records, scope, start, end).length === 0) {
      notify("No records yet", "There are no records from " + longDay(start) + " to " + longDay(end) + ".");
      return;
    }
    setBusy(true);
    let step = "preparing the statement";
    try {
      const html = buildStatementHtml({
        vendor: {
          username: username, fullName: profile && profile.full_name,
          market: profile && profile.market_name, email: user.email,
        },
        scope: scope, start: start, end: end, records: records,
        confirmedOn: confirmedOn, generatedAt: new Date(),
      });
      step = "making the PDF";
      const result = await savePdf(html, "Tindahan statement " + start + " to " + end,
        "Tindahan-statement-" + start + "-to-" + end + ".pdf");
      if (result === "blocked") {
        notify("Allow pop ups", "Your browser blocked the statement window. Allow pop ups for Tindahan and try again.");
      } else if (result === "saved") {
        notify("PDF saved", "The statement was made, but this phone cannot open the share menu.");
      }
    } catch (error) {
      notify("Could not make the PDF", "Stopped while " + step + ". " + String((error && error.message) || error));
    } finally {
      setBusy(false);
    }
  }

  // ----- help and support -----

  // Count tickets with an unread reply, and tell the vendor once about a new one
  async function checkSupport() {
    const { data, error } = await supabase
      .from("tickets")
      .select("id, number, last_staff_message_at, vendor_read_at");
    if (error || !data) return;
    const unread = data.filter((t) => t.last_staff_message_at
      && (!t.vendor_read_at || t.last_staff_message_at > t.vendor_read_at));
    setSupportUnread(unread.length);
    if (unread.length === 0) return;
    const newest = unread.map((t) => t.last_staff_message_at).sort().pop();
    const key = "tindahan_support_seen_" + user.id;
    const seen = await AsyncStorage.getItem(key);
    if (seen !== null && seen >= newest) return;
    await AsyncStorage.setItem(key, newest);
    notifyNow("New reply to your ticket", "Open Tindahan, Account, Help and support, to read it.");
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
    const cleanFull = editFullName.trim().replace(/\s+/g, " ");
    if (cleanFull.length > 0 && cleanFull.length < 2) {
      notify("Check your full name", "Please type your full name, like Juana Dela Cruz.");
      return;
    }
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
        .update({ username: cleanUser, market_name: cleanMarket, full_name: cleanFull || null })
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
    loadHealth();
  }

  // Show a notification right now, with no scheduling, to see if the phone shows Tindahan at all
  async function sendTestNow() {
    const sent = await sendNow(user.id);
    if (!sent) {
      notify("Notifications are off", "Allow notifications for Tindahan in your phone settings to get reminders.");
    }
    loadHealth();
  }

  // Read what the phone says about Tindahan's notifications
  async function loadHealth() {
    try {
      setHealth(await reminderHealth(user.id));
    } catch (error) {
      setHealth(null);
    }
  }

  // What the reminder settings card says about the alarms
  function alarmLabel() {
    if (!alarmStatus) return "Checking reminders...";
    if (alarmStatus.reason === "off") return "Reminders are off.";
    if (alarmStatus.reason === "permission") return "Notifications are blocked. Turn them on in your phone settings.";
    if (alarmStatus.reason === "error") return "Could not set reminders. Close and open the app again.";
    return alarmStatus.count + (alarmStatus.count === 1 ? " reminder" : " reminders") + " set for the next 30 days.";
  }

  // Delete the account and every piece of its data, as Google Play requires.
  // Screenshots first through the storage API, then the account on the server,
  // then this phone's copy and alarms, then sign out.
  async function deleteAccount() {
    if (deleteText.trim().toUpperCase() !== "DELETE") {
      notify("Type DELETE to confirm", "To delete your account, type the word DELETE in the box.");
      return;
    }
    setDeleting(true);
    try {
      const folder = await supabase.storage.from("ticket-screenshots").list(user.id, { limit: 1000 });
      if (folder.data && folder.data.length > 0) {
        await supabase.storage.from("ticket-screenshots").remove(folder.data.map((f) => user.id + "/" + f.name));
      }
      const { error } = await supabase.rpc("delete_my_account");
      if (error) throw error;
      try {
        await refreshReminders({ userId: user.id, schedules: [], profile: null, premium: false });
      } catch (alarmError) {
        // alarms are optional, the account is already deleted
      }
      const keys = await AsyncStorage.getAllKeys();
      await AsyncStorage.multiRemove(keys.filter((k) => k.includes(user.id)));
      notify("Account deleted", "Your Tindahan account and all of its data have been deleted. Salamat.");
      await supabase.auth.signOut().catch(() => {});
    } catch (error) {
      notify("Could not delete the account", "Check your internet and try again. " + String((error && error.message) || ""));
    } finally {
      setDeleting(false);
    }
  }

  // Which version and build this is, so it is always clear what is installed
  function versionLabel() {
    const version = Application.nativeApplicationVersion;
    const build = Application.nativeBuildVersion;
    if (!version) return "Tindahan web";
    return "Tindahan " + version + (build ? ", build " + build : "") + (PLAY_BUILD ? ", Google Play" : ", direct install");
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
          {title === "Tindahan" ? (
            <Image
              source={theme === "abyss"
                ? require("./assets/logo-horizontal-dark.png")
                : require("./assets/logo-horizontal-light.png")}
              style={styles.headerLogo}
              resizeMode="contain"
              accessibilityLabel="Tindahan"
            />
          ) : (
            <Text style={styles.title}>{title}</Text>
          )}
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
            placeholderTextColor={colors.muted}
            keyboardAppearance={theme === "abyss" ? "dark" : "light"}
          style={styles.input}
          value={amount}
          onChangeText={setAmount}
          keyboardType="numeric"
          placeholder="0.00"
        />
        <Text style={styles.label}>Para saan, description</Text>
        <TextInput
            placeholderTextColor={colors.muted}
            keyboardAppearance={theme === "abyss" ? "dark" : "light"}
          style={styles.input}
          value={description}
          onChangeText={setDescription}
          placeholder="halimbawa, benta, pamasahe, kuryente"
        />
        {premium && (
          <View>
            <Text style={styles.label}>Para saan, whose money</Text>
            <View style={styles.scopeRow}>
              {Object.keys(SCOPES).map((key) => (
                <TouchableOpacity
                  key={key}
                  style={[styles.scopeButton, scope === key && styles.scopeActive]}
                  onPress={() => chooseScope(key)}
                >
                  <Text style={[styles.scopeText, scope === key && styles.scopeTextActive]}>{SCOPES[key].label}</Text>
                  <Text style={[styles.scopeSub, scope === key && styles.scopeTextActive]}>{SCOPES[key].sub}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}
        <View style={styles.kindRow}>
          {Object.keys(KINDS).map((k) => (
            <TouchableOpacity
              key={k}
              style={[styles.kindButton, kind === k && styles["kindActive_" + k]]}
              onPress={() => setKind(k)}
            >
              <Text style={[styles.kindText, kind === k && styles.kindTextActive]}>{KINDS[k].button}</Text>
            </TouchableOpacity>
          ))}
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
        <Text style={styles.upgradePrice}>{PLAY_BUILD ? "Premium, coming soon" : "Premium, 99 pesos a month or 999 a year"}</Text>
        <TouchableOpacity style={styles.premiumButton} onPress={() => openScreen("account")}>
          <Text style={styles.premiumButtonText}>GET PREMIUM</Text>
        </TouchableOpacity>
      </View>
    );
  }

  function renderRecords(recordScope) {
    const list = todays.filter((r) => r.scope === recordScope);
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
                <Text style={styles.recordNote}>{SCOPES[item.scope].note[item.kind]}</Text>
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

  // Money in, money out, and what is left, the same layout for business and personal
  function renderScope(recordScope) {
    const moneyIn = recordScope === "business" ? businessIn : personalIn;
    const moneyOut = recordScope === "business" ? businessOut : personalOut;
    const left = moneyIn - moneyOut;
    return (
      <View>
        {renderTotal("Money in", moneyIn, styles.amountIn)}
        {renderTotal("Money out", moneyOut, styles.amountOut)}
        {renderTotal(recordScope === "business" ? "Kita, business net" : "Natira, personal net",
          left, left >= 0 ? styles.amountIn : styles.amountOut)}
        {renderRecords(recordScope)}
      </View>
    );
  }

  // The statement card, at the very bottom of TODAY
  function renderStatementCard() {
    const heading = (
      <View>
        <Text style={styles.statementTitle}>Kailangan ng loan? Need a loan?</Text>
        <Text style={styles.statementText}>
          Lenders often ask for proof of income. Download a statement of your recorded income, free.
        </Text>
      </View>
    );
    if (premium) {
      const custom = statementMonths === "custom";
      const period = custom ? { start: customFrom, end: customTo } : periodFor(statementMonths, new Date());
      // custom dates stay within 6 months of each other and never pass today
      const stepCustom = (which, days, months) => {
        const base = parseDay(which === "from" ? customFrom : customTo);
        let d = months
          ? new Date(base.getFullYear(), base.getMonth() + months, Math.min(base.getDate(),
              new Date(base.getFullYear(), base.getMonth() + months + 1, 0).getDate()))
          : addDays(base, days);
        let key = dayString(d);
        if (which === "from") {
          const low = earliestStart(customTo, MAX_MONTHS);
          if (key < low) key = low;
          if (key > customTo) key = customTo;
          setCustomFrom(key);
        } else {
          const today = todayString();
          if (key > today) key = today;
          if (key < customFrom) key = customFrom;
          setCustomTo(key);
          // moving the end keeps the range at 6 months or less
          const low = earliestStart(key, MAX_MONTHS);
          if (customFrom < low) setCustomFrom(low);
        }
      };
      return (
        <View style={styles.statementCard}>
          {heading}
          <View style={styles.statementRow}>
            {[["business", "NEGOSYO"], ["personal", "PERSONAL INCOME"]].map(([key, label]) => (
              <TouchableOpacity
                key={key}
                style={[styles.statementChip, statementScope === key && styles.statementChipActive]}
                onPress={() => setStatementScope(key)}
              >
                <Text style={[styles.statementChipText, statementScope === key && styles.statementChipTextActive]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.statementRow}>
            {[...PREMIUM_MONTHS, "custom"].map((m) => (
              <TouchableOpacity
                key={m}
                style={[styles.statementChip, statementMonths === m && styles.statementChipActive]}
                onPress={() => setStatementMonths(m)}
              >
                <Text style={[styles.statementChipText, statementMonths === m && styles.statementChipTextActive]}>
                  {m === "custom" ? "CUSTOM" : m === 1 ? "1 MONTH" : m + " MONTHS"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          {custom && [["from", "From", customFrom], ["to", "To", customTo]].map(([which, label, value]) => (
            <View key={which} style={styles.customBlock}>
              <Text style={styles.customLabel}>{label}</Text>
              <Text style={styles.customValue}>{longDay(value)}</Text>
              <View style={styles.statementRow}>
                {[["- 1 month", 0, -1], ["- 1 day", -1, 0], ["+ 1 day", 1, 0], ["+ 1 month", 0, 1]].map(([text, d, mo]) => (
                  <TouchableOpacity key={text} style={styles.customStep} onPress={() => stepCustom(which, d, mo)}>
                    <Text style={styles.customStepText}>{text}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          ))}
          {custom && <Text style={styles.statementNote}>Up to 6 months per statement.</Text>}
          <Text style={styles.statementPeriod}>{longDay(period.start)} to {longDay(period.end)}</Text>
          <TouchableOpacity
            style={styles.statementButton}
            onPress={() => downloadStatement(statementScope, period.start, period.end, null)}
            disabled={busy}
          >
            <Text style={styles.statementButtonText}>DOWNLOAD STATEMENT, PDF</Text>
          </TouchableOpacity>
        </View>
      );
    }
    const r = statementRequest;
    return (
      <View style={styles.statementCard}>
        {heading}
        {r && r.status === "pending" ? (
          <View>
            <Text style={styles.statementWait}>
              Waiting for approval, sent {shortDate(r.created_at)}. You will get a notice when it is ready.
            </Text>
            <TouchableOpacity onPress={cancelStatement}>
              <Text style={styles.linkText}>Cancel request</Text>
            </TouchableOpacity>
          </View>
        ) : r && r.status === "approved" ? (
          <View>
            <Text style={styles.statementReady}>
              Approved. Your statement covers {longDay(r.period_start)} to {longDay(r.period_end)}.
            </Text>
            <TouchableOpacity
              style={styles.statementButton}
              onPress={() => downloadStatement("business", r.period_start, r.period_end, r.decided_at.slice(0, 10))}
              disabled={busy}
            >
              <Text style={styles.statementButtonText}>DOWNLOAD STATEMENT, PDF</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={requestStatement} disabled={busy}>
              <Text style={styles.statementLink}>Request a newer statement</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View>
            {r && r.status === "rejected" && (
              <Text style={styles.statementRejected}>Your last request was not approved. {r.note}</Text>
            )}
            <Text style={styles.statementNote}>Free accounts get the last 1 month of business records, after the owner approves.</Text>
            <TouchableOpacity style={styles.statementButton} onPress={requestStatement} disabled={busy}>
              <Text style={styles.statementButtonText}>REQUEST MY STATEMENT</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => openScreen("account")}>
              <Text style={styles.statementLink}>Premium gets up to 6 months, instantly</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  }

  function renderDashboard() {
    const shownScope = premium ? tab : "business";
    return (
      <ScrollView contentContainerStyle={styles.body}>
        {renderHeader("Ngayong araw")}
        <TouchableOpacity onPress={runSync}>
          <Text style={syncStatus === "offline" || syncStatus === "disabled" ? styles.syncBad : styles.syncOk}>
            {syncLabel()}
          </Text>
        </TouchableOpacity>

        <View style={styles.summaryRow}>
          <View style={[styles.summaryBox, styles.summaryIncome]}>
            <Text style={styles.summaryLabel}>Total income</Text>
            <Text style={styles.summaryIncomeValue}>{pesos(allIn)}</Text>
          </View>
          <View style={[styles.summaryBox, styles.summaryExpense]}>
            <Text style={styles.summaryLabel}>Total expense</Text>
            <Text style={styles.summaryExpenseValue}>{pesos(allOut)}</Text>
          </View>
        </View>

        {premium && (
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
        )}

        {renderScope(shownScope)}

        {!premium && (
          <TouchableOpacity style={styles.upgradeHint} onPress={() => openScreen("account")}>
            <Text style={styles.upgradeHintText}>
              {PLAY_BUILD ? "Track personal money too with Premium, coming soon." : "Track personal money too with Premium, 99 pesos a month."}
            </Text>
          </TouchableOpacity>
        )}

        {renderStatementCard()}
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
            {PLAY_BUILD ? "" : " You can add more time below."}
          </Text>
        ) : (
          <Text style={styles.cardText}>You are on the free plan.</Text>
        )}
        {!premium && PREMIUM_BENEFITS.map((b) => (
          <Text key={b} style={styles.benefit}>{"\u2713  "}{b}</Text>
        ))}

        {PLAY_BUILD && !ownerPremium && (
          <Text style={styles.playNote}>
            Premium is coming soon to the Google Play version of Tindahan.
          </Text>
        )}

        {!PLAY_BUILD && !ownerPremium && pending && (
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

        {!PLAY_BUILD && !ownerPremium && !pending && (
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
            placeholderTextColor={colors.muted}
            keyboardAppearance={theme === "abyss" ? "dark" : "light"}
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

  function renderHistory() {
    return (
      <ScrollView contentContainerStyle={styles.body}>
        <HistoryScreen
          records={records}
          premium={premium}
          header={renderHeader("History")}
          onUpgrade={() => openScreen("account")}
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
        {health && health.supported && (
          <View style={styles.healthBox}>
            <Text style={health.permission ? styles.healthGood : styles.healthBad}>
              {health.permission ? "Notifications allowed" : "Notifications blocked in phone settings"}
            </Text>
            {health.categoryOn !== null && (
              <Text style={health.categoryOn ? styles.healthGood : styles.healthBad}>
                {health.categoryOn ? "Bill reminders category on" : "Bill reminders category switched off"}
              </Text>
            )}
            <Text style={styles.healthText}>
              {health.waiting} {health.waiting === 1 ? "reminder" : "reminders"} waiting on this phone
            </Text>
          </View>
        )}
        <TouchableOpacity style={styles.outlineButton} onPress={sendTestNow}>
          <Text style={styles.outlineButtonText}>SEND A NOTIFICATION NOW</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.outlineButton} onPress={sendTest}>
          <Text style={styles.outlineButtonText}>SEND A TEST REMINDER IN 5 SECONDS</Text>
        </TouchableOpacity>
        {Platform.OS === "android" && (
          <View style={styles.phoneTips}>
            <Text style={styles.phoneTipsTitle}>Hindi tumutunog? Reminders not ringing?</Text>
            <Text style={styles.phoneTipsText}>
              On Xiaomi, Redmi, and POCO phones, open Tindahan's settings and turn on Autostart,
              set Battery saver to No restrictions, allow Floating and Lock screen notifications,
              and allow Alarms and reminders.
            </Text>
            <TouchableOpacity style={styles.outlineButton} onPress={() => openPhoneSettings()}>
              <Text style={styles.outlineButtonText}>OPEN TINDAHAN PHONE SETTINGS</Text>
            </TouchableOpacity>
          </View>
        )}
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
          {["Personal money, separate from the business", "Schedules with reminders for your bills", "Your total income and expense in one place"].map((b) => (
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

  function renderSupport() {
    return (
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <SupportScreen
          user={user}
          header={renderHeader("Help")}
          onBack={() => openScreen("account")}
          onChanged={checkSupport}
        />
      </ScrollView>
    );
  }

  function renderAccount() {
    return (
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {renderHeader("Account")}

        {renderPremiumCard()}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Tulong, help and support</Text>
          <Text style={styles.cardText}>
            Something wrong, or a question about premium or your statement? Open a ticket,
            the owner replies within 2 to 24 hours.
          </Text>
          {supportUnread > 0 && (
            <Text style={styles.supportUnread}>
              {supportUnread} {supportUnread === 1 ? "ticket has" : "tickets have"} a new reply
            </Text>
          )}
          <TouchableOpacity style={styles.outlineButton} onPress={() => openScreen("support")}>
            <Text style={styles.outlineButtonText}>OPEN HELP AND SUPPORT</Text>
          </TouchableOpacity>
        </View>

        {premium && renderReminderCard()}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Profile</Text>
          <Text style={styles.label}>Buong pangalan, full name</Text>
          <TextInput
            placeholderTextColor={colors.muted}
            keyboardAppearance={theme === "abyss" ? "dark" : "light"}
            style={styles.input}
            value={editFullName}
            onChangeText={setEditFullName}
            autoCapitalize="words"
            placeholder="halimbawa, Juana Dela Cruz"
          />
          <Text style={styles.fieldHint}>Shown on your income statements.</Text>
          <Text style={styles.label}>Username</Text>
          <TextInput
            placeholderTextColor={colors.muted}
            keyboardAppearance={theme === "abyss" ? "dark" : "light"}
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

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Itsura, appearance</Text>
          <View style={styles.themeRow}>
            {[["light", "LIGHT", "maliwanag"], ["abyss", "ABYSS", "madilim"]].map(([key, label, sub]) => (
              <TouchableOpacity
                key={key}
                style={[styles.themeButton, theme === key && styles.themeActive]}
                onPress={() => setTheme(key)}
              >
                <Text style={[styles.themeText, theme === key && styles.themeTextActive]}>{label}</Text>
                <Text style={[styles.themeSub, theme === key && styles.themeTextActive]}>{sub}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <TouchableOpacity style={styles.logoutButton} onPress={logout}>
          <Text style={styles.logoutText}>LOG OUT</Text>
        </TouchableOpacity>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Privacy and your account</Text>
          <TouchableOpacity onPress={() => Linking.openURL(TERMS_URL)}>
            <Text style={styles.legalLink}>Terms of Service</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => Linking.openURL(PRIVACY_URL)}>
            <Text style={styles.legalLink}>Privacy Policy</Text>
          </TouchableOpacity>
          {profile && (profile.role === "owner" || profile.role === "admin") ? (
            <Text style={styles.hint}>Staff accounts cannot be deleted from the app.</Text>
          ) : !deleteOpen ? (
            <TouchableOpacity style={styles.deleteButton} onPress={() => setDeleteOpen(true)}>
              <Text style={styles.deleteButtonText}>DELETE MY ACCOUNT</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.deleteBox}>
              <Text style={styles.deleteWarning}>
                This deletes your account and everything in it, your records, schedules,
                statements, payment requests, and help tickets. It cannot be undone.
                Download any statement you need first.
              </Text>
              <Text style={styles.label}>Type DELETE to confirm</Text>
              <TextInput
                placeholderTextColor={colors.muted}
                keyboardAppearance={theme === "abyss" ? "dark" : "light"}
                style={styles.input}
                value={deleteText}
                onChangeText={setDeleteText}
                autoCapitalize="characters"
                placeholder="DELETE"
              />
              <TouchableOpacity style={styles.deleteConfirm} onPress={deleteAccount} disabled={deleting}>
                <Text style={styles.deleteConfirmText}>{deleting ? "DELETING..." : "DELETE MY ACCOUNT FOREVER"}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => { setDeleteOpen(false); setDeleteText(""); }}>
                <Text style={styles.legalLink}>Cancel</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        <Text style={styles.versionText}>{versionLabel()}</Text>
      </ScrollView>
    );
  }

  return (
    <View style={styles.page}>
      <SafeAreaView style={styles.container}>
        <View style={styles.screen}>
          {screen === "entry" && renderEntry()}
          {screen === "dashboard" && renderDashboard()}
          {screen === "history" && renderHistory()}
          {screen === "schedule" && renderSchedule()}
          {screen === "account" && renderAccount()}
          {screen === "support" && renderSupport()}
        </View>
        <View style={styles.nav}>
          {[
            ["entry", "ENTRY", "create-outline"],
            ["dashboard", "TODAY", "today-outline"],
            ["history", "HISTORY", "bar-chart-outline"],
            ["schedule", "SCHEDULE", "alarm-outline"],
            ["account", "ACCOUNT", "person-circle-outline"],
          ].map(([key, label, icon]) => (
            <TouchableOpacity
              key={key}
              style={[styles.navButton, (screen === key || (key === "account" && screen === "support")) && styles.navActive]}
              onPress={() => openScreen(key)}
              accessibilityLabel={key === "account" && supportUnread > 0 ? label + ", new reply" : label}
            >
              <View>
                <Ionicons name={icon} size={24}
                  color={screen === key || (key === "account" && screen === "support") ? colors.onStrong : colors.muted} />
                {key === "account" && supportUnread > 0 && <View style={styles.navDot} />}
              </View>
              <Text style={[styles.navText, (screen === key || (key === "account" && screen === "support")) && styles.navTextActive]}
                numberOfLines={1}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </SafeAreaView>
      {welcome && profile && renderWelcome()}
    </View>
  );
}

// Styles, large text and big touch targets for elderly and low literacy users
function makeStyles(c) {
  return StyleSheet.create({
  // the page fills the window, on a wide PC screen the app is a column in the middle
  page: { flex: 1, backgroundColor: c.outer },
  container: { flex: 1, width: "100%", maxWidth: 560, alignSelf: "center", backgroundColor: c.page },
  screen: { flex: 1 },
  body: { padding: 20, paddingTop: 40, paddingBottom: 40 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: c.page },

  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  headerLogo: { width: 150, height: 47, flexShrink: 1 },

  // light or abyss
  themeRow: { flexDirection: "row", gap: 10, marginTop: 12 },
  themeButton: {
    flex: 1, paddingVertical: 14, borderRadius: 10, alignItems: "center",
    borderWidth: 2, borderColor: c.line, backgroundColor: c.card,
  },
  themeActive: { backgroundColor: c.strong, borderColor: c.strong },
  themeText: { fontSize: 18, fontWeight: "bold", color: c.text },
  themeSub: { fontSize: 13, color: c.muted, marginTop: 2 },
  themeTextActive: { color: c.onStrong },
  title: { fontSize: 32, fontWeight: "bold", color: c.text, flexShrink: 1 },
  greeting: { fontSize: 20, color: c.text, marginTop: 6 },
  tagPremium: {
    backgroundColor: INDIGO, color: "white", fontWeight: "bold", fontSize: 14,
    paddingVertical: 5, paddingHorizontal: 10, borderRadius: 6, overflow: "hidden", flexShrink: 0,
  },
  tagFree: {
    backgroundColor: c.line, color: c.muted, fontWeight: "bold", fontSize: 14,
    paddingVertical: 5, paddingHorizontal: 10, borderRadius: 6, overflow: "hidden", flexShrink: 0,
  },
  bannerDanger: {
    backgroundColor: CRIMSON, color: "white", fontSize: 16, fontWeight: "bold",
    padding: 12, borderRadius: 10, marginTop: 12,
  },

  label: { fontSize: 18, color: c.muted, marginBottom: 6, marginTop: 14 },
  hint: { fontSize: 15, color: c.muted, marginTop: 12, marginBottom: 6 },
  input: {
    backgroundColor: c.card, borderRadius: 10, padding: 14, color: c.text,
    fontSize: 22, borderWidth: 1, borderColor: c.line,
  },

  // the business or personal switch, premium only
  scopeRow: { flexDirection: "row", gap: 10 },
  scopeButton: {
    flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: "center",
    borderWidth: 2, borderColor: c.line, backgroundColor: c.card,
  },
  scopeActive: { backgroundColor: c.strong, borderColor: c.strong },
  scopeText: { fontSize: 19, fontWeight: "bold", color: c.text },
  scopeSub: { fontSize: 13, color: c.muted, marginTop: 2 },
  scopeTextActive: { color: c.onStrong },

  // the two big money buttons
  kindRow: { flexDirection: "row", gap: 10, marginTop: 20 },
  kindButton: {
    flex: 1, minHeight: 72, borderRadius: 12, backgroundColor: c.card,
    borderWidth: 2, borderColor: c.line, alignItems: "center", justifyContent: "center",
  },
  kindActive_in: { backgroundColor: EMERALD, borderColor: EMERALD },
  kindActive_out: { backgroundColor: CRIMSON, borderColor: CRIMSON },
  kindText: { fontSize: 21, fontWeight: "bold", color: c.text },
  kindTextActive: { color: "white" },

  saveButton: { marginTop: 26, backgroundColor: EMERALD, padding: 20, borderRadius: 12, alignItems: "center" },
  saveText: { fontSize: 26, fontWeight: "bold", color: "white" },

  syncOk: { fontSize: 15, color: c.good, marginTop: 8 },
  syncBad: { fontSize: 15, color: c.bad, marginTop: 8, fontWeight: "bold" },

  // the business, personal, withdrawal switch at the top of the dashboard
  tabBar: { flexDirection: "row", marginTop: 16, backgroundColor: c.line, borderRadius: 10, padding: 4 },
  tabButton: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: "center" },
  tabActive: { backgroundColor: c.strong },
  tabText: { fontSize: 14, fontWeight: "bold", color: c.muted },
  tabTextActive: { color: c.onStrong },

  // total income and total expense at the top of today
  summaryRow: { flexDirection: "row", gap: 10, marginTop: 14 },
  summaryBox: { flex: 1, borderRadius: 12, padding: 14 },
  summaryIncome: { backgroundColor: c.goodSoft },
  summaryExpense: { backgroundColor: c.badSoft },
  summaryLabel: { fontSize: 15, color: c.text, fontWeight: "bold" },
  summaryIncomeValue: { fontSize: 22, fontWeight: "bold", color: c.good, marginTop: 4 },
  summaryExpenseValue: { fontSize: 22, fontWeight: "bold", color: c.bad, marginTop: 4 },
  upgradeHint: { marginTop: 16, backgroundColor: c.accentSoft, borderRadius: 10, padding: 14 },
  upgradeHintText: { fontSize: 16, color: c.accent, fontWeight: "bold" },

  // the statement nudge at the bottom of today
  statementCard: {
    marginTop: 24, borderRadius: 12, padding: 16, backgroundColor: c.card,
    borderWidth: 2, borderColor: c.line, borderStyle: "dashed",
  },
  statementTitle: { fontSize: 19, fontWeight: "bold", color: c.text },
  statementText: { fontSize: 15, color: c.muted, marginTop: 4 },
  statementRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  statementChip: {
    flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: "center",
    borderWidth: 2, borderColor: c.line, backgroundColor: c.card,
  },
  statementChipActive: { backgroundColor: c.strong, borderColor: c.strong },
  statementChipText: { fontSize: 13, fontWeight: "bold", color: c.text },
  statementChipTextActive: { color: c.onStrong },
  statementPeriod: { fontSize: 15, color: c.text, marginTop: 10, textAlign: "center" },
  statementButton: { marginTop: 12, backgroundColor: EMERALD, padding: 15, borderRadius: 10, alignItems: "center" },
  statementButtonText: { fontSize: 16, fontWeight: "bold", color: "white" },
  statementLink: { fontSize: 15, color: c.accent, fontWeight: "bold", textAlign: "center", marginTop: 12 },
  statementNote: { fontSize: 14, color: c.muted, marginTop: 10 },
  customBlock: { marginTop: 12 },
  customLabel: { fontSize: 14, color: c.muted },
  customValue: { fontSize: 18, fontWeight: "bold", color: c.text },
  customStep: { flex: 1, paddingVertical: 9, borderRadius: 8, backgroundColor: c.subtle, alignItems: "center" },
  customStepText: { fontSize: 12, fontWeight: "bold", color: c.text },
  fieldHint: { fontSize: 13, color: c.muted, marginTop: 4 },
  supportUnread: {
    fontSize: 15, fontWeight: "bold", color: c.accent, backgroundColor: c.accentSoft,
    padding: 10, borderRadius: 8, marginTop: 8,
  },
  navDot: {
    position: "absolute", top: -2, right: -4, width: 10, height: 10, borderRadius: 5,
    backgroundColor: CRIMSON, borderWidth: 2, borderColor: c.card,
  },
  statementWait: { fontSize: 15, color: c.accent, marginTop: 12, backgroundColor: c.accentSoft, padding: 12, borderRadius: 8 },
  statementReady: { fontSize: 15, color: c.good, marginTop: 12, backgroundColor: c.goodSoft, padding: 12, borderRadius: 8, fontWeight: "bold" },
  statementRejected: { fontSize: 15, color: c.bad, marginTop: 12, backgroundColor: c.badSoft, padding: 12, borderRadius: 8 },

  totalBox: {
    backgroundColor: c.card, borderRadius: 10, padding: 16, marginTop: 10,
    borderWidth: 1, borderColor: c.line,
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
  },
  totalLabel: { fontSize: 19, color: c.text, flexShrink: 1 },
  amountIn: { fontSize: 21, fontWeight: "bold", color: c.good },
  amountOut: { fontSize: 21, fontWeight: "bold", color: c.bad },

  recordRow: {
    backgroundColor: c.card, borderRadius: 8, padding: 14, marginBottom: 8,
    borderWidth: 1, borderColor: c.line,
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
  },
  recordInfo: { flex: 1, marginRight: 10 },
  recordText: { fontSize: 18, color: c.text },
  recordNote: { fontSize: 14, color: c.muted },
  empty: { fontSize: 17, color: c.muted, marginTop: 16 },

  upgradeCard: {
    backgroundColor: c.card, borderRadius: 12, padding: 18, marginTop: 14,
    borderWidth: 2, borderColor: INDIGO,
  },
  upgradeTitle: { fontSize: 19, color: c.text, fontWeight: "bold" },
  upgradePrice: { fontSize: 16, color: c.accent, marginTop: 6 },

  card: {
    backgroundColor: c.card, borderRadius: 12, padding: 18, marginTop: 16,
    borderWidth: 1, borderColor: c.line,
  },
  premiumCard: { borderWidth: 2, borderColor: INDIGO },
  cardTitle: { fontSize: 22, fontWeight: "bold", color: c.text },
  cardText: { fontSize: 17, color: c.text, marginTop: 8, marginBottom: 6 },
  benefit: { fontSize: 16, color: c.text, marginTop: 6 },
  stepTitle: { fontSize: 18, fontWeight: "bold", color: c.text, marginTop: 18 },

  // the monthly and annual plan picker
  planRow: { flexDirection: "row", gap: 10, marginTop: 10 },
  planCard: {
    flex: 1, borderWidth: 2, borderColor: c.line, borderRadius: 10,
    padding: 12, alignItems: "center", backgroundColor: c.card,
  },
  planActive: { backgroundColor: INDIGO, borderColor: INDIGO },
  planName: { fontSize: 16, fontWeight: "bold", color: c.text },
  planPrice: { fontSize: 24, fontWeight: "bold", color: c.text, marginTop: 2 },
  planDetail: { fontSize: 13, color: c.muted, marginTop: 2, textAlign: "center" },
  planTextActive: { color: "white" },

  // the GCash payment steps
  payBox: { marginTop: 14, backgroundColor: c.accentSoft, borderRadius: 10, padding: 14 },
  payStep: { fontSize: 16, color: c.text, marginTop: 10, marginBottom: 6 },
  payNumber: { fontSize: 28, fontWeight: "bold", color: c.accent, letterSpacing: 1 },
  payName: { fontSize: 16, color: c.text },
  waitBox: { marginTop: 14, backgroundColor: c.accentSoft, borderRadius: 10, padding: 14 },
  waitTitle: { fontSize: 18, fontWeight: "bold", color: c.accent },
  waitText: { fontSize: 16, color: c.text, marginTop: 6 },
  rejectBox: {
    fontSize: 16, color: "white", backgroundColor: CRIMSON,
    padding: 12, borderRadius: 8, marginTop: 14,
  },
  linkText: { fontSize: 16, color: c.bad, fontWeight: "bold", marginTop: 12 },

  primaryButton: { marginTop: 16, backgroundColor: EMERALD, padding: 16, borderRadius: 10, alignItems: "center" },
  primaryButtonText: { fontSize: 18, fontWeight: "bold", color: "white" },
  premiumButton: { marginTop: 16, backgroundColor: INDIGO, padding: 16, borderRadius: 10, alignItems: "center" },
  premiumButtonText: { fontSize: 18, fontWeight: "bold", color: "white" },
  logoutButton: {
    marginTop: 20, padding: 14, borderRadius: 10,
    borderWidth: 2, borderColor: CRIMSON, alignItems: "center",
  },
  logoutText: { fontSize: 18, fontWeight: "bold", color: c.bad },

  nav: { flexDirection: "row", borderTopWidth: 1, borderColor: c.line, backgroundColor: c.card },
  navButton: { flex: 1, paddingVertical: 8, alignItems: "center", gap: 2 },
  navActive: { backgroundColor: c.strong },
  navText: { fontSize: 11, fontWeight: "bold", color: c.muted },
  navTextActive: { color: c.onStrong },

  // reminder settings
  toggleRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingVertical: 12, borderBottomWidth: 1, borderColor: c.line,
  },
  toggleLabel: { fontSize: 18, color: c.text, flexShrink: 1 },
  toggle: { width: 56, height: 32, borderRadius: 16, backgroundColor: c.line, padding: 3 },
  toggleOn: { backgroundColor: EMERALD },
  knob: { width: 26, height: 26, borderRadius: 13, backgroundColor: "white" },
  knobOn: { marginLeft: 24 },
  outlineButton: {
    marginTop: 12, padding: 14, borderRadius: 10, alignItems: "center",
    borderWidth: 2, borderColor: INDIGO,
  },
  outlineButtonText: { fontSize: 16, fontWeight: "bold", color: c.accent },
  healthBox: { marginTop: 10, backgroundColor: c.subtle, borderRadius: 8, padding: 12, gap: 4 },
  healthGood: { fontSize: 15, fontWeight: "bold", color: c.good },
  healthBad: { fontSize: 15, fontWeight: "bold", color: c.bad },
  healthText: { fontSize: 15, color: c.text },
  phoneTips: { marginTop: 16, borderTopWidth: 1, borderColor: c.line, paddingTop: 12 },
  phoneTipsTitle: { fontSize: 16, fontWeight: "bold", color: c.text },
  phoneTipsText: { fontSize: 14, color: c.muted, marginTop: 4 },
  playNote: { fontSize: 15, color: c.accent, marginTop: 14, backgroundColor: c.accentSoft, padding: 12, borderRadius: 8 },
  legalLink: { fontSize: 16, color: c.accent, fontWeight: "bold", marginTop: 12 },
  deleteButton: { marginTop: 18, padding: 14, borderRadius: 10, borderWidth: 2, borderColor: CRIMSON, alignItems: "center" },
  deleteButtonText: { fontSize: 16, fontWeight: "bold", color: c.bad },
  deleteBox: { marginTop: 16, backgroundColor: c.badSoft, borderRadius: 10, padding: 14 },
  deleteWarning: { fontSize: 15, color: c.bad, fontWeight: "bold" },
  deleteConfirm: { marginTop: 14, backgroundColor: CRIMSON, padding: 15, borderRadius: 10, alignItems: "center" },
  deleteConfirmText: { fontSize: 16, fontWeight: "bold", color: "white" },
  versionText: { fontSize: 13, color: c.muted, textAlign: "center", marginTop: 20, marginBottom: 10 },

  // the welcome to premium screen
  welcomeOverlay: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: c.overlay, justifyContent: "center", padding: 20,
  },
  welcomeCard: {
    backgroundColor: c.card, borderRadius: 16, padding: 24,
    width: "100%", maxWidth: 480, alignSelf: "center",
    borderTopWidth: 8, borderTopColor: INDIGO,
  },
  welcomeTag: { fontSize: 14, fontWeight: "bold", color: c.accent, letterSpacing: 2 },
  welcomeTitle: { fontSize: 28, fontWeight: "bold", color: c.text, marginTop: 6 },
  welcomeText: { fontSize: 17, color: c.text, marginTop: 10, marginBottom: 8 },
  welcomeBenefit: { fontSize: 16, color: c.text, marginTop: 6 },
  welcomeButton: { marginTop: 20, backgroundColor: EMERALD, padding: 16, borderRadius: 10, alignItems: "center" },
  welcomeButtonText: { fontSize: 17, fontWeight: "bold", color: "white" },
  welcomeLater: { fontSize: 16, color: c.muted, fontWeight: "bold", textAlign: "center", marginTop: 14 },
  });
}
