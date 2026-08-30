import jwt from "jsonwebtoken";
import { config } from "../src/config.js";

const SECRET = config.web.sessionSecret || "dev-insecure-secret-change-me";
const COOKIE = "sess";
const secure = /^https:/.test(config.links.dashboard || "");

export function setSession(res, payload) {
  const token = jwt.sign(payload, SECRET, { expiresIn: "24h" });
  res.cookie(COOKIE, token, { httpOnly: true, secure, sameSite: "lax", maxAge: 864e5 });
}

export function clearSession(res) {
  res.clearCookie(COOKIE);
}

export function readSession(req) {
  const t = req.cookies?.[COOKIE];
  if (!t) return null;
  try {
    return jwt.verify(t, SECRET);
  } catch {
    return null;
  }
}

export function requireAuth(req, res, next) {
  const s = readSession(req);
  if (!s) return res.redirect("/auth/login");
  req.user = s;
  next();
}
