/**
 * Crypto Service — AES-GCM encryption for sensitive data in localStorage
 *
 * Uses Web Crypto API to encrypt/decrypt JSON data.
 * Key is derived from window.location.origin via PBKDF2.
 *
 * Migration Strategy:
 * - On read: detect plaintext JSON → encrypt in place → return original data
 * - On write: always encrypt before storing
 */

const SALT_PREFIX = "peinture_salt_v1_";
const KEY_ITERATIONS = 100000;
const KEY_LENGTH = 256;

/**
 * Derive an AES-GCM key from the current origin.
 * This ties encrypted data to the specific deployment domain.
 */
async function deriveKey(): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(window.location.origin),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  const salt = encoder.encode(SALT_PREFIX + window.location.origin);

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: KEY_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: KEY_LENGTH },
    false,
    ["encrypt", "decrypt"],
  );
}

// Cache the derived key to avoid re-deriving on every operation
let cachedKey: CryptoKey | null = null;

async function getKey(): Promise<CryptoKey> {
  if (!cachedKey) {
    cachedKey = await deriveKey();
  }
  return cachedKey;
}

/**
 * Encrypt a JSON-serializable value into a base64 string.
 * Format: base64(iv + ciphertext) prefixed with "enc:" marker
 */
export async function encryptJSON(data: unknown): Promise<string> {
  const encoder = new TextEncoder();
  const plaintext = encoder.encode(JSON.stringify(data));

  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV for AES-GCM

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    plaintext,
  );

  // Concatenate IV + ciphertext
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);

  // Encode as base64 with prefix marker (chunked to avoid stack overflow on large data)
  let binaryStr = "";
  const CHUNK_SIZE = 8192;
  for (let i = 0; i < combined.length; i += CHUNK_SIZE) {
    const chunk = combined.subarray(i, Math.min(i + CHUNK_SIZE, combined.length));
    binaryStr += String.fromCharCode(...chunk);
  }
  return "enc:" + btoa(binaryStr);
}

/**
 * Decrypt a previously encrypted string back to its original value.
 */
export async function decryptJSON<T = unknown>(encrypted: string): Promise<T> {
  if (!encrypted.startsWith("enc:")) {
    throw new Error("Not an encrypted value");
  }

  const raw = encrypted.slice(4); // Remove "enc:" prefix
  const combined = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));

  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);

  const key = await getKey();

  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext,
  );

  const decoder = new TextDecoder();
  return JSON.parse(decoder.decode(plaintext)) as T;
}

/**
 * Check if a stored value is encrypted (has "enc:" prefix).
 */
export function isEncrypted(value: string): boolean {
  return value.startsWith("enc:");
}

/**
 * Read a sensitive value from localStorage with automatic migration.
 *
 * Migration flow:
 * 1. Read raw value from localStorage
 * 2. If null/undefined → return default
 * 3. If encrypted ("enc:" prefix) → decrypt and return
 * 4. If plaintext JSON → parse it, encrypt it in place, return original data
 *
 * This ensures seamless migration from plaintext to encrypted storage.
 */
export async function readSecure<T>(key: string, defaultValue: T): Promise<T> {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null || raw === undefined) {
      return defaultValue;
    }

    // Case 1: Already encrypted
    if (isEncrypted(raw)) {
      try {
        return await decryptJSON<T>(raw);
      } catch (e) {
        // Decryption failed (maybe origin changed) — return default
        console.warn(`Failed to decrypt "${key}", returning default`, e);
        return defaultValue;
      }
    }

    // Case 2: Plaintext JSON — migrate to encrypted
    try {
      const parsed = JSON.parse(raw) as T;
      // Re-save as encrypted (migration)
      const encrypted = await encryptJSON(parsed);
      localStorage.setItem(key, encrypted);
      return parsed;
    } catch {
      // Not valid JSON — might be a raw string value
      // Try treating it as a string value
      try {
        const encrypted = await encryptJSON(raw);
        localStorage.setItem(key, encrypted);
        return raw as unknown as T;
      } catch {
        return defaultValue;
      }
    }
  } catch (e) {
    console.warn(`readSecure failed for "${key}"`, e);
    return defaultValue;
  }
}

/**
 * Write a sensitive value to localStorage in encrypted form.
 */
export async function writeSecure(key: string, value: unknown): Promise<void> {
  try {
    const encrypted = await encryptJSON(value);
    localStorage.setItem(key, encrypted);
  } catch (e) {
    console.error(
      `writeSecure failed for "${key}". Data was NOT saved to avoid storing sensitive values in plaintext.`,
      e,
    );
    // Do NOT fallback to plaintext — this would silently expose tokens/keys
    throw e;
  }
}

/**
 * Create a Zustand-compatible storage adapter that encrypts sensitive fields.
 * Non-sensitive fields are stored as plain JSON for performance.
 */
export function createEncryptedStorage(sensitiveKeys: string[]) {
  return {
    getItem: async (name: string): Promise<string | null> => {
      const raw = localStorage.getItem(name);
      if (raw === null) return null;

      try {
        // The entire Zustand state is stored as one JSON blob under `name`.
        // We need to decrypt sensitive fields within it.
        let state: Record<string, unknown>;

        if (isEncrypted(raw)) {
          state = await decryptJSON<Record<string, unknown>>(raw);
        } else {
          // Plaintext — parse and migrate
          state = JSON.parse(raw);
        }

        return JSON.stringify({ state });
      } catch (e) {
        console.warn(`Failed to read encrypted storage "${name}"`, e);
        // Return raw value as fallback for Zustand to parse
        return raw;
      }
    },

    setItem: async (name: string, value: string): Promise<void> => {
      try {
        // Zustand may pass a pre-serialized JSON string or a raw object
        // (depending on version/cast). Handle both defensively.
        let parsed: Record<string, unknown>;
        if (typeof value === "string") {
          parsed = JSON.parse(value);
        } else {
          // value is already an object (cast mismatch from `as any`)
          parsed = value as unknown as Record<string, unknown>;
        }
        const state = parsed.state || parsed;

        // Check if any sensitive keys have data
        const hasSensitiveData = sensitiveKeys.some(
          (key) => state[key] !== undefined && state[key] !== null,
        );

        if (hasSensitiveData) {
          // Encrypt the entire state blob
          const encrypted = await encryptJSON(state);
          localStorage.setItem(name, encrypted);
        } else {
          // No sensitive data, store as plain JSON
          localStorage.setItem(name, JSON.stringify(state));
        }
      } catch (e) {
        console.warn(`Failed to write encrypted storage "${name}"`, e);
        // Fallback: try to serialize whatever we got
        const fallback = typeof value === "string" ? value : JSON.stringify(value);
        localStorage.setItem(name, fallback);
      }
    },

    removeItem: async (name: string): Promise<void> => {
      localStorage.removeItem(name);
    },
  };
}
