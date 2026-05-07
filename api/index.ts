import "dotenv/config";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import fs from "fs";
import path from "path";
import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import cors from "cors";
import multer from "multer";
import mysql, {
  type ResultSetHeader,
  type RowDataPacket,
} from "mysql2/promise";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { Resend } from "resend";
import twilio from "twilio";

// ============================================================================
// ENV VALIDATION
// ============================================================================

const MISSING_DB_VARS = ["DB_HOST", "DB_USER", "DB_PASSWORD", "DB_NAME"].filter(
  (k) => !process.env[k],
);
if (MISSING_DB_VARS.length > 0) {
  console.error(
    `❌ Missing required env vars: ${MISSING_DB_VARS.join(", ")}. All API routes will return 503.`,
  );
}

const JWT_SECRET =
  process.env.JWT_SECRET ||
  (() => {
    console.warn(
      "⚠️  WARNING: Using default JWT_SECRET. Set JWT_SECRET in .env for production!",
    );
    return "default-jwt-secret-CHANGE-THIS-IN-PRODUCTION";
  })();

const APP_URL = process.env.PUBLIC_APP_URL || "http://localhost:8080";
const SESSION_TTL_DAYS = 30;
const OTP_TTL_MIN = 10;
const ONBOARDING_TOKEN_TTL_HOURS = 72;
// /tmp is the only writable path in serverless (Vercel). Fall back to it when
// the preferred directory cannot be created (read-only filesystem).
const UPLOADS_DIR =
  process.env.UPLOADS_DIR ||
  (() => {
    const preferred = path.join(process.cwd(), "uploads");
    try {
      fs.mkdirSync(preferred, { recursive: true });
      return preferred;
    } catch {
      const tmp = "/tmp/uploads";
      fs.mkdirSync(tmp, { recursive: true });
      return tmp;
    }
  })();

// ============================================================================
// DATABASE POOL
// ============================================================================

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 4000,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: { rejectUnauthorized: true },
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  timezone: "+00:00", // Always use UTC — prevents expires_at mismatch with TiDB NOW()
  // TiDB Cloud Serverless closes idle connections aggressively (~5 min).
  // keepAlive prevents the OS from holding dead TCP sockets in the pool.
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000, // send first keepalive after 10s
  connectTimeout: 60000, // 60s connect timeout
});

// Silently swallow connection-level errors (ECONNRESET, PROTOCOL_CONNECTION_LOST)
// so a dead pooled connection doesn't crash the process — the pool will discard it
// and open a fresh one on the next query.
pool.on("connection", (conn) => {
  conn.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code !== "ECONNRESET" && err.code !== "PROTOCOL_CONNECTION_LOST") {
      throw err;
    }
  });
});

// ============================================================================
// EXTERNAL CLIENTS (Resend / Twilio / Authorize.net) — all with graceful fallback
// ============================================================================

const FROM_EMAIL =
  process.env.SMTP_FROM || "Optimum <no-reply@disruptinglabs.com>";
let resendClient: Resend | null = null;
if (process.env.RESEND_API_KEY) {
  resendClient = new Resend(process.env.RESEND_API_KEY);
  console.log("✅ Resend initialized");
} else {
  console.warn("⚠️  RESEND_API_KEY not set — emails will be logged, not sent");
}

let twilioClient: ReturnType<typeof twilio> | null = null;
if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
  try {
    twilioClient = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN,
    );
    console.log("✅ Twilio initialized");
  } catch (err) {
    console.warn("⚠️  Twilio init failed:", err);
  }
} else {
  console.warn("⚠️  Twilio not configured — SMS/calls will be logged only");
}
const TWILIO_FROM = process.env.TWILIO_PHONE_NUMBER;

const AUTHORIZENET_URL =
  process.env.AUTHORIZENET_SANDBOX !== "false"
    ? "https://apitest.authorize.net/xml/v1/request.api"
    : "https://api.authorize.net/xml/v1/request.api";
const authorizeNetConfigured = !!(
  process.env.AUTHORIZENET_API_LOGIN_ID &&
  process.env.AUTHORIZENET_TRANSACTION_KEY
);
if (authorizeNetConfigured) {
  console.log(
    "✅ Authorize.net initialized (",
    process.env.AUTHORIZENET_SANDBOX !== "false" ? "sandbox" : "production",
    ")",
  );
} else {
  console.warn(
    "⚠️  AUTHORIZENET_API_LOGIN_ID / AUTHORIZENET_TRANSACTION_KEY not set — payments will use mock mode",
  );
}

// ============================================================================
// AUTH HELPERS
// ============================================================================

type ActorType = "client" | "admin";
interface JwtPayload {
  actor: ActorType;
  id: number;
  email: string;
  jti: string;
}
interface AuthedRequest extends Request {
  auth?: JwtPayload;
}

// ============================================================================
// FILE ENCRYPTION HELPERS (AES-256-GCM)
// ============================================================================

function getDocEncKey(): Buffer {
  const hex = process.env.DOC_ENCRYPTION_KEY || "";
  if (hex.length !== 64) {
    console.warn(
      "⚠️  DOC_ENCRYPTION_KEY not set or invalid — using insecure fallback",
    );
    return Buffer.alloc(32, 0);
  }
  return Buffer.from(hex, "hex");
}

function encryptFile(buf: Buffer): {
  encrypted: Buffer;
  iv: string;
  tag: string;
} {
  const key = getDocEncKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(buf), cipher.final()]);
  return {
    encrypted,
    iv: iv.toString("hex"),
    tag: cipher.getAuthTag().toString("hex"),
  };
}

function decryptFile(encrypted: Buffer, ivHex: string, tagHex: string): Buffer {
  const key = getDocEncKey();
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivHex, "hex"),
  );
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

// ============================================================================
// ONBOARDING TOKEN HELPERS (magic link after payment)
// ============================================================================

async function createOnboardingToken(
  clientId: number,
  ttlHours: number = ONBOARDING_TOKEN_TTL_HOURS,
): Promise<string> {
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = sha256(rawToken);
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
  await pool.query<ResultSetHeader>(
    `INSERT INTO onboarding_tokens (client_id, token_hash, expires_at) VALUES (?, ?, ?)`,
    [clientId, tokenHash, expiresAt],
  );
  return rawToken;
}

async function consumeOnboardingToken(
  rawToken: string,
): Promise<number | null> {
  const tokenHash = sha256(rawToken);
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, client_id FROM onboarding_tokens
     WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > NOW()
     LIMIT 1`,
    [tokenHash],
  );
  if (rows.length === 0) return null;
  await pool.query<ResultSetHeader>(
    `UPDATE onboarding_tokens SET consumed_at = NOW() WHERE id = ?`,
    [rows[0].id],
  );
  return rows[0].client_id as number;
}

function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function generateOtpCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function signSessionToken(payload: Omit<JwtPayload, "jti">) {
  const jti = crypto.randomBytes(16).toString("hex");
  const token = jwt.sign({ ...payload, jti }, JWT_SECRET, {
    expiresIn: `${SESSION_TTL_DAYS}d`,
  });
  return { token, jti };
}

function verifySessionToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JwtPayload;
  } catch {
    return null;
  }
}

async function createOtp(
  actor: ActorType,
  actorId: number,
  purpose: string,
  ip?: string,
): Promise<string> {
  const code = generateOtpCode();
  const codeHash = sha256(code);
  const expiresAt = new Date(Date.now() + OTP_TTL_MIN * 60 * 1000);
  const table = actor === "admin" ? "admin_otp_codes" : "client_otp_codes";
  const idCol = actor === "admin" ? "admin_id" : "client_id";
  await pool.query<ResultSetHeader>(
    `INSERT INTO ${table} (${idCol}, code_hash, purpose, expires_at, ip_address) VALUES (?,?,?,?,?)`,
    [actorId, codeHash, purpose, expiresAt, ip || null],
  );
  return code;
}

async function consumeOtp(
  actor: ActorType,
  actorId: number,
  code: string,
  purpose: string,
): Promise<boolean> {
  const codeHash = sha256(code);
  const table = actor === "admin" ? "admin_otp_codes" : "client_otp_codes";
  const idCol = actor === "admin" ? "admin_id" : "client_id";
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM ${table}
     WHERE ${idCol} = ? AND code_hash = ? AND purpose = ?
       AND consumed_at IS NULL AND expires_at > NOW()
     ORDER BY id DESC LIMIT 1`,
    [actorId, codeHash, purpose],
  );
  if (rows.length === 0) return false;
  await pool.query<ResultSetHeader>(
    `UPDATE ${table} SET consumed_at = NOW() WHERE id = ?`,
    [rows[0].id],
  );
  return true;
}

async function createSession(
  actor: ActorType,
  actorId: number,
  email: string,
  ip?: string,
  userAgent?: string,
): Promise<string> {
  const { token, jti } = signSessionToken({ actor, id: actorId, email });
  const expiresAt = new Date(
    Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
  );
  const table = actor === "admin" ? "admin_sessions" : "client_sessions";
  const idCol = actor === "admin" ? "admin_id" : "client_id";
  await pool.query<ResultSetHeader>(
    `INSERT INTO ${table} (${idCol}, token_hash, ip_address, user_agent, expires_at) VALUES (?,?,?,?,?)`,
    [actorId, sha256(jti), ip || null, userAgent || null, expiresAt],
  );
  return token;
}

async function revokeSession(token: string): Promise<void> {
  const payload = verifySessionToken(token);
  if (!payload) return;
  const table =
    payload.actor === "admin" ? "admin_sessions" : "client_sessions";
  await pool.query<ResultSetHeader>(
    `UPDATE ${table} SET is_active = 0 WHERE token_hash = ?`,
    [sha256(payload.jti)],
  );
}

async function isSessionActive(payload: JwtPayload): Promise<boolean> {
  const table =
    payload.actor === "admin" ? "admin_sessions" : "client_sessions";
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM ${table}
     WHERE token_hash = ? AND is_active = 1 AND expires_at > NOW() LIMIT 1`,
    [sha256(payload.jti)],
  );
  return rows.length > 0;
}

function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header && header.startsWith("Bearer ")) return header.slice(7);
  return null;
}

function requireAuth(actor: ActorType) {
  return async (req: AuthedRequest, res: Response, next: NextFunction) => {
    const token = extractToken(req);
    if (!token) return res.status(401).json({ error: "Unauthorized" });
    const payload = verifySessionToken(token);
    if (!payload || payload.actor !== actor) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const ok = await isSessionActive(payload);
    if (!ok) return res.status(401).json({ error: "Session expired" });
    req.auth = payload;
    next();
  };
}
const requireClient = requireAuth("client");
const requireAdmin = requireAuth("admin");

async function requireSuperAdmin(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
) {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  const payload = verifySessionToken(token);
  if (!payload || payload.actor !== "admin") {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const ok = await isSessionActive(payload);
  if (!ok) return res.status(401).json({ error: "Session expired" });
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT role FROM admins WHERE id = ? LIMIT 1`,
    [payload.id],
  );
  if (rows[0]?.role !== "super_admin") {
    return res.status(403).json({ error: "Forbidden: super_admin required" });
  }
  req.auth = payload;
  next();
}

// ============================================================================
// EMAIL HELPERS
// ============================================================================

interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
}

async function sendEmail(opts: SendEmailOptions) {
  if (!resendClient) {
    console.log("[email:dry-run]", opts.to, opts.subject);
    return { id: "dry-run" };
  }
  const { data, error } = await resendClient.emails.send({
    from: FROM_EMAIL,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    text: opts.text,
    replyTo: opts.replyTo,
  });
  if (error) throw new Error(error.message);
  return { id: data?.id };
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function emailLayout(opts: {
  title: string;
  preheader?: string;
  bodyHtml: string;
}) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>${escapeHtml(opts.title)}</title></head>
<body style="margin:0;padding:0;background:#f4f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
${opts.preheader ? `<div style="display:none;max-height:0;overflow:hidden;">${escapeHtml(opts.preheader)}</div>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f5f9;padding:40px 16px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 8px 24px rgba(15,23,42,0.06);">
      <tr><td style="background:#121829;padding:24px 32px;">
        <table width="100%"><tr>
          <td>
            <img src="https://disruptinglabs.com/data/optimum/assets/images/logo_horizontal_gold_white_text.png" alt="Optimum Credit" height="40" style="display:block;height:40px;width:auto;border:0;" />
          </td>
          <td align="right" style="font-size:12px;color:#C0A06A;font-weight:600;letter-spacing:0.03em;">Credit Repair, Done Right</td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:32px;">${opts.bodyHtml}</td></tr>
      <tr><td style="padding:24px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b;text-align:center;">
        You're receiving this email because you have an account with Optimum Credit Repair.<br/>
        © ${new Date().getFullYear()} Optimum Credit Repair. All rights reserved.
      </td></tr>
    </table>
  </td></tr>
</table></body></html>`;
}

function emailButton(url: string, label: string) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
  <tr><td style="border-radius:10px;background:#C0A06A;">
    <a href="${url}" style="display:inline-block;padding:14px 28px;color:#121829;text-decoration:none;font-weight:700;font-size:15px;border-radius:10px;">${escapeHtml(label)}</a>
  </td></tr></table>`;
}

function tplOtpLogin(opts: {
  firstName?: string;
  code: string;
  isAdmin?: boolean;
}) {
  const greeting = opts.firstName ? `Hi ${escapeHtml(opts.firstName)},` : "Hi,";
  const role = opts.isAdmin ? "admin panel" : "client portal";
  const body = `
    <h1 style="margin:0 0 16px;font-size:24px;font-weight:800;color:#0f172a;">Your sign-in code</h1>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">${greeting} use the verification code below to sign in to your ${role}.</p>
    <div style="margin:24px 0;padding:24px;background:#f1f5f9;border-radius:12px;text-align:center;font-family:'SF Mono',Menlo,monospace;font-size:36px;font-weight:800;letter-spacing:8px;color:#0f172a;">${escapeHtml(opts.code)}</div>
    <p style="margin:0;font-size:13px;color:#64748b;">This code expires in 10 minutes. If you didn't request this, you can safely ignore this email.</p>`;
  return {
    subject: `Your Optimum Credit code: ${opts.code}`,
    html: emailLayout({
      title: "Sign-in code",
      preheader: `Code: ${opts.code}`,
      bodyHtml: body,
    }),
  };
}

function tplWelcomePayment(opts: {
  firstName: string;
  packageName: string;
  packagePrice: string;
  onboardingUrl: string;
}) {
  const docRows = [
    {
      icon: "&#128100;",
      label: "Government-issued ID",
      desc: "Front and back (driver's license or passport)",
    },
    {
      icon: "&#128196;",
      label: "Social Security Card",
      desc: "Clear photo of your SSN card",
    },
    {
      icon: "&#127968;",
      label: "Proof of Address",
      desc: "Utility bill or bank statement, no older than 3 months",
    },
  ]
    .map(
      (d) =>
        `<tr><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;">
        <table width="100%"><tr>
          <td width="36" style="font-size:22px;vertical-align:middle;">${d.icon}</td>
          <td style="padding-left:8px;">
            <div style="font-size:14px;font-weight:700;color:#0f172a;">${d.label}</div>
            <div style="font-size:12px;color:#64748b;margin-top:2px;">${d.desc}</div>
          </td>
          <td width="60" align="right" style="font-size:12px;color:#d97706;font-weight:600;">Needed</td>
        </tr></table>
       </td></tr>`,
    )
    .join("");
  const body = `
    <h1 style="margin:0 0 12px;font-size:26px;font-weight:800;color:#0f172a;">Welcome aboard, ${escapeHtml(opts.firstName)}!</h1>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Your payment was confirmed — you're officially on your way to a stronger credit score. One quick step remains: upload your documents.</p>
    <div style="margin:20px 0;padding:20px;background:#fdf8f0;border-radius:12px;border:1px solid #d4b896;">
      <div style="font-size:13px;color:#8a6d3b;text-transform:uppercase;letter-spacing:0.05em;font-weight:700;">Your Package</div>
      <div style="margin-top:6px;font-size:18px;font-weight:700;color:#0f172a;">${escapeHtml(opts.packageName)} — ${escapeHtml(opts.packagePrice)}</div>
    </div>
    <p style="margin:16px 0 8px;font-size:15px;font-weight:700;color:#0f172a;">Documents you'll need to upload:</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
      ${docRows}
    </table>
    <div style="margin:16px 0;padding:14px 18px;background:#f0fdf4;border-left:4px solid #22c55e;border-radius:8px;">
      <div style="font-size:13px;font-weight:700;color:#15803d;">Your documents are secured with AES-256 encryption</div>
      <div style="font-size:12px;color:#166534;margin-top:4px;">All uploaded files are encrypted end-to-end and stored securely. Only authorised Optimum Credit staff can access them for review.</div>
    </div>
    <p style="margin:16px 0;font-size:15px;line-height:1.6;color:#334155;">Click the button below — this is your personal secure link (valid for 72 hours).</p>
    ${emailButton(opts.onboardingUrl, "Upload My Documents")}
    <p style="margin:24px 0 0;font-size:13px;color:#64748b;">Need help? Just reply to this email — we're here for you.</p>`;
  return {
    subject: `Welcome to Optimum Credit, ${opts.firstName}! — Upload your documents`,
    html: emailLayout({
      title: "Welcome — Upload Documents",
      preheader:
        "Your payment is confirmed. Upload your documents to get started.",
      bodyHtml: body,
    }),
  };
}

const DOC_TYPE_LABELS: Record<string, string> = {
  id_front: "Government ID (front)",
  id_back: "Government ID (back)",
  ssn_card: "Social Security Card",
  proof_of_address: "Proof of Address",
  other: "Document",
};

function tplDocumentRejected(opts: {
  firstName: string;
  docType: string;
  reason: string;
  portalUrl: string;
}) {
  const label = DOC_TYPE_LABELS[opts.docType] || opts.docType;
  const body = `
    <h1 style="margin:0 0 12px;font-size:24px;font-weight:800;color:#0f172a;">Action needed: please re-upload your document</h1>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Hi ${escapeHtml(opts.firstName)}, we reviewed your <strong>${escapeHtml(label)}</strong> but were unable to accept it. Please upload a new copy from your portal.</p>
    <div style="margin:20px 0;padding:16px 20px;background:#fef2f2;border-left:4px solid #ef4444;border-radius:8px;">
      <div style="font-size:13px;font-weight:700;color:#991b1b;">Reason for rejection</div>
      <div style="margin-top:6px;font-size:14px;color:#7f1d1d;">${escapeHtml(opts.reason)}</div>
    </div>
    <p style="margin:16px 0;font-size:14px;color:#334155;">Common tips: make sure the document is in focus, not cropped, clearly shows all four corners, and is a recent copy (no older than 3 months for address proof).</p>
    ${emailButton(opts.portalUrl, "Re-upload from My Portal")}
    <p style="margin:16px 0 0;font-size:13px;color:#64748b;">Questions? Reply to this email and our team will help you out.</p>`;
  return {
    subject: `Optimum Credit: action needed — re-upload your ${label}`,
    html: emailLayout({
      title: "Re-upload required",
      preheader: `We need a new copy of your ${label}.`,
      bodyHtml: body,
    }),
  };
}

function tplRoundComplete(opts: {
  firstName: string;
  roundNumber: number;
  scoreBefore?: number | null;
  scoreAfter?: number | null;
  itemsRemoved: number;
  portalUrl: string;
}) {
  const delta =
    opts.scoreBefore != null && opts.scoreAfter != null
      ? opts.scoreAfter - opts.scoreBefore
      : null;
  const body = `
    <h1 style="margin:0 0 12px;font-size:26px;font-weight:800;color:#0f172a;">Round ${opts.roundNumber} is complete</h1>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Hi ${escapeHtml(opts.firstName)}, here's your monthly progress update.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0;">
      <tr>
        <td style="padding:16px;background:#f1f5f9;border-radius:12px;text-align:center;width:33%;">
          <div style="font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;">Items Removed</div>
          <div style="margin-top:6px;font-size:24px;font-weight:800;color:#16a34a;">${opts.itemsRemoved}</div>
        </td>
        <td style="width:8px;"></td>
        <td style="padding:16px;background:#f1f5f9;border-radius:12px;text-align:center;">
          <div style="font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;">Score Change</div>
          <div style="margin-top:6px;font-size:24px;font-weight:800;color:${delta != null && delta >= 0 ? "#16a34a" : "#0f172a"};">${delta != null ? (delta >= 0 ? "+" : "") + delta : "—"}</div>
        </td>
      </tr>
    </table>
    ${emailButton(opts.portalUrl, "View Full Report")}`;
  return {
    subject: `Round ${opts.roundNumber} complete — your progress report is ready`,
    html: emailLayout({ title: "Round complete", bodyHtml: body }),
  };
}

// ============================================================================
// ADMIN WELCOME EMAIL TEMPLATE
// ============================================================================

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  agent: "Agent",
};

function tplAdminWelcome(opts: {
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  loginUrl: string;
  invitedByName: string;
}) {
  const roleLabel = ROLE_LABELS[opts.role] || opts.role;
  const body = `
    <div style="margin:0 0 28px;padding:24px 28px;background:linear-gradient(135deg,#1a2342 0%,#121829 100%);border-radius:14px;position:relative;overflow:hidden;">
      <div style="font-size:10px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#C0A06A;margin-bottom:10px;">You're on the team</div>
      <div style="font-size:30px;font-weight:800;color:#ffffff;line-height:1.2;margin-bottom:8px;">Welcome, ${escapeHtml(opts.firstName)}!</div>
      <div style="font-size:13px;color:rgba(255,255,255,0.55);">Optimum Credit Admin Panel</div>
    </div>
    <p style="margin:0 0 18px;font-size:15px;line-height:1.65;color:#334155;">
      <strong>${escapeHtml(opts.invitedByName)}</strong> has added you to the <strong>Optimum Credit</strong> admin team.
      Your account is ready and you've been granted access as a
      <span style="display:inline-block;font-size:11px;font-weight:700;background:#C0A06A;color:#121829;padding:1px 10px;border-radius:20px;vertical-align:middle;margin-left:4px;">${escapeHtml(roleLabel)}</span>
    </p>
    <div style="margin:20px 0;padding:0;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;">
      <div style="padding:10px 20px;background:#f8fafc;border-bottom:1px solid #e2e8f0;">
        <div style="font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#94a3b8;">Your account details</div>
      </div>
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr style="border-bottom:1px solid #f1f5f9;">
          <td style="padding:12px 20px;width:110px;font-size:12px;font-weight:600;color:#94a3b8;vertical-align:top;">Full name</td>
          <td style="padding:12px 20px;font-size:14px;font-weight:600;color:#0f172a;">${escapeHtml(opts.firstName)} ${escapeHtml(opts.lastName)}</td>
        </tr>
        <tr style="border-bottom:1px solid #f1f5f9;">
          <td style="padding:12px 20px;font-size:12px;font-weight:600;color:#94a3b8;vertical-align:top;">Email</td>
          <td style="padding:12px 20px;font-size:14px;color:#0f172a;">${escapeHtml(opts.email)}</td>
        </tr>
        <tr>
          <td style="padding:12px 20px;font-size:12px;font-weight:600;color:#94a3b8;vertical-align:middle;">Access level</td>
          <td style="padding:12px 20px;">
            <span style="display:inline-block;font-size:11px;font-weight:700;background:#C0A06A;color:#121829;padding:3px 12px;border-radius:20px;">${escapeHtml(roleLabel)}</span>
          </td>
        </tr>
      </table>
    </div>
    <p style="margin:20px 0 8px;font-size:14px;line-height:1.6;color:#334155;">
      Click the button below to access your admin panel. You sign in with a one-time code sent to this email — no password needed.
    </p>
    ${emailButton(opts.loginUrl, "Go to Admin Panel")}
    <div style="margin:24px 0 0;padding:14px 18px;background:#f1f5f9;border-radius:10px;border-left:4px solid #C0A06A;">
      <div style="font-size:12px;font-weight:700;color:#0f172a;margin-bottom:4px;">🔒 Security reminder</div>
      <div style="font-size:12px;color:#64748b;line-height:1.6;">
        Optimum Credit staff will <em>never</em> ask for your sign-in code via phone or chat.
        Only enter codes on the official admin login page. If you weren't expecting this invitation, please contact your administrator immediately.
      </div>
    </div>`;
  return {
    subject: `You've been added to Optimum Credit — welcome aboard, ${opts.firstName}!`,
    html: emailLayout({
      title: "Welcome to the Optimum Credit team",
      preheader: `${opts.invitedByName} has added you to the Optimum Credit admin team as ${roleLabel}.`,
      bodyHtml: body,
    }),
  };
}

// ============================================================================
// SMS HELPERS
// ============================================================================

async function sendSms(opts: { to: string; body: string }) {
  if (!twilioClient || !TWILIO_FROM) {
    console.log("[sms:dry-run]", opts.to, opts.body);
    return { sid: "dry-run", status: "dry-run" };
  }
  const msg = await twilioClient.messages.create({
    from: TWILIO_FROM,
    to: opts.to,
    body: opts.body,
  });
  return { sid: msg.sid, status: msg.status };
}

// ============================================================================
// AUTHORIZE.NET HELPERS
// ============================================================================

async function chargeCard(opts: {
  amountDollars: string;
  dataDescriptor: string;
  dataValue: string;
  clientId: number;
  email: string;
  firstName: string;
  lastName: string;
}): Promise<{
  transactionId: string;
  customerProfileId?: string;
  customerPaymentProfileId?: string;
}> {
  // Step 1: Charge the card. No createCustomerProfile field — it doesn't exist
  // in the createTransactionRequest XSD schema. Customer profile is created
  // separately after a successful charge via createCustomerProfileFromTransactionRequest.
  const chargePayload = {
    createTransactionRequest: {
      merchantAuthentication: {
        name: process.env.AUTHORIZENET_API_LOGIN_ID,
        transactionKey: process.env.AUTHORIZENET_TRANSACTION_KEY,
      },
      transactionRequest: {
        transactionType: "authCaptureTransaction",
        amount: opts.amountDollars,
        payment: {
          opaqueData: {
            dataDescriptor: opts.dataDescriptor,
            dataValue: opts.dataValue,
          },
        },
        customer: {
          type: "individual",
          id: String(opts.clientId),
          email: opts.email,
        },
        billTo: {
          firstName: opts.firstName,
          lastName: opts.lastName,
          email: opts.email,
        },
        userFields: {
          userField: [{ name: "client_id", value: String(opts.clientId) }],
        },
      },
    },
  };

  const resp = await fetch(AUTHORIZENET_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(chargePayload),
  });
  const data = (await resp.json()) as any;

  console.log(
    "[anet:charge]",
    JSON.stringify(
      {
        resultCode: data?.messages?.resultCode,
        responseCode: data?.transactionResponse?.responseCode,
        transId: data?.transactionResponse?.transId,
        authCode: data?.transactionResponse?.authCode,
        errors: data?.transactionResponse?.errors,
        messages: data?.messages?.message,
      },
      null,
      2,
    ),
  );

  if (
    data?.messages?.resultCode !== "Ok" ||
    data?.transactionResponse?.responseCode !== "1"
  ) {
    const errText =
      data?.transactionResponse?.errors?.error?.[0]?.errorText ||
      data?.messages?.message?.[0]?.text ||
      "Payment processing failed";
    throw new Error(errText);
  }

  const transactionId = data.transactionResponse.transId as string;

  // Step 2: Create customer profile from the successful transaction.
  // This is the documented approach — a separate call after charge.
  // Errors here are non-fatal: the charge already succeeded.
  let customerProfileId: string | undefined;
  let customerPaymentProfileId: string | undefined;
  try {
    const profileResp = await fetch(AUTHORIZENET_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        createCustomerProfileFromTransactionRequest: {
          merchantAuthentication: {
            name: process.env.AUTHORIZENET_API_LOGIN_ID,
            transactionKey: process.env.AUTHORIZENET_TRANSACTION_KEY,
          },
          transId: transactionId,
        },
      }),
    });
    const profileData = (await profileResp.json()) as any;
    console.log(
      "[anet:profile]",
      JSON.stringify(
        {
          resultCode: profileData?.messages?.resultCode,
          customerProfileId: profileData?.customerProfileId,
          customerPaymentProfileIdList:
            profileData?.customerPaymentProfileIdList,
          messages: profileData?.messages?.message,
        },
        null,
        2,
      ),
    );
    if (profileData?.messages?.resultCode === "Ok") {
      customerProfileId = profileData.customerProfileId as string;
      customerPaymentProfileId = profileData
        .customerPaymentProfileIdList?.[0] as string | undefined;
    }
  } catch (profileErr) {
    // Profile creation failure doesn't block the payment flow
    console.error("[anet:profile:error]", profileErr);
  }

  return { transactionId, customerProfileId, customerPaymentProfileId };
}

// ============================================================================
// SHARED — payment success processing
// ============================================================================

async function markPaymentSucceeded(clientId: number, transactionId: string) {
  await pool.query<ResultSetHeader>(
    `UPDATE payments SET status='succeeded', paid_at=NOW() WHERE provider_transaction_id = ? AND status <> 'succeeded'`,
    [transactionId],
  );
  await pool.query<ResultSetHeader>(
    `UPDATE clients SET status='onboarding' WHERE id = ? AND status='pending_payment'`,
    [clientId],
  );

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT c.first_name, c.email, c.phone, p.name AS package_name, p.price_cents
     FROM clients c LEFT JOIN packages p ON p.id = c.package_id
     WHERE c.id = ? LIMIT 1`,
    [clientId],
  );
  if (rows.length === 0) return;
  const r = rows[0];

  // All Day 0/1/2/3 communication (email) is handled by the
  // "payment_confirmed" reminder flow. SMS can be added as a flow step type
  // once Twilio is configured — do not hardcode sequences here.

  await pool.query<ResultSetHeader>(
    `INSERT INTO audit_logs (actor_type, actor_id, action, entity_type, entity_id) VALUES ('system', NULL, 'payment.succeeded', 'client', ?)`,
    [clientId],
  );

  // Trigger the "payment_confirmed" reminder flow (Day 1/2/3 email sequence)
  triggerReminderFlow("payment_confirmed", clientId).catch((e) =>
    console.error("[flow:payment_confirmed]", e?.message),
  );
}

// ============================================================================
// AUTHORIZE.NET — process card payment via Accept.js nonce
// ============================================================================
async function processAuthorizeNetPayment(
  clientId: number,
  email: string,
  amountCents: number,
  packageId: number | null,
  dataDescriptor: string,
  dataValue: string,
  firstName: string,
  lastName: string,
): Promise<{ transactionId: string }> {
  const result = await chargeCard({
    amountDollars: (amountCents / 100).toFixed(2),
    dataDescriptor,
    dataValue,
    clientId,
    email,
    firstName,
    lastName,
  });

  await pool.query<ResultSetHeader>(
    `INSERT INTO payments (client_id, package_id, amount_cents, status, provider, provider_transaction_id, metadata_json)
     VALUES (?, ?, ?, 'pending', 'authorize_net', ?, ?)`,
    [
      clientId,
      packageId,
      amountCents,
      result.transactionId,
      JSON.stringify({}),
    ],
  );

  // Store Authorize.net customer/payment profile IDs so future charges can
  // reference the same customer and they appear in Authorize.net Manage Customers.
  if (result.customerProfileId) {
    await pool.query<ResultSetHeader>(
      `UPDATE clients SET anet_customer_profile_id = ?, anet_payment_profile_id = ? WHERE id = ?`,
      [
        result.customerProfileId,
        result.customerPaymentProfileId ?? null,
        clientId,
      ],
    );
  }

  await markPaymentSucceeded(clientId, result.transactionId);
  return result;
}

async function triggerReminderFlow(
  triggerEvent: string,
  clientId: number,
  extraVars?: Record<string, string>,
): Promise<void> {
  const [flows] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM reminder_flows WHERE trigger_event = ? AND is_active = 1 LIMIT 1`,
    [triggerEvent],
  );
  if (flows.length === 0) return;
  const flowId = flows[0].id as number;

  // Idempotency guard: skip if this flow already ran for this client within the last 10 minutes
  // (prevents duplicates from double webhooks / retries).
  const [recent] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM reminder_flow_executions
     WHERE flow_id = ? AND client_id = ? AND triggered_at >= NOW() - INTERVAL 10 MINUTE
     LIMIT 1`,
    [flowId, clientId],
  );
  if (recent.length > 0) {
    console.warn(
      `[flow:${triggerEvent}] Skipping duplicate trigger for client ${clientId} (already ran within 10 min)`,
    );
    return;
  }

  const [steps] = await pool.query<RowDataPacket[]>(
    `SELECT id, step_type, delay_days, label, subject, body, template_slug
     FROM reminder_flow_steps WHERE flow_id = ? ORDER BY step_order ASC`,
    [flowId],
  );
  if (steps.length === 0) return;

  const [clientRows] = await pool.query<RowDataPacket[]>(
    `SELECT first_name, last_name, email, phone FROM clients WHERE id = ? LIMIT 1`,
    [clientId],
  );
  if (clientRows.length === 0) return;
  const client = clientRows[0];

  const vars: Record<string, string> = {
    first_name: client.first_name as string,
    last_name: client.last_name as string,
    portal_url: `${APP_URL}/portal/login`, // fallback; overridden per email step below
    ...extraVars,
  };

  let stepsExecuted = 0;
  let stepsScheduled = 0;
  let execError: string | null = null;

  const replaceVars = (tmpl: string) =>
    tmpl.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? `{{${k}}}`);

  try {
    for (const step of steps) {
      const delayMs = (step.delay_days as number) * 24 * 60 * 60 * 1000;
      const scheduledFor = new Date(Date.now() + delayMs);
      const isImmediate = (step.delay_days as number) === 0;

      if (step.step_type === "send_email") {
        let subj = step.subject as string | null;
        let bodyHtml = step.body as string | null;

        if (step.template_slug) {
          const [tmplRows] = await pool.query<RowDataPacket[]>(
            `SELECT subject, body FROM communication_templates WHERE slug = ? AND is_active = 1 LIMIT 1`,
            [step.template_slug],
          );
          if (tmplRows.length > 0) {
            subj = tmplRows[0].subject as string | null;
            bodyHtml = tmplRows[0].body as string | null;
          }
        }

        if (!subj || !bodyHtml) continue;

        // Generate a unique magic-link token for this step.
        // TTL = delay_days * 24h (time until delivery) + 72h buffer for the client to click it.
        const delayDays = step.delay_days as number;
        const tokenTtlHours = delayDays * 24 + ONBOARDING_TOKEN_TTL_HOURS;
        const rawToken = await createOnboardingToken(clientId, tokenTtlHours);
        const magicLink = `${APP_URL}/portal/onboarding/${rawToken}`;

        // Build step-specific vars with the magic link overriding the generic portal_url
        const stepVars = { ...vars, portal_url: magicLink };
        const stepReplaceVars = (tmpl: string) =>
          tmpl.replace(/\{\{(\w+)\}\}/g, (_, k) => stepVars[k] ?? `{{${k}}}`);

        const resolvedSubj = stepReplaceVars(subj);
        const resolvedBody = stepReplaceVars(bodyHtml);
        const fullHtml = emailLayout({
          title: resolvedSubj,
          bodyHtml: resolvedBody + emailButton(magicLink, "Go to My Portal"),
        });

        if (isImmediate) {
          try {
            await sendEmail({
              to: client.email as string,
              subject: resolvedSubj,
              html: fullHtml,
            });
            stepsExecuted++;
          } catch (e: any) {
            console.error("[flow:send_email]", e?.message);
          }
        } else {
          await pool.query<ResultSetHeader>(
            `INSERT INTO notification_queue (client_id, channel, to_address, subject, body, scheduled_for) VALUES (?, 'email', ?, ?, ?, ?)`,
            [clientId, client.email, resolvedSubj, fullHtml, scheduledFor],
          );
          stepsScheduled++;
        }
      } else if (step.step_type === "internal_alert") {
        const alertBody = replaceVars(
          (step.body as string | null) ||
            `Client {{first_name}} {{last_name}} requires follow-up (flow: ${triggerEvent}).`,
        );
        await pool.query<ResultSetHeader>(
          `INSERT INTO notification_queue (client_id, channel, to_address, subject, body, scheduled_for) VALUES (?, 'in_app', 'team', ?, ?, ?)`,
          [clientId, step.label || "Team Alert", alertBody, scheduledFor],
        );
        stepsScheduled++;
      }
    }
  } catch (e: any) {
    execError = e?.message ?? String(e);
  }

  await pool.query<ResultSetHeader>(
    `INSERT INTO reminder_flow_executions (flow_id, client_id, status, steps_executed, steps_scheduled, error_message) VALUES (?, ?, ?, ?, ?, ?)`,
    [
      flowId,
      clientId,
      execError ? "partial" : "completed",
      stepsExecuted,
      stepsScheduled,
      execError,
    ],
  );
}

// ============================================================================
// EXPRESS APP
// ============================================================================

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

function buildApp() {
  const app = express();
  app.use(cors());
  app.use(
    express.json({
      verify: (req: any, _res, buf) => {
        req.rawBody = buf?.toString();
      },
    }),
  );
  app.use(express.urlencoded({ extended: true }));

  // ── Request logger ──────────────────────────────────────────
  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    res.on("finish", () => {
      const ms = Date.now() - start;
      const status = res.statusCode;
      const color =
        status >= 500 ? "\x1b[31m" : status >= 400 ? "\x1b[33m" : "\x1b[32m";
      console.log(
        `${color}${req.method}\x1b[0m ${req.path} → ${color}${status}\x1b[0m (${ms}ms)`,
      );
    });
    next();
  });

  // ============================================================
  // HEALTH
  // ============================================================
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });
  app.get("/api/ping", (_req, res) => {
    res.json({ message: "pong" });
  });

  // ============================================================
  // AUTH (CLIENT + ADMIN)
  // ============================================================
  app.post("/api/auth/client/request-otp", async (req, res) => {
    const email = String(req.body?.email || "")
      .trim()
      .toLowerCase();
    if (!email || !/.+@.+\..+/.test(email)) {
      return res.status(400).json({ error: "Valid email required" });
    }
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT id, first_name FROM clients WHERE email = ? LIMIT 1",
      [email],
    );
    if (rows.length === 0) {
      return res
        .status(404)
        .json({ error: "No account found for that email." });
    }
    const code = await createOtp(
      "client",
      rows[0].id as number,
      "login",
      req.ip,
    );
    const tpl = tplOtpLogin({ firstName: rows[0].first_name, code });
    await sendEmail({ to: email, subject: tpl.subject, html: tpl.html });
    res.json({ ok: true, message: "Verification code sent." });
  });

  app.post("/api/auth/client/verify-otp", async (req, res) => {
    const email = String(req.body?.email || "")
      .trim()
      .toLowerCase();
    const code = String(req.body?.code || "").trim();
    if (!email || !code)
      return res.status(400).json({ error: "Missing fields" });
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT id, email, first_name, last_name FROM clients WHERE email = ? LIMIT 1",
      [email],
    );
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    const ok = await consumeOtp("client", rows[0].id as number, code, "login");
    if (!ok) return res.status(401).json({ error: "Invalid or expired code" });
    await pool.query<ResultSetHeader>(
      "UPDATE clients SET email_verified_at = COALESCE(email_verified_at, NOW()) WHERE id = ?",
      [rows[0].id],
    );
    const token = await createSession(
      "client",
      rows[0].id as number,
      rows[0].email,
      req.ip,
      String(req.headers["user-agent"] || ""),
    );
    res.json({
      token,
      user: {
        id: rows[0].id,
        email: rows[0].email,
        first_name: rows[0].first_name,
        last_name: rows[0].last_name,
      },
    });
  });

  app.post("/api/auth/admin/request-otp", async (req, res) => {
    const email = String(req.body?.email || "")
      .trim()
      .toLowerCase();
    if (!email) return res.status(400).json({ error: "Email required" });
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT id, first_name FROM admins WHERE email = ? AND status = 'active' LIMIT 1",
      [email],
    );
    if (rows.length === 0)
      return res.status(404).json({ error: "Admin not found" });
    const code = await createOtp(
      "admin",
      rows[0].id as number,
      "login",
      req.ip,
    );
    const tpl = tplOtpLogin({
      firstName: rows[0].first_name,
      code,
      isAdmin: true,
    });
    await sendEmail({ to: email, subject: tpl.subject, html: tpl.html });
    res.json({ ok: true });
  });

  app.post("/api/auth/admin/verify-otp", async (req, res) => {
    const email = String(req.body?.email || "")
      .trim()
      .toLowerCase();
    const code = String(req.body?.code || "").trim();
    if (!email || !code)
      return res.status(400).json({ error: "Missing fields" });
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT id, email, first_name, last_name, role, avatar_url FROM admins WHERE email = ? AND status = 'active' LIMIT 1",
      [email],
    );
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    const ok = await consumeOtp("admin", rows[0].id as number, code, "login");
    if (!ok) return res.status(401).json({ error: "Invalid or expired code" });
    await pool.query<ResultSetHeader>(
      "UPDATE admins SET last_login_at = NOW() WHERE id = ?",
      [rows[0].id],
    );
    const token = await createSession(
      "admin",
      rows[0].id as number,
      rows[0].email,
      req.ip,
      String(req.headers["user-agent"] || ""),
    );
    res.json({
      token,
      user: {
        id: rows[0].id,
        email: rows[0].email,
        first_name: rows[0].first_name,
        last_name: rows[0].last_name,
        role: rows[0].role,
        avatar_url: rows[0].avatar_url,
      },
    });
  });

  app.get(
    "/api/auth/client/me",
    requireClient,
    async (req: AuthedRequest, res) => {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT c.id, c.email, c.first_name, c.last_name, c.phone, c.address_line1, c.address_line2,
              c.city, c.state, c.zip, c.ssn_last4, c.preferred_language,
              c.pipeline_stage, c.pipeline_stage_changed_at,
              c.contract_signed_at, c.smart_credit_email, c.smart_credit_connected_at,
              c.status, c.email_verified_at, c.created_at,
              p.id AS package_id, p.slug AS package_slug, p.name AS package_name,
              p.price_cents AS package_price_cents, p.duration_months AS package_duration_months
       FROM clients c LEFT JOIN packages p ON p.id = c.package_id
       WHERE c.id = ? LIMIT 1`,
        [req.auth!.id],
      );
      if (rows.length === 0)
        return res.status(404).json({ error: "Not found" });
      res.json({ user: rows[0] });
    },
  );

  app.get(
    "/api/auth/admin/me",
    requireAdmin,
    async (req: AuthedRequest, res) => {
      const [rows] = await pool.query<RowDataPacket[]>(
        "SELECT id, email, first_name, last_name, role, avatar_url, last_login_at FROM admins WHERE id = ? LIMIT 1",
        [req.auth!.id],
      );
      if (rows.length === 0)
        return res.status(404).json({ error: "Not found" });
      res.json({ user: rows[0] });
    },
  );

  app.post("/api/auth/logout", async (req, res) => {
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
    if (token) await revokeSession(token);
    res.json({ ok: true });
  });

  // Magic link — validate onboarding token from welcome email, create full session
  app.get("/api/auth/onboarding/:token", async (req, res) => {
    const rawToken = String(req.params.token || "").trim();
    if (!rawToken || rawToken.length < 32) {
      return res.status(400).json({ error: "Invalid token" });
    }
    const clientId = await consumeOnboardingToken(rawToken);
    if (!clientId) {
      return res.status(401).json({
        error: "Link has expired or already been used. Please sign in.",
      });
    }
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT id, email, first_name, last_name FROM clients WHERE id = ? LIMIT 1",
      [clientId],
    );
    if (rows.length === 0)
      return res.status(404).json({ error: "Account not found" });
    const c = rows[0];
    await pool.query<ResultSetHeader>(
      "UPDATE clients SET email_verified_at = COALESCE(email_verified_at, NOW()) WHERE id = ?",
      [clientId],
    );
    const sessionToken = await createSession(
      "client",
      clientId,
      c.email as string,
      req.ip,
      String(req.headers["user-agent"] || ""),
    );
    res.json({
      token: sessionToken,
      user: {
        id: c.id,
        email: c.email,
        first_name: c.first_name,
        last_name: c.last_name,
      },
    });
  });

  // ============================================================
  // PUBLIC — packages + registration + Authorize.net
  // ============================================================
  app.get("/api/packages", async (_req, res) => {
    try {
      const [rows] = await pool.query<RowDataPacket[]>(
        "SELECT id, slug, name, subtitle, description, price_cents, duration_months, features_json, sort_order FROM packages WHERE is_active = 1 ORDER BY sort_order ASC",
      );
      res.json({ packages: rows });
    } catch (err: any) {
      console.error("[/api/packages] DB error:", err?.message ?? err);
      res.status(503).json({
        error: "Service temporarily unavailable. Please try again shortly.",
      });
    }
  });

  // Single-step registration: charge card first, create client only on success.
  // Accepts all form fields + Accept.js nonce (dataDescriptor + dataValue).
  app.post("/api/registration", async (req, res) => {
    const b = req.body || {};
    const required = [
      "firstName",
      "lastName",
      "email",
      "phone",
      "packageSlug",
      "dataDescriptor",
      "dataValue",
    ];
    for (const f of required) {
      if (!b[f] || String(b[f]).trim().length === 0) {
        return res.status(400).json({ error: `Missing field: ${f}` });
      }
    }
    const email = String(b.email).trim().toLowerCase();

    const [existing] = await pool.query<RowDataPacket[]>(
      "SELECT id, status FROM clients WHERE email = ? LIMIT 1",
      [email],
    );
    if (existing.length > 0 && existing[0].status !== "pending_payment") {
      return res.status(409).json({
        error: "An account with this email already exists. Please sign in.",
      });
    }

    const [pkgs] = await pool.query<RowDataPacket[]>(
      "SELECT id, name, price_cents FROM packages WHERE slug = ? AND is_active = 1 LIMIT 1",
      [b.packageSlug],
    );
    if (pkgs.length === 0)
      return res.status(400).json({ error: "Invalid package" });
    const pkg = pkgs[0];

    let affiliateId: number | null = null;
    if (b.affiliateCode) {
      const [afs] = await pool.query<RowDataPacket[]>(
        "SELECT id FROM affiliates WHERE referral_code = ? AND status = 'active' LIMIT 1",
        [b.affiliateCode],
      );
      if (afs.length > 0) affiliateId = afs[0].id as number;
    }

    // Use a temporary clientId placeholder for the charge (real ID assigned after insert).
    // For re-attempts on pending_payment accounts, reuse the existing id.
    const tempClientId = existing.length > 0 ? (existing[0].id as number) : 0;

    // 1. Charge card FIRST — no DB record written on failure
    let chargeResult: Awaited<
      ReturnType<typeof processAuthorizeNetPayment>
    > | null = null;
    if (!authorizeNetConfigured) {
      return res.status(503).json({ error: "Payment provider not configured" });
    }

    // We need a real clientId for Authorize.net metadata. For new clients we insert
    // with status='pending_payment', charge, then update to 'onboarding' — or rollback.
    let clientId: number;
    let isNewClient = false;

    if (existing.length > 0) {
      clientId = existing[0].id as number;
      await pool.query<ResultSetHeader>(
        `UPDATE clients SET first_name=?, last_name=?, phone=?, package_id=?,
          affiliate_id=COALESCE(affiliate_id, ?) WHERE id=?`,
        [
          b.firstName,
          b.lastName,
          b.phone || null,
          pkg.id,
          affiliateId,
          clientId,
        ],
      );
    } else {
      const [ins] = await pool.query<ResultSetHeader>(
        `INSERT INTO clients (email, first_name, last_name, phone, package_id, affiliate_id,
           pipeline_stage, status)
         VALUES (?,?,?,?,?,?, 'new_client', 'pending_payment')`,
        [email, b.firstName, b.lastName, b.phone || null, pkg.id, affiliateId],
      );
      clientId = ins.insertId;
      isNewClient = true;
    }

    try {
      chargeResult = await processAuthorizeNetPayment(
        clientId,
        email,
        pkg.price_cents as number,
        pkg.id as number,
        String(b.dataDescriptor),
        String(b.dataValue),
        String(b.firstName),
        String(b.lastName),
      );
    } catch (e: any) {
      // Payment failed — delete the newly inserted client so no ghost records
      if (isNewClient) {
        await pool.query(
          `DELETE FROM clients WHERE id = ? AND status = 'pending_payment'`,
          [clientId],
        );
      }
      return res.status(402).json({ error: e.message || "Payment failed" });
    }

    res.json({
      clientId,
      packageId: pkg.id,
      packageName: pkg.name,
      amountCents: pkg.price_cents,
    });
  });

  // Sandbox-only: confirm a mock payment (no real card charge).
  app.post("/api/registration/confirm-mock", async (req, res) => {
    const { clientId, transactionId } = req.body || {};
    if (!clientId || !transactionId) {
      return res.status(400).json({ error: "Missing fields" });
    }
    if (!String(transactionId).startsWith("txn_mock_")) {
      return res.status(400).json({ error: "Not a mock transaction" });
    }
    await markPaymentSucceeded(Number(clientId), String(transactionId));
    res.json({ ok: true });
  });

  // Process a real Authorize.net payment via Accept.js nonce.
  app.post("/api/registration/process-payment", async (req, res) => {
    const { clientId, dataDescriptor, dataValue } = req.body || {};
    if (!clientId || !dataDescriptor || !dataValue)
      return res.status(400).json({ error: "Missing fields" });

    if (!authorizeNetConfigured)
      return res.status(503).json({ error: "Payment provider not configured" });

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT c.id, c.email, c.first_name, c.last_name, c.package_id, p.price_cents
       FROM clients c LEFT JOIN packages p ON p.id = c.package_id
       WHERE c.id = ? LIMIT 1`,
      [Number(clientId)],
    );
    if (rows.length === 0)
      return res.status(404).json({ error: "Client not found" });
    const client = rows[0];

    try {
      await processAuthorizeNetPayment(
        Number(clientId),
        client.email as string,
        client.price_cents as number,
        client.package_id as number | null,
        String(dataDescriptor),
        String(dataValue),
        client.first_name as string,
        client.last_name as string,
      );
    } catch (e: any) {
      return res.status(402).json({ error: e.message || "Payment failed" });
    }

    res.json({ ok: true });
  });

  // ============================================================
  // CLIENT PORTAL
  // ============================================================
  app.get(
    "/api/portal/dashboard",
    requireClient,
    async (req: AuthedRequest, res) => {
      const clientId = req.auth!.id;
      const [clientRows] = await pool.query<RowDataPacket[]>(
        `SELECT c.id, c.first_name, c.last_name, c.email, c.phone, c.pipeline_stage,
              c.contract_signed_at, c.smart_credit_connected_at, c.status,
              p.name AS package_name, p.price_cents AS package_price_cents,
              p.duration_months AS package_duration_months
       FROM clients c LEFT JOIN packages p ON p.id = c.package_id
       WHERE c.id = ? LIMIT 1`,
        [clientId],
      );
      if (clientRows.length === 0)
        return res.status(404).json({ error: "Not found" });

      const [docRows] = await pool.query<RowDataPacket[]>(
        `SELECT id, doc_type, file_name, review_status, rejection_reason, uploaded_at
       FROM client_documents WHERE client_id = ? ORDER BY uploaded_at DESC`,
        [clientId],
      );
      const [reportRows] = await pool.query<RowDataPacket[]>(
        `SELECT id, round_number, score_before, score_after, items_removed, items_disputed, summary_md, created_at
       FROM client_round_reports WHERE client_id = ? ORDER BY round_number DESC`,
        [clientId],
      );
      const [ticketRows] = await pool.query<RowDataPacket[]>(
        `SELECT id, subject, status, priority, created_at FROM support_tickets WHERE client_id = ? ORDER BY created_at DESC LIMIT 5`,
        [clientId],
      );

      res.json({
        client: clientRows[0],
        documents: docRows,
        reports: reportRows,
        tickets: ticketRows,
      });
    },
  );

  app.post(
    "/api/portal/documents",
    requireClient,
    upload.array("files", 5),
    async (req: AuthedRequest, res) => {
      const clientId = req.auth!.id;
      const docType = String(req.body?.doc_type || "");
      const allowed = [
        "id_front",
        "id_back",
        "ssn_card",
        "proof_of_address",
        "other",
      ];
      if (!allowed.includes(docType)) {
        return res.status(400).json({ error: "Invalid doc_type" });
      }
      const files = (req.files as Express.Multer.File[]) || [];
      if (files.length === 0)
        return res.status(400).json({ error: "No files" });

      const inserted: any[] = [];
      for (const f of files) {
        const safeFilename = f.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
        const relKey = `clients/${clientId}/${Date.now()}_${safeFilename}.enc`;
        const absPath = path.join(UPLOADS_DIR, relKey);
        await fs.promises.mkdir(path.dirname(absPath), { recursive: true });
        const { encrypted, iv, tag } = encryptFile(f.buffer);
        await fs.promises.writeFile(absPath, encrypted);
        const [r] = await pool.query<ResultSetHeader>(
          `INSERT INTO client_documents
            (client_id, doc_type, file_name, file_size, mime_type, storage_provider, storage_key, encrypted, enc_iv, enc_tag, review_status)
           VALUES (?,?,?,?,?, 'local', ?, 1, ?, ?, 'pending')`,
          [
            clientId,
            docType,
            f.originalname,
            f.size,
            f.mimetype,
            relKey,
            iv,
            tag,
          ],
        );
        inserted.push({
          id: r.insertId,
          doc_type: docType,
          file_name: f.originalname,
          review_status: "pending",
        });
      }
      res.json({ ok: true, documents: inserted });
    },
  );

  app.get("/api/portal/contract", requireClient, async (_req, res) => {
    const [tpls] = await pool.query<RowDataPacket[]>(
      `SELECT setting_value FROM system_settings WHERE setting_key = 'contract_template_html'`,
    );
    const html =
      (tpls[0]?.setting_value as string) ||
      "<h1>Optimum Credit — Service Agreement</h1><p>By signing below you authorize Optimum Credit Repair to act on your behalf in disputing inaccurate items on your credit reports with the major credit bureaus, in accordance with the Credit Repair Organizations Act (CROA) and applicable state laws.</p><p>You may cancel this agreement at any time without penalty within 5 business days of signing. After that, monthly service fees apply per your selected plan.</p>";
    res.json({ html });
  });

  app.post(
    "/api/portal/contract/sign",
    requireClient,
    async (req: AuthedRequest, res) => {
      const clientId = req.auth!.id;
      const { signature_name, signature_data_url } = req.body || {};
      if (!signature_name || String(signature_name).trim().length < 2) {
        return res.status(400).json({ error: "Signature name required" });
      }
      const [tpls] = await pool.query<RowDataPacket[]>(
        `SELECT setting_value FROM system_settings WHERE setting_key = 'contract_template_html'`,
      );
      const body =
        (tpls[0]?.setting_value as string) ||
        "<h1>Service Agreement</h1><p>Default agreement.</p>";
      await pool.query<ResultSetHeader>(
        `INSERT INTO client_contracts (client_id, version, body_html, signed_name, signed_ip, signed_at, signature_data_url)
       VALUES (?, '1.0', ?, ?, ?, NOW(), ?)`,
        [
          clientId,
          body,
          signature_name,
          req.ip || null,
          signature_data_url || null,
        ],
      );
      await pool.query<ResultSetHeader>(
        `UPDATE clients SET contract_signed_at = NOW(), contract_signature_name = ?, contract_signature_ip = ? WHERE id = ?`,
        [signature_name, req.ip || null, clientId],
      );
      res.json({ ok: true, signed_at: new Date().toISOString() });
    },
  );

  app.post(
    "/api/portal/smart-credit",
    requireClient,
    async (req: AuthedRequest, res) => {
      const { smart_credit_email } = req.body || {};
      if (!smart_credit_email)
        return res.status(400).json({ error: "Email required" });
      await pool.query<ResultSetHeader>(
        `UPDATE clients SET smart_credit_email = ?, smart_credit_connected_at = NOW() WHERE id = ?`,
        [smart_credit_email, req.auth!.id],
      );
      res.json({ ok: true });
    },
  );

  app.get(
    "/api/portal/tickets",
    requireClient,
    async (req: AuthedRequest, res) => {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id, subject, body, category, priority, status, created_at, updated_at
       FROM support_tickets WHERE client_id = ? ORDER BY created_at DESC`,
        [req.auth!.id],
      );
      res.json({ tickets: rows });
    },
  );

  app.post(
    "/api/portal/tickets",
    requireClient,
    async (req: AuthedRequest, res) => {
      const { subject, body, category, priority } = req.body || {};
      if (!subject || !body)
        return res.status(400).json({ error: "Subject and body required" });
      const [r] = await pool.query<ResultSetHeader>(
        `INSERT INTO support_tickets (client_id, subject, body, category, priority) VALUES (?,?,?,?,?)`,
        [
          req.auth!.id,
          subject,
          body,
          category || "other",
          priority || "normal",
        ],
      );
      res.json({ id: r.insertId });
    },
  );

  app.post(
    "/api/portal/tickets/:id/replies",
    requireClient,
    async (req: AuthedRequest, res) => {
      const { id } = req.params;
      const { body } = req.body || {};
      if (!body) return res.status(400).json({ error: "Body required" });
      const [chk] = await pool.query<RowDataPacket[]>(
        `SELECT id FROM support_tickets WHERE id = ? AND client_id = ? LIMIT 1`,
        [id, req.auth!.id],
      );
      if (chk.length === 0) return res.status(404).json({ error: "Not found" });
      const [r] = await pool.query<ResultSetHeader>(
        `INSERT INTO support_ticket_replies (ticket_id, author_type, author_client_id, body) VALUES (?, 'client', ?, ?)`,
        [id, req.auth!.id, body],
      );
      await pool.query<ResultSetHeader>(
        `UPDATE support_tickets SET status='open', updated_at=NOW() WHERE id = ?`,
        [id],
      );
      res.json({ id: r.insertId });
    },
  );

  app.get(
    "/api/portal/ai-chat/sessions",
    requireClient,
    async (req: AuthedRequest, res) => {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id, title, language, created_at, updated_at FROM ai_chat_sessions WHERE client_id = ? ORDER BY updated_at DESC`,
        [req.auth!.id],
      );
      res.json({ sessions: rows });
    },
  );

  app.get(
    "/api/portal/ai-chat/sessions/:id/messages",
    requireClient,
    async (req: AuthedRequest, res) => {
      const [chk] = await pool.query<RowDataPacket[]>(
        `SELECT id FROM ai_chat_sessions WHERE id = ? AND client_id = ? LIMIT 1`,
        [req.params.id, req.auth!.id],
      );
      if (chk.length === 0) return res.status(404).json({ error: "Not found" });
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id, role, content, created_at FROM ai_chat_messages WHERE session_id = ? ORDER BY id ASC`,
        [req.params.id],
      );
      res.json({ messages: rows });
    },
  );

  app.post(
    "/api/portal/ai-chat/message",
    requireClient,
    async (req: AuthedRequest, res) => {
      const { session_id, content, language } = req.body || {};
      if (!content) return res.status(400).json({ error: "Content required" });

      let sessionId = session_id ? Number(session_id) : null;
      if (!sessionId) {
        const [r] = await pool.query<ResultSetHeader>(
          `INSERT INTO ai_chat_sessions (client_id, title, language) VALUES (?,?,?)`,
          [req.auth!.id, String(content).slice(0, 80), language || "en"],
        );
        sessionId = r.insertId;
      }
      await pool.query<ResultSetHeader>(
        `INSERT INTO ai_chat_messages (session_id, role, content) VALUES (?, 'user', ?)`,
        [sessionId, content],
      );

      const text = String(content).toLowerCase();
      let reply =
        "Thanks for reaching out! I'll connect you with our team if I can't help directly — open a support ticket from the Support section anytime.";
      if (text.includes("how long") || text.includes("timeline")) {
        reply =
          "Most credit repair plans run for 5 monthly rounds. You'll see updates after each round in your portal, and we'll text you when a new report is ready.";
      } else if (text.includes("document") || text.includes("upload")) {
        reply =
          "You can upload your government ID (front and back), Social Security card, and proof of address from the My Documents section of your portal.";
      } else if (text.includes("score") || text.includes("credit")) {
        reply =
          "Your monthly progress reports show how your scores have moved across all three bureaus. Open the Reports section to see them.";
      }

      await pool.query<ResultSetHeader>(
        `INSERT INTO ai_chat_messages (session_id, role, content) VALUES (?, 'assistant', ?)`,
        [sessionId, reply],
      );
      await pool.query<ResultSetHeader>(
        `UPDATE ai_chat_sessions SET updated_at = NOW() WHERE id = ?`,
        [sessionId],
      );
      res.json({ session_id: sessionId, reply });
    },
  );

  app.get("/api/portal/videos", requireClient, async (_req, res) => {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, title, description, video_url, thumbnail_url, duration_seconds, category, language
       FROM educational_videos WHERE is_published = 1 ORDER BY sort_order ASC, id DESC`,
    );
    res.json({ videos: rows });
  });

  // ============================================================
  // ADMIN
  // ============================================================
  app.get("/api/admin/dashboard", requireAdmin, async (_req, res) => {
    const [stages] = await pool.query<RowDataPacket[]>(
      `SELECT pipeline_stage, COUNT(*) AS count FROM clients GROUP BY pipeline_stage`,
    );
    const [stats] = await pool.query<RowDataPacket[]>(
      `SELECT
        (SELECT COUNT(*) FROM clients WHERE status = 'active' OR pipeline_stage NOT IN ('completed','cancelled')) AS active_clients,
        (SELECT COUNT(*) FROM clients WHERE status = 'pending_payment') AS pending_payments,
        (SELECT COUNT(*) FROM client_documents WHERE review_status = 'pending') AS pending_doc_reviews,
        (SELECT COUNT(*) FROM support_tickets WHERE status IN ('open','in_progress')) AS open_tickets,
        (SELECT COALESCE(SUM(amount_cents),0) FROM payments WHERE status = 'succeeded' AND paid_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)) AS revenue_cents_30d,
        (SELECT COUNT(*) FROM clients WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)) AS new_clients_30d`,
    );
    const [recent] = await pool.query<RowDataPacket[]>(
      `SELECT c.id, c.first_name, c.last_name, c.email, c.pipeline_stage, c.status, c.created_at, p.name AS package_name
       FROM clients c LEFT JOIN packages p ON p.id = c.package_id
       ORDER BY c.created_at DESC LIMIT 8`,
    );
    res.json({ stages, stats: stats[0] || {}, recent_clients: recent });
  });

  app.get("/api/admin/clients", requireAdmin, async (req, res) => {
    const stage = req.query.stage as string | undefined;
    const search = req.query.search as string | undefined;
    const where: string[] = [];
    const args: any[] = [];
    if (stage) {
      where.push("c.pipeline_stage = ?");
      args.push(stage);
    }
    if (search) {
      where.push(
        "(c.email LIKE ? OR c.first_name LIKE ? OR c.last_name LIKE ?)",
      );
      const s = `%${search}%`;
      args.push(s, s, s);
    }
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT c.id, c.first_name, c.last_name, c.email, c.phone, c.pipeline_stage,
              c.status, c.created_at, p.name AS package_name, p.slug AS package_slug
       FROM clients c LEFT JOIN packages p ON p.id = c.package_id
       ${where.length ? "WHERE " + where.join(" AND ") : ""}
       ORDER BY c.created_at DESC LIMIT 200`,
      args,
    );
    res.json({ clients: rows });
  });

  app.get("/api/admin/clients/:id", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const [c] = await pool.query<RowDataPacket[]>(
      `SELECT c.*, p.name AS package_name, p.slug AS package_slug, p.price_cents AS package_price_cents
       FROM clients c LEFT JOIN packages p ON p.id = c.package_id
       WHERE c.id = ? LIMIT 1`,
      [id],
    );
    if (c.length === 0) return res.status(404).json({ error: "Not found" });
    const [docs] = await pool.query<RowDataPacket[]>(
      `SELECT id, doc_type, file_name, file_size, mime_type, review_status, rejection_reason, uploaded_at, reviewed_at
       FROM client_documents WHERE client_id = ? ORDER BY uploaded_at DESC`,
      [id],
    );
    const [reports] = await pool.query<RowDataPacket[]>(
      `SELECT id, round_number, score_before, score_after, items_removed, items_disputed, summary_md, created_at
       FROM client_round_reports WHERE client_id = ? ORDER BY round_number DESC`,
      [id],
    );
    const [payments] = await pool.query<RowDataPacket[]>(
      `SELECT id, amount_cents, status, paid_at, created_at, provider_transaction_id
       FROM payments WHERE client_id = ? ORDER BY created_at DESC`,
      [id],
    );
    const [pipeline] = await pool.query<RowDataPacket[]>(
      `SELECT id, from_stage, to_stage, notes, created_at FROM client_pipeline_history WHERE client_id = ? ORDER BY created_at DESC`,
      [id],
    );
    res.json({
      client: c[0],
      documents: docs,
      reports,
      payments,
      pipeline_history: pipeline,
    });
  });

  app.get("/api/admin/pipeline", requireAdmin, async (_req, res) => {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT c.id, c.first_name, c.last_name, c.email, c.phone, c.pipeline_stage,
              c.status, c.created_at, c.pipeline_stage_changed_at,
              p.name AS package_name, p.slug AS package_slug,
              COALESCE(ds.docs_total,    0) AS docs_total,
              COALESCE(ds.docs_approved, 0) AS docs_approved,
              COALESCE(ds.docs_pending,  0) AS docs_pending,
              COALESCE(ds.docs_rejected, 0) AS docs_rejected
       FROM clients c
       LEFT JOIN packages p ON p.id = c.package_id
       LEFT JOIN (
         SELECT client_id,
           COUNT(*) AS docs_total,
           SUM(CASE WHEN review_status = 'approved' THEN 1 ELSE 0 END) AS docs_approved,
           SUM(CASE WHEN review_status = 'pending'  THEN 1 ELSE 0 END) AS docs_pending,
           SUM(CASE WHEN review_status = 'rejected' THEN 1 ELSE 0 END) AS docs_rejected
         FROM client_documents
         GROUP BY client_id
       ) ds ON ds.client_id = c.id
       WHERE c.status NOT IN ('cancelled')
       ORDER BY c.pipeline_stage_changed_at DESC, c.created_at DESC`,
    );
    res.json({ clients: rows });
  });

  // ── Create client ────────────────────────────────────────────────────────
  app.post("/api/admin/clients", requireAdmin, async (req, res) => {
    const { first_name, last_name, email, phone, package_id, status } =
      req.body || {};
    if (!first_name || !last_name || !email)
      return res
        .status(400)
        .json({ error: "first_name, last_name and email are required" });
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRe.test(String(email)))
      return res.status(400).json({ error: "Invalid email address" });
    const allowedStatus = [
      "pending_payment",
      "onboarding",
      "active",
      "paused",
      "cancelled",
    ];
    const clientStatus = allowedStatus.includes(status)
      ? status
      : "pending_payment";
    try {
      const [result] = await pool.query<ResultSetHeader>(
        `INSERT INTO clients (first_name, last_name, email, phone, package_id, status)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          String(first_name).trim(),
          String(last_name).trim(),
          String(email).trim().toLowerCase(),
          phone ? String(phone).trim() : null,
          package_id ? Number(package_id) : null,
          clientStatus,
        ],
      );
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT c.id, c.first_name, c.last_name, c.email, c.phone, c.pipeline_stage,
                c.status, c.created_at, p.name AS package_name, p.slug AS package_slug
         FROM clients c LEFT JOIN packages p ON p.id = c.package_id
         WHERE c.id = ? LIMIT 1`,
        [result.insertId],
      );
      res.status(201).json({ client: rows[0] });
    } catch (err: any) {
      if (err?.code === "ER_DUP_ENTRY")
        return res
          .status(409)
          .json({ error: "A client with that email already exists" });
      throw err;
    }
  });

  // ── Update client ────────────────────────────────────────────────────────
  app.put("/api/admin/clients/:id", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const { first_name, last_name, email, phone, package_id, status } =
      req.body || {};
    const [existing] = await pool.query<RowDataPacket[]>(
      "SELECT id FROM clients WHERE id = ? LIMIT 1",
      [id],
    );
    if (existing.length === 0)
      return res.status(404).json({ error: "Client not found" });
    const allowedStatus = [
      "pending_payment",
      "onboarding",
      "active",
      "paused",
      "cancelled",
    ];
    const updates: string[] = [];
    const args: any[] = [];
    if (first_name != null) {
      updates.push("first_name = ?");
      args.push(String(first_name).trim());
    }
    if (last_name != null) {
      updates.push("last_name = ?");
      args.push(String(last_name).trim());
    }
    if (email != null) {
      const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRe.test(String(email)))
        return res.status(400).json({ error: "Invalid email address" });
      updates.push("email = ?");
      args.push(String(email).trim().toLowerCase());
    }
    if (phone !== undefined) {
      updates.push("phone = ?");
      args.push(phone ? String(phone).trim() : null);
    }
    if (package_id !== undefined) {
      updates.push("package_id = ?");
      args.push(package_id ? Number(package_id) : null);
    }
    if (status != null && allowedStatus.includes(status)) {
      updates.push("status = ?");
      args.push(status);
    }
    if (updates.length === 0)
      return res.status(400).json({ error: "No valid fields to update" });
    args.push(id);
    try {
      await pool.query<ResultSetHeader>(
        `UPDATE clients SET ${updates.join(", ")} WHERE id = ?`,
        args,
      );
    } catch (err: any) {
      if (err?.code === "ER_DUP_ENTRY")
        return res
          .status(409)
          .json({ error: "A client with that email already exists" });
      throw err;
    }
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT c.id, c.first_name, c.last_name, c.email, c.phone, c.pipeline_stage,
              c.status, c.created_at, p.name AS package_name, p.slug AS package_slug
       FROM clients c LEFT JOIN packages p ON p.id = c.package_id
       WHERE c.id = ? LIMIT 1`,
      [id],
    );
    res.json({ client: rows[0] });
  });

  // ── Delete client ────────────────────────────────────────────────────────
  app.delete("/api/admin/clients/:id", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const [existing] = await pool.query<RowDataPacket[]>(
      "SELECT id FROM clients WHERE id = ? LIMIT 1",
      [id],
    );
    if (existing.length === 0)
      return res.status(404).json({ error: "Client not found" });
    await pool.query<ResultSetHeader>("DELETE FROM clients WHERE id = ?", [id]);
    res.json({ ok: true });
  });

  app.post(
    "/api/admin/clients/:id/stage",
    requireAdmin,
    async (req: AuthedRequest, res) => {
      const id = Number(req.params.id);
      const { stage, notes } = req.body || {};
      const allowed = [
        "new_client",
        "docs_ready",
        "round_1",
        "round_2",
        "round_3",
        "round_4",
        "round_5",
        "completed",
        "cancelled",
      ];
      if (!allowed.includes(stage))
        return res.status(400).json({ error: "Invalid stage" });
      const [cur] = await pool.query<RowDataPacket[]>(
        `SELECT pipeline_stage FROM clients WHERE id = ? LIMIT 1`,
        [id],
      );
      if (cur.length === 0) return res.status(404).json({ error: "Not found" });
      const fromStage = cur[0].pipeline_stage as string;
      if (fromStage === stage) return res.json({ ok: true, unchanged: true });

      // Enforce docs_ready rule: all 4 required docs must be approved
      if (stage === "docs_ready") {
        const REQUIRED = [
          "id_front",
          "id_back",
          "ssn_card",
          "proof_of_address",
        ];
        const [docRows] = await pool.query<RowDataPacket[]>(
          `SELECT doc_type, review_status FROM client_documents
           WHERE client_id = ? AND doc_type IN (?) ORDER BY uploaded_at DESC`,
          [id, REQUIRED],
        );
        // Keep only the latest doc per type
        const latestByType: Record<string, string> = {};
        for (const d of docRows) {
          if (!latestByType[d.doc_type as string])
            latestByType[d.doc_type as string] = d.review_status as string;
        }
        const approved = REQUIRED.filter((t) => latestByType[t] === "approved");
        if (approved.length < 4) {
          return res.status(422).json({
            error: `Cannot advance to Docs Verified — ${4 - approved.length} required document(s) still need approval.`,
          });
        }
      }
      await pool.query<ResultSetHeader>(
        `UPDATE clients SET pipeline_stage = ?, pipeline_stage_changed_at = NOW() WHERE id = ?`,
        [stage, id],
      );
      await pool.query<ResultSetHeader>(
        `INSERT INTO client_pipeline_history (client_id, from_stage, to_stage, changed_by_admin_id, notes) VALUES (?,?,?,?,?)`,
        [id, fromStage, stage, req.auth!.id, notes || null],
      );
      // Trigger reminder flow for completed stage
      if (stage === "completed") {
        triggerReminderFlow("completed", id).catch((e) =>
          console.error("[flow:completed]", e?.message),
        );
      }
      res.json({ ok: true });
    },
  );

  app.get("/api/admin/documents", requireAdmin, async (req, res) => {
    const status = (req.query.status as string) || "pending";
    const search = ((req.query.search as string) || "").trim();

    const params: (string | number)[] = [];
    const conditions: string[] = [];

    if (status !== "all") {
      conditions.push("d.review_status = ?");
      params.push(status);
    }
    if (search) {
      conditions.push(
        "(c.first_name LIKE ? OR c.last_name LIKE ? OR c.email LIKE ?)",
      );
      const like = `%${search}%`;
      params.push(like, like, like);
    }

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT d.id, d.client_id, d.doc_type, d.file_name, d.file_size, d.mime_type,
              d.review_status, d.rejection_reason, d.uploaded_at, d.reviewed_at,
              c.first_name, c.last_name, c.email
       FROM client_documents d JOIN clients c ON c.id = d.client_id
       ${where}
       ORDER BY d.uploaded_at DESC LIMIT 500`,
      params,
    );
    res.json({ documents: rows });
  });

  // Serve decrypted document file to admin (streamed, authenticated)
  app.get(
    "/api/admin/documents/:id/file",
    requireAdmin,
    async (req: AuthedRequest, res) => {
      const id = Number(req.params.id);
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT file_name, mime_type, storage_provider, storage_key, encrypted, enc_iv, enc_tag
         FROM client_documents WHERE id = ? LIMIT 1`,
        [id],
      );
      if (rows.length === 0)
        return res.status(404).json({ error: "Not found" });
      const doc = rows[0];
      const absPath = path.join(UPLOADS_DIR, doc.storage_key as string);
      try {
        const raw = await fs.promises.readFile(absPath);
        let buf: Buffer;
        if (doc.encrypted && doc.enc_iv && doc.enc_tag) {
          buf = decryptFile(raw, doc.enc_iv as string, doc.enc_tag as string);
        } else {
          buf = raw;
        }
        res.set(
          "Content-Type",
          (doc.mime_type as string) || "application/octet-stream",
        );
        res.set(
          "Content-Disposition",
          `inline; filename="${encodeURIComponent(doc.file_name as string)}"`,
        );
        res.set("Content-Length", String(buf.length));
        res.set("Cache-Control", "no-store, no-cache");
        res.send(buf);
      } catch {
        res.status(404).json({ error: "File not found on disk" });
      }
    },
  );

  app.post(
    "/api/admin/documents/:id/review",
    requireSuperAdmin,
    async (req: AuthedRequest, res) => {
      const id = Number(req.params.id);
      const { decision, reason } = req.body || {};
      if (!["approved", "rejected"].includes(decision)) {
        return res
          .status(400)
          .json({ error: "decision must be approved or rejected" });
      }
      if (decision === "rejected" && !reason) {
        return res.status(400).json({ error: "Reason required for rejection" });
      }
      const [docs] = await pool.query<RowDataPacket[]>(
        `SELECT d.id, d.doc_type, d.client_id, c.first_name, c.email, c.phone
         FROM client_documents d JOIN clients c ON c.id = d.client_id
         WHERE d.id = ? LIMIT 1`,
        [id],
      );
      if (docs.length === 0)
        return res.status(404).json({ error: "Not found" });
      const d = docs[0];
      await pool.query<ResultSetHeader>(
        `UPDATE client_documents
         SET review_status = ?, rejection_reason = ?, reviewed_by_admin_id = ?, reviewed_at = NOW()
         WHERE id = ?`,
        [decision, decision === "rejected" ? reason : null, req.auth!.id, id],
      );

      if (decision === "rejected") {
        const portalUrl = `${APP_URL}/portal/documents`;
        const tpl = tplDocumentRejected({
          firstName: d.first_name,
          docType: d.doc_type,
          reason,
          portalUrl,
        });
        await sendEmail({
          to: d.email,
          subject: tpl.subject,
          html: tpl.html,
        }).catch(() => null);
        if (d.phone) {
          await sendSms({
            to: d.phone,
            body: `Optimum Credit: your ${DOC_TYPE_LABELS[d.doc_type] || d.doc_type} needs to be re-uploaded. Reason: ${reason}. Log in at: ${APP_URL}/portal/documents`,
          }).catch(() => null);
        }
      }

      const required = ["id_front", "id_back", "ssn_card", "proof_of_address"];
      const [docStats] = await pool.query<RowDataPacket[]>(
        `SELECT doc_type, MAX(review_status = 'approved') AS approved
         FROM client_documents
         WHERE client_id = ? AND doc_type IN ('id_front','id_back','ssn_card','proof_of_address')
         GROUP BY doc_type`,
        [d.client_id],
      );
      const approvedSet = new Set(
        (docStats as any[])
          .filter((r) => Number(r.approved) === 1)
          .map((r) => r.doc_type),
      );
      const allApproved = required.every((r) => approvedSet.has(r));
      if (allApproved) {
        const [cur] = await pool.query<RowDataPacket[]>(
          `SELECT pipeline_stage FROM clients WHERE id = ? LIMIT 1`,
          [d.client_id],
        );
        if (cur[0]?.pipeline_stage === "new_client") {
          await pool.query<ResultSetHeader>(
            `UPDATE clients SET pipeline_stage = 'docs_ready', pipeline_stage_changed_at = NOW(), status='active' WHERE id = ?`,
            [d.client_id],
          );
          await pool.query<ResultSetHeader>(
            `INSERT INTO client_pipeline_history (client_id, from_stage, to_stage, changed_by_admin_id, notes) VALUES (?, 'new_client', 'docs_ready', ?, 'Auto-advanced: all documents approved')`,
            [d.client_id, req.auth!.id],
          );
        }
      }

      res.json({ ok: true, auto_advanced: allApproved });
    },
  );

  app.post(
    "/api/admin/clients/:id/round-reports",
    requireSuperAdmin,
    async (req: AuthedRequest, res) => {
      const clientId = Number(req.params.id);
      const {
        round_number,
        score_before,
        score_after,
        items_removed,
        items_disputed,
        summary_md,
      } = req.body || {};
      if (!round_number)
        return res.status(400).json({ error: "round_number required" });

      await pool.query<ResultSetHeader>(
        `INSERT INTO client_round_reports
          (client_id, round_number, score_before, score_after, items_removed, items_disputed, summary_md, created_by_admin_id, delivered_via_email, delivered_via_sms)
         VALUES (?,?,?,?,?,?,?,?, 1, 1)
         ON DUPLICATE KEY UPDATE score_before=VALUES(score_before), score_after=VALUES(score_after),
            items_removed=VALUES(items_removed), items_disputed=VALUES(items_disputed), summary_md=VALUES(summary_md)`,
        [
          clientId,
          round_number,
          score_before || null,
          score_after || null,
          items_removed || 0,
          items_disputed || 0,
          summary_md || null,
          req.auth!.id,
        ],
      );

      const stageMap: Record<number, string> = {
        1: "round_1",
        2: "round_2",
        3: "round_3",
        4: "round_4",
        5: "round_5",
      };
      if (stageMap[round_number]) {
        await pool.query<ResultSetHeader>(
          `UPDATE clients SET pipeline_stage = ?, pipeline_stage_changed_at = NOW() WHERE id = ?`,
          [round_number === 5 ? "completed" : stageMap[round_number], clientId],
        );
      }

      const [crows] = await pool.query<RowDataPacket[]>(
        `SELECT first_name, email, phone FROM clients WHERE id = ? LIMIT 1`,
        [clientId],
      );
      const c = crows[0];
      if (c) {
        const tpl = tplRoundComplete({
          firstName: c.first_name,
          roundNumber: round_number,
          scoreBefore: score_before,
          scoreAfter: score_after,
          itemsRemoved: items_removed || 0,
          portalUrl: `${APP_URL}/portal/reports`,
        });
        await sendEmail({
          to: c.email,
          subject: tpl.subject,
          html: tpl.html,
        }).catch(() => null);
        if (c.phone) {
          await sendSms({
            to: c.phone,
            body: `${c.first_name}, your Round ${round_number} report is ready! View progress: ${APP_URL}/portal/reports`,
          }).catch(() => null);
        }
        // Trigger reminder flow for round completion
        const roundTrigger = `round_${round_number}_complete`;
        const scoreChange =
          score_before != null && score_after != null
            ? String(score_after - score_before)
            : undefined;
        await triggerReminderFlow(roundTrigger, clientId, {
          items_removed: String(items_removed || 0),
          ...(scoreChange !== undefined ? { score_change: scoreChange } : {}),
        }).catch(() => null);
      }
      res.json({ ok: true });
    },
  );

  app.get("/api/admin/conversations", requireAdmin, async (_req, res) => {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT cv.id, cv.channel, cv.status, cv.last_message_at, cv.last_message_preview, cv.unread_count,
              c.id AS client_id, c.first_name, c.last_name, c.email, c.phone
       FROM conversations cv JOIN clients c ON c.id = cv.client_id
       ORDER BY cv.last_message_at DESC LIMIT 100`,
    );
    res.json({ conversations: rows });
  });

  app.get(
    "/api/admin/conversations/:id/messages",
    requireAdmin,
    async (req, res) => {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id, direction, channel, body, from_address, to_address, sent_by_admin_id, created_at
       FROM conversation_messages WHERE conversation_id = ? ORDER BY id ASC`,
        [req.params.id],
      );
      res.json({ messages: rows });
    },
  );

  app.post(
    "/api/admin/conversations/send",
    requireAdmin,
    async (req: AuthedRequest, res) => {
      const { client_id, channel, body, subject } = req.body || {};
      if (!client_id || !channel || !body)
        return res.status(400).json({ error: "Missing fields" });
      const [crows] = await pool.query<RowDataPacket[]>(
        `SELECT email, phone, first_name FROM clients WHERE id = ? LIMIT 1`,
        [client_id],
      );
      if (crows.length === 0)
        return res.status(404).json({ error: "Client not found" });
      const c = crows[0];

      let conversationId: number;
      const [conv] = await pool.query<RowDataPacket[]>(
        `SELECT id FROM conversations WHERE client_id = ? AND channel = ? LIMIT 1`,
        [client_id, channel],
      );
      if (conv.length > 0) {
        conversationId = conv[0].id as number;
      } else {
        const [r] = await pool.query<ResultSetHeader>(
          `INSERT INTO conversations (client_id, channel, status, assigned_admin_id) VALUES (?,?,?,?)`,
          [client_id, channel, "open", req.auth!.id],
        );
        conversationId = r.insertId;
      }

      let providerId: string | undefined;
      let toAddress = "";
      if (channel === "sms") {
        if (!c.phone)
          return res.status(400).json({ error: "Client has no phone" });
        toAddress = c.phone;
        const result = await sendSms({ to: c.phone, body }).catch((e) => {
          console.error(e);
          return null;
        });
        providerId = result?.sid;
      } else if (channel === "email") {
        toAddress = c.email;
        const result = await sendEmail({
          to: c.email,
          subject: subject || `Message from Optimum Credit`,
          html: `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.6;color:#0f172a;">${String(body).replace(/\n/g, "<br/>")}</div>`,
        }).catch((e) => {
          console.error(e);
          return null;
        });
        providerId = result?.id;
      } else {
        return res.status(400).json({ error: "Unsupported channel" });
      }

      await pool.query<ResultSetHeader>(
        `INSERT INTO conversation_messages (conversation_id, direction, channel, body, to_address, sent_by_admin_id, provider_message_id) VALUES (?, 'outbound', ?, ?, ?, ?, ?)`,
        [
          conversationId,
          channel,
          body,
          toAddress,
          req.auth!.id,
          providerId || null,
        ],
      );
      await pool.query<ResultSetHeader>(
        `UPDATE conversations SET last_message_at = NOW(), last_message_preview = ? WHERE id = ?`,
        [String(body).slice(0, 200), conversationId],
      );
      res.json({ ok: true, conversation_id: conversationId });
    },
  );

  app.get("/api/admin/tickets", requireAdmin, async (req, res) => {
    const status = req.query.status as string | undefined;
    const args: any[] = [];
    let where = "";
    if (status) {
      where = "WHERE t.status = ?";
      args.push(status);
    }
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT t.id, t.subject, t.status, t.priority, t.category, t.created_at, t.updated_at,
              c.id AS client_id, c.first_name, c.last_name, c.email
       FROM support_tickets t JOIN clients c ON c.id = t.client_id
       ${where}
       ORDER BY t.created_at DESC LIMIT 200`,
      args,
    );
    res.json({ tickets: rows });
  });

  app.get("/api/admin/tickets/:id", requireAdmin, async (req, res) => {
    const [t] = await pool.query<RowDataPacket[]>(
      `SELECT t.*, c.first_name, c.last_name, c.email
       FROM support_tickets t JOIN clients c ON c.id = t.client_id WHERE t.id = ? LIMIT 1`,
      [req.params.id],
    );
    if (t.length === 0) return res.status(404).json({ error: "Not found" });
    const [replies] = await pool.query<RowDataPacket[]>(
      `SELECT id, author_type, author_admin_id, author_client_id, body, is_internal_note, created_at
       FROM support_ticket_replies WHERE ticket_id = ? ORDER BY id ASC`,
      [req.params.id],
    );
    res.json({ ticket: t[0], replies });
  });

  app.post(
    "/api/admin/tickets/:id/replies",
    requireAdmin,
    async (req: AuthedRequest, res) => {
      const { body, is_internal_note } = req.body || {};
      if (!body) return res.status(400).json({ error: "Body required" });
      const [r] = await pool.query<ResultSetHeader>(
        `INSERT INTO support_ticket_replies (ticket_id, author_type, author_admin_id, body, is_internal_note) VALUES (?, 'admin', ?, ?, ?)`,
        [req.params.id, req.auth!.id, body, is_internal_note ? 1 : 0],
      );
      await pool.query<ResultSetHeader>(
        `UPDATE support_tickets SET status='in_progress', updated_at=NOW() WHERE id = ?`,
        [req.params.id],
      );
      res.json({ id: r.insertId });
    },
  );

  app.post("/api/admin/tickets/:id/status", requireAdmin, async (req, res) => {
    const { status } = req.body || {};
    const allowed = [
      "open",
      "in_progress",
      "waiting_client",
      "resolved",
      "closed",
    ];
    if (!allowed.includes(status))
      return res.status(400).json({ error: "Invalid status" });
    await pool.query<ResultSetHeader>(
      `UPDATE support_tickets SET status = ?, resolved_at = CASE WHEN ? IN ('resolved','closed') THEN NOW() ELSE NULL END WHERE id = ?`,
      [status, status, req.params.id],
    );
    res.json({ ok: true });
  });

  app.get("/api/admin/templates", requireAdmin, async (_req, res) => {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, slug, name, channel, subject, body, variables_json, is_active, updated_at
       FROM communication_templates ORDER BY channel, name`,
    );
    res.json({ templates: rows });
  });

  app.post("/api/admin/templates/:id", requireAdmin, async (req, res) => {
    const { name, subject, body, is_active } = req.body || {};
    await pool.query<ResultSetHeader>(
      `UPDATE communication_templates SET name = COALESCE(?, name), subject = ?, body = COALESCE(?, body), is_active = COALESCE(?, is_active) WHERE id = ?`,
      [
        name || null,
        subject ?? null,
        body || null,
        typeof is_active === "boolean" ? (is_active ? 1 : 0) : null,
        req.params.id,
      ],
    );
    res.json({ ok: true });
  });

  app.post("/api/admin/templates", requireAdmin, async (req, res) => {
    const { slug, name, channel, subject, body, variables } = req.body || {};
    if (!slug || !name || !channel || !body) {
      return res
        .status(400)
        .json({ error: "slug, name, channel and body are required" });
    }
    const [existing] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM communication_templates WHERE slug = ? LIMIT 1`,
      [slug],
    );
    if ((existing as RowDataPacket[]).length > 0) {
      return res
        .status(409)
        .json({ error: "A template with this slug already exists" });
    }
    const vars =
      Array.isArray(variables) && variables.length > 0
        ? JSON.stringify(variables)
        : null;
    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO communication_templates (slug, name, channel, subject, body, variables_json, is_active) VALUES (?,?,?,?,?,?,1)`,
      [slug, name, channel, subject || null, body, vars],
    );
    res.json({ ok: true, id: result.insertId });
  });

  app.delete("/api/admin/templates/:id", requireAdmin, async (req, res) => {
    // Guard: block delete if template is referenced by any reminder flow step
    const [usages] = await pool.query<RowDataPacket[]>(
      `SELECT rf.name AS flow_name
       FROM reminder_flow_steps rfs
       JOIN reminder_flows rf ON rf.id = rfs.flow_id
       JOIN communication_templates ct ON ct.slug = rfs.template_slug
       WHERE ct.id = ?`,
      [req.params.id],
    );
    if ((usages as RowDataPacket[]).length > 0) {
      const flows = [
        ...new Set(
          (usages as RowDataPacket[]).map((u) => u.flow_name as string),
        ),
      ];
      return res.status(409).json({
        error: "Template is used in active reminder flows",
        flows,
      });
    }
    await pool.query<ResultSetHeader>(
      `DELETE FROM communication_templates WHERE id = ?`,
      [req.params.id],
    );
    res.json({ ok: true });
  });

  app.get("/api/admin/videos", requireAdmin, async (_req, res) => {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM educational_videos ORDER BY sort_order ASC, id DESC`,
    );
    res.json({ videos: rows });
  });

  app.post("/api/admin/videos", requireAdmin, async (req, res) => {
    const {
      title,
      description,
      video_url,
      thumbnail_url,
      duration_seconds,
      category,
      language,
      is_published,
      sort_order,
    } = req.body || {};
    if (!title || !video_url)
      return res.status(400).json({ error: "title and video_url required" });
    const [r] = await pool.query<ResultSetHeader>(
      `INSERT INTO educational_videos (title, description, video_url, thumbnail_url, duration_seconds, category, language, is_published, sort_order)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        title,
        description || null,
        video_url,
        thumbnail_url || null,
        duration_seconds || null,
        category || null,
        language || "en",
        is_published === false ? 0 : 1,
        sort_order || 0,
      ],
    );
    res.json({ id: r.insertId });
  });

  app.delete("/api/admin/videos/:id", requireAdmin, async (req, res) => {
    await pool.query<ResultSetHeader>(
      `DELETE FROM educational_videos WHERE id = ?`,
      [req.params.id],
    );
    res.json({ ok: true });
  });

  // ── ADMIN PAYMENTS ──────────────────────────────────────────────────────────
  app.get("/api/admin/payments", requireAdmin, async (req, res) => {
    const status = (req.query.status as string) || "all";
    const search = ((req.query.search as string) || "").trim();
    const provider = (req.query.provider as string) || "";
    const page = Math.max(1, parseInt((req.query.page as string) || "1", 10));
    const limit = Math.min(
      100,
      Math.max(10, parseInt((req.query.limit as string) || "50", 10)),
    );
    const offset = (page - 1) * limit;

    const where: string[] = [];
    const args: any[] = [];

    if (status && status !== "all") {
      where.push("pay.status = ?");
      args.push(status);
    }
    if (provider && provider !== "all") {
      where.push("pay.provider = ?");
      args.push(provider);
    }
    if (search) {
      where.push(
        "(c.email LIKE ? OR c.first_name LIKE ? OR c.last_name LIKE ? OR pay.provider_transaction_id LIKE ?)",
      );
      const like = `%${search}%`;
      args.push(like, like, like, like);
    }

    const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const [payments] = await pool.query<RowDataPacket[]>(
      `SELECT pay.id, pay.client_id, pay.package_id, pay.amount_cents, pay.currency,
              pay.status, pay.provider, pay.provider_transaction_id, pay.provider_charge_id,
              pay.failure_reason, pay.paid_at, pay.created_at, pay.updated_at,
              c.first_name AS client_first_name, c.last_name AS client_last_name,
              c.email AS client_email, c.phone AS client_phone,
              c.pipeline_stage AS client_pipeline_stage, c.status AS client_status,
              p.name AS package_name, p.slug AS package_slug
       FROM payments pay
       LEFT JOIN clients c ON c.id = pay.client_id
       LEFT JOIN packages p ON p.id = pay.package_id
       ${whereClause}
       ORDER BY pay.created_at DESC
       LIMIT ? OFFSET ?`,
      [...args, limit, offset],
    );

    const [countRow] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM payments pay
       LEFT JOIN clients c ON c.id = pay.client_id
       ${whereClause}`,
      args,
    );
    const total = Number(countRow[0]?.total ?? 0);

    const [summary] = await pool.query<RowDataPacket[]>(
      `SELECT
        COUNT(*) AS total_count,
        SUM(status = 'succeeded') AS succeeded_count,
        SUM(status = 'pending') AS pending_count,
        SUM(status = 'failed') AS failed_count,
        SUM(status = 'refunded') AS refunded_count,
        COALESCE(SUM(CASE WHEN status = 'succeeded' THEN amount_cents ELSE 0 END), 0) AS total_revenue_cents,
        COALESCE(SUM(CASE WHEN status = 'succeeded' AND paid_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN amount_cents ELSE 0 END), 0) AS revenue_30d_cents,
        COALESCE(SUM(CASE WHEN status = 'succeeded' AND paid_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN amount_cents ELSE 0 END), 0) AS revenue_7d_cents
       FROM payments`,
    );

    res.json({
      payments,
      summary: summary[0] || {},
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  });

  // ── COUPONS (admin CRUD) ────────────────────────────────────────────────────
  app.get("/api/admin/coupons", requireAdmin, async (_req, res) => {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT c.*,
              CONCAT(a.first_name,' ',a.last_name) AS created_by_name
       FROM coupons c
       LEFT JOIN admins a ON a.id = c.created_by_admin_id
       ORDER BY c.created_at DESC`,
    );
    res.json({ coupons: rows });
  });

  app.post(
    "/api/admin/coupons",
    requireAdmin,
    async (req: AuthedRequest, res) => {
      const {
        code,
        description,
        discount_type,
        discount_value,
        min_amount_cents,
        max_uses,
        applicable_packages,
        valid_from,
        expires_at,
        is_active,
      } = req.body || {};

      if (!code || !discount_type || discount_value == null) {
        return res.status(400).json({
          error: "code, discount_type and discount_value are required",
        });
      }
      const upperCode = String(code)
        .toUpperCase()
        .replace(/[^A-Z0-9_-]/g, "");
      if (!upperCode)
        return res.status(400).json({ error: "Invalid coupon code" });
      if (!["percentage", "fixed"].includes(discount_type)) {
        return res
          .status(400)
          .json({ error: "discount_type must be percentage or fixed" });
      }
      const val = Number(discount_value);
      if (isNaN(val) || val <= 0)
        return res.status(400).json({ error: "discount_value must be > 0" });
      if (discount_type === "percentage" && val > 100) {
        return res
          .status(400)
          .json({ error: "Percentage discount cannot exceed 100" });
      }

      const [existing] = await pool.query<RowDataPacket[]>(
        `SELECT id FROM coupons WHERE code = ? LIMIT 1`,
        [upperCode],
      );
      if (existing.length > 0)
        return res.status(409).json({ error: "Coupon code already exists" });

      const [r] = await pool.query<ResultSetHeader>(
        `INSERT INTO coupons
        (code, description, discount_type, discount_value, min_amount_cents, max_uses,
         applicable_packages, valid_from, expires_at, is_active, created_by_admin_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [
          upperCode,
          description || null,
          discount_type,
          val,
          Number(min_amount_cents) || 0,
          max_uses != null ? Number(max_uses) : null,
          applicable_packages ? JSON.stringify(applicable_packages) : null,
          valid_from || null,
          expires_at || null,
          is_active != null ? Number(is_active) : 1,
          req.auth!.id,
        ],
      );

      const [created] = await pool.query<RowDataPacket[]>(
        `SELECT c.*, CONCAT(a.first_name,' ',a.last_name) AS created_by_name
       FROM coupons c LEFT JOIN admins a ON a.id = c.created_by_admin_id
       WHERE c.id = ? LIMIT 1`,
        [r.insertId],
      );
      res.status(201).json({ coupon: created[0] });
    },
  );

  app.put("/api/admin/coupons/:id", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const {
      code,
      description,
      discount_type,
      discount_value,
      min_amount_cents,
      max_uses,
      applicable_packages,
      valid_from,
      expires_at,
      is_active,
    } = req.body || {};

    const [existing] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM coupons WHERE id = ? LIMIT 1`,
      [id],
    );
    if (existing.length === 0)
      return res.status(404).json({ error: "Coupon not found" });

    const sets: string[] = [];
    const vals: any[] = [];

    if (code !== undefined) {
      const upperCode = String(code)
        .toUpperCase()
        .replace(/[^A-Z0-9_-]/g, "");
      if (!upperCode)
        return res.status(400).json({ error: "Invalid coupon code" });
      const [dup] = await pool.query<RowDataPacket[]>(
        `SELECT id FROM coupons WHERE code = ? AND id <> ? LIMIT 1`,
        [upperCode, id],
      );
      if (dup.length > 0)
        return res.status(409).json({ error: "Coupon code already in use" });
      sets.push("code = ?");
      vals.push(upperCode);
    }
    if (description !== undefined) {
      sets.push("description = ?");
      vals.push(description || null);
    }
    if (discount_type !== undefined) {
      sets.push("discount_type = ?");
      vals.push(discount_type);
    }
    if (discount_value !== undefined) {
      sets.push("discount_value = ?");
      vals.push(Number(discount_value));
    }
    if (min_amount_cents !== undefined) {
      sets.push("min_amount_cents = ?");
      vals.push(Number(min_amount_cents) || 0);
    }
    if (max_uses !== undefined) {
      sets.push("max_uses = ?");
      vals.push(max_uses != null ? Number(max_uses) : null);
    }
    if (applicable_packages !== undefined) {
      sets.push("applicable_packages = ?");
      vals.push(
        applicable_packages ? JSON.stringify(applicable_packages) : null,
      );
    }
    if (valid_from !== undefined) {
      sets.push("valid_from = ?");
      vals.push(valid_from || null);
    }
    if (expires_at !== undefined) {
      sets.push("expires_at = ?");
      vals.push(expires_at || null);
    }
    if (is_active !== undefined) {
      sets.push("is_active = ?");
      vals.push(Number(is_active));
    }

    if (sets.length === 0)
      return res.status(400).json({ error: "No fields to update" });

    await pool.query<ResultSetHeader>(
      `UPDATE coupons SET ${sets.join(", ")} WHERE id = ?`,
      [...vals, id],
    );
    const [updated] = await pool.query<RowDataPacket[]>(
      `SELECT c.*, CONCAT(a.first_name,' ',a.last_name) AS created_by_name
       FROM coupons c LEFT JOIN admins a ON a.id = c.created_by_admin_id
       WHERE c.id = ? LIMIT 1`,
      [id],
    );
    res.json({ coupon: updated[0] });
  });

  app.delete("/api/admin/coupons/:id", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM coupons WHERE id = ? LIMIT 1`,
      [id],
    );
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    await pool.query<ResultSetHeader>(`DELETE FROM coupons WHERE id = ?`, [id]);
    res.json({ ok: true });
  });

  // ── PUBLIC: validate + preview coupon discount ──────────────────────────────
  app.post("/api/validate-coupon", async (req, res) => {
    const { code, package_id, amount_cents } = req.body || {};
    if (!code) return res.status(400).json({ error: "code required" });

    const upperCode = String(code).toUpperCase().trim();
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM coupons WHERE code = ? AND is_active = 1 LIMIT 1`,
      [upperCode],
    );
    if (rows.length === 0) {
      return res.json({
        valid: false,
        discount_cents: 0,
        final_amount_cents: Number(amount_cents) || 0,
        error: "Invalid or inactive coupon code",
      });
    }
    const c = rows[0];
    const now = new Date();
    if (c.valid_from && new Date(c.valid_from) > now) {
      return res.json({
        valid: false,
        discount_cents: 0,
        final_amount_cents: Number(amount_cents) || 0,
        error: "Coupon is not yet valid",
      });
    }
    if (c.expires_at && new Date(c.expires_at) < now) {
      return res.json({
        valid: false,
        discount_cents: 0,
        final_amount_cents: Number(amount_cents) || 0,
        error: "Coupon has expired",
      });
    }
    if (c.max_uses != null && Number(c.uses_count) >= Number(c.max_uses)) {
      return res.json({
        valid: false,
        discount_cents: 0,
        final_amount_cents: Number(amount_cents) || 0,
        error: "Coupon usage limit reached",
      });
    }
    const amt = Number(amount_cents) || 0;
    if (amt < Number(c.min_amount_cents)) {
      return res.json({
        valid: false,
        discount_cents: 0,
        final_amount_cents: amt,
        error: `Minimum order of $${(Number(c.min_amount_cents) / 100).toFixed(2)} required`,
      });
    }
    if (c.applicable_packages && package_id) {
      let pkgs: number[] = [];
      try {
        pkgs =
          typeof c.applicable_packages === "string"
            ? JSON.parse(c.applicable_packages)
            : c.applicable_packages;
      } catch {}
      if (pkgs.length > 0 && !pkgs.includes(Number(package_id))) {
        return res.json({
          valid: false,
          discount_cents: 0,
          final_amount_cents: amt,
          error: "Coupon not valid for selected package",
        });
      }
    }
    let discountCents = 0;
    if (c.discount_type === "percentage") {
      discountCents = Math.round((amt * Number(c.discount_value)) / 100);
    } else {
      discountCents = Number(c.discount_value);
    }
    discountCents = Math.min(discountCents, amt);
    res.json({
      valid: true,
      coupon: c,
      discount_cents: discountCents,
      final_amount_cents: amt - discountCents,
    });
  });

  app.get("/api/admin/reports", requireSuperAdmin, async (_req, res) => {
    const [revenueByMonth] = await pool.query<RowDataPacket[]>(
      `SELECT DATE_FORMAT(paid_at, '%Y-%m') AS month, SUM(amount_cents) AS revenue_cents, COUNT(*) AS count
       FROM payments WHERE status = 'succeeded' AND paid_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
       GROUP BY month ORDER BY month ASC`,
    );
    const [signupsByMonth] = await pool.query<RowDataPacket[]>(
      `SELECT DATE_FORMAT(created_at, '%Y-%m') AS month, COUNT(*) AS count
       FROM clients WHERE created_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
       GROUP BY month ORDER BY month ASC`,
    );
    const [packageBreakdown] = await pool.query<RowDataPacket[]>(
      `SELECT p.name, COUNT(c.id) AS count
       FROM clients c JOIN packages p ON p.id = c.package_id
       GROUP BY p.id, p.name ORDER BY count DESC`,
    );
    res.json({ revenueByMonth, signupsByMonth, packageBreakdown });
  });

  app.get("/api/admin/settings", requireSuperAdmin, async (_req, res) => {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT setting_key, setting_value, description, updated_at FROM system_settings`,
    );
    res.json({ settings: rows });
  });

  app.post("/api/admin/settings", requireSuperAdmin, async (req, res) => {
    const { setting_key, setting_value } = req.body || {};
    if (!setting_key)
      return res.status(400).json({ error: "setting_key required" });
    await pool.query<ResultSetHeader>(
      `INSERT INTO system_settings (setting_key, setting_value) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
      [setting_key, setting_value || null],
    );
    res.json({ ok: true });
  });

  // ── Section locks ───────────────────────────────────────────────────────────

  // GET /api/admin/section-locks — all sections with lock status (any admin)
  app.get("/api/admin/section-locks", requireAdmin, async (_req, res) => {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, section_key, label, is_locked, lock_reason, updated_by_admin_id, updated_at
       FROM section_locks ORDER BY id ASC`,
    );
    res.json({
      section_locks: rows.map((r) => ({
        ...r,
        is_locked: Boolean(r.is_locked),
      })),
    });
  });

  // PUT /api/admin/section-locks/:key — toggle lock (super admin only)
  app.put(
    "/api/admin/section-locks/:key",
    requireSuperAdmin,
    async (req, res) => {
      const { key } = req.params;
      const { is_locked, lock_reason } = req.body || {};
      const adminId = (req as any).adminId as number;
      if (
        typeof is_locked !== "boolean" &&
        is_locked !== 0 &&
        is_locked !== 1
      ) {
        return res.status(400).json({ error: "is_locked (boolean) required" });
      }
      const lockedVal = is_locked ? 1 : 0;
      const [result] = await pool.query<ResultSetHeader>(
        `UPDATE section_locks
       SET is_locked = ?, lock_reason = ?, updated_by_admin_id = ?
       WHERE section_key = ?`,
        [lockedVal, lock_reason ?? null, adminId, key],
      );
      if (result.affectedRows === 0) {
        return res.status(404).json({ error: "Section not found" });
      }
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id, section_key, label, is_locked, lock_reason, updated_by_admin_id, updated_at
       FROM section_locks WHERE section_key = ?`,
        [key],
      );
      const row = rows[0];
      res.json({ section_lock: { ...row, is_locked: Boolean(row.is_locked) } });
    },
  );

  app.get("/api/admin/admins", requireAdmin, async (req, res) => {
    const search = ((req.query.search as string) || "").trim();
    const role = (req.query.role as string) || "";
    const conditions: string[] = [];
    const params: any[] = [];
    if (search) {
      conditions.push(
        "(email LIKE ? OR first_name LIKE ? OR last_name LIKE ?)",
      );
      const like = `%${search}%`;
      params.push(like, like, like);
    }
    if (role) {
      conditions.push("role = ?");
      params.push(role);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, email, first_name, last_name, phone, role, status, last_login_at, created_at FROM admins ${where} ORDER BY created_at DESC`,
      params,
    );
    res.json({ admins: rows });
  });

  app.post(
    "/api/admin/admins",
    requireAdmin,
    async (req: AuthedRequest, res) => {
      const [me] = await pool.query<RowDataPacket[]>(
        `SELECT role FROM admins WHERE id = ? LIMIT 1`,
        [req.auth!.id],
      );
      if (me[0]?.role !== "super_admin")
        return res.status(403).json({ error: "Forbidden" });
      const { email, first_name, last_name, phone, role } = req.body || {};
      if (!email || !first_name || !last_name)
        return res.status(400).json({ error: "Missing fields" });
      const [r] = await pool.query<ResultSetHeader>(
        `INSERT INTO admins (email, first_name, last_name, phone, role) VALUES (?,?,?,?,?)`,
        [
          String(email).toLowerCase(),
          first_name,
          last_name,
          phone || null,
          role || "admin",
        ],
      );
      // Send welcome email (non-blocking)
      const [inviter] = await pool.query<RowDataPacket[]>(
        `SELECT first_name, last_name FROM admins WHERE id = ? LIMIT 1`,
        [req.auth!.id],
      );
      const inviterName = inviter[0]
        ? `${inviter[0].first_name} ${inviter[0].last_name}`
        : "The Optimum Credit team";
      const welcomeTpl = tplAdminWelcome({
        firstName: first_name,
        lastName: last_name,
        email: String(email).toLowerCase(),
        role: role || "admin",
        loginUrl: `${APP_URL}/admin/login`,
        invitedByName: inviterName,
      });
      sendEmail({
        to: String(email).toLowerCase(),
        subject: welcomeTpl.subject,
        html: welcomeTpl.html,
      }).catch((err) => console.error("[admin-welcome-email]:", err));
      res.json({ id: r.insertId });
    },
  );

  app.put(
    "/api/admin/admins/:id",
    requireAdmin,
    async (req: AuthedRequest, res) => {
      const [me] = await pool.query<RowDataPacket[]>(
        `SELECT role FROM admins WHERE id = ? LIMIT 1`,
        [req.auth!.id],
      );
      if (me[0]?.role !== "super_admin")
        return res.status(403).json({ error: "Forbidden" });
      const targetId = Number(req.params.id);
      const { first_name, last_name, phone, role, status } = req.body || {};
      await pool.query(
        `UPDATE admins SET first_name=COALESCE(?,first_name), last_name=COALESCE(?,last_name), phone=COALESCE(?,phone), role=COALESCE(?,role), status=COALESCE(?,status) WHERE id=?`,
        [
          first_name || null,
          last_name || null,
          phone || null,
          role || null,
          status || null,
          targetId,
        ],
      );
      res.json({ ok: true });
    },
  );

  app.delete(
    "/api/admin/admins/:id",
    requireAdmin,
    async (req: AuthedRequest, res) => {
      const [me] = await pool.query<RowDataPacket[]>(
        `SELECT role FROM admins WHERE id = ? LIMIT 1`,
        [req.auth!.id],
      );
      if (me[0]?.role !== "super_admin")
        return res.status(403).json({ error: "Forbidden" });
      const targetId = Number(req.params.id);
      if (targetId === req.auth!.id)
        return res.status(400).json({ error: "Cannot delete yourself" });
      await pool.query(`DELETE FROM admins WHERE id = ?`, [targetId]);
      res.json({ ok: true });
    },
  );

  // ============================================================
  // WEBHOOKS — Twilio inbound SMS / voice
  // ============================================================
  app.post("/api/webhooks/twilio/sms", async (req, res) => {
    const from = String(req.body?.From || "");
    const to = String(req.body?.To || "");
    const body = String(req.body?.Body || "");
    const sid = String(req.body?.MessageSid || "");

    if (!from || !body) {
      res.set("Content-Type", "text/xml");
      return res.send("<Response/>");
    }

    const [crows] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM clients WHERE phone = ? OR phone = ? LIMIT 1`,
      [from, from.replace(/^\+1/, "")],
    );
    if (crows.length === 0) {
      console.log("Inbound SMS from unknown phone:", from);
      res.set("Content-Type", "text/xml");
      return res.send("<Response/>");
    }
    const clientId = crows[0].id as number;

    let conversationId: number;
    const [conv] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM conversations WHERE client_id = ? AND channel = 'sms' LIMIT 1`,
      [clientId],
    );
    if (conv.length > 0) {
      conversationId = conv[0].id as number;
    } else {
      const [r] = await pool.query<ResultSetHeader>(
        `INSERT INTO conversations (client_id, channel, status) VALUES (?, 'sms', 'open')`,
        [clientId],
      );
      conversationId = r.insertId;
    }

    await pool.query<ResultSetHeader>(
      `INSERT INTO conversation_messages (conversation_id, direction, channel, body, from_address, to_address, provider_message_id) VALUES (?, 'inbound', 'sms', ?, ?, ?, ?)`,
      [conversationId, body, from, to, sid],
    );
    await pool.query<ResultSetHeader>(
      `UPDATE conversations SET last_message_at = NOW(), last_message_preview = ?, unread_count = unread_count + 1 WHERE id = ?`,
      [body.slice(0, 200), conversationId],
    );

    res.set("Content-Type", "text/xml");
    res.send("<Response/>");
  });

  app.post("/api/webhooks/twilio/voice", async (_req, res) => {
    res.set("Content-Type", "text/xml");
    res.send(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice">Thank you for calling Optimum Credit Repair. Please leave a message after the tone.</Say><Record maxLength="120"/></Response>`,
    );
  });

  // ============================================================
  // REMINDER FLOWS
  // ============================================================

  // ── List all flows ────────────────────────────────────────────────────────
  app.get("/api/admin/reminder-flows", requireAdmin, async (_req, res) => {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT rf.id, rf.name, rf.description, rf.trigger_event, rf.is_active, rf.created_at, rf.updated_at,
              COUNT(rfs.id) AS step_count
       FROM reminder_flows rf
       LEFT JOIN reminder_flow_steps rfs ON rfs.flow_id = rf.id
       GROUP BY rf.id
       ORDER BY FIELD(rf.trigger_event,
         'payment_confirmed','docs_ready',
         'round_1_complete','round_2_complete','round_3_complete',
         'round_4_complete','round_5_complete','completed')`,
    );
    res.json({ flows: rows });
  });

  // ── Get single flow with steps + recent executions ────────────────────────
  app.get("/api/admin/reminder-flows/:id", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const [flowRows] = await pool.query<RowDataPacket[]>(
      `SELECT id, name, description, trigger_event, is_active, created_at, updated_at FROM reminder_flows WHERE id = ? LIMIT 1`,
      [id],
    );
    if (flowRows.length === 0)
      return res.status(404).json({ error: "Not found" });

    const [steps] = await pool.query<RowDataPacket[]>(
      `SELECT id, flow_id, step_order, step_type, delay_days, label, subject, body, template_slug, created_at, updated_at
       FROM reminder_flow_steps WHERE flow_id = ? ORDER BY step_order ASC`,
      [id],
    );
    const [executions] = await pool.query<RowDataPacket[]>(
      `SELECT rfe.id, rfe.flow_id, rfe.client_id, rfe.triggered_at, rfe.status,
              rfe.steps_executed, rfe.steps_scheduled, rfe.error_message,
              CONCAT(c.first_name, ' ', c.last_name) AS client_name, c.email AS client_email,
              (SELECT COUNT(*) FROM reminder_flow_steps rfs2 WHERE rfs2.flow_id = rfe.flow_id) AS total_steps,
              (SELECT nq.subject FROM notification_queue nq
               WHERE nq.client_id = rfe.client_id AND nq.status = 'pending'
               AND nq.scheduled_for > rfe.triggered_at
               ORDER BY nq.scheduled_for ASC LIMIT 1) AS next_step_label,
              (SELECT nq.scheduled_for FROM notification_queue nq
               WHERE nq.client_id = rfe.client_id AND nq.status = 'pending'
               AND nq.scheduled_for > rfe.triggered_at
               ORDER BY nq.scheduled_for ASC LIMIT 1) AS next_step_scheduled_for
       FROM reminder_flow_executions rfe
       JOIN clients c ON c.id = rfe.client_id
       WHERE rfe.flow_id = ?
       ORDER BY rfe.triggered_at DESC LIMIT 50`,
      [id],
    );

    res.json({ flow: { ...flowRows[0], steps }, executions });
  });

  // ── Create flow ───────────────────────────────────────────────────────────
  app.post("/api/admin/reminder-flows", requireAdmin, async (req, res) => {
    const { name, description, trigger_event } = req.body || {};
    if (!name || !trigger_event)
      return res.status(400).json({ error: "name and trigger_event required" });
    const allowed = [
      "payment_confirmed",
      "docs_ready",
      "round_1_complete",
      "round_2_complete",
      "round_3_complete",
      "round_4_complete",
      "round_5_complete",
      "completed",
    ];
    if (!allowed.includes(trigger_event))
      return res.status(400).json({ error: "Invalid trigger_event" });
    const [r] = await pool.query<ResultSetHeader>(
      `INSERT INTO reminder_flows (name, description, trigger_event) VALUES (?, ?, ?)`,
      [name, description || null, trigger_event],
    );
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, name, description, trigger_event, is_active, created_at, updated_at FROM reminder_flows WHERE id = ? LIMIT 1`,
      [r.insertId],
    );
    res.status(201).json({ flow: rows[0] });
  });

  // ── Update flow ───────────────────────────────────────────────────────────
  app.put("/api/admin/reminder-flows/:id", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const { name, description, is_active } = req.body || {};
    const updates: string[] = [];
    const args: any[] = [];
    if (name != null) {
      updates.push("name = ?");
      args.push(String(name).trim());
    }
    if (description !== undefined) {
      updates.push("description = ?");
      args.push(description || null);
    }
    if (is_active !== undefined) {
      updates.push("is_active = ?");
      args.push(is_active ? 1 : 0);
    }
    if (updates.length === 0)
      return res.status(400).json({ error: "Nothing to update" });
    args.push(id);
    await pool.query<ResultSetHeader>(
      `UPDATE reminder_flows SET ${updates.join(", ")} WHERE id = ?`,
      args,
    );
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, name, description, trigger_event, is_active, created_at, updated_at FROM reminder_flows WHERE id = ? LIMIT 1`,
      [id],
    );
    res.json({ flow: rows[0] });
  });

  // ── Toggle active ─────────────────────────────────────────────────────────
  app.post(
    "/api/admin/reminder-flows/:id/toggle",
    requireAdmin,
    async (req, res) => {
      const id = Number(req.params.id);
      await pool.query<ResultSetHeader>(
        `UPDATE reminder_flows SET is_active = NOT is_active WHERE id = ?`,
        [id],
      );
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id, is_active FROM reminder_flows WHERE id = ? LIMIT 1`,
        [id],
      );
      res.json({ id, is_active: rows[0]?.is_active ?? 0 });
    },
  );

  // ── Delete flow ───────────────────────────────────────────────────────────
  app.delete(
    "/api/admin/reminder-flows/:id",
    requireAdmin,
    async (req, res) => {
      const id = Number(req.params.id);
      await pool.query<ResultSetHeader>(
        `DELETE FROM reminder_flows WHERE id = ?`,
        [id],
      );
      res.json({ ok: true });
    },
  );

  // ── Add step ──────────────────────────────────────────────────────────────
  app.post(
    "/api/admin/reminder-flows/:id/steps",
    requireAdmin,
    async (req, res) => {
      const flowId = Number(req.params.id);
      const { step_type, delay_days, label, subject, body, template_slug } =
        req.body || {};
      if (!step_type)
        return res.status(400).json({ error: "step_type required" });
      const [maxOrder] = await pool.query<RowDataPacket[]>(
        `SELECT COALESCE(MAX(step_order), 0) AS max_order FROM reminder_flow_steps WHERE flow_id = ?`,
        [flowId],
      );
      const nextOrder = ((maxOrder[0]?.max_order as number) ?? 0) + 1;
      const [r] = await pool.query<ResultSetHeader>(
        `INSERT INTO reminder_flow_steps (flow_id, step_order, step_type, delay_days, label, subject, body, template_slug) VALUES (?,?,?,?,?,?,?,?)`,
        [
          flowId,
          nextOrder,
          step_type,
          delay_days ?? 0,
          label || null,
          subject || null,
          body || null,
          template_slug || null,
        ],
      );
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT * FROM reminder_flow_steps WHERE id = ? LIMIT 1`,
        [r.insertId],
      );
      res.status(201).json({ step: rows[0] });
    },
  );

  // ── Update step ───────────────────────────────────────────────────────────
  app.put(
    "/api/admin/reminder-flows/:id/steps/:stepId",
    requireAdmin,
    async (req, res) => {
      const flowId = Number(req.params.id);
      const stepId = Number(req.params.stepId);
      const {
        step_type,
        delay_days,
        label,
        subject,
        body,
        template_slug,
        step_order,
      } = req.body || {};
      const updates: string[] = [];
      const args: any[] = [];
      if (step_type != null) {
        updates.push("step_type = ?");
        args.push(step_type);
      }
      if (delay_days !== undefined) {
        updates.push("delay_days = ?");
        args.push(Number(delay_days));
      }
      if (label !== undefined) {
        updates.push("label = ?");
        args.push(label || null);
      }
      if (subject !== undefined) {
        updates.push("subject = ?");
        args.push(subject || null);
      }
      if (body !== undefined) {
        updates.push("body = ?");
        args.push(body || null);
      }
      if (template_slug !== undefined) {
        updates.push("template_slug = ?");
        args.push(template_slug || null);
      }
      if (step_order !== undefined) {
        updates.push("step_order = ?");
        args.push(Number(step_order));
      }
      if (updates.length === 0)
        return res.status(400).json({ error: "Nothing to update" });
      args.push(stepId, flowId);
      await pool.query<ResultSetHeader>(
        `UPDATE reminder_flow_steps SET ${updates.join(", ")} WHERE id = ? AND flow_id = ?`,
        args,
      );
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT * FROM reminder_flow_steps WHERE id = ? LIMIT 1`,
        [stepId],
      );
      res.json({ step: rows[0] });
    },
  );

  // ── Delete step ───────────────────────────────────────────────────────────
  app.delete(
    "/api/admin/reminder-flows/:id/steps/:stepId",
    requireAdmin,
    async (req, res) => {
      const flowId = Number(req.params.id);
      const stepId = Number(req.params.stepId);
      await pool.query<ResultSetHeader>(
        `DELETE FROM reminder_flow_steps WHERE id = ? AND flow_id = ?`,
        [stepId, flowId],
      );
      res.json({ ok: true });
    },
  );

  // ── Manual trigger (fire flow for a specific client) ─────────────────────
  app.post(
    "/api/admin/reminder-flows/:id/trigger",
    requireAdmin,
    async (req, res) => {
      const flowId = Number(req.params.id);
      const { client_id } = req.body || {};
      if (!client_id)
        return res.status(400).json({ error: "client_id required" });

      const [flowRows] = await pool.query<RowDataPacket[]>(
        `SELECT trigger_event FROM reminder_flows WHERE id = ? LIMIT 1`,
        [flowId],
      );
      if (flowRows.length === 0)
        return res.status(404).json({ error: "Flow not found" });

      await triggerReminderFlow(
        flowRows[0].trigger_event as string,
        Number(client_id),
      );
      res.json({ ok: true });
    },
  );

  // ── List available email templates (for step editor) ─────────────────────
  app.get(
    "/api/admin/reminder-flows/meta/templates",
    requireAdmin,
    async (_req, res) => {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT slug, name, subject FROM communication_templates WHERE channel = 'email' AND slug LIKE 'flow_%' ORDER BY name ASC`,
      );
      res.json({ templates: rows });
    },
  );

  // ── List executions across all flows ─────────────────────────────────────
  app.get(
    "/api/admin/reminder-flows/meta/executions",
    requireAdmin,
    async (_req, res) => {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT rfe.id, rfe.flow_id, rfe.client_id, rfe.triggered_at, rfe.status,
              rfe.steps_executed, rfe.steps_scheduled, rfe.error_message,
              rf.name AS flow_name, rf.trigger_event,
              CONCAT(c.first_name, ' ', c.last_name) AS client_name, c.email AS client_email,
              (SELECT COUNT(*) FROM reminder_flow_steps rfs2 WHERE rfs2.flow_id = rfe.flow_id) AS total_steps,
              (SELECT nq.subject FROM notification_queue nq
               WHERE nq.client_id = rfe.client_id AND nq.status = 'pending'
               AND nq.scheduled_for > rfe.triggered_at
               ORDER BY nq.scheduled_for ASC LIMIT 1) AS next_step_label,
              (SELECT nq.scheduled_for FROM notification_queue nq
               WHERE nq.client_id = rfe.client_id AND nq.status = 'pending'
               AND nq.scheduled_for > rfe.triggered_at
               ORDER BY nq.scheduled_for ASC LIMIT 1) AS next_step_scheduled_for
       FROM reminder_flow_executions rfe
       JOIN reminder_flows rf ON rf.id = rfe.flow_id
       JOIN clients c ON c.id = rfe.client_id
       ORDER BY rfe.triggered_at DESC LIMIT 100`,
      );
      res.json({ executions: rows });
    },
  );

  // ── Cron: process notification queue ────────────────────────────────────
  // Called by a cPanel cron job:
  //   curl -s -X POST https://yourdomain.com/api/cron/process-queue \
  //        -H "x-cron-secret: YOUR_CRON_SECRET"
  app.post("/api/cron/process-queue", async (req, res) => {
    const secret = process.env.CRON_SECRET;
    if (!secret) {
      return res
        .status(503)
        .json({ error: "CRON_SECRET not configured on server" });
    }
    const provided = req.headers["x-cron-secret"] as string | undefined;
    if (!provided || provided !== secret) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const batchSize = 50; // max emails per run
    const maxAttempts = 3;

    // Atomically claim a batch by flipping status to 'processing'.
    // This prevents duplicate sends if two cron runs overlap.
    await pool.query<ResultSetHeader>(
      `UPDATE notification_queue
       SET status = 'processing'
       WHERE status = 'pending'
         AND scheduled_for <= NOW()
         AND attempts < ?
       ORDER BY scheduled_for ASC
       LIMIT ?`,
      [maxAttempts, batchSize],
    );

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, client_id, channel, to_address, subject, body, attempts
       FROM notification_queue
       WHERE status = 'processing'
       ORDER BY scheduled_for ASC
       LIMIT ?`,
      [batchSize],
    );

    let sent = 0;
    let failed = 0;

    for (const row of rows as RowDataPacket[]) {
      const qid = row.id as number;
      try {
        if (row.channel === "email") {
          await sendEmail({
            to: row.to_address as string,
            subject: row.subject as string,
            html: row.body as string,
          });
          await pool.query<ResultSetHeader>(
            `UPDATE notification_queue SET status='sent', sent_at=NOW(), attempts=attempts+1 WHERE id=?`,
            [qid],
          );
          sent++;
        } else {
          // in_app / sms — mark sent (SMS not yet wired)
          await pool.query<ResultSetHeader>(
            `UPDATE notification_queue SET status='sent', sent_at=NOW(), attempts=attempts+1 WHERE id=?`,
            [qid],
          );
          sent++;
        }
      } catch (e: any) {
        const newAttempts = (row.attempts as number) + 1;
        const newStatus = newAttempts >= maxAttempts ? "failed" : "pending";
        await pool.query<ResultSetHeader>(
          `UPDATE notification_queue SET status=?, attempts=?, error_message=? WHERE id=?`,
          [newStatus, newAttempts, e?.message ?? String(e), qid],
        );
        failed++;
      }
    }

    res.json({ ok: true, processed: rows.length, sent, failed });
  });

  // ── Global JSON error handler (must be last use()) ───────────────────────
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = typeof err?.status === "number" ? err.status : 500;
    const message =
      process.env.NODE_ENV === "production"
        ? "An unexpected error occurred."
        : (err?.message ?? String(err));
    console.error(`[Express error handler] ${status}:`, err?.message ?? err);
    res.status(status).json({ error: message });
  });

  return app;
}

// ============================================================================
// EXPORTS — Vercel serverless + dev server
// ============================================================================

let app: ReturnType<typeof buildApp>;
try {
  app = buildApp();
} catch (initErr: any) {
  console.error(
    "[API init] Fatal error during startup:",
    initErr?.message ?? initErr,
  );
  // Serve a JSON 503 for every request when the app fails to initialise
  app = express() as any;
  (app as any).use((_req: Request, res: Response) => {
    res.status(503).json({
      error:
        "Service unavailable — server failed to initialise. Check environment variables.",
    });
  });
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  return app(req as any, res as any);
}

export function createServer() {
  return buildApp();
}
