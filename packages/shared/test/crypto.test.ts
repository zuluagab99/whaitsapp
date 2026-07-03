import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, hmacSha256Base64, hmacSha256Hex, safeCompare } from "../src/crypto.js";

const KEY = "a".repeat(64);

describe("encryptSecret/decryptSecret", () => {
  it("round-trips a secret", () => {
    const encrypted = encryptSecret("shpat_super_secret_token", KEY);
    expect(encrypted).not.toContain("shpat");
    expect(decryptSecret(encrypted, KEY)).toBe("shpat_super_secret_token");
  });

  it("produces distinct ciphertexts per call (random IV)", () => {
    expect(encryptSecret("x", KEY)).not.toBe(encryptSecret("x", KEY));
  });

  it("fails on tampered ciphertext", () => {
    const encrypted = encryptSecret("secret", KEY);
    const raw = Buffer.from(encrypted, "base64");
    raw[raw.length - 1] = raw[raw.length - 1]! ^ 0xff;
    expect(() => decryptSecret(raw.toString("base64"), KEY)).toThrow();
  });

  it("fails with the wrong key", () => {
    const encrypted = encryptSecret("secret", KEY);
    expect(() => decryptSecret(encrypted, "b".repeat(64))).toThrow();
  });
});

describe("safeCompare", () => {
  it("matches equal strings", () => {
    expect(safeCompare("abc", "abc")).toBe(true);
  });
  it("rejects different strings and lengths", () => {
    expect(safeCompare("abc", "abd")).toBe(false);
    expect(safeCompare("abc", "abcd")).toBe(false);
  });
});

describe("hmac helpers", () => {
  it("computes known digests", () => {
    expect(hmacSha256Hex("key", "payload")).toMatch(/^[0-9a-f]{64}$/);
    expect(hmacSha256Base64("key", "payload")).toBe(
      Buffer.from(hmacSha256Hex("key", "payload"), "hex").toString("base64"),
    );
  });
});
