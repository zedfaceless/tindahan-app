// __tests__/helpers/fakeSupabase.js
// A small in-memory stand-in for Supabase, used by the tests.
// It follows the same rules as the real database: disabled accounts cannot
// write, personal money needs premium, deletes are always allowed, and old
// money types are converted on the way in. It can also pretend to be offline.

const tables = { records: new Map(), schedules: new Map() };
const account = { disabled: false, premium_until: null, role: "vendor", owner_premium: false };
const net = { online: true };
let clock = 0;

function reset() {
  tables.records.clear();
  tables.schedules.clear();
  Object.assign(account, { disabled: false, premium_until: null, role: "vendor", owner_premium: false });
  net.online = true;
}

function serverTime() {
  clock += 1;
  return new Date(Date.UTC(2026, 8, 30, 0, 0, 0, clock)).toISOString().replace("Z", "+00:00");
}

function premiumActive() {
  return (account.role === "owner" && account.owner_premium)
    || Boolean(account.premium_until && new Date(account.premium_until) > new Date());
}

class Query {
  constructor(source) { this.source = source; this.filters = []; this.window = null; }
  select() { return this; }
  eq(column, value) { this.filters.push((row) => row[column] === value); return this; }
  gt(column, value) { this.filters.push((row) => new Date(row[column]) > new Date(value)); return this; }
  order() { return this; }
  range(from, to) { this.window = [from, to]; return this; }
  single() { return this; }
  then(resolve, reject) {
    if (!net.online) return Promise.resolve({ data: null, error: new Error("offline") }).then(resolve, reject);
    if (this.source === "profiles") return Promise.resolve({ data: { ...account }, error: null }).then(resolve, reject);
    let rows = [...tables[this.source].values()].filter((row) => this.filters.every((f) => f(row)));
    rows.sort((a, b) => (a.server_updated_at < b.server_updated_at ? -1 : a.server_updated_at > b.server_updated_at ? 1 : a.id < b.id ? -1 : 1));
    if (this.window) rows = rows.slice(this.window[0], this.window[1] + 1);
    return Promise.resolve({ data: rows.map((r) => ({ ...r })), error: null }).then(resolve, reject);
  }
}

const supabase = {
  from(name) {
    return {
      select() { return new Query(name); },
      async upsert(rows) {
        if (!net.online) return { error: new Error("offline") };
        // the whole batch is refused if any row breaks a rule, like the real database
        for (const row of rows) {
          if (row.kind === "personal") { row.kind = "out"; row.scope = "personal"; }
          if (row.kind === "withdrawal") { row.kind = "out"; row.scope = "business"; }
          const needsPremium = name === "schedules" ? !row.deleted : row.scope === "personal" && !row.deleted;
          if (account.disabled || (needsPremium && !premiumActive())) {
            return { error: { code: "42501", message: "new row violates row-level security policy" } };
          }
        }
        const stamp = serverTime();
        for (const row of rows) {
          tables[name].set(row.id, { ...row, updated_at: row.updated_at.replace("Z", "+00:00"), server_updated_at: stamp });
        }
        return { error: null };
      },
    };
  },
  rpc: jest.fn(async () => ({ data: null, error: null })),
  auth: { startAutoRefresh() {}, stopAutoRefresh() {} },
};

module.exports = { supabase, tables, account, net, reset };
