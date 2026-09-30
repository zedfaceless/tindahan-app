// AuthScreen.js
// Login and registration for Tindahan, using email and a PIN or password.
// No email verification, vendors can use the app right after registering.

import { useState } from "react";
import {
  StyleSheet, Text, TextInput, TouchableOpacity,
  ActivityIndicator, ScrollView,
} from "react-native";
import { supabase } from "./lib/supabase";
import { notify } from "./lib/notify";

export default function AuthScreen() {
  const [mode, setMode] = useState("login"); // "login" or "register"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [marketName, setMarketName] = useState("");
  const [busy, setBusy] = useState(false);

  // Check every registration field before talking to the server
  function validRegistration(cleanEmail, cleanUser, cleanMarket) {
    if (!cleanEmail.includes("@") || !cleanEmail.includes(".")) {
      notify("Check your email", "Please enter a valid email address.");
      return false;
    }
    if (password.length < 6) {
      notify("PIN too short", "Use at least 6 numbers or letters.");
      return false;
    }
    if (cleanUser.length < 3) {
      notify("Username too short", "Use at least 3 letters.");
      return false;
    }
    if (cleanMarket.length === 0) {
      notify("Market required", "Please enter the name of your market.");
      return false;
    }
    return true;
  }

  // Create a new account, the database makes the profile automatically
  async function register() {
    const cleanEmail = email.trim().toLowerCase();
    const cleanUser = username.trim().toLowerCase();
    const cleanMarket = marketName.trim();
    if (!validRegistration(cleanEmail, cleanUser, cleanMarket)) {
      return;
    }
    setBusy(true);
    try {
      const { data: available, error: checkError } = await supabase.rpc(
        "username_available", { check_name: cleanUser }
      );
      if (checkError) {
        notify("Connection problem", "Please check your internet and try again.");
        return;
      }
      if (!available) {
        notify("Username taken", "Please choose a different username.");
        return;
      }
      const { error } = await supabase.auth.signUp({
        email: cleanEmail,
        password: password,
        options: { data: { username: cleanUser, market_name: cleanMarket } },
      });
      if (error) {
        notify("Registration failed", error.message);
      }
      // on success the app switches screens by itself through the session listener
    } finally {
      setBusy(false);
    }
  }

  // Log in with email and PIN
  async function login() {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !password) {
      notify("Missing details", "Please enter your email and PIN.");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password: password,
      });
      if (error) {
        notify("Login failed", "Wrong email or PIN, please try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  const registering = mode === "register";

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.body}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>Tindahan</Text>
      <Text style={styles.subtitle}>
        {registering ? "Gumawa ng account, register" : "Mag login, log in"}
      </Text>

      {registering && (
        <>
          <Text style={styles.label}>Username</Text>
          <TextInput
            style={styles.input}
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            placeholder="halimbawa, aling_nena"
          />
          <Text style={styles.label}>Palengke, market name</Text>
          <TextInput
            style={styles.input}
            value={marketName}
            onChangeText={setMarketName}
            placeholder="halimbawa, Santa Cruz Public Market"
          />
        </>
      )}

      <Text style={styles.label}>Email</Text>
      <TextInput
        style={styles.input}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        placeholder="you@gmail.com"
      />
      <Text style={styles.label}>PIN, at least 6</Text>
      <TextInput
        style={styles.input}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        placeholder="******"
      />

      <TouchableOpacity
        style={styles.mainButton}
        onPress={registering ? register : login}
        disabled={busy}
      >
        {busy ? (
          <ActivityIndicator color="white" />
        ) : (
          <Text style={styles.mainText}>{registering ? "REGISTER" : "LOG IN"}</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity onPress={() => setMode(registering ? "login" : "register")}>
        <Text style={styles.switchText}>
          {registering ? "May account na? Log in" : "Wala pang account? Register"}
        </Text>
      </TouchableOpacity>

      <Text style={styles.notice}>
        Tindahan records how the app is used to improve it. Only the app owner sees this.
      </Text>
    </ScrollView>
  );
}

// Same large text style as the rest of the app
const styles = StyleSheet.create({
  page: { backgroundColor: "#F8FAFC" },
  // on a wide PC screen the form stays a phone sized column in the middle
  body: {
    padding: 20, paddingTop: 60, flexGrow: 1,
    width: "100%", maxWidth: 520, alignSelf: "center",
  },
  title: { fontSize: 40, fontWeight: "bold", color: "#1E293B" },
  subtitle: { fontSize: 20, color: "#64748B", marginBottom: 20 },
  label: { fontSize: 18, color: "#64748B", marginBottom: 6, marginTop: 12 },
  input: {
    backgroundColor: "white", borderRadius: 10, padding: 16,
    fontSize: 22, borderWidth: 1, borderColor: "#E2E8F0", color: "#1E293B",
  },
  mainButton: {
    marginTop: 30, backgroundColor: "#059669", padding: 22,
    borderRadius: 12, alignItems: "center",
  },
  mainText: { fontSize: 24, fontWeight: "bold", color: "white" },
  switchText: { fontSize: 18, color: "#2563EB", textAlign: "center", marginTop: 20 },
  notice: { fontSize: 14, color: "#64748B", textAlign: "center", marginTop: 30 },
});
