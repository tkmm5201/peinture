import { describe, it, expect, beforeEach } from "vitest";
import {
  encryptJSON,
  decryptJSON,
  isEncrypted,
  readSecure,
  writeSecure,
} from "../services/cryptoService";

/**
 * Crypto service tests.
 *
 * Note: encrypt/decrypt tests work with in-memory crypto (no localStorage needed).
 * readSecure/writeSecure tests need localStorage, so we provide a simple in-memory mock.
 */

// Simple in-memory localStorage mock for tests that need it
const createMockLocalStorage = () => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = String(value);
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    get length() {
      return Object.keys(store).length;
    },
    key: (index: number) => Object.keys(store)[index] ?? null,
  };
};

describe("cryptoService", () => {
  describe("encryptJSON / decryptJSON (pure crypto, no storage)", () => {
    it("should encrypt and decrypt a string", async () => {
      const original = "hello-world-token";
      const encrypted = await encryptJSON(original);

      expect(encrypted).toMatch(/^enc:/);
      expect(encrypted).not.toContain(original);

      const decrypted = await decryptJSON<string>(encrypted);
      expect(decrypted).toBe(original);
    });

    it("should encrypt and decrypt an object", async () => {
      const original = { key: "value", nested: { arr: [1, 2, 3] } };
      const encrypted = await encryptJSON(original);
      const decrypted = await decryptJSON(encrypted);

      expect(decrypted).toEqual(original);
    });

    it("should encrypt and decrypt an array", async () => {
      const original = ["token1", "token2", "token3"];
      const encrypted = await encryptJSON(original);
      const decrypted = await decryptJSON<string[]>(encrypted);

      expect(decrypted).toEqual(original);
    });

    it("should produce different ciphertexts for the same input (due to random IV)", async () => {
      const data = "same-data";
      const enc1 = await encryptJSON(data);
      const enc2 = await encryptJSON(data);

      expect(await decryptJSON(enc1)).toBe(data);
      expect(await decryptJSON(enc2)).toBe(data);
      expect(enc1).not.toBe(enc2);
    });

    it("should throw on invalid encrypted data", async () => {
      await expect(decryptJSON("not-encrypted")).rejects.toThrow(
        "Not an encrypted value",
      );
    });
  });

  describe("isEncrypted", () => {
    it("should return true for encrypted values", () => {
      expect(isEncrypted("enc:abcdef")).toBe(true);
    });

    it("should return false for plain values", () => {
      expect(isEncrypted("plain-text")).toBe(false);
      expect(isEncrypted('{"key":"value"}')).toBe(false);
    });
  });

  describe("readSecure / writeSecure (with storage mock)", () => {
    let mockStorage: ReturnType<typeof createMockLocalStorage>;

    beforeEach(() => {
      mockStorage = createMockLocalStorage();
      // Replace global localStorage for these tests
      Object.defineProperty(globalThis, "localStorage", {
        value: mockStorage,
        writable: true,
        configurable: true,
      });
    });

    it("should return default when key does not exist", async () => {
      const result = await readSecure("nonexistent", "default-val");
      expect(result).toBe("default-val");
    });

    it("should migrate plaintext JSON to encrypted on first read", async () => {
      const data = { tokens: ["t1", "t2"] };
      mockStorage.setItem("test_key", JSON.stringify(data));

      const result = await readSecure("test_key", {});
      expect(result).toEqual(data);

      // After read, the stored value should now be encrypted
      const stored = mockStorage.getItem("test_key");
      expect(stored).toMatch(/^enc:/);

      // Reading again should still return the same data
      const result2 = await readSecure("test_key", {});
      expect(result2).toEqual(data);
    });

    it("should read already-encrypted values correctly", async () => {
      const data = "secure-token";
      await writeSecure("test_key", data);

      const result = await readSecure("test_key", "");
      expect(result).toBe(data);
    });

    it("should write encrypted value to localStorage", async () => {
      await writeSecure("test_key", { secret: "data" });

      const stored = mockStorage.getItem("test_key");
      expect(stored).not.toBeNull();
      expect(stored).toMatch(/^enc:/);

      // Should not contain plaintext
      expect(stored).not.toContain("secret");
    });

    it("should handle null values", async () => {
      await writeSecure("null_key", null);
      const result = await readSecure("null_key", "fallback");
      expect(result).toBeNull();
    });
  });
});
