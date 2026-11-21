import bcrypt from "bcrypt";
import cookieSession from "cookie-session";
import { rateLimit } from "express-rate-limit";
import type { Request, RequestHandler } from "express";
import { createHmac } from "node:crypto";
import type { Env } from "./env.js";

const duration = 12 * 60 * 60 * 1000;
export function auth(env: Env) {
  const key = createHmac("sha256", env.SESSION_SECRET)
    .update(env.DASHBOARD_PASSWORD_HASH)
    .digest("base64url");
  const session = cookieSession({
    name: "dashboard",
    keys: [key],
    httpOnly: true,
    secure: env.SOURCE_MODE === "live",
    sameSite: "lax",
    maxAge: duration,
  });
  const signedIn = (req: Request) =>
    typeof req.session?.expiresAt === "number" &&
    req.session.expiresAt > Date.now();
  const requireSession: RequestHandler = (req, res, next) => {
    if (!signedIn(req)) {
      res.status(401).json({ error: "Sign in to continue" });
      return;
    }
    next();
  };
  const loginLimit = rateLimit({
    windowMs: 60_000,
    limit: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many attempts. Try again in a minute." },
  });
  const login: RequestHandler = (req, res, next) => {
    const password = req.body?.password;
    if (
      typeof password !== "string" ||
      !password ||
      Buffer.byteLength(password) > 72
    ) {
      res.status(401).json({ error: "Incorrect password" });
      return;
    }
    void bcrypt
      .compare(password, env.DASHBOARD_PASSWORD_HASH)
      .then((valid) => {
        if (!valid) {
          res.status(401).json({ error: "Incorrect password" });
          return;
        }
        req.session = { expiresAt: Date.now() + duration };
        res.sendStatus(204);
      })
      .catch(next);
  };
  const logout: RequestHandler = (req, res) => {
    req.session = null;
    res.sendStatus(204);
  };
  return { session, requireSession, signedIn, loginLimit, login, logout };
}
