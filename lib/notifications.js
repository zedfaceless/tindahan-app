// lib/notifications.js
// Sets the phone alarms for schedules and premium renewal, using the plan
// from reminders.js. Alarms are scheduled on the phone itself, so they go off
// with no internet and with the app closed. Phones only, the web skips this.
//
// Expo Go on Android crashes at startup if expo-notifications is even loaded,
// since SDK 53. So the package is loaded only when it is safe, the installed
// Tindahan app and iPhones, and never inside Expo Go on Android or on the web.

import { Platform, Linking } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { buildReminderPlan } from "./reminders";

// Why alarms cannot run here, or null when they can
const inExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
export const alarmsUnavailable = Platform.OS === "web"
  ? "web"
  : inExpoGo && Platform.OS === "android" ? "expo-go" : null;

// Load expo-notifications only on first use, and only where it is safe
let loaded = null;
function Notifications() {
  if (!loaded) {
    loaded = require("expo-notifications");
  }
  return loaded;
}

// Android lets people control sound per channel, so there is one loud and one quiet
const SOUND_CHANNEL = "tindahan-reminders";
const QUIET_CHANNEL = "tindahan-reminders-quiet";

// Alarms only exist in the installed app on a phone
export const alarmsSupported = alarmsUnavailable === null;

// Each vendor's reminder settings, saved on the phone
export const DEFAULT_SETTINGS = { enabled: true, sound: true };
function settingsKey(userId) {
  return "tindahan_reminder_settings_" + userId;
}

export async function readReminderSettings(userId) {
  const saved = await AsyncStorage.getItem(settingsKey(userId));
  return saved === null ? DEFAULT_SETTINGS : { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
}

export async function saveReminderSettings(userId, settings) {
  await AsyncStorage.setItem(settingsKey(userId), JSON.stringify(settings));
}

// Show notifications even while the app is open, and set up the two channels once
let prepared = false;
async function prepare() {
  if (prepared || !alarmsSupported) return;
  Notifications().setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
  if (Platform.OS === "android") {
    await Notifications().setNotificationChannelAsync(SOUND_CHANNEL, {
      name: "Bill reminders",
      importance: Notifications().AndroidImportance.MAX,
      sound: "default",
      vibrationPattern: [0, 400, 250, 400],
    });
    await Notifications().setNotificationChannelAsync(QUIET_CHANNEL, {
      name: "Bill reminders, silent",
      importance: Notifications().AndroidImportance.HIGH,
      sound: null,
      vibrationPattern: [0, 250],
    });
  }
  prepared = true;
}

// Ask the phone for permission to show reminders, true when allowed
export async function askPermission() {
  if (!alarmsSupported) return false;
  await prepare();
  const current = await Notifications().getPermissionsAsync();
  if (current.granted) return true;
  const asked = await Notifications().requestPermissionsAsync();
  return asked.granted;
}

// Only one refresh at a time, so two quick refreshes never leave double alarms
let chain = Promise.resolve();

// Clear every alarm and set them again from the latest schedules.
// Returns how many were set, and a reason when none could be set.
export function refreshReminders({ userId, schedules, profile, premium }) {
  const run = chain.then(async () => {
    if (!alarmsSupported) return { count: 0, reason: alarmsUnavailable };
    await prepare();
    await Notifications().cancelAllScheduledNotificationsAsync();
    const settings = await readReminderSettings(userId);
    if (!settings.enabled) return { count: 0, reason: "off" };
    const permission = await Notifications().getPermissionsAsync();
    if (!permission.granted) return { count: 0, reason: "permission" };
    const plan = buildReminderPlan(schedules, profile, new Date(), premium);
    const channelId = settings.sound ? SOUND_CHANNEL : QUIET_CHANNEL;
    for (const reminder of plan) {
      await Notifications().scheduleNotificationAsync({
        identifier: reminder.id,
        content: { title: reminder.title, body: reminder.body, sound: settings.sound },
        trigger: {
          type: Notifications().SchedulableTriggerInputTypes.DATE,
          date: reminder.at,
          channelId: channelId,
        },
      });
    }
    return { count: plan.length, reason: null };
  });
  chain = run.catch(() => {});
  return run;
}

// Show a notification right away, used for the welcome to premium message
export async function notifyNow(title, body) {
  if (!alarmsSupported) return;
  await prepare();
  const permission = await Notifications().getPermissionsAsync();
  if (!permission.granted) return;
  await Notifications().scheduleNotificationAsync({
    content: { title: title, body: body, sound: true },
    trigger: null,
  });
}

// A test reminder 5 seconds from now, so vendors can check sound and permission
export async function testReminder(userId) {
  if (!alarmsSupported) return false;
  const allowed = await askPermission();
  if (!allowed) return false;
  const settings = await readReminderSettings(userId);
  await Notifications().scheduleNotificationAsync({
    content: {
      title: "Test reminder, gumagana",
      body: "Your Tindahan reminders are working.",
      sound: settings.sound,
    },
    trigger: {
      type: Notifications().SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: 5,
      channelId: settings.sound ? SOUND_CHANNEL : QUIET_CHANNEL,
    },
  });
  return true;
}

// An instant notification with no scheduling at all. If this one shows but the
// timed test does not, the phone is holding back scheduled alarms. If neither
// shows, the phone is hiding Tindahan's notifications.
export async function sendNow(userId) {
  if (!alarmsSupported) return false;
  const allowed = await askPermission();
  if (!allowed) return false;
  const settings = await readReminderSettings(userId);
  await Notifications().scheduleNotificationAsync({
    content: {
      title: "Tindahan notification test",
      body: "If you can see this, notifications can show on this phone.",
      sound: settings.sound,
    },
    trigger: Platform.OS === "android" ? { channelId: settings.sound ? SOUND_CHANNEL : QUIET_CHANNEL } : null,
  });
  return true;
}

// What the phone itself says about Tindahan's notifications, in plain facts,
// so a problem shows up as words on screen instead of silence.
export async function reminderHealth(userId) {
  if (!alarmsSupported) return { supported: false, reason: alarmsUnavailable };
  await prepare();
  const settings = await readReminderSettings(userId);
  const permission = await Notifications().getPermissionsAsync();
  let categoryOn = null;
  if (Platform.OS === "android") {
    const channel = await Notifications().getNotificationChannelAsync(settings.sound ? SOUND_CHANNEL : QUIET_CHANNEL);
    // a category the person switched off in phone settings has importance NONE
    categoryOn = Boolean(channel) && channel.importance !== Notifications().AndroidImportance.NONE;
  }
  const waiting = (await Notifications().getAllScheduledNotificationsAsync()).length;
  return {
    supported: true,
    enabled: settings.enabled,
    permission: permission.granted,
    categoryOn: categoryOn,
    waiting: waiting,
  };
}

// Open Tindahan's own page in the phone settings, where notifications, battery,
// autostart, and alarms are allowed
export function openPhoneSettings() {
  return Linking.openSettings();
}
