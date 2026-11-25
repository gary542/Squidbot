// Adapted from milind-soni/OpenMausBot (Apache-2.0), modified for Squidbot.
// Modified: a local self-signed certificate so an exposed relay is pinned by the phone.

import { execFileSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

export interface PhoneCertificate {
  cert: string;
  key: string;
  fingerprint: string;
}

export function ensurePhoneCertificate(dir: string): PhoneCertificate {
  mkdirSync(dir, { recursive: true });
  const certPath = path.join(dir, "cert.pem");
  const keyPath = path.join(dir, "key.pem");
  if (!existsSync(certPath) || !existsSync(keyPath)) {
    execFileSync(
      "openssl",
      ["req", "-x509", "-newkey", "rsa:2048", "-keyout", keyPath, "-out", certPath, "-days", "3650", "-nodes", "-subj", "/CN=squidbot-phone"],
      { stdio: "ignore" },
    );
  }
  const cert = readFileSync(certPath, "utf8");
  const key = readFileSync(keyPath, "utf8");
  return { cert, key, fingerprint: fingerprintOfPem(cert) };
}

export function fingerprintOfPem(pem: string): string {
  return new X509Certificate(pem).fingerprint256.replaceAll(":", "").toLowerCase();
}
