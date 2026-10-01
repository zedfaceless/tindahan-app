// Registration needs the vendor to confirm they are 18 or older and agree to
// the Terms of Service and Privacy Policy, Google Play reviewers check this.
import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import { Linking } from "react-native";
import { ThemeProvider } from "../lib/theme";
import AuthScreen from "../AuthScreen";
import { supabase } from "./helpers/fakeSupabase";
import { notify } from "../lib/notify";
import { TERMS_URL, PRIVACY_URL } from "../lib/legal";

jest.mock("../lib/notify", () => ({ notify: jest.fn(), confirmAction: jest.fn() }));

function show() {
  render(<ThemeProvider><AuthScreen /></ThemeProvider>);
  fireEvent.press(screen.getByText("Wala pang account? Register"));
  fireEvent.changeText(screen.getByPlaceholderText("halimbawa, Juana Dela Cruz"), "Juana Dela Cruz");
  fireEvent.changeText(screen.getByPlaceholderText("halimbawa, aling_nena"), "aling_nena");
  fireEvent.changeText(screen.getByPlaceholderText("halimbawa, Santa Cruz Public Market"), "Candelaria Market");
  fireEvent.changeText(screen.getByPlaceholderText("you@gmail.com"), "nena@gmail.com");
  fireEvent.changeText(screen.getByPlaceholderText("******"), "123456");
}

beforeEach(() => {
  notify.mockClear();
  supabase.auth.signUp.mockClear();
  supabase.rpc.mockImplementation(async (name) => ({ data: name === "username_available" ? true : null, error: null }));
});

test("registering without agreeing is refused, and no account is created", async () => {
  show();
  fireEvent.press(screen.getByText("REGISTER"));
  await waitFor(() => expect(notify).toHaveBeenCalledWith("Please agree first", expect.stringMatching(/18 or older/)));
  expect(supabase.auth.signUp).not.toHaveBeenCalled();
});

test("after ticking the box, registration goes ahead", async () => {
  show();
  fireEvent.press(screen.getByLabelText("I am 18 or older and agree to the Terms of Service and Privacy Policy"));
  fireEvent.press(screen.getByText("REGISTER"));
  await waitFor(() => expect(supabase.auth.signUp).toHaveBeenCalledWith(expect.objectContaining({ email: "nena@gmail.com" })));
});

test("the login screen links to the Terms of Service and the Privacy Policy", () => {
  const open = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
  render(<ThemeProvider><AuthScreen /></ThemeProvider>);
  fireEvent.press(screen.getAllByText("Terms of Service").slice(-1)[0]);
  fireEvent.press(screen.getAllByText("Privacy Policy").slice(-1)[0]);
  expect(open).toHaveBeenCalledWith(TERMS_URL);
  expect(open).toHaveBeenCalledWith(PRIVACY_URL);
  expect(TERMS_URL).toMatch(/^https:\/\//);
});
