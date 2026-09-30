// The Schedule screen, rendered like on a phone. Paying a schedule adds the money
// record and moves a monthly bill to next month. Free vendors see the upgrade card.
import { Text } from "react-native";
import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ThemeProvider } from "../lib/theme";
import ScheduleScreen from "../ScheduleScreen";
import { dayString, addDays } from "../lib/reminders";

const due = dayString(addDays(new Date(), 5));
const kuryente = {
  id: "5c1e1e1e-0000-4000-8000-000000000001", title: "Kuryente", amount: 850, scope: "business", kind: "out",
  due_date: due, anchor_day: Number(due.slice(8)), remind_time: "07:00", repeat: "monthly",
  done: false, deleted: false, synced: true, updated_at: new Date().toISOString(),
};

function show(premium, handlers = {}) {
  return render(
    <ThemeProvider>
      <ScheduleScreen
        user={{ id: "u1" }}
        schedules={[kuryente]}
        onSchedules={handlers.onSchedules || jest.fn()}
        onRecords={handlers.onRecords || jest.fn()}
        afterChange={handlers.afterChange || jest.fn()}
        header={null}
        upgrade={<Text>UPGRADE CARD</Text>}
        premium={premium}
      />
    </ThemeProvider>
  );
}

beforeEach(async () => {
  await AsyncStorage.clear();
  await AsyncStorage.setItem("tindahan_schedules_u1", JSON.stringify([kuryente]));
});

test("a free vendor sees the upgrade card, not the schedules", () => {
  show(false);
  expect(screen.getByText("UPGRADE CARD")).toBeTruthy();
  expect(screen.queryByText("Kuryente")).toBeNull();
});

test("the schedule card shows the bill, when it is due, and how it repeats", () => {
  show(true);
  expect(screen.getByText("Kuryente")).toBeTruthy();
  expect(screen.getByText("P 850.00")).toBeTruthy();
  expect(screen.getByText(/^Due in 5 days/)).toBeTruthy();
  expect(screen.getByText(/Repeats monthly/)).toBeTruthy();
});

test("paying with a changed amount adds the record and moves the bill to next month", async () => {
  const onRecords = jest.fn();
  const onSchedules = jest.fn();
  const afterChange = jest.fn();
  show(true, { onRecords, onSchedules, afterChange });
  fireEvent.press(screen.getByText("PAID, BAYAD NA"));
  fireEvent.changeText(screen.getByDisplayValue("850"), "870");
  fireEvent.press(screen.getByText("SAVE PAYMENT"));
  await waitFor(() => expect(afterChange).toHaveBeenCalled());

  const records = onRecords.mock.calls[0][0];
  expect(records[0]).toMatchObject({ description: "Kuryente", amount: 870, kind: "out", scope: "business", synced: false });

  const schedules = onSchedules.mock.calls[0][0];
  const moved = new Date(Number(due.slice(0, 4)), Number(due.slice(5, 7)), 1);
  expect(schedules[0].due_date.slice(0, 7)).toBe(dayString(moved).slice(0, 7));
  expect(schedules[0].done).toBe(false);
});

test("a wrong amount is refused and nothing is saved", async () => {
  const onRecords = jest.fn();
  show(true, { onRecords });
  fireEvent.press(screen.getByText("PAID, BAYAD NA"));
  fireEvent.changeText(screen.getByDisplayValue("850"), "abc");
  fireEvent.press(screen.getByText("SAVE PAYMENT"));
  await new Promise((r) => setTimeout(r, 50));
  expect(onRecords).not.toHaveBeenCalled();
});

test("a new schedule needs a name before it saves", async () => {
  const onSchedules = jest.fn();
  show(true, { onSchedules });
  fireEvent.press(screen.getByText("+ ADD SCHEDULE"));
  fireEvent.press(screen.getByText("SAVE SCHEDULE"));
  await new Promise((r) => setTimeout(r, 50));
  expect(onSchedules).not.toHaveBeenCalled();
});
