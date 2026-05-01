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
import Stripe from "stripe";

// ============================================================================
// ENV VALIDATION
// ============================================================================

if (
  !process.env.DB_HOST ||
  !process.env.DB_USER ||
  !process.env.DB_PASSWORD ||
  !process.env.DB_NAME
) {
  throw new Error(
    "Database environment variables are required: DB_HOST, DB_USER, DB_PASSWORD, DB_NAME",
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
const UPLOADS_DIR =
  process.env.UPLOADS_DIR || path.join(process.cwd(), "uploads");

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
});

// ============================================================================
// EXTERNAL CLIENTS (Resend / Twilio / Stripe) — all with graceful fallback
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

let stripeClient: Stripe | null = null;
if (process.env.STRIPE_SECRET_KEY) {
  stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: "2024-11-20.acacia" as any,
  });
  console.log("✅ Stripe initialized");
} else {
  console.warn("⚠️  STRIPE_SECRET_KEY not set — payments will use mock mode");
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

async function createOnboardingToken(clientId: number): Promise<string> {
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = sha256(rawToken);
  const expiresAt = new Date(
    Date.now() + ONBOARDING_TOKEN_TTL_HOURS * 60 * 60 * 1000,
  );
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
      <tr><td style="background:linear-gradient(135deg,#1e40ff 0%,#0b2bd6 100%);padding:28px 32px;color:#fff;">
        <table width="100%"><tr>
          <td style="font-size:20px;font-weight:800;letter-spacing:-0.01em;">Optimum Credit</td>
          <td align="right" style="font-size:12px;opacity:.85;">Credit Repair, Done Right</td>
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
  <tr><td style="border-radius:10px;background:#1e40ff;">
    <a href="${url}" style="display:inline-block;padding:14px 28px;color:#fff;text-decoration:none;font-weight:700;font-size:15px;border-radius:10px;">${escapeHtml(label)}</a>
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
    <div style="margin:20px 0;padding:20px;background:#eff6ff;border-radius:12px;border:1px solid #dbeafe;">
      <div style="font-size:13px;color:#1e40af;text-transform:uppercase;letter-spacing:0.05em;font-weight:700;">Your Package</div>
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
// STRIPE HELPERS
// ============================================================================

async function createPaymentIntent(input: {
  amountCents: number;
  currency?: string;
  customerEmail: string;
  metadata?: Record<string, string>;
}) {
  if (!stripeClient) {
    return {
      id: `pi_mock_${Date.now()}`,
      client_secret: `pi_mock_${Date.now()}_secret_mock`,
      amount: input.amountCents,
      currency: input.currency || "usd",
      mock: true as const,
    };
  }
  const intent = await stripeClient.paymentIntents.create({
    amount: input.amountCents,
    currency: input.currency || "usd",
    receipt_email: input.customerEmail,
    metadata: input.metadata,
    automatic_payment_methods: { enabled: true },
  });
  return {
    id: intent.id,
    client_secret: intent.client_secret!,
    amount: intent.amount,
    currency: intent.currency,
    mock: false as const,
  };
}

// ============================================================================
// SHARED — payment success processing
// ============================================================================

async function markPaymentSucceeded(clientId: number, paymentIntentId: string) {
  await pool.query<ResultSetHeader>(
    `UPDATE payments SET status='succeeded', paid_at=NOW() WHERE stripe_payment_intent_id = ? AND status <> 'succeeded'`,
    [paymentIntentId],
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

  const rawToken = await createOnboardingToken(clientId).catch(() => null);
  const onboardingUrl = rawToken
    ? `${APP_URL}/portal/onboarding/${rawToken}`
    : `${APP_URL}/portal/login`;
  const tpl = tplWelcomePayment({
    firstName: r.first_name,
    packageName: r.package_name || "Credit Repair",
    packagePrice: `$${(Number(r.price_cents) / 100).toFixed(2)}`,
    onboardingUrl,
  });
  await sendEmail({ to: r.email, subject: tpl.subject, html: tpl.html }).catch(
    (e) => console.error("welcome email failed", e),
  );

  if (r.phone) {
    const messages = [
      {
        delayMs: 0,
        body: `Hi ${r.first_name}, welcome to Optimum Credit! Please upload your documents to get started: ${APP_URL}/portal/login`,
      },
      {
        delayMs: 24 * 60 * 60 * 1000,
        body: `Reminder: We are waiting for your documents. Only takes a few minutes: ${APP_URL}/portal/login`,
      },
      {
        delayMs: 2 * 24 * 60 * 60 * 1000,
        body: `Final reminder: Please upload your documents today so we can begin: ${APP_URL}/portal/login`,
      },
    ];
    for (const m of messages) {
      const scheduledFor = new Date(Date.now() + m.delayMs);
      await pool.query<ResultSetHeader>(
        `INSERT INTO notification_queue (client_id, channel, to_address, body, scheduled_for) VALUES (?, 'sms', ?, ?, ?)`,
        [clientId, r.phone, m.body, scheduledFor],
      );
    }
    try {
      await sendSms({ to: r.phone, body: messages[0].body });
      await pool.query<ResultSetHeader>(
        `UPDATE notification_queue SET sent_at = NOW(), status = 'sent'
         WHERE client_id = ? AND channel = 'sms' AND scheduled_for <= NOW() AND status = 'pending'
         ORDER BY id ASC LIMIT 1`,
        [clientId],
      );
    } catch (e) {
      console.error("SMS send failed:", e);
    }
  }

  await pool.query<ResultSetHeader>(
    `INSERT INTO audit_logs (actor_type, actor_id, action, entity_type, entity_id) VALUES ('system', NULL, 'payment.succeeded', 'client', ?)`,
    [clientId],
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
  // Ensure uploads directory exists on startup
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
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
  // PUBLIC — packages + registration + Stripe
  // ============================================================
  app.get("/api/packages", async (_req, res) => {
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT id, slug, name, subtitle, description, price_cents, duration_months, features_json, sort_order FROM packages WHERE is_active = 1 ORDER BY sort_order ASC",
    );
    res.json({ packages: rows });
  });

  app.post("/api/registration", async (req, res) => {
    const b = req.body || {};
    const required = [
      "firstName",
      "lastName",
      "email",
      "addressLine1",
      "city",
      "state",
      "zip",
      "ssnLast4",
      "packageSlug",
    ];
    for (const f of required) {
      if (!b[f] || String(b[f]).trim().length === 0) {
        return res.status(400).json({ error: `Missing field: ${f}` });
      }
    }
    const email = String(b.email).trim().toLowerCase();
    const ssn = String(b.ssnLast4).replace(/\D/g, "").slice(-4);
    if (ssn.length !== 4) {
      return res.status(400).json({ error: "SSN last 4 must be 4 digits" });
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

    const [existing] = await pool.query<RowDataPacket[]>(
      "SELECT id, status FROM clients WHERE email = ? LIMIT 1",
      [email],
    );

    let clientId: number;
    if (existing.length > 0) {
      if (existing[0].status !== "pending_payment") {
        return res.status(409).json({
          error: "An account with this email already exists. Please sign in.",
        });
      }
      clientId = existing[0].id as number;
      await pool.query<ResultSetHeader>(
        `UPDATE clients
         SET first_name=?, last_name=?, phone=?, address_line1=?, address_line2=?, city=?, state=?, zip=?, ssn_last4=?,
             package_id=?, affiliate_id=COALESCE(affiliate_id, ?)
         WHERE id=?`,
        [
          b.firstName,
          b.lastName,
          b.phone || null,
          b.addressLine1,
          b.addressLine2 || null,
          b.city,
          b.state,
          b.zip,
          ssn,
          pkg.id,
          affiliateId,
          clientId,
        ],
      );
    } else {
      const [ins] = await pool.query<ResultSetHeader>(
        `INSERT INTO clients
          (email, first_name, last_name, phone, address_line1, address_line2, city, state, zip, ssn_last4,
           package_id, affiliate_id, pipeline_stage, status)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'new_client', 'pending_payment')`,
        [
          email,
          b.firstName,
          b.lastName,
          b.phone || null,
          b.addressLine1,
          b.addressLine2 || null,
          b.city,
          b.state,
          b.zip,
          ssn,
          pkg.id,
          affiliateId,
        ],
      );
      clientId = ins.insertId;
    }

    const intent = await createPaymentIntent({
      amountCents: pkg.price_cents as number,
      customerEmail: email,
      metadata: { client_id: String(clientId), package_id: String(pkg.id) },
    });

    await pool.query<ResultSetHeader>(
      `INSERT INTO payments (client_id, package_id, amount_cents, status, provider, stripe_payment_intent_id, metadata_json)
       VALUES (?,?,?, 'pending', 'stripe', ?, ?)
       ON DUPLICATE KEY UPDATE status = VALUES(status)`,
      [
        clientId,
        pkg.id,
        pkg.price_cents,
        intent.id,
        JSON.stringify({ mock: intent.mock }),
      ],
    );

    res.json({
      clientId,
      packageId: pkg.id,
      packageName: pkg.name,
      amountCents: pkg.price_cents,
      paymentIntentClientSecret: intent.client_secret,
      isMock: intent.mock,
    });
  });

  app.post("/api/registration/confirm-mock", async (req, res) => {
    const { clientId, paymentIntentId } = req.body || {};
    if (!clientId || !paymentIntentId) {
      return res.status(400).json({ error: "Missing fields" });
    }
    if (!String(paymentIntentId).startsWith("pi_mock_")) {
      return res.status(400).json({ error: "Not a mock intent" });
    }
    await markPaymentSucceeded(Number(clientId), String(paymentIntentId));
    res.json({ ok: true });
  });

  // Called by the frontend immediately after stripe.confirmCardPayment succeeds.
  // Ensures the DB is updated and welcome email is sent even if the webhook
  // is delayed or not configured (e.g. local dev without stripe listen).
  // markPaymentSucceeded is idempotent — the webhook calling it again is safe.
  app.post("/api/registration/confirm-payment", async (req, res) => {
    const { clientId, paymentIntentId } = req.body || {};
    if (!clientId || !paymentIntentId)
      return res.status(400).json({ error: "Missing fields" });

    if (!stripeClient)
      return res.status(503).json({ error: "Stripe not configured" });

    let intent: Stripe.PaymentIntent;
    try {
      intent = await stripeClient.paymentIntents.retrieve(
        String(paymentIntentId),
      );
    } catch (e: any) {
      return res
        .status(400)
        .json({ error: "Could not retrieve payment intent" });
    }

    if (intent.status !== "succeeded")
      return res
        .status(400)
        .json({ error: `Payment not succeeded: ${intent.status}` });

    await markPaymentSucceeded(Number(clientId), String(paymentIntentId));
    res.json({ ok: true });
  });

  app.post("/api/stripe/webhook", async (req, res) => {
    if (!stripeClient)
      return res.status(503).json({ error: "Stripe not configured" });
    const sig = req.headers["stripe-signature"] as string | undefined;
    const rawBody = (req as any).rawBody || JSON.stringify(req.body);

    let event: any = null;
    if (process.env.STRIPE_WEBHOOK_SECRET && sig) {
      try {
        event = stripeClient.webhooks.constructEvent(
          rawBody,
          sig,
          process.env.STRIPE_WEBHOOK_SECRET,
        );
      } catch (err) {
        console.error("Stripe webhook signature failed:", err);
        return res.status(400).json({ error: "Invalid signature" });
      }
    } else {
      event = req.body;
    }

    if (event?.type === "payment_intent.succeeded") {
      const pi = event.data.object;
      const clientId = Number(pi.metadata?.client_id);
      if (clientId) await markPaymentSucceeded(clientId, pi.id);
    }
    res.json({ received: true });
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
      `SELECT id, amount_cents, status, paid_at, created_at, stripe_payment_intent_id
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
    requireAdmin,
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
    requireAdmin,
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

  app.get("/api/admin/reports", requireAdmin, async (_req, res) => {
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

  app.get("/api/admin/settings", requireAdmin, async (_req, res) => {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT setting_key, setting_value, description, updated_at FROM system_settings`,
    );
    res.json({ settings: rows });
  });

  app.post("/api/admin/settings", requireAdmin, async (req, res) => {
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

  app.get("/api/admin/admins", requireAdmin, async (_req, res) => {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, email, first_name, last_name, phone, role, status, last_login_at, created_at FROM admins ORDER BY created_at DESC`,
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
      res.json({ id: r.insertId });
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

  return app;
}

// ============================================================================
// EXPORTS — Vercel serverless + dev server
// ============================================================================

const app = buildApp();

export default function handler(req: VercelRequest, res: VercelResponse) {
  return app(req as any, res as any);
}

export function createServer() {
  return buildApp();
}
