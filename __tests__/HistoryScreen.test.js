// The History screen, rendered like on a phone. Money in on the left, money out
// on the right, each with its total. Premium switches business and personal,
// free is limited to the last 30 days.
import { render, screen, fireEvent } from "@testing-library/react-native";
import { ThemeProvider } from "../lib/theme";
import HistoryScreen from "../HistoryScreen";
import { dayString, addDays } from "../lib/reminders";
import { longDay } from "../lib/statement";

const today = dayString(new Date());
const daysAgo = (n) => dayString(addDays(new Date(), -n));
const rec = (id, record_date, scope, kind, amount, description) =>
  ({ id, record_date, scope, kind, amount, description, deleted: false, updated_at: record_date + "T01:00:00Z" });
const records = [
  rec("1", today, "business", "in", 1500, "benta ng gulay"),
  rec("2", today, "business", "out", 300, "supplier"),
  rec("3", today, "personal", "in", 5000, "padala"),
  rec("4", daysAgo(3), "business", "in", 700, "benta kahapon"),
  { ...rec("5", today, "business", "in", 9999, "deleted sale"), deleted: true },
];

function show(premium) {
  return render(
    <ThemeProvider>
      <HistoryScreen records={records} premium={premium} header={null} onUpgrade={jest.fn()} />
    </ThemeProvider>
  );
}

test("today's business money in and out, with totals and net, and no deleted records", () => {
  show(true);
  expect(screen.getByText("benta ng gulay")).toBeTruthy();
  expect(screen.getByText("supplier")).toBeTruthy();
  expect(screen.getAllByText("P 1,500.00").length).toBeGreaterThan(0);
  expect(screen.getAllByText("P 300.00").length).toBeGreaterThan(0);
  expect(screen.getByText("P 1,200.00")).toBeTruthy();
  expect(screen.queryByText("deleted sale")).toBeNull();
  expect(screen.queryByText("padala")).toBeNull();
});

test("7 DAYS brings in the earlier sale", () => {
  show(true);
  fireEvent.press(screen.getByText("7 DAYS"));
  expect(screen.getByText("benta kahapon")).toBeTruthy();
  expect(screen.getByText("P 2,200.00")).toBeTruthy();
});

test("premium can switch to personal money", () => {
  show(true);
  fireEvent.press(screen.getByText("PERSONAL"));
  expect(screen.getByText("padala")).toBeTruthy();
  expect(screen.queryByText("benta ng gulay")).toBeNull();
});

test("free sees business only, with the 30 day note", () => {
  show(false);
  expect(screen.queryByText("PERSONAL")).toBeNull();
  expect(screen.getByText("Free shows the last 30 days. Premium shows all your history.")).toBeTruthy();
});

test("free cannot step the start date back past 30 days", () => {
  show(false);
  fireEvent.press(screen.getByText("PICK DATES"));
  const monthBack = screen.getAllByText("- 1 month")[0];
  fireEvent.press(monthBack);
  fireEvent.press(monthBack);
  expect(screen.getByText(longDay(daysAgo(29)))).toBeTruthy();
});

test("premium can step back further than 30 days", () => {
  show(true);
  fireEvent.press(screen.getByText("PICK DATES"));
  const monthBack = screen.getAllByText("- 1 month")[0];
  fireEvent.press(monthBack);
  fireEvent.press(monthBack);
  expect(screen.queryByText(longDay(daysAgo(29)))).toBeNull();
});
