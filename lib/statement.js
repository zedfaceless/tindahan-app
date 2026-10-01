// lib/statement.js
// Builds the income statement PDF page from the vendor's own records.
// Pure calculation and text, so it is easy to test. The phone turns the
// page into a PDF with expo-print.

// The footer every statement carries, short and honest about where the numbers come from
export function footerText(name) {
  return "Prepared from records " + name + " entered in Tindahan. "
    + "The figures have not been audited or verified.";
}

export const PREMIUM_MONTHS = [1, 3, 6];
export const FREE_MONTHS = 1;
export const MAX_MONTHS = 6;

// "2026-10-15" into a local date
function toDate(value) {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function dayKey(date) {
  return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0")
    + "-" + String(date.getDate()).padStart(2, "0");
}

// Oct 15, 2026
export function longDay(value) {
  return toDate(value).toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric" });
}

// The last few months ending today, one month is Sep 16 to Oct 15
export function periodFor(months, today) {
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  // a month with fewer days, like Mar 31 back to Feb, uses the last day of February
  const lastDay = new Date(end.getFullYear(), end.getMonth() - months + 1, 0).getDate();
  // the day after the same date that many months ago, the Date handles year changes
  const start = new Date(end.getFullYear(), end.getMonth() - months, Math.min(end.getDate(), lastDay) + 1);
  return { start: dayKey(start), end: dayKey(end) };
}

// The earliest start a custom range may have, so it is never longer than the limit
export function earliestStart(end, months) {
  return periodFor(months, toDate(end)).start;
}

// Only this statement's records, business or personal, inside the period, oldest first
export function statementRecords(records, scope, start, end) {
  return records
    .filter((r) => !r.deleted && r.scope === scope && r.record_date >= start && r.record_date <= end)
    .sort((a, b) => (a.record_date < b.record_date ? -1 : a.record_date > b.record_date ? 1
      : a.updated_at < b.updated_at ? -1 : 1));
}

// Totals for the whole period and for each month in it
export function summarize(list) {
  const months = new Map();
  let moneyIn = 0;
  let moneyOut = 0;
  for (const r of list) {
    const key = r.record_date.slice(0, 7);
    if (!months.has(key)) months.set(key, { key: key, moneyIn: 0, moneyOut: 0 });
    const m = months.get(key);
    if (r.kind === "in") { moneyIn += r.amount; m.moneyIn += r.amount; }
    else { moneyOut += r.amount; m.moneyOut += r.amount; }
  }
  return {
    moneyIn: moneyIn,
    moneyOut: moneyOut,
    net: moneyIn - moneyOut,
    count: list.length,
    months: Array.from(months.values()).sort((a, b) => (a.key < b.key ? -1 : 1)),
  };
}

function money(amount) {
  return "&#8369;" + Number(amount).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Vendor text goes into the page, so anything that looks like HTML is shown as plain text
function escape(text) {
  return String(text == null ? "" : text)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function monthName(key) {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-PH", { year: "numeric", month: "long" });
}

// The Tindahan icon, drawn inline so the PDF needs no image files
const ICON = '<svg viewBox="0 0 1024 1024" width="56" height="56" xmlns="http://www.w3.org/2000/svg">'
  + '<rect width="1024" height="1024" rx="230" fill="#1E293B"/>'
  + '<rect x="197" y="228" width="630" height="44" rx="22" fill="#F8FAFC"/>'
  + '<path d="M212 272 H332 V400 A60 60 0 0 1 212 400 Z" fill="#059669"/>'
  + '<path d="M332 272 H452 V400 A60 60 0 0 1 332 400 Z" fill="#F8FAFC"/>'
  + '<path d="M452 272 H572 V400 A60 60 0 0 1 452 400 Z" fill="#059669"/>'
  + '<path d="M572 272 H692 V400 A60 60 0 0 1 572 400 Z" fill="#F8FAFC"/>'
  + '<path d="M692 272 H812 V400 A60 60 0 0 1 692 400 Z" fill="#059669"/>'
  + '<rect x="302" y="664" width="110" height="136" rx="18" fill="#059669"/>'
  + '<rect x="457" y="588" width="110" height="212" rx="18" fill="#059669"/>'
  + '<rect x="612" y="512" width="110" height="288" rx="18" fill="#2563EB"/>'
  + '<rect x="237" y="800" width="550" height="36" rx="18" fill="#F8FAFC"/></svg>';

// October 15, 2026 at 9:30 AM, written out by hand because some phones
// cannot format dates with dateStyle and timeStyle
function preparedAt(date) {
  const h = date.getHours();
  const hour = h % 12 === 0 ? 12 : h % 12;
  return longDay(dayKey(date)) + " at " + hour + ":" + String(date.getMinutes()).padStart(2, "0")
    + (h < 12 ? " AM" : " PM");
}

// The whole statement page, ready for expo-print
export function buildStatementHtml({ vendor, scope, start, end, records, confirmedOn, generatedAt }) {
  const list = statementRecords(records, scope, start, end);
  const t = summarize(list);
  const kind = scope === "personal" ? "Personal income" : "Business income";
  const fullName = vendor.fullName && vendor.fullName.trim() ? vendor.fullName.trim() : vendor.username;
  const name = escape(fullName);
  const rows = list.length === 0
    ? '<tr><td colspan="4" class="none">No records in this period.</td></tr>'
    : list.map((r) => '<tr><td>' + escape(longDay(r.record_date)) + '</td><td>' + escape(r.description)
        + '</td><td class="num in">' + (r.kind === "in" ? money(r.amount) : "") + '</td><td class="num out">'
        + (r.kind === "out" ? money(r.amount) : "") + '</td></tr>').join("");
  const monthRows = t.months.map((m) => '<tr><td>' + monthName(m.key) + '</td><td class="num">'
    + money(m.moneyIn) + '</td><td class="num">' + money(m.moneyOut) + '</td><td class="num">'
    + money(m.moneyIn - m.moneyOut) + '</td></tr>').join("");

  return '<!DOCTYPE html><html><head><meta charset="utf-8"><style>'
    + '@page { size: A4; margin: 18mm 16mm; }'
    + 'body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #1E293B; font-size: 11pt; margin: 0; }'
    + '.brand { display: flex; align-items: center; gap: 12px; }'
    + '.brand b { font-size: 22pt; letter-spacing: -0.5px; }'
    + 'h1 { font-size: 17pt; margin: 18px 0 2px; }'
    + '.kind { color: #059669; font-weight: bold; margin: 0 0 14px; }'
    + '.who { width: 100%; border-collapse: collapse; margin-bottom: 16px; }'
    + '.who td { padding: 3px 0; vertical-align: top; } .who td:first-child { color: #64748B; width: 34%; }'
    + '.totals { display: flex; gap: 10px; margin: 6px 0 18px; }'
    + '.box { flex: 1; border: 1px solid #E2E8F0; border-radius: 8px; padding: 10px 12px; }'
    + '.box span { display: block; color: #64748B; font-size: 9.5pt; }'
    + '.box strong { font-size: 14pt; }'
    + '.box.in strong { color: #059669; } .box.out strong { color: #DC2626; }'
    + 'h2 { font-size: 12pt; margin: 18px 0 6px; }'
    + 'table.list { width: 100%; border-collapse: collapse; font-size: 10pt; }'
    + '.list th { text-align: left; color: #64748B; font-weight: bold; border-bottom: 1.5px solid #1E293B; padding: 6px 4px; }'
    + '.list td { border-bottom: 1px solid #E2E8F0; padding: 5px 4px; }'
    + '.list tr { page-break-inside: avoid; } .list thead { display: table-header-group; }'
    + '.num { text-align: right; white-space: nowrap; } .list th.num { text-align: right; }'
    + '.in { color: #059669; } .out { color: #DC2626; } .none { color: #64748B; text-align: center; padding: 16px; }'
    + '.confirmed { margin-top: 18px; padding: 8px 12px; background: #ECFDF5; border-radius: 6px; color: #047857; font-weight: bold; }'
    + '.footer { margin-top: 22px; padding-top: 10px; border-top: 1px solid #E2E8F0; color: #64748B; font-size: 9pt; line-height: 1.45; }'
    + '</style></head><body>'
    + '<div class="brand">' + ICON + '<b>Tindahan</b></div>'
    + '<h1>Statement of Income and Expenses</h1>'
    + '<p class="kind">' + kind + '</p>'
    + '<table class="who">'
    + '<tr><td>Name</td><td>' + name + '</td></tr>'
    + (fullName !== vendor.username ? '<tr><td>Username</td><td>' + escape(vendor.username) + '</td></tr>' : '')
    + (vendor.market ? '<tr><td>Market</td><td>' + escape(vendor.market) + '</td></tr>' : '')
    + (vendor.email ? '<tr><td>Email</td><td>' + escape(vendor.email) + '</td></tr>' : '')
    + '<tr><td>Period</td><td>' + longDay(start) + ' to ' + longDay(end) + '</td></tr>'
    + '<tr><td>Prepared</td><td>' + escape(preparedAt(generatedAt)) + '</td></tr>'
    + '</table>'
    + '<div class="totals">'
    + '<div class="box in"><span>Total money in</span><strong>' + money(t.moneyIn) + '</strong></div>'
    + '<div class="box out"><span>Total money out</span><strong>' + money(t.moneyOut) + '</strong></div>'
    + '<div class="box"><span>Net</span><strong>' + money(t.net) + '</strong></div>'
    + '</div>'
    + (t.months.length > 1
      ? '<h2>By month</h2><table class="list"><thead><tr><th>Month</th><th class="num">Money in</th><th class="num">Money out</th><th class="num">Net</th></tr></thead><tbody>' + monthRows + '</tbody></table>'
      : '')
    + '<h2>Records, ' + t.count + (t.count === 1 ? ' entry' : ' entries') + '</h2>'
    + '<table class="list"><thead><tr><th>Date</th><th>Description</th><th class="num">Money in</th><th class="num">Money out</th></tr></thead><tbody>' + rows + '</tbody></table>'
    + (confirmedOn ? '<p class="confirmed">Account confirmed active by Tindahan on ' + longDay(confirmedOn) + '.</p>' : '')
    + '<p class="footer">' + escape(footerText(fullName)) + '</p>'
    + '</body></html>';
}
