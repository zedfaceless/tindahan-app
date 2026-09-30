// lib/exportPdf.js
// Turns a statement page into a PDF. On phones it is saved and the share sheet
// opens, so vendors can send it by Messenger, email, or save it to Files.
// On the web it opens the print window, where Save as PDF is one of the choices.

import { Platform } from "react-native";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";

export async function savePdf(html, title) {
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
  const { uri } = await Print.printToFileAsync({ html: html });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf", dialogTitle: title });
    return "shared";
  }
  return "saved";
}
