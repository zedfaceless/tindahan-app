// lib/notify.js
// Popups that work on both the phone and the web browser.
// React Native's Alert does nothing in a browser, so on the web these use
// the browser's own alert and confirm boxes instead.

import { Alert, Platform } from "react-native";

// Show a simple message with an OK button
export function notify(title, message) {
  if (Platform.OS === "web") {
    window.alert(title + "\n\n" + message);
  } else {
    Alert.alert(title, message);
  }
}

// Ask the user to confirm before doing something, like deleting or logging out
export function confirmAction(title, message, actionLabel, onConfirm) {
  if (Platform.OS === "web") {
    if (window.confirm(title + "\n\n" + message)) {
      onConfirm();
    }
  } else {
    Alert.alert(title, message, [
      { text: "Cancel" },
      { text: actionLabel, onPress: onConfirm },
    ]);
  }
}
