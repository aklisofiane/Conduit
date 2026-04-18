import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { CredentialLookup } from '@conduit/agent';
import { prisma } from './prisma.js';

/**
 * Worker-side mirror of `apps/api/src/modules/credentials/crypto.ts`. Same
 * AES-256-GCM format, same key resolution. Kept local to the worker to
 * avoid importing from `apps/api` — the two agree on the on-disk format,
 * not on runtime code.
 */
const ALGO = 'aes-256-gcm';
let _key: Buffer | undefined;

function encryptionKey(): Buffer {
  if (_key) return _key;
  const envKey = process.env.CONDUIT_ENCRYPTION_KEY;
  if (envKey) {
    _key = normalizeKey(envKey);
    return _key;
  }
  const file = path.join(os.homedir(), '.conduit', 'key');
  _key = normalizeKey(fs.readFileSync(file, 'utf8').trim());
  return _key;
}

function normalizeKey(material: string): Buffer {
  const hex = material.trim();
  if (/^[0-9a-fA-F]{64}$/.test(hex)) return Buffer.from(hex, 'hex');
  return crypto.createHash('sha256').update(hex).digest();
}

function decrypt(payload: string): string {
  const [ivHex, tagHex, ctHex] = payload.split(':');
  if (!ivHex || !tagHex || !ctHex) throw new Error('Malformed encrypted credential');
  const decipher = crypto.createDecipheriv(ALGO, encryptionKey(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const pt = Buffer.concat([decipher.update(Buffer.from(ctHex, 'hex')), decipher.final()]);
  return pt.toString('utf8');
}

/**
 * Build a `CredentialLookup` bound to this run. Returns undefined for
 * missing connections so the MCP resolver can throw a clean error.
 */
export function makeCredentialLookup(): CredentialLookup {
  return async (connectionId: string): Promise<string | undefined> => {
    const conn = await prisma().workflowConnection.findUnique({
      where: { id: connectionId },
      include: { credential: true },
    });
    if (!conn) return undefined;
    return decrypt(conn.credential.secret);
  };
}
