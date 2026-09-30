// lib/sync.js
// Offline first storage and two way sync for Tindahan records and schedules.
// Everything is saved on the phone first. When there is internet, rows not yet
// sent are pushed to Supabase, and newer rows are pulled down, so a vendor who
// changes phones gets everything back after logging in.
// Rows that need premium are pushed separately, so if premium lapsed while the
// phone was offline, they wait safely on the phone and never block the rest.

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { supabase } from "./supabase";

const PAGE_SIZE = 1000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The record types only premium accounts can add
export const PREMIUM_KINDS = ["withdrawal", "personal"];

// The database answers with this code when a security rule refuses a write
const REFUSED = "42501";

// A new unique id, made on the phone so offline rows never clash
export function newId() {
  return Crypto.randomUUID();
}

// The current time in one standard format, used to decide which version is newer
export function nowIso() {
  return new Date().toISOString();
}

// How each synced table is stored on the phone and sent to the server
const TABLES = {
  records: {
    storageKey: (userId) => "tindahan_records_" + userId,
    pulledKey: (userId) => "tindahan_last_pulled_" + userId,
    // older app versions stored records differently, bring them up to date
    normalize: (r) => ({
      id: UUID_PATTERN.test(r.id) ? r.id : newId(),
      record_date: r.record_date || r.date,
      kind: r.kind,
      amount: Number(r.amount),
      description: r.description || "",
      updated_at: r.updated_at || nowIso(),
      deleted: r.deleted === true,
      synced: r.synced === true,
    }),
    toRow: (r, userId) => ({
      id: r.id, user_id: userId, kind: r.kind, amount: r.amount,
      description: r.description, record_date: r.record_date,
      updated_at: r.updated_at, deleted: r.deleted,
    }),
    fromRow: (r) => ({
      id: r.id, record_date: r.record_date, kind: r.kind, amount: Number(r.amount),
      description: r.description, updated_at: new Date(r.updated_at).toISOString(),
      deleted: r.deleted, synced: true,
    }),
    // premium record types need premium, deletes never do
    needsPremium: (r) => PREMIUM_KINDS.includes(r.kind) && !r.deleted,
  },
  schedules: {
    storageKey: (userId) => "tindahan_schedules_" + userId,
    pulledKey: (userId) => "tindahan_schedules_pulled_" + userId,
    normalize: (s) => ({ ...s, amount: Number(s.amount), deleted: s.deleted === true, synced: s.synced === true }),
    toRow: (s, userId) => ({
      id: s.id, user_id: userId, title: s.title, amount: s.amount, kind: s.kind,
      due_date: s.due_date, anchor_day: s.anchor_day, remind_time: s.remind_time,
      repeat: s.repeat, done: s.done, updated_at: s.updated_at, deleted: s.deleted,
    }),
    fromRow: (s) => ({
      id: s.id, title: s.title, amount: Number(s.amount), kind: s.kind,
      due_date: s.due_date, anchor_day: s.anchor_day, remind_time: s.remind_time,
      repeat: s.repeat, done: s.done, updated_at: new Date(s.updated_at).toISOString(),
      deleted: s.deleted, synced: true,
    }),
    // every schedule change needs premium, except deleting
    needsPremium: (s) => !s.deleted,
  },
};

function profileKey(userId) {
  return "tindahan_profile_" + userId;
}

// The vendor's own account status from the last sync, for offline use
export async function readProfile(userId) {
  const saved = await AsyncStorage.getItem(profileKey(userId));
  return saved === null ? null : JSON.parse(saved);
}

// True while premium time remains, or for the owner while owner premium is on,
// using the account details from the last sync
export function isPremium(profile) {
  if (!profile) {
    return false;
  }
  if (profile.role === "owner" && profile.owner_premium) {
    return true;
  }
  return Boolean(profile.premium_until && new Date(profile.premium_until) > new Date());
}

// Read one table from the phone, upgrading and saving old rows once
async function loadLocal(table, userId) {
  const config = TABLES[table];
  const saved = await AsyncStorage.getItem(config.storageKey(userId));
  if (saved === null) {
    return [];
  }
  const raw = JSON.parse(saved);
  const rows = raw.map(config.normalize);
  const upgraded = raw.some((r, i) => r.id !== rows[i].id || r.updated_at === undefined);
  if (upgraded) {
    await saveLocal(table, userId, rows);
  }
  return rows;
}

// Write one whole table to the phone
async function saveLocal(table, userId, rows) {
  await AsyncStorage.setItem(TABLES[table].storageKey(userId), JSON.stringify(rows));
}

// Only one read or write of the phone storage happens at a time, so a save
// made while a sync is running can never be overwritten and lost
let lock = Promise.resolve();
function withLock(task) {
  const run = lock.then(task, task);
  lock = run.catch(() => {});
  return run;
}

// Read the records safely, for the screen to show
export function readLocal(userId) {
  return withLock(() => loadLocal("records", userId));
}

// Change the records safely, for saving and deleting
export function updateLocal(userId, change) {
  return withLock(async () => {
    const next = change(await loadLocal("records", userId));
    await saveLocal("records", userId, next);
    return next;
  });
}

// Read the schedules safely
export function readSchedules(userId) {
  return withLock(() => loadLocal("schedules", userId));
}

// Change the schedules safely
export function updateSchedules(userId, change) {
  return withLock(async () => {
    const next = change(await loadLocal("schedules", userId));
    await saveLocal("schedules", userId, next);
    return next;
  });
}

// Combine two lists, when the same row is in both the newer one wins
function mergeLists(base, incoming) {
  const byId = new Map(base.map((r) => [r.id, r]));
  for (const row of incoming) {
    const existing = byId.get(row.id);
    if (!existing || row.updated_at > existing.updated_at) {
      byId.set(row.id, row);
    }
  }
  return Array.from(byId.values()).sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
}

// Send a group of rows to Supabase, returns false when the database refused them
async function push(table, userId, rows) {
  if (rows.length === 0) {
    return true;
  }
  const { error } = await supabase
    .from(table)
    .upsert(rows.map((r) => TABLES[table].toRow(r, userId)));
  if (error && error.code === REFUSED) {
    return false;
  }
  if (error) {
    throw error;
  }
  return true;
}

// Download every row changed on the server since the last pull, page by page
async function pull(table, userId, lastPulled) {
  const rows = [];
  let from = 0;
  while (true) {
    let query = supabase
      .from(table)
      .select("*")
      .eq("user_id", userId)
      .order("server_updated_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (lastPulled) {
      query = query.gt("server_updated_at", lastPulled);
    }
    const { data, error } = await query;
    if (error) {
      throw error;
    }
    rows.push(...data);
    if (data.length < PAGE_SIZE) {
      break;
    }
    from += PAGE_SIZE;
  }
  return rows;
}

// One full round for one table, push then pull then merge into the phone storage
async function syncTable(table, userId) {
  const config = TABLES[table];
  const local = await withLock(() => loadLocal(table, userId));
  const unsynced = local.filter((r) => !r.synced);
  const basic = unsynced.filter((r) => !config.needsPremium(r));
  const premium = unsynced.filter((r) => config.needsPremium(r));
  const basicAccepted = await push(table, userId, basic);
  const premiumAccepted = await push(table, userId, premium);
  const pushed = [...(basicAccepted ? basic : []), ...(premiumAccepted ? premium : [])];

  const lastPulled = await AsyncStorage.getItem(config.pulledKey(userId));
  const serverRows = await pull(table, userId, lastPulled);
  const remote = serverRows.map(config.fromRow);

  // mark what was pushed as synced, but only if it was not changed again meanwhile
  const pushedVersion = new Map(pushed.map((r) => [r.id, r.updated_at]));
  const merged = await withLock(async () => {
    const latest = await loadLocal(table, userId);
    const marked = latest.map((r) =>
      pushedVersion.get(r.id) === r.updated_at ? { ...r, synced: true } : r
    );
    const result = mergeLists(marked, remote);
    await saveLocal(table, userId, result);
    return result;
  });

  if (serverRows.length > 0) {
    await AsyncStorage.setItem(config.pulledKey(userId), serverRows[serverRows.length - 1].server_updated_at);
  }
  return {
    rows: merged,
    heldBack: premiumAccepted ? 0 : premium.length,
    refused: !basicAccepted,
  };
}

// Fetch and remember the vendor's own account details
export async function refreshProfile(userId) {
  const { data, error } = await supabase
    .from("profiles")
    .select("username, market_name, role, disabled, premium_until, owner_premium")
    .eq("id", userId)
    .single();
  if (error) {
    throw error;
  }
  await AsyncStorage.setItem(profileKey(userId), JSON.stringify(data));
  return data;
}

// One full sync of everything, records then schedules then the account
async function syncOnce(userId) {
  const records = await syncTable("records", userId);
  const schedules = await syncTable("schedules", userId);
  const profile = await refreshProfile(userId);
  return {
    records: records.rows,
    schedules: schedules.rows,
    profile: profile,
    heldBack: records.heldBack + schedules.heldBack,
    refused: records.refused,
  };
}

// Run a sync, if one is already running, run once more after it finishes.
// Returns records, schedules, the account, and how many premium rows are waiting,
// or null when this call was folded into a running sync.
// Throws when offline, so the screen can show the offline status.
let running = false;
let runAgain = false;
export async function syncRecords(userId) {
  if (running) {
    runAgain = true;
    return null;
  }
  running = true;
  try {
    let result;
    do {
      runAgain = false;
      result = await syncOnce(userId);
    } while (runAgain);
    return result;
  } finally {
    running = false;
  }
}
