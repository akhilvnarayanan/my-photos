import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { and, eq, gt } from "drizzle-orm";
import { db, sessionsTable, usersTable } from "@workspace/db";

const SESSION_COOKIE = "my_photos_session";
const SESSION_DAYS = 30;

function hashPassword(password: string, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, encoded: string) {
  const [salt, expected] = encoded.split(":");
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

export async function ensureDefaultUser() {
  const username = process.env.MY_PHOTOS_USERNAME ?? "owner";
  const password = process.env.MY_PHOTOS_PASSWORD ?? "change-me";
  const [existing] = await db.select().from(usersTable).where(eq(usersTable.username, username)).limit(1);
  if (existing) return existing;
  const [user] = await db.insert(usersTable).values({
    id: crypto.randomUUID(),
    username,
    passwordHash: hashPassword(password),
  }).returning();
  return user;
}

export async function login(username: string, password: string) {
  const user = await ensureDefaultUser();
  if (user.username !== username || !verifyPassword(password, user.passwordHash)) return null;
  const id = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000);
  await db.insert(sessionsTable).values({ id, userId: user.id, expiresAt });
  return { id, user };
}

function getCookie(req: Request) {
  const cookieHeader = req.headers.cookie ?? "";
  const found = cookieHeader.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`));
  return found?.slice(`${SESSION_COOKIE}=`.length) ?? null;
}

export async function getCurrentUser(req: Request) {
  const sessionId = getCookie(req);
  if (!sessionId) return null;
  const [session] = await db.select({
    userId: sessionsTable.userId,
    username: usersTable.username,
  }).from(sessionsTable)
    .innerJoin(usersTable, eq(sessionsTable.userId, usersTable.id))
    .where(and(eq(sessionsTable.id, sessionId), gt(sessionsTable.expiresAt, new Date())))
    .limit(1);
  return session ?? null;
}

export async function requireUser(req: Request, res: Response, next: NextFunction) {
  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  res.locals.user = user;
  next();
}

export function setSessionCookie(res: Response, id: string) {
  res.cookie(SESSION_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_DAYS * 86400000,
    path: "/",
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: "lax", path: "/" });
}

export async function destroySession(req: Request) {
  const sessionId = getCookie(req);
  if (sessionId) await db.delete(sessionsTable).where(eq(sessionsTable.id, sessionId));
}