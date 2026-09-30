// lib/sync.js
// Offline first storage and two way sync for Tindahan records.
// Every record is saved on the phone first. When there is internet, records
// not yet sent are pushed to Supabase, and newer records are pulled down, so a
// vendor who changes phones gets all their records back after logging in.
// Premium record types are pushed separately, so if premium lapsed while the
// phone was offline, they wait safely on the phone and never block the rest.

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { supabase } from "./supabase";

const PAGE_SIZE = 1000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Each vendor's records and sync marker are stored under their own keys
function recordsKey(userId) {
  return "tindahan_records_" + userId;
}
function pulledKey(userId) {
  return "tindahan_last_pulled_" + userId;
}
function profileKey(userId) {
  return "tindahan_profile_" + userId;
}

// The record types only premium accounts can add
export const PREMIUM_KINDS = ["withdrawal", "personal"];

// The database answers with this code when a security rule refuses a write
const REFUSED = "42501";

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

// A new unique id, made on the phone so offline records never clash
export function newId() {
  return Crypto.randomUUID();
}

// The current time in one standard format, used to decide which version is newer
export function nowIso() {
  return new Date().toISOString();
}

// Bring a record from an older app version up to the current shape
function normalize(record) {
  return {
    id: UUID_PATTERN.test(record.id) ? record.id : newId(),
    record_date: record.record_date || record.date,
    kind: record.kind,
    amount: Number(record.amount),
    description: record.description || "",
    updated_at: record.updated_at || nowIso(),
    deleted: record.deleted === true,
    synced: record.synced === true,
  };
}

// Read records from the phone, upgrading and saving old ones once
async function loadLocal(userId) {
  const saved = await AsyncStorage.getItem(recordsKey(userId));
  if (saved === null) {
    return [];
  }
  const raw = JSON.parse(saved);
  const records = raw.map(normalize);
  const upgraded = raw.some((r, i) => r.id !== records[i].id || r.updated_at === undefined);
  if (upgraded) {
    await saveLocal(userId, records);
  }
  return records;
}

// Write the full record list to the phone
async function saveLocal(userId, records) {
  await AsyncStorage.setItem(recordsKey(userId), JSON.stringify(records));
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
  return withLock(() => loadLocal(userId));
}

// Change the records safely, for saving and deleting
export function updateLocal(userId, change) {
  return withLock(async () => {
    const current = await loadLocal(userId);
    const next = change(current);
    await saveLocal(userId, next);
    return next;
  });
}

// Combine two lists, when the same record is in both the newer one wins
function mergeLists(base, incoming) {
  const byId = new Map(base.map((r) => [r.id, r]));
  for (const record of incoming) {
    const existing = byId.get(record.id);
    if (!existing || record.updated_at > existing.updated_at) {
      byId.set(record.id, record);
    }
  }
  return Array.from(byId.values()).sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
}

// Send a group of records to Supabase, returns false when the database refused them
async function push(userId, unsynced) {
  if (unsynced.length === 0) {
    return true;
  }
  const rows = unsynced.map((r) => ({
    id: r.id,
    user_id: userId,
    kind: r.kind,
    amount: r.amount,
    description: r.description,
    record_date: r.record_date,
    updated_at: r.updated_at,
    deleted: r.deleted,
  }));
  const { error } = await supabase.from("records").upsert(rows);
  if (error && error.code === REFUSED) {
    return false;
  }
  if (error) {
    throw error;
  }
  return true;
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

// Download every record changed on the server since the last pull, page by page
async function pull(userId, lastPulled) {
  const rows = [];
  let from = 0;
  while (true) {
    let query = supabase
      .from("records")
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

// One full round, push then pull then merge into the phone storage
async function syncOnce(userId) {
  const local = await readLocal(userId);
  const unsynced = local.filter((r) => !r.synced);
  // normal records, plus deletes, never need premium
  const basic = unsynced.filter((r) => !PREMIUM_KINDS.includes(r.kind) || r.deleted);
  const premium = unsynced.filter((r) => PREMIUM_KINDS.includes(r.kind) && !r.deleted);
  const basicAccepted = await push(userId, basic);
  const premiumAccepted = await push(userId, premium);
  const pushed = [...(basicAccepted ? basic : []), ...(premiumAccepted ? premium : [])];

  const lastPulled = await AsyncStorage.getItem(pulledKey(userId));
  const rows = await pull(userId, lastPulled);
  const remote = rows.map((r) => ({
    id: r.id,
    record_date: r.record_date,
    kind: r.kind,
    amount: Number(r.amount),
    description: r.description,
    updated_at: new Date(r.updated_at).toISOString(),
    deleted: r.deleted,
    synced: true,
  }));

  // mark what was pushed as synced, but only if it was not changed again meanwhile
  const pushedVersion = new Map(pushed.map((r) => [r.id, r.updated_at]));
  const merged = await withLock(async () => {
    const latest = await loadLocal(userId);
    const marked = latest.map((r) =>
      pushedVersion.get(r.id) === r.updated_at ? { ...r, synced: true } : r
    );
    const result = mergeLists(marked, remote);
    await saveLocal(userId, result);
    return result;
  });

  if (rows.length > 0) {
    await AsyncStorage.setItem(pulledKey(userId), rows[rows.length - 1].server_updated_at);
  }
  const profile = await refreshProfile(userId);
  return {
    records: merged,
    profile: profile,
    heldBack: premiumAccepted ? 0 : premium.length,
    refused: !basicAccepted,
  };
}

// Run a sync, if one is already running, run once more after it finishes.
// Returns the records, the account status, and how many premium records are waiting,
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
