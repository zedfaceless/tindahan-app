// lib/legal.js
// Where Tindahan's legal pages live, and which kind of build this is.
// The pages are plain web pages hosted free on GitHub Pages.

const SITE = "https://zedfaceless.github.io/tindahan-app";

export const PRIVACY_URL = SITE + "/privacy.html";
export const TERMS_URL = SITE + "/terms.html";
export const DELETE_URL = SITE + "/delete-account.html";
export const SUPPORT_EMAIL = "zedfaces.fernandez@gmail.com";

// The Google Play build has no payment screens, Google Play only allows its own
// billing for in-app features. The direct APK keeps the GCash flow.
// Set by EXPO_PUBLIC_DISTRIBUTION in the EAS environment, "play" or "direct".
export const PLAY_BUILD = process.env.EXPO_PUBLIC_DISTRIBUTION === "play";
