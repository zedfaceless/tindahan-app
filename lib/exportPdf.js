// lib/exportPdf.js
// Turns a statement page into a PDF. On phones the PDF is written into the app's
// own cache folder with a clear name, then the share sheet opens, so vendors can
// send it by Messenger, email, or save it to Files. The app's own folder matters,
// the share sheet is only allowed to read files there.
// On the web it opens the print window, where Save as PDF is one of the choices.

import { Platform } from "react-native";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { File, Paths } from "expo-file-system";

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// base64 text into the PDF's bytes, done by hand so it works on every phone
export function base64ToBytes(text) {
  const clean = text.replace(/[^A-Za-z0-9+/]/g, "");
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let out = 0;
  for (let i = 0; i < clean.length; i += 1) {
    buffer = (buffer << 6) | BASE64.indexOf(clean[i]);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[out] = (buffer >> bits) & 0xff;
      out += 1;
    }
  }
  return bytes.subarray(0, out);
}

export async function savePdf(html, title, fileName) {
  if (Platform.OS === "web") {
    const page = window.open("", "_blank");
    if (!page) return "blocked";
    page.document.write(html);
    page.document.title = title;
    page.document.close();
    page.focus();
    setTimeout(() => page.print(), 400);
    return "printed";
  }
  // ask for the PDF's contents, so the file where expo-print saved it is never read
  const printed = await Print.printToFileAsync({ html: html, base64: true });
  const file = new File(Paths.cache, fileName || "Tindahan-statement.pdf");
  if (file.exists) file.delete();
  file.create();
  file.write(base64ToBytes(printed.base64));
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf", dialogTitle: title });
    return "shared";
  }
  return "saved";
}
