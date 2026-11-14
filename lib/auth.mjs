// Email + password sign-in with a server-side session behind an httpOnly cookie (same origin as the web app).
// Sessions live in Mongo `sessions`; the cookie holds a random token and we store only its SHA-256.
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import getDb from './db.mjs';

const scrypt = promisify(crypto.scrypt);
const COOKIE = 'fr_session';
const SESSION_DAYS = 30;
const SECURE = (process.env.PUBLIC_URL ?? '').startsWith('https:');
const MIN_PASSWORD = 8;

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

// Used when the email is unknown, so a miss costs the same time as a wrong password.
const DUMMY_HASH = await hashPassword(crypto.randomBytes(16).toString('hex'));

export async function verifyPassword(password, stored) {
  const [algo, saltHex, hashHex] = String(stored ?? DUMMY_HASH).split('$');
  if (algo !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

/** Returns an error message, or null if the password is acceptable. */
export function passwordProblem(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) return `password must be at least ${MIN_PASSWORD} characters`;
  if (password.length > 200) return 'password too long';
  return null;
}

function readCookie(req, name) {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > -1 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

const cookie = (value, maxAge) =>
  `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${SECURE ? '; Secure' : ''}`;

/** Creates a session for the user and returns the Set-Cookie header value. */
export async function startSession(userId) {
  const db = await getDb();
  const token = crypto.randomBytes(32).toString('base64url');
  const now = new Date();
  await db.collection('sessions').insertOne({
    _id: sha256(token), user_id: userId, created_at: now,
    expires_at: new Date(now.getTime() + SESSION_DAYS * 86_400_000),
  });
  return cookie(token, SESSION_DAYS * 86_400);
}

/** Deletes the request's session (if any) and returns a Set-Cookie header value that clears the cookie. */
export async function endSession(req) {
  const token = readCookie(req, COOKIE);
  if (token) await (await getDb()).collection('sessions').deleteOne({ _id: sha256(token) });
  return cookie('', 0);
}

/** The signed-in user document (without password_hash), or null. */
export async function currentUser(req) {
  const token = readCookie(req, COOKIE);
  if (!token) return null;
  const db = await getDb();
  const s = await db.collection('sessions').findOne({ _id: sha256(token), expires_at: { $gt: new Date() } });
  if (!s) return null;
  return db.collection('users').findOne({ _id: s.user_id }, { projection: { password_hash: 0 } });
}

/** Public shape of a user for API responses. */
export const publicUser = (u) => ({ id: u._id, email: u.email, name: u.name ?? null, searches: u.searches ?? [] });
