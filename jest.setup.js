// jest.setup.js
// Runs before every test file. Phone storage is replaced with Jest's in-memory
// version, and the native modules that only exist on a real phone are faked.

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock")
);

// a real random id, the same shape the phone makes
jest.mock("expo-crypto", () => ({ randomUUID: () => require("crypto").randomUUID() }));

// PDF, sharing, files, and pictures only work on a phone, tests check they are called
jest.mock("expo-print", () => ({ printToFileAsync: jest.fn(async () => ({ uri: "file:///print.pdf", base64: "JVBERi0=" })) }));
jest.mock("expo-sharing", () => ({ isAvailableAsync: jest.fn(async () => true), shareAsync: jest.fn(async () => {}) }));
jest.mock("expo-file-system", () => {
  class File {
    constructor(dir, name) { this.uri = "file:///cache/" + name; this.exists = false; this.written = null; File.last = this; }
    delete() { this.exists = false; }
    create() { this.exists = true; }
    write(bytes) { this.written = bytes; }
  }
  return { File, Paths: { cache: "cache" } };
});
jest.mock("expo-image-picker", () => ({ launchImageLibraryAsync: jest.fn(async () => ({ canceled: true })) }));
jest.mock("react-native-url-polyfill/auto", () => ({}));

// the Supabase client is replaced by a small fake that follows the real rules
jest.mock("./lib/supabase", () => require("./__tests__/helpers/fakeSupabase"));
