import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const KEY_LEN = 32;

function keyFromHex(masterHex: string): Buffer {
  const key = Buffer.from(masterHex, "hex");
  if (key.length !== KEY_LEN) {
    throw new Error("ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes).");
  }
  return key;
}

export function encryptSecret(plain: string, masterKeyHex: string): Buffer {
  const key = keyFromHex(masterKeyHex);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]);
}

export function decryptSecret(blob: Buffer, masterKeyHex: string): string {
  if (blob.length < IV_LEN + 16 + 1) {
    throw new Error("Invalid encrypted payload.");
  }
  const key = keyFromHex(masterKeyHex);
  const iv = blob.subarray(0, IV_LEN);
  const tag = blob.subarray(IV_LEN, IV_LEN + 16);
  const ciphertext = blob.subarray(IV_LEN + 16);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
