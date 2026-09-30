// The income statement, its periods, totals, safety, and honest footer.
import {
  periodFor, statementRecords, summarize, buildStatementHtml, earliestStart,
} from "../lib/statement";

const mk = (date, kind, amount, description, scope = "business", deleted = false) =>
  ({ record_date: date, kind, amount, description, scope, deleted, updated_at: date + "T00:00:00Z" });
const records = [
  mk("2026-09-10", "in", 999, "too early"),
  mk("2026-09-20", "in", 1500, "benta"),
  mk("2026-09-21", "out", 300, "supplier"),
  mk("2026-10-02", "in", 2000, "benta"),
  mk("2026-10-03", "out", 150, "deleted one", "business", true),
  mk("2026-10-05", "in", 5000, "freelance design", "personal"),
  mk("2026-10-05", "out", 400, "<script>alert(1)</script> & kuryente"),
];

describe("statement periods", () => {
  test.each([
    [1, new Date(2026, 9, 15), "2026-09-16", "2026-10-15"],
    [6, new Date(2026, 9, 15), "2026-04-16", "2026-10-15"],
    [1, new Date(2027, 2, 31), "2027-03-01", "2027-03-31"],
    [3, new Date(2027, 0, 10), "2026-10-11", "2027-01-10"],
  ])("%i month ending %s", (months, today, start, end) => {
    expect(periodFor(months, today)).toEqual({ start, end });
  });

  test("a custom range can start no earlier than 6 months back", () => {
    expect(earliestStart("2026-10-15", 6)).toBe("2026-04-16");
  });
});

describe("statement totals", () => {
  const list = statementRecords(records, "business", "2026-09-16", "2026-10-15");

  test("only business records in the period, oldest first, no deleted ones", () => {
    expect(list.map((r) => r.description)).toEqual(["benta", "supplier", "benta", "<script>alert(1)</script> & kuryente"]);
  });

  test("totals and the month by month split", () => {
    const t = summarize(list);
    expect([t.moneyIn, t.moneyOut, t.net]).toEqual([3500, 700, 2800]);
    expect(t.months.map((m) => [m.key, m.moneyIn, m.moneyOut])).toEqual([["2026-09", 1500, 300], ["2026-10", 2000, 400]]);
  });

  test("personal income is kept separate", () => {
    expect(summarize(statementRecords(records, "personal", "2026-09-16", "2026-10-15")).moneyIn).toBe(5000);
  });
});

describe("the statement page", () => {
  const html = buildStatementHtml({
    vendor: { username: "aling_nena", fullName: "Juana Dela Cruz", market: "Santa Cruz Public Market", email: "nena@gmail.com" },
    scope: "business", start: "2026-09-16", end: "2026-10-15", records,
    confirmedOn: "2026-10-15", generatedAt: new Date(2026, 9, 15, 9, 30),
  });

  test("vendor text can never inject code into the PDF", () => {
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  test("the full name shows, with the username under it", () => {
    expect(html).toContain("Juana Dela Cruz");
    expect(html).toContain("Username</td><td>aling_nena");
  });

  test("the short honest footer uses the full name", () => {
    expect(html).toContain("Prepared from records Juana Dela Cruz entered in Tindahan. The figures have not been audited or verified.");
  });

  test("the approval line shows only when the owner confirmed the account", () => {
    expect(html).toContain("Account confirmed active by Tindahan");
    const premium = buildStatementHtml({ vendor: { username: "x" }, scope: "business", start: "2026-09-16", end: "2026-10-15", records, generatedAt: new Date() });
    expect(premium).not.toContain("confirmed active");
  });

  test("the Prepared date is written out by hand, safe on phones", () => {
    expect(html).toMatch(/October 15, 2026 at 9:30 AM/);
    expect(html).not.toMatch(/dateStyle|timeStyle/);
  });
});
