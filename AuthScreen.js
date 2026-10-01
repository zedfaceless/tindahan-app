// AuthScreen.js
// Login and registration for Tindahan, using email and a PIN or password.
// No email verification, vendors can use the app right after registering.

import { useState, useMemo } from "react";
import {
  StyleSheet, Text, TextInput, TouchableOpacity,
  ActivityIndicator, ScrollView, Image, View, Linking,
} from "react-native";
import { PRIVACY_URL, TERMS_URL } from "./lib/legal";
import { useTheme, EMERALD } from "./lib/theme";
import { supabase } from "./lib/supabase";
import { notify } from "./lib/notify";

export default function AuthScreen() {
  const { colors, mode: theme } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [mode, setMode] = useState("login"); // "login" or "register"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  // registration needs the vendor to confirm age and agree to the terms
  const [agreed, setAgreed] = useState(false);
  const [username, setUsername] = useState("");
  const [marketName, setMarketName] = useState("");
  const [busy, setBusy] = useState(false);

  // Check every registration field before talking to the server
  function validRegistration(cleanEmail, cleanUser, cleanMarket, cleanFull) {
    if (!agreed) {
      notify("Please agree first", "Tick the box to confirm you are 18 or older and agree to the Terms of Service and Privacy Policy.");
      return false;
    }
    if (cleanFull.length < 2) {
      notify("Full name needed", "Please type your full name, like Juana Dela Cruz.");
      return false;
    }
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
    const cleanFull = fullName.trim().replace(/\s+/g, " ");
    if (!validRegistration(cleanEmail, cleanUser, cleanMarket, cleanFull)) {
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
      const { data, error } = await supabase.auth.signUp({
        email: cleanEmail,
        password: password,
        options: { data: { username: cleanUser, market_name: cleanMarket, full_name: cleanFull } },
      });
      if (error) {
        notify("Registration failed", error.message);
        return;
      }
      // save the full name on the new profile, it can also be changed later in Account
      if (data && data.user) {
        await supabase.from("profiles").update({ full_name: cleanFull }).eq("id", data.user.id);
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
      <Image
        source={theme === "abyss"
          ? require("./assets/logo-stacked-dark.png")
          : require("./assets/logo-stacked-light.png")}
        style={styles.logo}
        resizeMode="contain"
        accessibilityLabel="Tindahan"
      />
      <Text style={styles.subtitle}>
        {registering ? "Gumawa ng account, register" : "Mag login, log in"}
      </Text>

      {registering && (
        <>
          <Text style={styles.label}>Buong pangalan, full name</Text>
          <TextInput
            placeholderTextColor={colors.muted}
            keyboardAppearance={theme === "abyss" ? "dark" : "light"}
            style={styles.input}
            value={fullName}
            onChangeText={setFullName}
            autoCapitalize="words"
            placeholder="halimbawa, Juana Dela Cruz"
          />
          <Text style={styles.label}>Username</Text>
          <TextInput
            placeholderTextColor={colors.muted}
            keyboardAppearance={theme === "abyss" ? "dark" : "light"}
            style={styles.input}
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            placeholder="halimbawa, aling_nena"
          />
          <Text style={styles.label}>Palengke, market name</Text>
          <TextInput
            placeholderTextColor={colors.muted}
            keyboardAppearance={theme === "abyss" ? "dark" : "light"}
            style={styles.input}
            value={marketName}
            onChangeText={setMarketName}
            placeholder="halimbawa, Santa Cruz Public Market"
          />
        </>
      )}

      <Text style={styles.label}>Email</Text>
      <TextInput
            placeholderTextColor={colors.muted}
            keyboardAppearance={theme === "abyss" ? "dark" : "light"}
        style={styles.input}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        placeholder="you@gmail.com"
      />
      <Text style={styles.label}>PIN, at least 6</Text>
      <TextInput
            placeholderTextColor={colors.muted}
            keyboardAppearance={theme === "abyss" ? "dark" : "light"}
        style={styles.input}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        placeholder="******"
      />

      {registering && (
        <View style={styles.agreeRow}>
          <TouchableOpacity
            style={[styles.agreeBox, agreed && styles.agreeBoxOn]}
            onPress={() => setAgreed(!agreed)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: agreed }}
            accessibilityLabel="I am 18 or older and agree to the Terms of Service and Privacy Policy"
          >
            {agreed && <Text style={styles.agreeMark}>{"\u2713"}</Text>}
          </TouchableOpacity>
          <Text style={styles.agreeText}>
            I am 18 or older and I agree to the{" "}
            <Text style={styles.agreeLink} onPress={() => Linking.openURL(TERMS_URL)}>Terms of Service</Text>
            {" "}and the{" "}
            <Text style={styles.agreeLink} onPress={() => Linking.openURL(PRIVACY_URL)}>Privacy Policy</Text>.
          </Text>
        </View>
      )}

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
      <View style={styles.footerLinks}>
        <Text style={styles.footerLink} onPress={() => Linking.openURL(TERMS_URL)}>Terms of Service</Text>
        <Text style={styles.footerLink} onPress={() => Linking.openURL(PRIVACY_URL)}>Privacy Policy</Text>
      </View>
    </ScrollView>
  );
}

// Same large text style as the rest of the app
function makeStyles(c) {
  return StyleSheet.create({
    page: { backgroundColor: c.page },
    // on a wide PC screen the form stays a phone sized column in the middle
    body: {
      padding: 20, paddingTop: 40, flexGrow: 1,
      width: "100%", maxWidth: 520, alignSelf: "center",
    },
    logo: { width: 190, height: 168, alignSelf: "center", marginBottom: 8 },
    subtitle: { fontSize: 20, color: c.muted, marginBottom: 20, textAlign: "center" },
    label: { fontSize: 18, color: c.muted, marginBottom: 6, marginTop: 12 },
    input: {
      backgroundColor: c.card, borderRadius: 10, padding: 16,
      fontSize: 22, borderWidth: 1, borderColor: c.line, color: c.text,
    },
    mainButton: {
      marginTop: 30, backgroundColor: EMERALD, padding: 22,
      borderRadius: 12, alignItems: "center",
    },
    mainText: { fontSize: 24, fontWeight: "bold", color: "white" },
    switchText: { fontSize: 18, color: c.accent, textAlign: "center", marginTop: 20 },
    notice: { fontSize: 14, color: c.muted, textAlign: "center", marginTop: 30 },
    agreeRow: { flexDirection: "row", alignItems: "flex-start", gap: 12, marginTop: 20 },
    agreeBox: {
      width: 30, height: 30, borderRadius: 6, borderWidth: 2, borderColor: c.text,
      alignItems: "center", justifyContent: "center", marginTop: 2,
    },
    agreeBoxOn: { backgroundColor: EMERALD, borderColor: EMERALD },
    agreeMark: { color: "white", fontSize: 18, fontWeight: "bold" },
    agreeText: { flex: 1, fontSize: 15, color: c.text, lineHeight: 22 },
    agreeLink: { color: c.accent, fontWeight: "bold", textDecorationLine: "underline" },
    footerLinks: { flexDirection: "row", justifyContent: "center", gap: 24, marginTop: 14, marginBottom: 20 },
    footerLink: { fontSize: 14, color: c.accent, fontWeight: "bold" },
  });
}
