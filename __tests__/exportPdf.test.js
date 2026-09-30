// The PDF bytes and saving into the app's own folder for the share menu.
import { base64ToBytes, savePdf } from "../lib/exportPdf";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { File } from "expo-file-system";

describe("turning base64 back into bytes", () => {
  test.each(["", "a", "ab", "abc", "abcd", "Tindahan statement, P 1,234.00"])("round trip of %j", (text) => {
    const bytes = base64ToBytes(Buffer.from(text).toString("base64"));
    expect(Buffer.from(bytes).toString()).toBe(text);
  });

  test("a whole binary file comes back byte for byte", () => {
    const original = Buffer.from(Array.from({ length: 5000 }, (_, i) => (i * 37) % 256));
    expect(Buffer.from(base64ToBytes(original.toString("base64"))).equals(original)).toBe(true);
  });

  test("line breaks inside the text are ignored", () => {
    expect(Buffer.from(base64ToBytes("aGVs\nbG8=")).toString()).toBe("hello");
  });
});

describe("saving the PDF on a phone", () => {
  test("it asks for the contents, writes them to the app cache with the name, and shares that file", async () => {
    const result = await savePdf("<p>hi</p>", "Tindahan statement", "Tindahan-statement-2026-09-01-to-2026-09-30.pdf");
    expect(result).toBe("shared");
    expect(Print.printToFileAsync).toHaveBeenCalledWith({ html: "<p>hi</p>", base64: true });
    expect(File.last.uri).toBe("file:///cache/Tindahan-statement-2026-09-01-to-2026-09-30.pdf");
    expect(Buffer.from(File.last.written).toString()).toBe("%PDF-");
    expect(Sharing.shareAsync).toHaveBeenCalledWith(File.last.uri, expect.objectContaining({ mimeType: "application/pdf" }));
  });
});
