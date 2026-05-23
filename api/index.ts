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

// CDN (disruptinglabs.com) file storage
// Files are proxied through Express — the CDN URL is never exposed to the browser.
const CDN_UPLOAD_SECRET = process.env.CDN_UPLOAD_SECRET || "";
const CDN_UPLOAD_URL =
  process.env.CDN_UPLOAD_URL ||
  "https://disruptinglabs.com/data/api/uploadFiles.php";
const CDN_MAIN_FOLDER = process.env.CDN_MAIN_FOLDER || "optimum-credit";

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

// Silently swallow connection-level errors so a dead pooled connection doesn't
// crash the process — mysql2 will discard it and open a fresh one on the next query.
const TRANSIENT_DB_CODES = [
  "ECONNRESET",
  "PROTOCOL_CONNECTION_LOST",
  "ETIMEDOUT",
  "ECONNREFUSED",
];

pool.on("connection", (conn) => {
  conn.on("error", (err: NodeJS.ErrnoException) => {
    if (!TRANSIENT_DB_CODES.includes(err.code ?? "")) throw err;
  });
});

// Pool-level safety net (catches errors not handled at the connection level)
(pool as any).on("error", (err: NodeJS.ErrnoException) => {
  if (!TRANSIENT_DB_CODES.includes(err.code ?? "")) throw err;
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

/**
 * Upload a file buffer to the Disrupting Labs CDN and return the full public URL.
 * The URL is stored as storage_key in the DB and is never sent directly to the browser —
 * all access is proxied through the authenticated Express file-serve endpoints.
 */
async function uploadToCDN(
  buffer: Buffer,
  originalname: string,
  mimetype: string,
  clientId: number | string,
): Promise<string> {
  if (!CDN_UPLOAD_SECRET)
    throw new Error("CDN_UPLOAD_SECRET is not configured");
  const folderId =
    typeof clientId === "string" ? clientId : `client-${clientId}`;
  const formData = new FormData();
  formData.append("main_folder", CDN_MAIN_FOLDER);
  formData.append("id", folderId);
  formData.append(
    "files[]",
    new Blob([new Uint8Array(buffer)], { type: mimetype }),
    originalname,
  );
  const res = await fetch(CDN_UPLOAD_URL, {
    method: "POST",
    headers: { "X-Api-Key": CDN_UPLOAD_SECRET },
    body: formData,
  });
  if (!res.ok) throw new Error(`CDN upload failed: ${res.status}`);
  const data = (await res.json()) as any;
  const uploaded = data?.uploaded?.[0];
  if (!uploaded?.url)
    throw new Error(
      "CDN upload returned no URL: " + (data?.error ?? "unknown"),
    );
  return uploaded.url as string;
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
  lang?: string;
}) {
  const isEs = opts.lang === "es";
  const tagline = isEs
    ? "Reparación de Crédito, Bien Hecha"
    : "Credit Repair, Done Right";
  const footer = isEs
    ? `Recibes este correo porque tienes una cuenta con Optimum Credit Repair.<br/>© ${new Date().getFullYear()} Optimum Credit Repair. Todos los derechos reservados.`
    : `You're receiving this email because you have an account with Optimum Credit Repair.<br/>© ${new Date().getFullYear()} Optimum Credit Repair. All rights reserved.`;
  return `<!doctype html>
<html lang="${isEs ? "es" : "en"}"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>${escapeHtml(opts.title)}</title></head>
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
          <td align="right" style="font-size:12px;color:#C0A06A;font-weight:600;letter-spacing:0.03em;">${tagline}</td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:32px;">${opts.bodyHtml}</td></tr>
      <tr><td style="padding:24px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b;text-align:center;">
        ${footer}
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
  lang?: string;
}) {
  const isEs = opts.lang === "es" && !opts.isAdmin;
  const greeting = opts.firstName
    ? isEs
      ? `Hola ${escapeHtml(opts.firstName)},`
      : `Hi ${escapeHtml(opts.firstName)},`
    : isEs
      ? "Hola,"
      : "Hi,";
  const role = opts.isAdmin
    ? "admin panel"
    : isEs
      ? "portal de clientes"
      : "client portal";
  const body = isEs
    ? `
    <h1 style="margin:0 0 16px;font-size:24px;font-weight:800;color:#0f172a;">Tu código de acceso</h1>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">${greeting} usa el código de verificación a continuación para iniciar sesión en tu ${role}.</p>
    <div style="margin:24px 0;padding:24px;background:#f1f5f9;border-radius:12px;text-align:center;font-family:'SF Mono',Menlo,monospace;font-size:36px;font-weight:800;letter-spacing:8px;color:#0f172a;">${escapeHtml(opts.code)}</div>
    <p style="margin:0;font-size:13px;color:#64748b;">Este código expira en 10 minutos. Si no lo solicitaste, puedes ignorar este correo de forma segura.</p>`
    : `
    <h1 style="margin:0 0 16px;font-size:24px;font-weight:800;color:#0f172a;">Your sign-in code</h1>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">${greeting} use the verification code below to sign in to your ${role}.</p>
    <div style="margin:24px 0;padding:24px;background:#f1f5f9;border-radius:12px;text-align:center;font-family:'SF Mono',Menlo,monospace;font-size:36px;font-weight:800;letter-spacing:8px;color:#0f172a;">${escapeHtml(opts.code)}</div>
    <p style="margin:0;font-size:13px;color:#64748b;">This code expires in 10 minutes. If you didn't request this, you can safely ignore this email.</p>`;
  return {
    subject: isEs
      ? `Tu código de Optimum Credit: ${opts.code}`
      : `Your Optimum Credit code: ${opts.code}`,
    html: emailLayout({
      title: isEs ? "Código de acceso" : "Sign-in code",
      preheader: isEs ? `Código: ${opts.code}` : `Code: ${opts.code}`,
      bodyHtml: body,
      lang: opts.lang,
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

const DOC_TYPE_LABELS_ES: Record<string, string> = {
  id_front: "Identificación oficial (frente)",
  id_back: "Identificación oficial (reverso)",
  ssn_card: "Tarjeta de Seguro Social",
  proof_of_address: "Comprobante de domicilio",
  other: "Documento",
};

function tplDocumentRejected(opts: {
  firstName: string;
  docType: string;
  reason: string;
  portalUrl: string;
  lang?: string;
}) {
  const isEs = opts.lang === "es";
  const label = isEs
    ? DOC_TYPE_LABELS_ES[opts.docType] || opts.docType
    : DOC_TYPE_LABELS[opts.docType] || opts.docType;
  const body = isEs
    ? `
    <h1 style="margin:0 0 12px;font-size:24px;font-weight:800;color:#0f172a;">Acción requerida: por favor vuelve a subir tu documento</h1>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Hola ${escapeHtml(opts.firstName)}, revisamos tu <strong>${escapeHtml(label)}</strong> pero no pudimos aceptarlo. Por favor sube una nueva copia desde tu portal.</p>
    <div style="margin:20px 0;padding:16px 20px;background:#fef2f2;border-left:4px solid #ef4444;border-radius:8px;">
      <div style="font-size:13px;font-weight:700;color:#991b1b;">Motivo del rechazo</div>
      <div style="margin-top:6px;font-size:14px;color:#7f1d1d;">${escapeHtml(opts.reason)}</div>
    </div>
    <p style="margin:16px 0;font-size:14px;color:#334155;">Consejos frecuentes: asegúrate de que el documento esté enfocado, no recortado, muestre claramente las cuatro esquinas y sea una copia reciente (no mayor a 3 meses para comprobante de domicilio).</p>
    ${emailButton(opts.portalUrl, "Volver a subir desde mi portal")}
    <p style="margin:16px 0 0;font-size:13px;color:#64748b;">¿Preguntas? Responde a este correo y nuestro equipo te ayudará.</p>`
    : `
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
    subject: isEs
      ? `Optimum Credit: acción requerida — vuelve a subir tu ${label}`
      : `Optimum Credit: action needed — re-upload your ${label}`,
    html: emailLayout({
      title: isEs ? "Nueva subida requerida" : "Re-upload required",
      preheader: isEs
        ? `Necesitamos una nueva copia de tu ${label}.`
        : `We need a new copy of your ${label}.`,
      bodyHtml: body,
      lang: opts.lang,
    }),
  };
}

function tplAllDocsApproved(opts: {
  firstName: string;
  portalUrl: string;
  lang?: string;
}) {
  const isEs = opts.lang === "es";
  const body = isEs
    ? `
    <h1 style="margin:0 0 12px;font-size:24px;font-weight:800;color:#0f172a;">¡Buenas noticias &#127881; — todos tus documentos han sido verificados!</h1>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Hola ${escapeHtml(opts.firstName)}, nuestro equipo ha revisado y aprobado los cuatro documentos de identidad. Tu expediente ha pasado a la siguiente etapa y nuestros especialistas comenzarán a trabajar en tu caso de inmediato.</p>
    <div style="margin:20px 0;padding:16px 20px;background:#f0fdf4;border-left:4px solid #22c55e;border-radius:8px;">
      <div style="font-size:13px;font-weight:700;color:#15803d;">¿Qué sigue?</div>
      <div style="margin-top:6px;font-size:14px;color:#166534;line-height:1.6;">Nuestros especialistas comenzarán a revisar tus reportes de crédito y a preparar cartas de disputa con las principales agencias de crédito. Recibirás una actualización de progreso después de que se complete cada ronda — generalmente dentro de 30&ndash;45 días.</div>
    </div>
    <p style="margin:16px 0;font-size:14px;line-height:1.6;color:#334155;">Puedes seguir tu progreso y ver los informes de cada ronda directamente desde tu portal.</p>
    ${emailButton(opts.portalUrl, "Ver mi portal")}
    <p style="margin:24px 0 0;font-size:13px;color:#64748b;">¿Preguntas? Responde a este correo y nuestro equipo estará feliz de ayudarte.</p>`
    : `
    <h1 style="margin:0 0 12px;font-size:24px;font-weight:800;color:#0f172a;">Great news &#127881; — your documents are all verified!</h1>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Hi ${escapeHtml(opts.firstName)}, our team has reviewed and approved all four of your identity documents. Your file has been moved to the next stage and our specialists will begin working on your case right away.</p>
    <div style="margin:20px 0;padding:16px 20px;background:#f0fdf4;border-left:4px solid #22c55e;border-radius:8px;">
      <div style="font-size:13px;font-weight:700;color:#15803d;">What happens next?</div>
      <div style="margin-top:6px;font-size:14px;color:#166534;line-height:1.6;">Our specialists will start reviewing your credit reports and preparing dispute letters with the major credit bureaus. You'll receive a progress update after each round is completed — usually within 30&ndash;45 days.</div>
    </div>
    <p style="margin:16px 0;font-size:14px;line-height:1.6;color:#334155;">You can track your progress and view round reports directly from your client portal.</p>
    ${emailButton(opts.portalUrl, "View My Portal")}
    <p style="margin:24px 0 0;font-size:13px;color:#64748b;">Questions? Reply to this email and our team will be happy to assist.</p>`;
  return {
    subject: isEs
      ? `Optimum Credit: documentos verificados — ¡comenzamos!`
      : `Optimum Credit: all documents verified — we're getting started!`,
    html: emailLayout({
      title: isEs ? "Documentos Verificados" : "Documents Verified",
      preheader: isEs
        ? "Todos tus documentos han sido aprobados. ¡Manos a la obra!"
        : "All your documents have been approved. We're on it!",
      bodyHtml: body,
      lang: opts.lang,
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
  lang?: string;
}) {
  const isEs = opts.lang === "es";
  const delta =
    opts.scoreBefore != null && opts.scoreAfter != null
      ? opts.scoreAfter - opts.scoreBefore
      : null;
  const body = `
    <h1 style="margin:0 0 12px;font-size:26px;font-weight:800;color:#0f172a;">${isEs ? `Ronda ${opts.roundNumber} completada` : `Round ${opts.roundNumber} is complete`}</h1>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">${isEs ? `Hola ${escapeHtml(opts.firstName)}, aquí está tu actualización de progreso mensual.` : `Hi ${escapeHtml(opts.firstName)}, here's your monthly progress update.`}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0;">
      <tr>
        <td style="padding:16px;background:#f1f5f9;border-radius:12px;text-align:center;width:33%;">
          <div style="font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;">${isEs ? "Elementos eliminados" : "Items Removed"}</div>
          <div style="margin-top:6px;font-size:24px;font-weight:800;color:#16a34a;">${opts.itemsRemoved}</div>
        </td>
        <td style="width:8px;"></td>
        <td style="padding:16px;background:#f1f5f9;border-radius:12px;text-align:center;">
          <div style="font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;">${isEs ? "Cambio de puntaje" : "Score Change"}</div>
          <div style="margin-top:6px;font-size:24px;font-weight:800;color:${delta != null && delta >= 0 ? "#16a34a" : "#0f172a"};">${delta != null ? (delta >= 0 ? "+" : "") + delta : "—"}</div>
        </td>
      </tr>
    </table>
    ${emailButton(opts.portalUrl, isEs ? "Ver informe completo" : "View Full Report")}`;
  return {
    subject: isEs
      ? `Ronda ${opts.roundNumber} completada — tu informe de progreso está listo`
      : `Round ${opts.roundNumber} complete — your progress report is ready`,
    html: emailLayout({
      title: isEs ? "Ronda completada" : "Round complete",
      bodyHtml: body,
      lang: opts.lang,
    }),
  };
}

// ============================================================================
// ROUND PDF REPORT READY EMAIL TEMPLATE
// ============================================================================

/** Attach pdfs[] to each round report row from the round_report_pdfs table. */
async function attachPdfsToReports(
  clientId: number,
  reports: RowDataPacket[],
): Promise<void> {
  if (!reports.length) return;
  const [pdfRows] = await pool.query<RowDataPacket[]>(
    `SELECT id, client_id, round_number, round_report_id, file_name, uploaded_at
     FROM round_report_pdfs WHERE client_id = ? ORDER BY round_number ASC, uploaded_at ASC`,
    [clientId],
  );
  const byRound: Record<number, RowDataPacket[]> = {};
  for (const p of pdfRows) {
    const rn = p.round_number as number;
    if (!byRound[rn]) byRound[rn] = [];
    byRound[rn].push(p);
  }
  for (const r of reports) {
    r.pdfs = byRound[r.round_number as number] ?? [];
  }
}

function tplRoundPdfReady(opts: {
  firstName: string;
  roundNumber: number;
  portalUrl: string;
  lang?: string;
}) {
  const isEs = opts.lang === "es";
  const body = `
    <h1 style="margin:0 0 12px;font-size:26px;font-weight:800;color:#0f172a;">${isEs ? `Tu informe PDF de la Ronda ${opts.roundNumber} ya está disponible` : `Your Round ${opts.roundNumber} PDF report is ready`}</h1>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">${isEs ? `Hola ${escapeHtml(opts.firstName)}, tu asesor de crédito ha subido el informe detallado de la Ronda ${opts.roundNumber}. Puedes descargarlo desde tu portal en cualquier momento.` : `Hi ${escapeHtml(opts.firstName)}, your credit advisor has uploaded the detailed Round ${opts.roundNumber} report. You can download it from your portal at any time.`}</p>
    <div style="margin:20px 0;padding:20px 24px;background:#f1f5f9;border-radius:12px;border-left:4px solid #C0A06A;">
      <div style="font-size:13px;font-weight:700;color:#0f172a;margin-bottom:6px;">📄 ${isEs ? `Informe de la Ronda ${opts.roundNumber}` : `Round ${opts.roundNumber} Report`}</div>
      <div style="font-size:13px;color:#64748b;">${isEs ? "Este informe incluye el desglose completo de los elementos disputados, eliminados y los cambios en tu puntuación crediticia." : "This report includes the complete breakdown of disputed items, removals, and credit score changes for this round."}</div>
    </div>
    ${emailButton(opts.portalUrl, isEs ? "Descargar mi informe" : "Download My Report")}
    <p style="margin:20px 0 0;font-size:13px;color:#94a3b8;">${isEs ? "Si tienes preguntas sobre tu informe, no dudes en contactar a tu asesor a través del portal." : "If you have questions about your report, feel free to contact your advisor through the portal."}</p>`;
  return {
    subject: isEs
      ? `Tu informe PDF de la Ronda ${opts.roundNumber} ya está listo — Optimum Credit`
      : `Round ${opts.roundNumber} PDF report ready — Optimum Credit`,
    html: emailLayout({
      title: isEs ? "Informe PDF listo" : "PDF Report Ready",
      preheader: isEs
        ? `Tu informe de la Ronda ${opts.roundNumber} está disponible para descargar.`
        : `Your Round ${opts.roundNumber} report is available to download.`,
      bodyHtml: body,
      lang: opts.lang,
    }),
  };
}

// ============================================================================
// CLIENT WELCOME EMAIL (manual admin-created client)
// ============================================================================
function tplClientWelcome(opts: {
  firstName: string;
  portalUrl: string;
  lang?: string;
}) {
  const isEs = opts.lang === "es";
  const body = isEs
    ? `<h1 style="margin:0 0 16px;font-size:26px;font-weight:800;color:#0f172a;">¡Bienvenido, ${escapeHtml(opts.firstName)}!</h1>
       <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Tu cuenta con Optimum Credit ha sido creada. Haz clic en el botón de abajo para acceder a tu portal de cliente.</p>
       ${emailButton(opts.portalUrl, "Acceder a mi portal")}
       <p style="margin:24px 0 0;font-size:13px;color:#64748b;">¿Necesitas ayuda? Responde a este correo y te asistiremos.</p>`
    : `<h1 style="margin:0 0 16px;font-size:26px;font-weight:800;color:#0f172a;">Welcome, ${escapeHtml(opts.firstName)}!</h1>
       <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Your Optimum Credit account has been created. Click below to access your client portal.</p>
       ${emailButton(opts.portalUrl, "Access My Portal")}
       <p style="margin:24px 0 0;font-size:13px;color:#64748b;">Need help? Just reply to this email — we're here for you.</p>`;
  return {
    subject: isEs
      ? `Bienvenido a Optimum Credit, ${opts.firstName}`
      : `Welcome to Optimum Credit, ${opts.firstName}`,
    html: emailLayout({
      title: isEs ? "Bienvenido" : "Welcome",
      preheader: isEs ? "Tu cuenta está lista." : "Your account is ready.",
      bodyHtml: body,
      lang: opts.lang,
    }),
  };
}

// ============================================================================
// CASE STARTED EMAIL (manual CR- case)
// ============================================================================
function tplCaseStarted(opts: {
  firstName: string;
  caseNumber: string;
  portalUrl: string;
  lang?: string;
}) {
  const isEs = opts.lang === "es";
  const body = isEs
    ? `<h1 style="margin:0 0 16px;font-size:26px;font-weight:800;color:#0f172a;">¡Tu caso ha sido activado!</h1>
       <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Hola ${escapeHtml(opts.firstName)}, tu expediente de reparación de crédito <strong>${escapeHtml(opts.caseNumber)}</strong> ya está activo.</p>
       <div style="margin:20px 0;padding:16px 20px;background:#f0fdf4;border-left:4px solid #22c55e;border-radius:8px;">
         <div style="font-size:13px;font-weight:700;color:#15803d;">Número de caso: ${escapeHtml(opts.caseNumber)}</div>
       </div>
       ${emailButton(opts.portalUrl, "Ver mi portal")}
       <p style="margin:24px 0 0;font-size:13px;color:#64748b;">¿Preguntas? Responde este correo.</p>`
    : `<h1 style="margin:0 0 16px;font-size:26px;font-weight:800;color:#0f172a;">Your case is now active!</h1>
       <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Hi ${escapeHtml(opts.firstName)}, your credit repair case <strong>${escapeHtml(opts.caseNumber)}</strong> is now active. Our team will begin working on it right away.</p>
       <div style="margin:20px 0;padding:16px 20px;background:#f0fdf4;border-left:4px solid #22c55e;border-radius:8px;">
         <div style="font-size:13px;font-weight:700;color:#15803d;">Case number: ${escapeHtml(opts.caseNumber)}</div>
       </div>
       ${emailButton(opts.portalUrl, "View My Portal")}
       <p style="margin:24px 0 0;font-size:13px;color:#64748b;">Have questions? Just reply to this email.</p>`;
  return {
    subject: isEs
      ? `Tu caso ${opts.caseNumber} está activo — Optimum Credit`
      : `Your case ${opts.caseNumber} is active — Optimum Credit`,
    html: emailLayout({
      title: isEs ? "Caso activado" : "Case started",
      preheader: isEs
        ? `Tu expediente ${opts.caseNumber} está en marcha.`
        : `Your case ${opts.caseNumber} is now underway.`,
      bodyHtml: body,
      lang: opts.lang,
    }),
  };
}

// ============================================================================
// PAYMENT DUE EMAIL (split reminder — used by scheduleSplitReminders)
// ============================================================================
function tplPaymentDue(opts: {
  firstName: string;
  label: string;
  amountFormatted: string;
  dueDateFormatted: string;
  paymentLink: string;
  lang?: string;
}) {
  const isEs = opts.lang === "es";
  const body = isEs
    ? `<h1 style="margin:0 0 16px;font-size:24px;font-weight:800;color:#0f172a;">Recordatorio de pago</h1>
       <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Hola ${escapeHtml(opts.firstName)}, tienes un pago próximo:</p>
       <div style="margin:20px 0;padding:20px 24px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;">
         <div style="font-size:13px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">${escapeHtml(opts.label)}</div>
         <div style="font-size:32px;font-weight:800;color:#0f172a;margin:8px 0;">${escapeHtml(opts.amountFormatted)}</div>
         <div style="font-size:13px;color:#64748b;">Fecha de vencimiento: <strong style="color:#0f172a;">${escapeHtml(opts.dueDateFormatted)}</strong></div>
       </div>
       ${emailButton(opts.paymentLink, "Pagar ahora")}
       <p style="margin:24px 0 0;font-size:13px;color:#64748b;">Si ya realizaste el pago, ignora este mensaje.</p>`
    : `<h1 style="margin:0 0 16px;font-size:24px;font-weight:800;color:#0f172a;">Payment reminder</h1>
       <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Hi ${escapeHtml(opts.firstName)}, you have an upcoming payment:</p>
       <div style="margin:20px 0;padding:20px 24px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;">
         <div style="font-size:13px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">${escapeHtml(opts.label)}</div>
         <div style="font-size:32px;font-weight:800;color:#0f172a;margin:8px 0;">${escapeHtml(opts.amountFormatted)}</div>
         <div style="font-size:13px;color:#64748b;">Due date: <strong style="color:#0f172a;">${escapeHtml(opts.dueDateFormatted)}</strong></div>
       </div>
       ${emailButton(opts.paymentLink, "Pay Now")}
       <p style="margin:24px 0 0;font-size:13px;color:#64748b;">If you've already paid, please disregard this message.</p>`;
  return {
    subject: isEs
      ? `Recordatorio: ${opts.amountFormatted} vence el ${opts.dueDateFormatted}`
      : `Payment reminder: ${opts.amountFormatted} due ${opts.dueDateFormatted}`,
    html: emailLayout({
      title: isEs ? "Recordatorio de pago" : "Payment reminder",
      preheader: isEs
        ? `${opts.amountFormatted} vence el ${opts.dueDateFormatted}.`
        : `${opts.amountFormatted} due on ${opts.dueDateFormatted}.`,
      bodyHtml: body,
      lang: opts.lang,
    }),
  };
}

// ============================================================================
// SPLIT REMINDER SCHEDULER
// Seeds notification_queue for a split based on reminder flow steps.
// delay_days means "days BEFORE due_date" (inverse of pipeline flows).
// ============================================================================
async function scheduleSplitReminders(opts: {
  splitId: number;
  clientId: number;
  flowId: number;
  dueDate: Date;
  paymentLink: string;
  label: string;
  amountFormatted: string;
  dueDateFormatted: string;
}): Promise<void> {
  const [clientRows] = await pool.query<RowDataPacket[]>(
    `SELECT first_name, email, preferred_language FROM clients WHERE id = ? LIMIT 1`,
    [opts.clientId],
  );
  if (clientRows.length === 0) return;
  const client = clientRows[0];
  const lang = (client.preferred_language as string) || "en";

  const [steps] = await pool.query<RowDataPacket[]>(
    `SELECT delay_days FROM reminder_flow_steps WHERE flow_id = ? ORDER BY step_order ASC`,
    [opts.flowId],
  );
  if (steps.length === 0) return;

  const now = new Date();
  for (const step of steps) {
    const delayDays = step.delay_days as number;
    const scheduledFor = new Date(
      opts.dueDate.getTime() - delayDays * 86400000,
    );
    if (scheduledFor <= now) continue; // skip past dates

    const tpl = tplPaymentDue({
      firstName: client.first_name as string,
      label: opts.label,
      amountFormatted: opts.amountFormatted,
      dueDateFormatted: opts.dueDateFormatted,
      paymentLink: opts.paymentLink,
      lang,
    });

    await pool.query<ResultSetHeader>(
      `INSERT INTO notification_queue
         (client_id, channel, to_address, subject, body, scheduled_for, payload_json)
       VALUES (?, 'email', ?, ?, ?, ?, ?)`,
      [
        opts.clientId,
        client.email as string,
        tpl.subject,
        tpl.html,
        scheduledFor,
        JSON.stringify({ split_id: opts.splitId }),
      ],
    );
  }
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

/**
 * Creates client_task_completions rows for all active, auto_assign=1 templates
 * that the client doesn't already have. Safe to call multiple times (INSERT IGNORE).
 */
async function autoAssignTasksForClient(clientId: number): Promise<void> {
  const [templates] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM onboarding_task_templates
     WHERE is_active = 1 AND auto_assign = 1
     ORDER BY sort_order ASC, id ASC`,
  );
  if (templates.length === 0) return;

  const values = templates.map(() => "(?, ?, 'pending')").join(", ");
  const params = templates.flatMap((t) => [clientId, t.id]);

  await pool.query<ResultSetHeader>(
    `INSERT IGNORE INTO client_task_completions (client_id, task_template_id, status)
     VALUES ${values}`,
    params,
  );
}

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

  // Create a credit_repair_cases row if no active case exists for this client
  const [existingCases] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM credit_repair_cases WHERE client_id = ? AND status = 'active' LIMIT 1`,
    [clientId],
  );
  if (existingCases.length === 0) {
    const [pkgRow] = await pool.query<RowDataPacket[]>(
      `SELECT package_id, pipeline_stage FROM clients WHERE id = ? LIMIT 1`,
      [clientId],
    );
    const [caseInsert] = await pool.query<ResultSetHeader>(
      `INSERT INTO credit_repair_cases (case_number, client_id, package_id, pipeline_stage, status)
       VALUES (NULL, ?, ?, COALESCE(?, 'new_client'), 'active')`,
      [
        clientId,
        pkgRow[0]?.package_id ?? null,
        pkgRow[0]?.pipeline_stage ?? "new_client",
      ],
    );
    const newCaseId = caseInsert.insertId;
    await pool.query<ResultSetHeader>(
      `UPDATE credit_repair_cases SET case_number = ? WHERE id = ?`,
      [`CR-${String(newCaseId).padStart(5, "0")}`, newCaseId],
    );
  }

  // Trigger the "payment_confirmed" reminder flow (Day 1/2/3 email sequence)
  triggerReminderFlow("payment_confirmed", clientId).catch((e) =>
    console.error("[flow:payment_confirmed]", e?.message),
  );

  // Auto-assign onboarding tasks to this client
  autoAssignTasksForClient(clientId).catch((e) =>
    console.error("[tasks:auto-assign]", e?.message),
  );

  // Push new client to Credit Repair Cloud (async — don't block payment confirmation)
  crcSyncClient(clientId).catch((e) =>
    console.error("[crc:new-client-sync]", e?.message),
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
    `SELECT first_name, last_name, email, phone, preferred_language FROM clients WHERE id = ? LIMIT 1`,
    [clientId],
  );
  if (clientRows.length === 0) return;
  const client = clientRows[0];
  const lang = (client.preferred_language as string | null) || "en";

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
          // Prefer language-specific template (e.g. flow_new_client_day1_es) when available
          const preferredSlug =
            lang !== "en"
              ? `${step.template_slug}_${lang}`
              : step.template_slug;
          const slugsToTry =
            preferredSlug !== step.template_slug
              ? [preferredSlug, step.template_slug]
              : [step.template_slug];
          for (const slug of slugsToTry) {
            const [tmplRows] = await pool.query<RowDataPacket[]>(
              `SELECT subject, body FROM communication_templates WHERE slug = ? AND is_active = 1 LIMIT 1`,
              [slug],
            );
            if (tmplRows.length > 0) {
              subj = tmplRows[0].subject as string | null;
              bodyHtml = tmplRows[0].body as string | null;
              break;
            }
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
        const btnLabel = lang === "es" ? "Ir a mi portal" : "Go to My Portal";
        const fullHtml = emailLayout({
          title: resolvedSubj,
          bodyHtml: resolvedBody + emailButton(magicLink, btnLabel),
          lang,
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
// CREDIT REPAIR CLOUD (CRC) SERVICE
// ============================================================================

const CRC_BASE_URL = "https://app.creditrepaircloud.com/api";
const crcConfigured = !!(
  process.env.CRC_API_AUTH_KEY && process.env.CRC_SECRET_KEY
);
const crcDryRun =
  process.env.CRC_DRY_RUN === "true" || process.env.NODE_ENV === "test";

if (crcConfigured && !crcDryRun) {
  console.log("✅ Credit Repair Cloud API configured (live mode)");
} else if (crcConfigured && crcDryRun) {
  console.log(
    "✅ Credit Repair Cloud API configured (DRY-RUN — no real calls)",
  );
} else {
  console.warn(
    "⚠️  CRC_API_AUTH_KEY / CRC_SECRET_KEY not set — CRC sync will be skipped",
  );
}

/** Build the XML payload for a CRC lead/client record. */
function buildCrcClientXml(opts: {
  type: string;
  firstname: string;
  lastname: string;
  email: string;
  phone_home?: string | null;
  street_address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  ssno?: string | null;
  birth_date?: string | null;
  memo?: string | null;
  id?: string | null; // required for updateRecord
}): string {
  const tag = (name: string, value: string | null | undefined) =>
    value != null && value !== "" ? `    <${name}>${value}</${name}>` : "";

  const fields = [
    opts.id != null ? `    <id>${opts.id}</id>` : "",
    `    <type>${opts.type}</type>`,
    `    <firstname>${opts.firstname}</firstname>`,
    `    <lastname>${opts.lastname}</lastname>`,
    `    <email>${opts.email}</email>`,
    tag("phone_home", opts.phone_home),
    tag("street_address", opts.street_address),
    tag("city", opts.city),
    tag("state", opts.state),
    tag("zip", opts.zip),
    tag("ssno", opts.ssno),
    tag("birth_date", opts.birth_date),
    tag("memo", opts.memo),
  ]
    .filter(Boolean)
    .join("\n");

  return `<crcloud>\n  <lead>\n${fields}\n  </lead>\n</crcloud>`;
}

/** Map our pipeline_stage to a CRC client status. */
function mapStageToCrcType(stage: string): string {
  if (stage === "new_client") return "Client";
  if (stage === "completed") return "Client";
  if (stage === "cancelled") return "Inactive";
  return "Client"; // active rounds remain Client status
}

/** POST to CRC API with XML data. Returns parsed JSON response body. */
async function crcPost(
  path: string,
  xmlData: string,
): Promise<{ success: boolean; crcId?: string; raw?: any; dryRun?: boolean }> {
  if (!crcConfigured || crcDryRun) {
    const mode = !crcConfigured ? "no-keys" : "dry-run";
    console.log(`[crc:${mode}]`, path, "\n" + xmlData);
    // Return a fake CRC ID so local testing exercises the full code path
    return { success: true, crcId: undefined, dryRun: true };
  }

  const url = `${CRC_BASE_URL}${path}?apiauthkey=${encodeURIComponent(process.env.CRC_API_AUTH_KEY!)}&secretkey=${encodeURIComponent(process.env.CRC_SECRET_KEY!)}`;

  const body = new URLSearchParams();
  body.set("xmlData", xmlData);

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const text = await resp.text();
  let raw: any;

  // CRC returns XML: <success>True</success><result><id>MzA5</id></result>
  if (text.trimStart().startsWith("<")) {
    const successMatch = text.match(/<success>(True|1)<\/success>/i);
    const idMatch = text.match(/<id>([^<]+)<\/id>/);
    raw = { raw: text };
    if (resp.ok && successMatch) {
      const crcId = idMatch?.[1]?.trim() || undefined;
      return { success: true, crcId, raw };
    }
    console.error("[crc:error]", path, text);
    return { success: false, raw };
  }

  // Fallback: JSON response
  try {
    raw = JSON.parse(text);
  } catch {
    raw = { raw: text };
  }

  // CRC returns {"status":"success","id":"<base64-id>"} on success
  if (resp.ok && (raw?.status === "success" || raw?.status === "1")) {
    return { success: true, crcId: raw?.id as string | undefined, raw };
  }
  console.error("[crc:error]", path, raw);
  return { success: false, raw };
}

/**
 * Push a local client record to CRC (create or update).
 * Logs the result in crc_sync_log and updates clients.crc_client_id.
 */
async function crcSyncClient(clientId: number): Promise<void> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT c.id, c.first_name, c.last_name, c.email, c.phone,
            c.address_line1, c.city, c.state, c.zip,
            c.ssn_last4, c.date_of_birth, c.pipeline_stage,
            c.crc_client_id
     FROM clients c WHERE c.id = ? LIMIT 1`,
    [clientId],
  );
  if (rows.length === 0) return;
  const c = rows[0];

  const isUpdate = !!c.crc_client_id;
  const crcType = mapStageToCrcType(c.pipeline_stage as string);

  const xmlData = buildCrcClientXml({
    id: isUpdate ? (c.crc_client_id as string) : null,
    type: crcType,
    firstname: c.first_name as string,
    lastname: c.last_name as string,
    email: c.email as string,
    phone_home: c.phone as string | null,
    street_address: c.address_line1 as string | null,
    city: c.city as string | null,
    state: c.state as string | null,
    zip: c.zip as string | null,
    ssno: c.ssn_last4 as string | null,
    birth_date: c.date_of_birth
      ? new Date(c.date_of_birth as string).toLocaleDateString("en-US")
      : null,
  });

  const action = isUpdate ? "push_update" : "push_create";
  const endpoint = isUpdate ? "/lead/updateRecord" : "/lead/insertRecord";
  const result = await crcPost(endpoint, xmlData);

  if (result.success && !isUpdate && result.crcId) {
    await pool.query<ResultSetHeader>(
      `UPDATE clients SET crc_client_id = ?, crc_synced_at = NOW() WHERE id = ?`,
      [result.crcId, clientId],
    );
  } else if (result.success && isUpdate) {
    await pool.query<ResultSetHeader>(
      `UPDATE clients SET crc_synced_at = NOW() WHERE id = ?`,
      [clientId],
    );
  }

  await pool.query<ResultSetHeader>(
    `INSERT INTO crc_sync_log (client_id, action, crc_client_id, pipeline_stage, status, error_message, payload)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      clientId,
      action,
      result.crcId || (c.crc_client_id as string) || null,
      c.pipeline_stage,
      result.success ? "success" : "error",
      result.success ? null : JSON.stringify(result.raw),
      JSON.stringify({ xmlData, response: result.raw }),
    ],
  );
}

/** Map Zapier/CRC webhook stage name → our pipeline_stage enum value. */
const CRC_STAGE_MAP: Record<string, string> = {
  "new client": "new_client",
  "docs ready": "docs_ready",
  "round 1": "round_1",
  "round 1 (month 1)": "round_1",
  "round 1 out": "round_1",
  "round 1 out!": "round_1",
  "round 1 in": "round_1",
  "round 1 in!": "round_1",
  "round 2": "round_2",
  "round 2 (month 2)": "round_2",
  "round 2 out": "round_2",
  "round 2 out!": "round_2",
  "round 2 in": "round_2",
  "round 2 in!": "round_2",
  "round 3": "round_3",
  "round 3 (month 3)": "round_3",
  "round 3 out": "round_3",
  "round 3 out!": "round_3",
  "round 3 in": "round_3",
  "round 3 in!": "round_3",
  "round 4": "round_4",
  "round 4 (month 4)": "round_4",
  "round 4 out": "round_4",
  "round 4 out!": "round_4",
  "round 4 in": "round_4",
  "round 4 in!": "round_4",
  "round 5": "round_5",
  "round 5 (month 5)": "round_5",
  "round 5 out": "round_5",
  "round 5 out!": "round_5",
  "round 5 in": "round_5",
  "round 5 in!": "round_5",
  completed: "completed",
  graduated: "completed",
  "deleted client": "completed",
};

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
  // SMOKE-TEST HELPERS (only active when SMOKE_TEST_SECRET is set)
  // ============================================================
  const SMOKE_SECRET = process.env.SMOKE_TEST_SECRET;
  if (SMOKE_SECRET) {
    // POST /api/smoke/token — returns a real session token for admin or client
    app.post("/api/smoke/token", async (req, res) => {
      const { secret, actor, email } = req.body || {};
      if (!secret || secret !== SMOKE_SECRET)
        return res.status(401).json({ error: "Unauthorized" });
      if (!["admin", "client"].includes(String(actor)) || !email)
        return res
          .status(400)
          .json({ error: "actor (admin|client) and email required" });
      const table = actor === "admin" ? "admins" : "clients";
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id, email FROM \`${table}\` WHERE email = ? LIMIT 1`,
        [String(email).trim().toLowerCase()],
      );
      if (rows.length === 0)
        return res.status(404).json({ error: `${actor} not found: ${email}` });
      const token = await createSession(
        actor as "admin" | "client",
        rows[0].id as number,
        rows[0].email as string,
        "127.0.0.1",
        "smoke-test",
      );
      res.json({ token, id: rows[0].id, email: rows[0].email });
    });

    // DELETE /api/smoke/cleanup — removes test data created during smoke run
    app.delete("/api/smoke/cleanup", async (req, res) => {
      const { secret, ticket_id, faq_id, session_revoke_token } =
        req.body || {};
      if (!secret || secret !== SMOKE_SECRET)
        return res.status(401).json({ error: "Unauthorized" });
      if (faq_id)
        await pool.query("DELETE FROM support_faq WHERE id = ?", [
          Number(faq_id),
        ]);
      if (ticket_id) {
        await pool.query(
          "DELETE FROM support_ticket_replies WHERE ticket_id = ?",
          [Number(ticket_id)],
        );
        await pool.query("DELETE FROM support_tickets WHERE id = ?", [
          Number(ticket_id),
        ]);
      }
      if (session_revoke_token)
        await revokeSession(String(session_revoke_token));
      res.json({ ok: true });
    });
  }

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
      "SELECT id, first_name, preferred_language FROM clients WHERE email = ? LIMIT 1",
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
    const tpl = tplOtpLogin({
      firstName: rows[0].first_name,
      code,
      lang: rows[0].preferred_language || "en",
    });
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
      return res.status(404).json({
        error:
          "No staff account found for that email. Double-check for typos or contact your super admin.",
      });
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

    // ── Coupon validation ──────────────────────────────────────────────────────
    let couponId: number | null = null;
    let discountCents = 0;
    let originalAmountCents: number | null = null;
    let chargeAmountCents: number = pkg.price_cents as number;

    if (b.coupon_code) {
      const upperCode = String(b.coupon_code).toUpperCase().trim();
      const [couponRows] = await pool.query<RowDataPacket[]>(
        `SELECT * FROM coupons WHERE code = ? AND is_active = 1 LIMIT 1`,
        [upperCode],
      );
      if (couponRows.length > 0) {
        const c = couponRows[0];
        const now = new Date();
        const isValid =
          (!c.valid_from || new Date(c.valid_from) <= now) &&
          (!c.expires_at || new Date(c.expires_at) >= now) &&
          (c.max_uses == null || Number(c.uses_count) < Number(c.max_uses)) &&
          Number(pkg.price_cents) >= Number(c.min_amount_cents);

        if (isValid) {
          // Check package applicability
          let pkgAllowed = true;
          if (c.applicable_packages) {
            let pkgs: number[] = [];
            try {
              pkgs =
                typeof c.applicable_packages === "string"
                  ? JSON.parse(c.applicable_packages)
                  : c.applicable_packages;
            } catch {}
            if (pkgs.length > 0 && !pkgs.includes(Number(pkg.id))) {
              pkgAllowed = false;
            }
          }

          if (pkgAllowed) {
            couponId = c.id as number;
            originalAmountCents = pkg.price_cents as number;
            if (c.discount_type === "percentage") {
              discountCents = Math.round(
                (Number(pkg.price_cents) * Number(c.discount_value)) / 100,
              );
            } else {
              discountCents = Number(c.discount_value);
            }
            discountCents = Math.min(discountCents, Number(pkg.price_cents));
            chargeAmountCents = Number(pkg.price_cents) - discountCents;
          }
        }
      }
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
        chargeAmountCents,
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

    // ── Apply coupon to payment record + increment usage ────────────────────
    if (couponId !== null && discountCents > 0 && chargeResult?.transactionId) {
      await Promise.all([
        pool.query(
          `UPDATE payments SET coupon_id=?, discount_cents=?, original_amount_cents=?
           WHERE provider_transaction_id=? LIMIT 1`,
          [
            couponId,
            discountCents,
            originalAmountCents,
            chargeResult.transactionId,
          ],
        ),
        pool.query(
          `UPDATE coupons SET uses_count = uses_count + 1 WHERE id = ?`,
          [couponId],
        ),
      ]);
    }

    res.json({
      clientId,
      packageId: pkg.id,
      packageName: pkg.name,
      amountCents: chargeAmountCents,
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
        `SELECT id, round_number, score_before, score_after, items_removed, items_disputed, summary_md,
              pdf_file_name, (pdf_storage_key IS NOT NULL) AS has_pdf, pdf_uploaded_at, created_at
       FROM client_round_reports WHERE client_id = ? ORDER BY round_number DESC`,
        [clientId],
      );
      await attachPdfsToReports(clientId, reportRows);
      const [ticketRows] = await pool.query<RowDataPacket[]>(
        `SELECT id, subject, status, priority, created_at FROM support_tickets WHERE client_id = ? ORDER BY created_at DESC LIMIT 5`,
        [clientId],
      );

      const [activeCase] = await pool.query<RowDataPacket[]>(
        `SELECT id, case_number, pipeline_stage, status, created_at
         FROM credit_repair_cases
         WHERE client_id = ? AND status = 'active'
         ORDER BY created_at DESC LIMIT 1`,
        [clientId],
      );

      res.json({
        client: clientRows[0],
        documents: docRows,
        reports: reportRows,
        tickets: ticketRows,
        active_case: activeCase[0] ?? null,
      });
    },
  );

  // Serve a client's own document file (decrypted, inline)
  app.get(
    "/api/portal/documents/:id/file",
    requireClient,
    async (req: AuthedRequest, res) => {
      const clientId = req.auth!.id;
      const docId = Number(req.params.id);
      if (!docId || isNaN(docId))
        return res.status(400).json({ error: "Invalid id" });
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT file_name, mime_type, storage_provider, storage_key, encrypted, enc_iv, enc_tag
         FROM client_documents WHERE id = ? AND client_id = ? LIMIT 1`,
        [docId, clientId],
      );
      if (rows.length === 0)
        return res.status(404).json({ error: "Not found" });
      const doc = rows[0];
      try {
        let buf: Buffer;
        if (doc.storage_provider === "cdn") {
          const cdnRes = await fetch(doc.storage_key as string);
          if (!cdnRes.ok)
            return res.status(404).json({ error: "File not available" });
          const cdnRaw = Buffer.from(await cdnRes.arrayBuffer());
          buf =
            doc.encrypted && doc.enc_iv && doc.enc_tag
              ? decryptFile(cdnRaw, doc.enc_iv as string, doc.enc_tag as string)
              : cdnRaw;
        } else {
          const raw = await fs.promises.readFile(
            path.join(UPLOADS_DIR, doc.storage_key as string),
          );
          buf =
            doc.encrypted && doc.enc_iv && doc.enc_tag
              ? decryptFile(raw, doc.enc_iv as string, doc.enc_tag as string)
              : raw;
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
        res.status(404).json({ error: "File not found" });
      }
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
        const { encrypted, iv, tag } = encryptFile(f.buffer);
        const cdnUrl = await uploadToCDN(
          encrypted,
          f.originalname + ".enc",
          "application/octet-stream",
          clientId,
        );
        // Resolve active case for this client to link the document
        const [caseRows] = await pool.query<RowDataPacket[]>(
          `SELECT id FROM credit_repair_cases WHERE client_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1`,
          [clientId],
        );
        const activeCaseId: number | null = caseRows[0]?.id ?? null;
        const [r] = await pool.query<ResultSetHeader>(
          `INSERT INTO client_documents
            (client_id, case_id, doc_type, file_name, file_size, mime_type, storage_provider, storage_key, encrypted, enc_iv, enc_tag, review_status)
           VALUES (?,?,?,?,?, 'cdn', ?, 1, ?, ?, 'pending')`,
          [
            clientId,
            activeCaseId,
            docType,
            f.originalname,
            f.size,
            f.mimetype,
            cdnUrl,
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

  app.put(
    "/api/portal/profile",
    requireClient,
    async (req: AuthedRequest, res) => {
      const clientId = req.auth!.id;
      const { first_name, last_name, phone } = req.body || {};
      if (!first_name?.trim() || !last_name?.trim()) {
        return res
          .status(400)
          .json({ error: "First and last name are required" });
      }
      await pool.query<ResultSetHeader>(
        `UPDATE clients SET first_name = ?, last_name = ?, phone = ? WHERE id = ?`,
        [first_name.trim(), last_name.trim(), phone?.trim() || null, clientId],
      );
      res.json({ ok: true });
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

  app.put(
    "/api/portal/language",
    requireClient,
    async (req: AuthedRequest, res) => {
      const { language } = req.body || {};
      if (!["en", "es"].includes(language)) {
        return res
          .status(400)
          .json({ error: "Invalid language. Supported: en, es" });
      }
      await pool.query<ResultSetHeader>(
        `UPDATE clients SET preferred_language = ? WHERE id = ?`,
        [language, req.auth!.id],
      );
      res.json({ ok: true, language });
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

  // Support FAQ — public read for portal clients
  app.get("/api/portal/support-faq", requireClient, async (_req, res) => {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, question, answer, category, sort_order FROM support_faq WHERE is_active = 1 ORDER BY sort_order ASC, id ASC`,
    );
    res.json({ faqs: rows });
  });

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
      `SELECT id, title, content_type, description, video_url, file_url,
              thumbnail_url, duration_seconds, category, language
       FROM educational_videos WHERE is_published = 1 ORDER BY sort_order ASC, id DESC`,
    );
    res.json({ videos: rows });
  });

  app.get(
    "/api/portal/payments",
    requireClient,
    async (req: AuthedRequest, res) => {
      const clientId = req.auth!.id;
      try {
        const [rows] = await pool.query<RowDataPacket[]>(
          `SELECT
           p.id,
           pk.name                              AS package_name,
           p.amount_cents,
           COALESCE(p.discount_cents, 0)        AS discount_cents,
           p.original_amount_cents,
           p.currency,
           p.status,
           p.provider,
           c.code                               AS coupon_code,
           p.paid_at,
           p.created_at
         FROM payments p
         LEFT JOIN packages pk ON pk.id = p.package_id
         LEFT JOIN coupons   c ON  c.id = p.coupon_id
         WHERE p.client_id = ?
         ORDER BY p.created_at DESC`,
          [clientId],
        );
        res.json({ payments: rows });
      } catch (err) {
        console.error("GET /api/portal/payments error:", err);
        res.status(500).json({ error: "Failed to fetch payments" });
      }
    },
  );

  // ── Client: list own payment splits ────────────────────────────────────────
  app.get(
    "/api/portal/payment-splits",
    requireClient,
    async (req: AuthedRequest, res) => {
      const clientId = req.auth!.id;
      try {
        const [splits] = await pool.query<RowDataPacket[]>(
          `SELECT ps.id, cr.case_number, ps.label, ps.amount_cents, ps.currency,
                  ps.due_date, ps.status, ps.completion_source, ps.paid_at,
                  ps.send_payment_link, pst.token AS payment_token
           FROM payment_splits ps
           JOIN credit_repair_cases cr ON cr.id = ps.case_id
           LEFT JOIN payment_split_tokens pst ON pst.split_id = ps.id
             AND (pst.expires_at > NOW() AND pst.used_at IS NULL)
           WHERE ps.client_id = ?
           ORDER BY ps.due_date ASC`,
          [clientId],
        );
        res.json({ splits });
      } catch (err) {
        console.error("GET /api/portal/payment-splits error:", err);
        res.status(500).json({ error: "Failed to fetch payment splits" });
      }
    },
  );

  // ============================================================================
  // PUBLIC PAYMENT PAGE  /api/pay/:token
  // No auth middleware — validated by the token itself
  // ============================================================================
  app.get("/api/pay/:token", async (req, res) => {
    const { token } = req.params;
    if (!token) return res.status(400).json({ error: "Missing token" });

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT pst.id AS token_id, pst.split_id, pst.expires_at, pst.used_at,
              ps.id, ps.case_id, cr.case_number, ps.client_id,
              c.first_name AS client_first_name, c.last_name AS client_last_name,
              c.email AS client_email, c.preferred_language,
              c.anet_customer_profile_id, c.anet_payment_profile_id,
              ps.label, ps.amount_cents, ps.currency, ps.due_date,
              ps.status, ps.completion_source, ps.paid_at, ps.payments_id,
              ps.reminder_flow_id, ps.send_payment_link, ps.notes,
              ps.created_at, ps.updated_at
       FROM payment_split_tokens pst
       JOIN payment_splits ps ON ps.id = pst.split_id
       JOIN credit_repair_cases cr ON cr.id = ps.case_id
       JOIN clients c ON c.id = ps.client_id
       WHERE pst.token = ? LIMIT 1`,
      [token],
    );
    if (rows.length === 0)
      return res.status(404).json({ error: "Payment link not found" });

    const row = rows[0];
    if (row.used_at)
      return res
        .status(410)
        .json({ error: "This payment link has already been used" });
    if (new Date(row.expires_at) < new Date())
      return res.status(410).json({ error: "This payment link has expired" });
    if (row.status === "paid")
      return res
        .status(410)
        .json({ error: "This split has already been paid" });
    if (row.status === "cancelled")
      return res.status(410).json({ error: "This payment has been cancelled" });

    const hasStoredCard = !!(
      row.anet_customer_profile_id && row.anet_payment_profile_id
    );

    res.json({
      split: {
        id: row.id,
        case_id: row.case_id,
        case_number: row.case_number,
        client_id: row.client_id,
        label: row.label,
        amount_cents: row.amount_cents,
        currency: row.currency,
        due_date: row.due_date,
        status: row.status,
        notes: row.notes,
        created_at: row.created_at,
      },
      client_first_name: row.client_first_name,
      client_last_name: row.client_last_name,
      has_stored_card: hasStoredCard,
      card_last4: null, // Authorize.net doesn't expose last4 without additional API call
      preferred_language: row.preferred_language,
    });
  });

  // ── POST /api/pay/:token — charge payment ─────────────────────────────────
  app.post("/api/pay/:token", async (req, res) => {
    const { token } = req.params;
    if (!token) return res.status(400).json({ error: "Missing token" });

    const { method, data_descriptor, data_value } = req.body || {};
    if (!method || !["stored_profile", "new_card"].includes(method))
      return res
        .status(400)
        .json({ error: "method must be 'stored_profile' or 'new_card'" });
    if (method === "new_card" && (!data_descriptor || !data_value))
      return res.status(400).json({
        error: "data_descriptor and data_value required for new_card",
      });

    // Load token
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT pst.id AS token_id, pst.split_id, pst.expires_at, pst.used_at,
              ps.id AS split_id_direct, ps.case_id, ps.client_id,
              ps.label, ps.amount_cents, ps.currency, ps.status,
              c.first_name, c.last_name, c.email, c.preferred_language,
              c.anet_customer_profile_id, c.anet_payment_profile_id
       FROM payment_split_tokens pst
       JOIN payment_splits ps ON ps.id = pst.split_id
       JOIN clients c ON c.id = ps.client_id
       WHERE pst.token = ? LIMIT 1`,
      [token],
    );
    if (rows.length === 0)
      return res.status(404).json({ error: "Payment link not found" });
    const row = rows[0];

    if (row.used_at)
      return res
        .status(410)
        .json({ error: "This payment link has already been used" });
    if (new Date(row.expires_at) < new Date())
      return res.status(410).json({ error: "Payment link has expired" });
    if (row.status === "paid")
      return res.status(410).json({ error: "Already paid" });
    if (row.status === "cancelled")
      return res.status(410).json({ error: "Payment cancelled" });

    const amountDollars = (Number(row.amount_cents) / 100).toFixed(2);
    const splitId = row.split_id as number;
    const caseId = row.case_id as number;
    const clientId = row.client_id as number;

    let chargeResult: { transactionId: string };

    if (method === "stored_profile") {
      if (!row.anet_customer_profile_id || !row.anet_payment_profile_id)
        return res
          .status(400)
          .json({ error: "No stored card on file. Please use a new card." });

      // Charge via Authorize.net CIM
      const anetApiUrl =
        process.env.ANET_ENV === "production"
          ? "https://api.authorize.net/xml/v1/request.api"
          : "https://apitest.authorize.net/xml/v1/request.api";

      const payload = {
        createCustomerProfileTransactionRequest: {
          merchantAuthentication: {
            name: process.env.ANET_API_LOGIN_ID,
            transactionKey: process.env.ANET_TRANSACTION_KEY,
          },
          transaction: {
            profileTransAuthCapture: {
              amount: amountDollars,
              customerProfileId: row.anet_customer_profile_id,
              customerPaymentProfileId: row.anet_payment_profile_id,
              order: {
                description: String(row.label).slice(0, 255),
              },
            },
          },
        },
      };

      const anetResp = await fetch(anetApiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const anetData = (await anetResp.json()) as any;

      const txResp =
        anetData?.createCustomerProfileTransactionResponse?.directResponse;
      if (!txResp) {
        console.error("[pay/token] CIM error:", JSON.stringify(anetData));
        return res
          .status(402)
          .json({ error: "Payment declined. Please try a different card." });
      }
      const parts = txResp.split(",");
      // Position 0: result code (1=approved, 2=declined, 3=error)
      if (parts[0] !== "1") {
        return res.status(402).json({ error: parts[3] || "Payment declined" });
      }
      chargeResult = { transactionId: parts[6] || `CIM-${Date.now()}` };
    } else {
      // new_card — charge via Accept.js nonce
      const result = await chargeCard({
        amountDollars,
        dataDescriptor: data_descriptor,
        dataValue: data_value,
        clientId,
        email: row.email as string,
        firstName: row.first_name as string,
        lastName: row.last_name as string,
      });
      if (!result.transactionId)
        return res.status(402).json({ error: "Payment failed" });
      chargeResult = { transactionId: result.transactionId };

      // Persist anet profile IDs if returned
      if (result.customerProfileId) {
        try {
          await pool.query(
            `UPDATE clients SET anet_customer_profile_id = ?, anet_payment_profile_id = ? WHERE id = ?`,
            [
              result.customerProfileId,
              result.customerPaymentProfileId ?? null,
              clientId,
            ],
          );
        } catch (e) {
          console.error("[pay/token] anet profile update failed:", e);
        }
      }
    }

    // Record payment and update split atomically
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [payResult] = await conn.query<ResultSetHeader>(
        `INSERT INTO payments
           (client_id, case_id, split_id, amount_cents, currency,
            status, provider, provider_transaction_id, paid_at)
         VALUES (?, ?, ?, ?, ?, 'succeeded', 'authorize_net', ?, NOW())`,
        [
          clientId,
          caseId,
          splitId,
          row.amount_cents,
          row.currency || "USD",
          chargeResult.transactionId,
        ],
      );
      const paymentId = payResult.insertId;

      await conn.query(
        `UPDATE payment_splits
         SET status = 'paid', completion_source = ?, paid_at = NOW(), payments_id = ?
         WHERE id = ?`,
        [
          method === "stored_profile" ? "authorize_link" : "authorize_link",
          paymentId,
          splitId,
        ],
      );

      await conn.query(
        `UPDATE payment_split_tokens SET used_at = NOW() WHERE split_id = ?`,
        [splitId],
      );

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    // Cancel pending notifications for this split
    try {
      await pool.query(
        `UPDATE notification_queue SET status = 'cancelled'
         WHERE payload_json->>'$.split_id' = ? AND status = 'pending'`,
        [splitId],
      );
    } catch (e) {
      console.error("[pay/token] cancel notifications failed:", e);
    }

    res.json({ ok: true, transaction_id: chargeResult.transactionId });
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
        (SELECT COUNT(*) FROM clients WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)) AS new_clients_30d,
        (SELECT COUNT(*) FROM clients WHERE pipeline_stage = 'completed') AS completed_clients,
        (SELECT COALESCE(ROUND(AVG(score_after - score_before),0),0) FROM client_round_reports WHERE score_before IS NOT NULL AND score_after IS NOT NULL) AS avg_score_improvement`,
    );
    const [recent] = await pool.query<RowDataPacket[]>(
      `SELECT c.id, c.first_name, c.last_name, c.email, c.pipeline_stage, c.status, c.created_at, p.name AS package_name
       FROM clients c LEFT JOIN packages p ON p.id = c.package_id
       ORDER BY c.created_at DESC LIMIT 6`,
    );
    const [recent_tickets] = await pool.query<RowDataPacket[]>(
      `SELECT t.id, t.subject, t.status, t.priority, t.category, t.created_at,
              c.first_name, c.last_name, c.id AS client_id
       FROM support_tickets t
       JOIN clients c ON c.id = t.client_id
       WHERE t.status IN ('open','in_progress','waiting_client')
       ORDER BY t.created_at DESC LIMIT 5`,
    );
    const [recent_payments] = await pool.query<RowDataPacket[]>(
      `SELECT p.id, p.amount_cents, p.status, p.paid_at, p.created_at,
              c.first_name, c.last_name, c.id AS client_id
       FROM payments p
       JOIN clients c ON c.id = p.client_id
       WHERE p.status = 'succeeded'
       ORDER BY p.paid_at DESC LIMIT 5`,
    );
    res.json({
      stages,
      stats: stats[0] || {},
      recent_clients: recent,
      recent_tickets,
      recent_payments,
    });
  });

  app.get("/api/admin/clients", requireAdmin, async (req, res) => {
    const stage = req.query.stage as string | undefined;
    const search = req.query.search as string | undefined;
    const status = req.query.status as string | undefined;
    const language = req.query.language as string | undefined;
    const billing = req.query.billing as string | undefined;
    const joined_from = req.query.joined_from as string | undefined;
    const joined_to = req.query.joined_to as string | undefined;
    const has_notes = req.query.has_notes as string | undefined;
    const limit = Math.min(
      parseInt((req.query.limit as string) || "200", 10),
      200,
    );
    const where: string[] = [];
    const args: any[] = [];
    if (stage) {
      where.push("c.pipeline_stage = ?");
      args.push(stage);
    }
    if (search) {
      where.push(
        "(c.email LIKE ? OR c.first_name LIKE ? OR c.last_name LIKE ? OR CONCAT(c.first_name,' ',c.last_name) LIKE ? OR c.phone LIKE ?)",
      );
      const s = `%${search}%`;
      args.push(s, s, s, s, s);
    }
    if (status) {
      where.push("c.status = ?");
      args.push(status);
    }
    if (language === "en" || language === "es") {
      where.push("c.preferred_language = ?");
      args.push(language);
    }
    if (joined_from) {
      where.push("DATE(c.created_at) >= ?");
      args.push(joined_from);
    }
    if (joined_to) {
      where.push("DATE(c.created_at) <= ?");
      args.push(joined_to);
    }
    if (has_notes === "yes") {
      where.push("(c.admin_notes IS NOT NULL AND c.admin_notes != '')");
    } else if (has_notes === "no") {
      where.push("(c.admin_notes IS NULL OR c.admin_notes = '')");
    }
    if (billing === "overdue") {
      where.push(
        "EXISTS (SELECT 1 FROM payment_splits ps WHERE ps.client_id = c.id AND ps.status = 'overdue')",
      );
    } else if (billing === "split_plan") {
      where.push(
        "EXISTS (SELECT 1 FROM payment_splits ps WHERE ps.client_id = c.id)",
      );
    } else if (billing === "paid_full") {
      where.push(
        "EXISTS (SELECT 1 FROM payment_splits ps WHERE ps.client_id = c.id)" +
          " AND NOT EXISTS (SELECT 1 FROM payment_splits ps2 WHERE ps2.client_id = c.id AND ps2.status IN ('pending','overdue'))",
      );
    } else if (billing === "direct_paid") {
      where.push(
        "EXISTS (SELECT 1 FROM payments py WHERE py.client_id = c.id AND py.status = 'succeeded')" +
          " AND NOT EXISTS (SELECT 1 FROM payment_splits ps WHERE ps.client_id = c.id)",
      );
    } else if (billing === "no_payment") {
      where.push(
        "NOT EXISTS (SELECT 1 FROM payments py WHERE py.client_id = c.id AND py.status = 'succeeded')" +
          " AND NOT EXISTS (SELECT 1 FROM payment_splits ps WHERE ps.client_id = c.id)",
      );
    }
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT c.id, c.first_name, c.last_name, c.email, c.phone, c.pipeline_stage,
              c.status, c.admin_notes, c.created_at, c.preferred_language,
              p.name AS package_name, p.slug AS package_slug,
              COALESCE(pay_agg.total_paid_cents, 0)  AS total_paid_cents,
              COALESCE(pay_agg.payment_count,   0)   AS payment_count,
              COALESCE(sp_agg.splits_total,     0)   AS splits_total,
              COALESCE(sp_agg.splits_paid,      0)   AS splits_paid,
              COALESCE(sp_agg.splits_pending,   0)   AS splits_pending,
              COALESCE(sp_agg.splits_overdue,   0)   AS splits_overdue,
              COALESCE(sp_agg.splits_amount_cents, 0) AS splits_amount_cents,
              COALESCE(sp_agg.splits_paid_cents,   0) AS splits_paid_cents
       FROM clients c
       LEFT JOIN packages p ON p.id = c.package_id
       LEFT JOIN (
         SELECT client_id,
                SUM(amount_cents) AS total_paid_cents,
                COUNT(*)          AS payment_count
         FROM payments WHERE status = 'succeeded'
         GROUP BY client_id
       ) pay_agg ON pay_agg.client_id = c.id
       LEFT JOIN (
         SELECT client_id,
                COUNT(*)                                                        AS splits_total,
                SUM(status = 'paid')                                            AS splits_paid,
                SUM(status IN ('pending','overdue'))                            AS splits_pending,
                SUM(status = 'overdue')                                         AS splits_overdue,
                SUM(amount_cents)                                               AS splits_amount_cents,
                SUM(CASE WHEN status = 'paid' THEN amount_cents ELSE 0 END)    AS splits_paid_cents
         FROM payment_splits
         GROUP BY client_id
       ) sp_agg ON sp_agg.client_id = c.id
       ${where.length ? "WHERE " + where.join(" AND ") : ""}
       ORDER BY c.created_at DESC LIMIT ${limit}`,
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
      `SELECT id, doc_type, pipeline_round, file_name, file_size, mime_type, review_status, rejection_reason, uploaded_at, reviewed_at
       FROM client_documents WHERE client_id = ? ORDER BY uploaded_at DESC`,
      [id],
    );
    const [reports] = await pool.query<RowDataPacket[]>(
      `SELECT id, round_number, score_before, score_after, items_removed, items_disputed, summary_md,
              pdf_file_name, (pdf_storage_key IS NOT NULL) AS has_pdf, pdf_uploaded_at, created_at
       FROM client_round_reports WHERE client_id = ? ORDER BY round_number DESC`,
      [id],
    );
    await attachPdfsToReports(Number(id), reports);
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
      `SELECT cr.id, cr.case_number, cr.client_id, cr.pipeline_stage,
              cr.pipeline_stage_changed_at, cr.status, cr.created_at,
              c.first_name, c.last_name, c.email, c.phone,
              c.status AS client_status, c.preferred_language,
              c.crc_client_id, c.crc_synced_at,
              p.name AS package_name, p.slug AS package_slug,
              (SELECT COUNT(*) FROM onboarding_task_templates
               WHERE is_active = 1) AS tasks_total,
              (SELECT COUNT(*) FROM onboarding_task_templates
               WHERE is_active = 1 AND is_required = 1) AS tasks_required_total,
              COALESCE(ts.tasks_approved,      0) AS tasks_approved,
              COALESCE(ts.tasks_pending_review,0) AS tasks_pending_review,
              COALESCE(ts.tasks_rejected,      0) AS tasks_rejected
       FROM credit_repair_cases cr
       JOIN clients c ON c.id = cr.client_id
       LEFT JOIN packages p ON p.id = cr.package_id
       LEFT JOIN (
         SELECT ctc.client_id,
           SUM(CASE WHEN ctc.admin_review_status = 'approved'  THEN 1 ELSE 0 END) AS tasks_approved,
           SUM(CASE WHEN ctc.status = 'completed'
                     AND ctc.admin_review_status = 'pending'  THEN 1 ELSE 0 END) AS tasks_pending_review,
           SUM(CASE WHEN ctc.admin_review_status = 'rejected'  THEN 1 ELSE 0 END) AS tasks_rejected
         FROM client_task_completions ctc
         JOIN onboarding_task_templates ott ON ott.id = ctc.task_template_id AND ott.is_active = 1
         GROUP BY ctc.client_id
       ) ts ON ts.client_id = c.id
       WHERE cr.status NOT IN ('cancelled')
       ORDER BY cr.pipeline_stage_changed_at DESC, cr.created_at DESC`,
    );
    res.json({ cases: rows });
  });

  // ── Create case manually (admin) ──────────────────────────────────────────
  app.post("/api/admin/cases", requireAdmin, async (req, res) => {
    const {
      client_id,
      package_id,
      pipeline_stage,
      notes,
      send_case_email,
      splits,
    } = req.body || {};
    if (!client_id)
      return res.status(400).json({ error: "client_id is required" });
    const cId = Number(client_id);
    if (!cId || isNaN(cId))
      return res.status(400).json({ error: "Invalid client_id" });

    const [clientRows] = await pool.query<RowDataPacket[]>(
      `SELECT id, first_name, last_name, email, preferred_language,
              anet_customer_profile_id
       FROM clients WHERE id = ? LIMIT 1`,
      [cId],
    );
    if (clientRows.length === 0)
      return res.status(404).json({ error: "Client not found" });
    const client = clientRows[0];

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // Insert case
      const stage = pipeline_stage || "lead";
      const [caseResult] = await conn.query<ResultSetHeader>(
        `INSERT INTO credit_repair_cases (client_id, package_id, pipeline_stage, notes)
         VALUES (?, ?, ?, ?)`,
        [cId, package_id ? Number(package_id) : null, stage, notes || null],
      );
      const caseId = caseResult.insertId;

      // Generate case number CR-XXXXXX
      const caseNumber = `CR-${String(caseId).padStart(6, "0")}`;
      await conn.query(
        `UPDATE credit_repair_cases SET case_number = ? WHERE id = ?`,
        [caseNumber, caseId],
      );

      // Insert splits if provided
      const splitDefs: any[] = Array.isArray(splits) ? splits : [];
      const insertedSplits: Array<{
        id: number;
        token: string | null;
        label: string;
        amount_cents: number;
        due_date: Date;
        flow_id: number | null;
        send_link: boolean;
      }> = [];

      for (const sp of splitDefs) {
        if (!sp.label || !sp.amount_cents || !sp.due_date) continue;
        const [spResult] = await conn.query<ResultSetHeader>(
          `INSERT INTO payment_splits
             (case_id, client_id, label, amount_cents, due_date,
              reminder_flow_id, send_payment_link, notes, created_by_admin_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            caseId,
            cId,
            String(sp.label).trim(),
            Number(sp.amount_cents),
            sp.due_date,
            sp.reminder_flow_id ? Number(sp.reminder_flow_id) : null,
            sp.send_payment_link ? 1 : 0,
            sp.notes || null,
            (req as AuthedRequest).auth!.id,
          ],
        );
        const splitId = spResult.insertId;
        let tokenStr: string | null = null;

        if (sp.send_payment_link) {
          tokenStr = crypto.randomUUID();
          const expiresAt = new Date(sp.due_date);
          expiresAt.setDate(expiresAt.getDate() + 7); // token valid 7 days after due date
          await conn.query(
            `INSERT INTO payment_split_tokens (split_id, token, expires_at)
             VALUES (?, ?, ?)`,
            [splitId, tokenStr, expiresAt],
          );
        }

        insertedSplits.push({
          id: splitId,
          token: tokenStr,
          label: String(sp.label).trim(),
          amount_cents: Number(sp.amount_cents),
          due_date: new Date(sp.due_date),
          flow_id: sp.reminder_flow_id ? Number(sp.reminder_flow_id) : null,
          send_link: !!sp.send_payment_link,
        });
      }

      await conn.commit();

      // Post-commit: emails + reminders (best effort)
      const lang = (client.preferred_language as string) || "en";
      const appUrl = process.env.APP_URL || "https://optimumcredit.com";

      if (send_case_email) {
        try {
          const tpl = tplCaseStarted({
            firstName: client.first_name as string,
            caseNumber,
            portalUrl: `${appUrl}/portal/payments`,
            lang,
          });
          await sendEmail({
            to: client.email as string,
            subject: tpl.subject,
            html: tpl.html,
          });
        } catch (e) {
          console.error("[admin/cases] case-started email failed:", e);
        }
      }

      // Trigger payment_confirmed reminder flow
      try {
        await triggerReminderFlow("payment_confirmed", cId, {});
      } catch (e) {
        console.error("[admin/cases] triggerReminderFlow failed:", e);
      }

      // Auto-assign tasks
      try {
        await autoAssignTasksForClient(cId);
      } catch (e) {
        console.error("[admin/cases] autoAssignTasks failed:", e);
      }

      // Schedule split reminders
      for (const sp of insertedSplits) {
        if (!sp.flow_id || !sp.token) continue;
        try {
          const paymentLink = `${appUrl}/pay/${sp.token}`;
          const amountFormatted = `$${(sp.amount_cents / 100).toFixed(2)}`;
          const dueDateFormatted = sp.due_date.toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
          });
          await scheduleSplitReminders({
            splitId: sp.id,
            clientId: cId,
            flowId: sp.flow_id,
            dueDate: sp.due_date,
            paymentLink,
            label: sp.label,
            amountFormatted,
            dueDateFormatted,
          });
        } catch (e) {
          console.error("[admin/cases] scheduleSplitReminders failed:", e);
        }
      }

      const [caseRow] = await pool.query<RowDataPacket[]>(
        `SELECT cr.id, cr.case_number, cr.pipeline_stage, cr.status, cr.notes, cr.created_at,
                c.id AS client_id, c.first_name AS client_first_name,
                c.last_name AS client_last_name, c.email AS client_email,
                p.id AS package_id, p.name AS package_name
         FROM credit_repair_cases cr
         JOIN clients c ON c.id = cr.client_id
         LEFT JOIN packages p ON p.id = cr.package_id
         WHERE cr.id = ? LIMIT 1`,
        [caseId],
      );

      res.status(201).json({ case: caseRow[0] });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });

  // ── List splits for a case ────────────────────────────────────────────────
  app.get("/api/admin/cases/:id/splits", requireAdmin, async (req, res) => {
    const caseId = Number(req.params.id);
    if (!caseId || isNaN(caseId))
      return res.status(400).json({ error: "Invalid case id" });
    const [splits] = await pool.query<RowDataPacket[]>(
      `SELECT ps.id, ps.case_id, ps.client_id, ps.label, ps.amount_cents, ps.currency,
              ps.due_date, ps.status, ps.completion_source, ps.paid_at, ps.payments_id,
              ps.reminder_flow_id, rf.name AS reminder_flow_name,
              ps.send_payment_link, ps.notes, ps.created_at, ps.updated_at,
              pst.token AS payment_token, pst.expires_at AS token_expires_at, pst.used_at AS token_used_at
       FROM payment_splits ps
       LEFT JOIN reminder_flows rf ON rf.id = ps.reminder_flow_id
       LEFT JOIN payment_split_tokens pst ON pst.split_id = ps.id
       WHERE ps.case_id = ?
       ORDER BY ps.due_date ASC`,
      [caseId],
    );
    const appUrl = process.env.APP_URL || "https://optimumcredit.com";
    const result = splits.map((s) => ({
      ...s,
      payment_link: s.payment_token ? `${appUrl}/pay/${s.payment_token}` : null,
    }));
    res.json({ splits: result });
  });

  // ── Create split for a case ───────────────────────────────────────────────
  app.post("/api/admin/cases/:id/splits", requireAdmin, async (req, res) => {
    const caseId = Number(req.params.id);
    if (!caseId || isNaN(caseId))
      return res.status(400).json({ error: "Invalid case id" });

    const [caseRows] = await pool.query<RowDataPacket[]>(
      `SELECT cr.id, cr.client_id, c.email, c.first_name, c.preferred_language
       FROM credit_repair_cases cr JOIN clients c ON c.id = cr.client_id
       WHERE cr.id = ? LIMIT 1`,
      [caseId],
    );
    if (caseRows.length === 0)
      return res.status(404).json({ error: "Case not found" });
    const cr = caseRows[0];

    const {
      label,
      amount_cents,
      due_date,
      send_payment_link,
      reminder_flow_id,
      notes,
    } = req.body || {};
    if (!label || !amount_cents || !due_date)
      return res
        .status(400)
        .json({ error: "label, amount_cents, and due_date are required" });

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [spResult] = await conn.query<ResultSetHeader>(
        `INSERT INTO payment_splits
           (case_id, client_id, label, amount_cents, due_date,
            reminder_flow_id, send_payment_link, notes, created_by_admin_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          caseId,
          cr.client_id,
          String(label).trim(),
          Number(amount_cents),
          due_date,
          reminder_flow_id ? Number(reminder_flow_id) : null,
          send_payment_link ? 1 : 0,
          notes || null,
          (req as AuthedRequest).auth!.id,
        ],
      );
      const splitId = spResult.insertId;
      let tokenStr: string | null = null;

      if (send_payment_link) {
        tokenStr = crypto.randomUUID();
        const expiresAt = new Date(due_date);
        expiresAt.setDate(expiresAt.getDate() + 7);
        await conn.query(
          `INSERT INTO payment_split_tokens (split_id, token, expires_at) VALUES (?, ?, ?)`,
          [splitId, tokenStr, expiresAt],
        );
      }

      await conn.commit();

      // Schedule reminders
      if (reminder_flow_id && tokenStr) {
        try {
          const appUrl = process.env.APP_URL || "https://optimumcredit.com";
          const dueDate = new Date(due_date);
          const amountFormatted = `$${(Number(amount_cents) / 100).toFixed(2)}`;
          const dueDateFormatted = dueDate.toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
          });
          await scheduleSplitReminders({
            splitId,
            clientId: cr.client_id as number,
            flowId: Number(reminder_flow_id),
            dueDate,
            paymentLink: `${appUrl}/pay/${tokenStr}`,
            label: String(label).trim(),
            amountFormatted,
            dueDateFormatted,
          });
        } catch (e) {
          console.error("[admin/splits] scheduleSplitReminders failed:", e);
        }
      }

      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT ps.*, pst.token AS payment_token, pst.expires_at AS token_expires_at
         FROM payment_splits ps
         LEFT JOIN payment_split_tokens pst ON pst.split_id = ps.id
         WHERE ps.id = ? LIMIT 1`,
        [splitId],
      );
      res.status(201).json({ split: rows[0] });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });

  // ── Update split ──────────────────────────────────────────────────────────
  app.put(
    "/api/admin/cases/:id/splits/:splitId",
    requireAdmin,
    async (req, res) => {
      const caseId = Number(req.params.id);
      const splitId = Number(req.params.splitId);
      if (!caseId || !splitId)
        return res.status(400).json({ error: "Invalid ids" });

      const [existing] = await pool.query<RowDataPacket[]>(
        `SELECT ps.*, pst.token FROM payment_splits ps
         LEFT JOIN payment_split_tokens pst ON pst.split_id = ps.id
         WHERE ps.id = ? AND ps.case_id = ? LIMIT 1`,
        [splitId, caseId],
      );
      if (existing.length === 0)
        return res.status(404).json({ error: "Split not found" });
      const current = existing[0];

      const {
        label,
        amount_cents,
        due_date,
        status,
        completion_source,
        notes,
        reminder_flow_id,
      } = req.body || {};

      const updates: string[] = [];
      const args: any[] = [];
      if (label != null) {
        updates.push("label = ?");
        args.push(String(label).trim());
      }
      if (amount_cents != null) {
        updates.push("amount_cents = ?");
        args.push(Number(amount_cents));
      }
      if (due_date != null) {
        updates.push("due_date = ?");
        args.push(due_date);
      }
      if (notes !== undefined) {
        updates.push("notes = ?");
        args.push(notes || null);
      }
      if (reminder_flow_id !== undefined) {
        updates.push("reminder_flow_id = ?");
        args.push(reminder_flow_id ? Number(reminder_flow_id) : null);
      }
      const allowedStatuses = ["pending", "paid", "overdue", "cancelled"];
      if (status != null && allowedStatuses.includes(status)) {
        updates.push("status = ?");
        args.push(status);
        if (status === "paid" && completion_source) {
          updates.push("completion_source = ?");
          args.push(completion_source);
          updates.push("paid_at = NOW()");
        }
      }
      if (updates.length === 0)
        return res.status(400).json({ error: "No valid fields to update" });

      args.push(splitId);
      await pool.query<ResultSetHeader>(
        `UPDATE payment_splits SET ${updates.join(", ")} WHERE id = ?`,
        args,
      );

      // If due_date changed, cancel old notifications and reschedule
      const dueDateChanged =
        due_date != null &&
        new Date(due_date).toISOString().slice(0, 10) !==
          new Date(current.due_date).toISOString().slice(0, 10);
      const markAsPaid = status === "paid" || status === "cancelled";

      if (markAsPaid || dueDateChanged) {
        // Cancel pending notifications for this split
        await pool.query(
          `UPDATE notification_queue SET status = 'cancelled'
           WHERE payload_json->>'$.split_id' = ? AND status = 'pending'`,
          [splitId],
        );
      }

      // Reschedule if due_date changed and split still has a flow + token
      if (
        dueDateChanged &&
        !markAsPaid &&
        current.token &&
        (reminder_flow_id || current.reminder_flow_id)
      ) {
        try {
          const newDueDate = new Date(due_date);
          const flowId = reminder_flow_id
            ? Number(reminder_flow_id)
            : (current.reminder_flow_id as number);
          const appUrl = process.env.APP_URL || "https://optimumcredit.com";
          const amountCents = amount_cents ?? (current.amount_cents as number);
          await scheduleSplitReminders({
            splitId,
            clientId: current.client_id as number,
            flowId,
            dueDate: newDueDate,
            paymentLink: `${appUrl}/pay/${current.token}`,
            label: label ?? (current.label as string),
            amountFormatted: `$${(Number(amountCents) / 100).toFixed(2)}`,
            dueDateFormatted: newDueDate.toLocaleDateString("en-US", {
              year: "numeric",
              month: "long",
              day: "numeric",
            }),
          });
        } catch (e) {
          console.error("[admin/splits] reschedule failed:", e);
        }
      }

      const [updated] = await pool.query<RowDataPacket[]>(
        `SELECT ps.*, pst.token AS payment_token FROM payment_splits ps
         LEFT JOIN payment_split_tokens pst ON pst.split_id = ps.id
         WHERE ps.id = ? LIMIT 1`,
        [splitId],
      );
      res.json({ split: updated[0] });
    },
  );

  // ── Delete split ──────────────────────────────────────────────────────────
  app.delete(
    "/api/admin/cases/:id/splits/:splitId",
    requireAdmin,
    async (req, res) => {
      const caseId = Number(req.params.id);
      const splitId = Number(req.params.splitId);
      if (!caseId || !splitId)
        return res.status(400).json({ error: "Invalid ids" });

      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id FROM payment_splits WHERE id = ? AND case_id = ? LIMIT 1`,
        [splitId, caseId],
      );
      if (rows.length === 0)
        return res.status(404).json({ error: "Split not found" });

      // Cancel pending notifications
      await pool.query(
        `UPDATE notification_queue SET status = 'cancelled'
         WHERE payload_json->>'$.split_id' = ? AND status = 'pending'`,
        [splitId],
      );
      // Tokens cascade via FK
      await pool.query(`DELETE FROM payment_splits WHERE id = ?`, [splitId]);
      res.json({ ok: true });
    },
  );

  // ── Admin payment splits overview (all cases) ─────────────────────────────
  app.get("/api/admin/payment-splits", requireAdmin, async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
    const offset = (page - 1) * limit;
    const status = req.query.status as string | undefined;
    const allowedStatuses = ["pending", "paid", "overdue", "cancelled"];

    const conditions: string[] = [];
    const args: any[] = [];
    if (status && allowedStatuses.includes(status)) {
      conditions.push("ps.status = ?");
      args.push(status);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const [[countRow]] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM payment_splits ps ${where}`,
      args,
    );
    const total = (countRow.total as number) || 0;

    const [splits] = await pool.query<RowDataPacket[]>(
      `SELECT ps.id, ps.case_id, cr.case_number, ps.client_id,
              c.first_name AS client_first_name, c.last_name AS client_last_name,
              c.email AS client_email,
              ps.label, ps.amount_cents, ps.currency, ps.due_date,
              ps.status, ps.completion_source, ps.paid_at, ps.payments_id,
              ps.reminder_flow_id, rf.name AS reminder_flow_name,
              ps.send_payment_link, ps.notes, ps.created_at, ps.updated_at,
              pst.token AS payment_token
       FROM payment_splits ps
       JOIN credit_repair_cases cr ON cr.id = ps.case_id
       JOIN clients c ON c.id = ps.client_id
       LEFT JOIN reminder_flows rf ON rf.id = ps.reminder_flow_id
       LEFT JOIN payment_split_tokens pst ON pst.split_id = ps.id
       ${where}
       ORDER BY ps.due_date ASC
       LIMIT ? OFFSET ?`,
      [...args, limit, offset],
    );
    const appUrl = process.env.APP_URL || "https://optimumcredit.com";
    const result = splits.map((s) => ({
      ...s,
      payment_link: s.payment_token ? `${appUrl}/pay/${s.payment_token}` : null,
    }));
    res.json({
      splits: result,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  });

  // ── Admin calendar: splits in date range ──────────────────────────────────
  app.get("/api/admin/calendar", requireAdmin, async (req, res) => {
    const { from, to } = req.query as { from?: string; to?: string };
    if (!from || !to)
      return res
        .status(400)
        .json({ error: "from and to query params required" });

    const [splits] = await pool.query<RowDataPacket[]>(
      `SELECT ps.id, ps.case_id, cr.case_number, ps.client_id,
              c.first_name AS client_first_name, c.last_name AS client_last_name,
              ps.label, ps.amount_cents, ps.currency, ps.due_date,
              ps.status, ps.completion_source
       FROM payment_splits ps
       JOIN credit_repair_cases cr ON cr.id = ps.case_id
       JOIN clients c ON c.id = ps.client_id
       WHERE ps.due_date BETWEEN ? AND ?
       ORDER BY ps.due_date ASC`,
      [from, to],
    );
    res.json({ splits });
  });

  // ── Get single case detail (pipeline panel) ──────────────────────────────
  app.get("/api/admin/cases/:id", requireAdmin, async (req, res) => {
    const caseId = Number(req.params.id);
    if (!caseId || isNaN(caseId))
      return res.status(400).json({ error: "Invalid case id" });

    const [caseRows] = await pool.query<RowDataPacket[]>(
      `SELECT cr.id AS case_id, cr.case_number, cr.pipeline_stage AS case_stage,
              cr.status AS case_status, cr.created_at AS case_created_at,
              c.id, c.first_name, c.last_name, c.email, c.phone,
              cr.pipeline_stage,
              c.status, c.contract_signed_at, c.smart_credit_connected_at,
              c.crc_client_id, c.crc_synced_at, c.preferred_language,
              p.name AS package_name, p.price_cents AS package_price_cents
       FROM credit_repair_cases cr
       JOIN clients c ON c.id = cr.client_id
       LEFT JOIN packages p ON p.id = cr.package_id
       WHERE cr.id = ? LIMIT 1`,
      [caseId],
    );
    if (caseRows.length === 0)
      return res.status(404).json({ error: "Case not found" });

    const row = caseRows[0];
    const clientId = row.id as number;

    const [taskCompletions] = await pool.query<RowDataPacket[]>(
      `SELECT ctc.id, ctc.task_template_id, ctc.status AS completion_status,
              ctc.form_data_json, ctc.file_name, ctc.file_mime,
              ctc.signature_name, ctc.completed_at,
              ctc.admin_review_status, ctc.admin_notes, ctc.admin_reviewed_at,
              ott.slug, ott.task_type, ott.title_en, ott.title_es,
              ott.description_en, ott.description_es, ott.sort_order, ott.is_required
       FROM client_task_completions ctc
       JOIN onboarding_task_templates ott ON ott.id = ctc.task_template_id
       WHERE ctc.client_id = ?
       ORDER BY ott.sort_order ASC`,
      [clientId],
    );
    const [reports] = await pool.query<RowDataPacket[]>(
      `SELECT id, round_number, score_before, score_after, items_removed,
              items_disputed, summary_md,
              pdf_file_name, (pdf_storage_key IS NOT NULL) AS has_pdf, pdf_uploaded_at, created_at
       FROM client_round_reports WHERE client_id = ? ORDER BY round_number DESC`,
      [clientId],
    );
    await attachPdfsToReports(clientId, reports);
    const [payments] = await pool.query<RowDataPacket[]>(
      `SELECT p.id, p.amount_cents, p.status, p.paid_at, p.created_at,
              pk.name AS package_name
       FROM payments p LEFT JOIN packages pk ON pk.id = p.package_id
       WHERE p.client_id = ? ORDER BY p.created_at DESC`,
      [clientId],
    );
    const [pipeline] = await pool.query<RowDataPacket[]>(
      `SELECT id, from_stage, to_stage, notes, created_at
       FROM client_pipeline_history WHERE client_id = ? ORDER BY created_at DESC`,
      [clientId],
    );

    res.json({
      case_info: {
        id: row.case_id,
        case_number: row.case_number,
        status: row.case_status,
        pipeline_stage: row.case_stage,
        created_at: row.case_created_at,
      },
      client: {
        id: row.id,
        first_name: row.first_name,
        last_name: row.last_name,
        email: row.email,
        phone: row.phone,
        pipeline_stage: row.pipeline_stage, // sourced from case stage
        status: row.status,
        contract_signed_at: row.contract_signed_at,
        smart_credit_connected_at: row.smart_credit_connected_at,
        crc_client_id: row.crc_client_id,
        crc_synced_at: row.crc_synced_at,
        preferred_language: row.preferred_language,
        package_name: row.package_name,
        package_price_cents: row.package_price_cents,
      },
      documents: taskCompletions,
      reports,
      payments,
      pipeline_history: pipeline,
    });
  });

  // ── Update case pipeline stage ────────────────────────────────────────────
  app.post(
    "/api/admin/cases/:id/stage",
    requireAdmin,
    async (req: AuthedRequest, res) => {
      const caseId = Number(req.params.id);
      if (!caseId || isNaN(caseId))
        return res.status(400).json({ error: "Invalid case id" });

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
        `SELECT cr.pipeline_stage, cr.client_id FROM credit_repair_cases cr WHERE cr.id = ? LIMIT 1`,
        [caseId],
      );
      if (cur.length === 0)
        return res.status(404).json({ error: "Case not found" });

      const fromStage = cur[0].pipeline_stage as string;
      const clientId = cur[0].client_id as number;
      if (fromStage === stage) return res.json({ ok: true, unchanged: true });

      // Enforce docs_ready rule: all required tasks must be approved
      if (stage === "docs_ready") {
        const [[requiredRow]] = await pool.query<RowDataPacket[]>(
          `SELECT COUNT(*) AS required_total FROM onboarding_task_templates
           WHERE is_active = 1 AND is_required = 1`,
        );
        const requiredTotal = Number(requiredRow.required_total);

        const [[approvedRow]] = await pool.query<RowDataPacket[]>(
          `SELECT COUNT(*) AS approved_count
           FROM client_task_completions ctc
           JOIN onboarding_task_templates ott ON ott.id = ctc.task_template_id
           WHERE ctc.client_id = ? AND ctc.admin_review_status = 'approved'
             AND ott.is_required = 1 AND ott.is_active = 1`,
          [clientId],
        );
        const approvedCount = Number(approvedRow.approved_count);

        if (approvedCount < requiredTotal) {
          return res.status(422).json({
            error: `Cannot advance to Docs Verified — ${requiredTotal - approvedCount} required task(s) still need approval.`,
          });
        }
      }

      // Update the case stage
      await pool.query<ResultSetHeader>(
        `UPDATE credit_repair_cases SET pipeline_stage = ?, pipeline_stage_changed_at = NOW() WHERE id = ?`,
        [stage, caseId],
      );
      // Keep clients.pipeline_stage in sync for client portal backward compat
      await pool.query<ResultSetHeader>(
        `UPDATE clients SET pipeline_stage = ?, pipeline_stage_changed_at = NOW() WHERE id = ?`,
        [stage, clientId],
      );
      await pool.query<ResultSetHeader>(
        `INSERT INTO client_pipeline_history (client_id, from_stage, to_stage, changed_by_admin_id, notes)
         VALUES (?,?,?,?,?)`,
        [clientId, fromStage, stage, req.auth!.id, notes || null],
      );

      if (stage === "completed") {
        triggerReminderFlow("completed", clientId).catch((e) =>
          console.error("[flow:completed]", e?.message),
        );
      }
      crcSyncClient(clientId).catch((e) =>
        console.error("[crc:stage-sync]", e?.message),
      );
      res.json({ ok: true });
    },
  );

  // ── Create client ────────────────────────────────────────────────────────
  app.post("/api/admin/clients", requireAdmin, async (req, res) => {
    const {
      first_name,
      last_name,
      email,
      phone,
      package_id,
      status,
      admin_notes,
      send_welcome_email,
      preferred_language,
    } = req.body || {};
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
    const lang = preferred_language === "es" ? "es" : "en";
    try {
      const [result] = await pool.query<ResultSetHeader>(
        `INSERT INTO clients (first_name, last_name, email, phone, package_id, status, preferred_language, admin_notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          String(first_name).trim(),
          String(last_name).trim(),
          String(email).trim().toLowerCase(),
          phone ? String(phone).trim() : null,
          package_id ? Number(package_id) : null,
          clientStatus,
          lang,
          admin_notes ? String(admin_notes).trim() : null,
        ],
      );
      const clientId = result.insertId;
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT c.id, c.first_name, c.last_name, c.email, c.phone, c.pipeline_stage,
                c.status, c.created_at, p.name AS package_name, p.slug AS package_slug
         FROM clients c LEFT JOIN packages p ON p.id = c.package_id
         WHERE c.id = ? LIMIT 1`,
        [clientId],
      );
      // Optionally send welcome email with portal access link
      if (send_welcome_email) {
        try {
          const token = await createOnboardingToken(clientId, 72);
          const portalUrl = `${process.env.APP_URL || "https://optimumcredit.com"}/onboarding?token=${token}`;
          const tpl = tplClientWelcome({
            firstName: String(first_name).trim(),
            portalUrl,
            lang,
          });
          await sendEmail({
            to: String(email).trim().toLowerCase(),
            subject: tpl.subject,
            html: tpl.html,
          });
        } catch (emailErr) {
          console.error("[admin/clients] welcome email failed:", emailErr);
        }
      }
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
    const {
      first_name,
      last_name,
      email,
      phone,
      package_id,
      status,
      admin_notes,
    } = req.body || {};
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
    if (admin_notes !== undefined) {
      updates.push("admin_notes = ?");
      args.push(admin_notes ? String(admin_notes).trim() : null);
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
      // Async CRC sync when stage changes — do not block response
      crcSyncClient(id).catch((e) =>
        console.error("[crc:stage-sync]", e?.message),
      );
      res.json({ ok: true });
    },
  );

  // ============================================================
  // CREDIT REPAIR CLOUD — ADMIN ENDPOINTS
  // ============================================================

  /** GET /api/admin/crc/status — check CRC configuration */
  app.get("/api/admin/crc/status", requireAdmin, (_req, res) => {
    res.json({
      configured: crcConfigured,
      dry_run: crcDryRun,
      mode: !crcConfigured ? "disabled" : crcDryRun ? "dry_run" : "live",
    });
  });

  /**
   * GET /api/admin/crc/preview/:id — preview the XML payload for a client
   * without sending anything to CRC. Safe to use anytime.
   */
  app.get("/api/admin/crc/preview/:id", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT c.id, c.first_name, c.last_name, c.email, c.phone,
                c.address_line1, c.city, c.state, c.zip,
                c.ssn_last4, c.date_of_birth, c.pipeline_stage,
                c.crc_client_id, c.crc_synced_at
         FROM clients c WHERE c.id = ? LIMIT 1`,
      [id],
    );
    if (rows.length === 0)
      return res.status(404).json({ error: "Client not found" });
    const c = rows[0];
    const isUpdate = !!c.crc_client_id;
    const xmlData = buildCrcClientXml({
      id: isUpdate ? (c.crc_client_id as string) : null,
      type: mapStageToCrcType(c.pipeline_stage as string),
      firstname: c.first_name as string,
      lastname: c.last_name as string,
      email: c.email as string,
      phone_home: c.phone as string | null,
      street_address: c.address_line1 as string | null,
      city: c.city as string | null,
      state: c.state as string | null,
      zip: c.zip as string | null,
      ssno: c.ssn_last4 as string | null,
      birth_date: c.date_of_birth
        ? new Date(c.date_of_birth as string).toLocaleDateString("en-US")
        : null,
    });
    res.json({
      action: isUpdate ? "updateRecord" : "insertRecord",
      endpoint: isUpdate
        ? `${CRC_BASE_URL}/lead/updateRecord`
        : `${CRC_BASE_URL}/lead/insertRecord`,
      crc_client_id: c.crc_client_id ?? null,
      crc_synced_at: c.crc_synced_at ?? null,
      xmlData,
      note: "This is a preview only — nothing was sent to CRC.",
    });
  });

  /**
   * POST /api/admin/crc/simulate-webhook — fire a fake Zapier stage-change
   * event against our own webhook handler. Useful for local testing without Zapier.
   *
   * Body: { clientId?: number, email?: string, stage: string }
   */
  app.post(
    "/api/admin/crc/simulate-webhook",
    requireAdmin,
    async (req, res) => {
      const { clientId, email, stage } = req.body || {};
      if (!stage) return res.status(400).json({ error: "Missing stage" });

      // Resolve the client's email if clientId provided
      let resolvedEmail = email;
      if (!resolvedEmail && clientId) {
        const [rows] = await pool.query<RowDataPacket[]>(
          `SELECT email FROM clients WHERE id = ? LIMIT 1`,
          [Number(clientId)],
        );
        resolvedEmail = rows[0]?.email;
      }
      if (!resolvedEmail)
        return res.status(400).json({ error: "Provide clientId or email" });

      // Forward internally to webhook handler (simulate Zapier POST).
      // Must call Express directly on its plain-HTTP port (not the Vite HTTPS port).
      const webhookSecret = process.env.CRC_WEBHOOK_SECRET || "";
      const internalRes = await fetch(
        `http://localhost:${process.env.EXPRESS_PORT || 8081}/api/webhooks/crc`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            secret: webhookSecret,
            email: resolvedEmail,
            stage,
          }),
        },
      );
      const result = await internalRes.json();
      res.json({ simulated: true, webhook_response: result });
    },
  );

  /** POST /api/admin/clients/:id/crc-sync — manually push a client to CRC */
  app.post(
    "/api/admin/clients/:id/crc-sync",
    requireAdmin,
    async (req, res) => {
      const id = Number(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      try {
        await crcSyncClient(id);
        const [rows] = await pool.query<RowDataPacket[]>(
          `SELECT crc_client_id, crc_synced_at FROM clients WHERE id = ? LIMIT 1`,
          [id],
        );
        res.json({
          ok: true,
          crc_client_id: rows[0]?.crc_client_id ?? null,
          crc_synced_at: rows[0]?.crc_synced_at ?? null,
        });
      } catch (e: any) {
        res.status(500).json({ error: e?.message ?? "CRC sync failed" });
      }
    },
  );

  /** GET /api/admin/crc/sync-log — latest CRC sync log entries */
  app.get("/api/admin/crc/sync-log", requireAdmin, async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT l.id, l.client_id, c.first_name, c.last_name, c.email,
              l.action, l.crc_client_id, l.pipeline_stage,
              l.status, l.error_message, l.created_at
       FROM crc_sync_log l
       JOIN clients c ON c.id = l.client_id
       ORDER BY l.created_at DESC
       LIMIT ?`,
      [limit],
    );
    res.json(rows);
  });

  // ============================================================
  // CREDIT REPAIR CLOUD — WEBHOOK (called by Zapier)
  // ============================================================
  /**
   * POST /api/webhooks/crc
   * Receives a stage-change event from Zapier (or CRC directly).
   *
   * Expected JSON body (sent by Zapier):
   * {
   *   "secret": "<CRC_WEBHOOK_SECRET>",  // optional shared secret
   *   "email": "client@example.com",     // used to look up local client
   *   "crc_client_id": "ODY4",           // CRC base64 ID (optional fallback)
   *   "stage": "Round 2 (Month 2)"       // stage name from CRC/GoHighLevel
   * }
   */
  app.post("/api/webhooks/crc", async (req, res) => {
    // Verify shared secret if configured (timing-safe comparison)
    const webhookSecret = process.env.CRC_WEBHOOK_SECRET;
    if (webhookSecret) {
      const provided = String(req.body?.secret ?? "");
      const secretBuf = Buffer.from(webhookSecret);
      const providedBuf = Buffer.alloc(secretBuf.length);
      providedBuf.write(provided.slice(0, secretBuf.length));
      if (!crypto.timingSafeEqual(secretBuf, providedBuf)) {
        return res.status(401).json({ error: "Unauthorized" });
      }
    }

    const { email, crc_client_id, stage } = req.body || {};

    if (!stage) return res.status(400).json({ error: "Missing stage" });
    if (!email && !crc_client_id)
      return res.status(400).json({ error: "Missing email or crc_client_id" });

    // Map CRC stage name → our enum
    const mapped = CRC_STAGE_MAP[String(stage).toLowerCase().trim()];
    if (!mapped) {
      console.warn("[crc:webhook] Unknown stage:", stage);
      return res.status(422).json({ error: `Unknown stage: ${stage}` });
    }

    // Find the client
    const params: (string | number)[] = [];
    let lookup = "";
    if (email) {
      lookup = "email = ?";
      params.push(String(email).toLowerCase().trim());
    } else {
      lookup = "crc_client_id = ?";
      params.push(String(crc_client_id));
    }

    const [clients] = await pool.query<RowDataPacket[]>(
      `SELECT id, pipeline_stage, crc_client_id FROM clients WHERE ${lookup} LIMIT 1`,
      params,
    );

    if (clients.length === 0) {
      console.warn("[crc:webhook] Client not found:", email || crc_client_id);
      // Return 200 so Zapier doesn't retry — we just can't find this client
      return res.json({ ok: false, reason: "client_not_found" });
    }

    const client = clients[0];
    const clientId = client.id as number;
    const fromStage = client.pipeline_stage as string;

    // Store crc_client_id if we didn't have it yet
    if (crc_client_id && !client.crc_client_id) {
      await pool.query<ResultSetHeader>(
        `UPDATE clients SET crc_client_id = ? WHERE id = ?`,
        [String(crc_client_id), clientId],
      );
    }

    if (fromStage === mapped) {
      return res.json({ ok: true, unchanged: true });
    }

    await pool.query<ResultSetHeader>(
      `UPDATE clients SET pipeline_stage = ?, pipeline_stage_changed_at = NOW() WHERE id = ?`,
      [mapped, clientId],
    );
    await pool.query<ResultSetHeader>(
      `INSERT INTO client_pipeline_history (client_id, from_stage, to_stage, notes)
       VALUES (?, ?, ?, 'Automated: CRC webhook')`,
      [clientId, fromStage, mapped],
    );

    // Log the webhook sync
    await pool.query<ResultSetHeader>(
      `INSERT INTO crc_sync_log (client_id, action, crc_client_id, pipeline_stage, status, payload)
       VALUES (?, 'webhook_stage_update', ?, ?, 'success', ?)`,
      [
        clientId,
        crc_client_id || client.crc_client_id || null,
        mapped,
        JSON.stringify({ from: fromStage, to: mapped, raw_stage: stage }),
      ],
    );

    // Trigger reminder flow for completed stage
    if (mapped === "completed") {
      triggerReminderFlow("completed", clientId).catch((e) =>
        console.error("[flow:completed]", e?.message),
      );
    }

    res.json({ ok: true, stage: mapped, clientId });
  });

  app.get("/api/admin/documents", requireAdmin, async (req, res) => {
    const status = (req.query.status as string) || "all";
    const search = ((req.query.search as string) || "").trim();

    const params: (string | number)[] = [];
    const conditions: string[] = [
      "t.task_type = 'upload'",
      "ctc.file_name IS NOT NULL",
      "ctc.status = 'completed'",
    ];

    if (status !== "all") {
      conditions.push("ctc.admin_review_status = ?");
      params.push(status);
    }
    if (search) {
      conditions.push(
        "(cl.first_name LIKE ? OR cl.last_name LIKE ? OR cl.email LIKE ? OR ctc.file_name LIKE ?)",
      );
      const like = `%${search}%`;
      params.push(like, like, like, like);
    }

    const where = `WHERE ${conditions.join(" AND ")}`;

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT ctc.id, ctc.client_id,
              t.slug AS doc_type,
              NULL AS pipeline_round,
              ctc.file_name, 0 AS file_size, ctc.file_mime AS mime_type,
              ctc.admin_review_status AS review_status,
              ctc.admin_notes AS rejection_reason,
              ctc.completed_at AS uploaded_at,
              ctc.admin_reviewed_at AS reviewed_at,
              cl.first_name, cl.last_name, cl.email, cl.preferred_language,
              crc.case_number
       FROM client_task_completions ctc
       JOIN onboarding_task_templates t ON t.id = ctc.task_template_id
       JOIN clients cl ON cl.id = ctc.client_id
       LEFT JOIN credit_repair_cases crc ON crc.client_id = ctc.client_id
       ${where}
       ORDER BY ctc.completed_at DESC LIMIT 500`,
      params,
    );
    res.json({ documents: rows });
  });

  app.patch(
    "/api/admin/documents/:id/pipeline-round",
    requireAdmin,
    async (req: AuthedRequest, res) => {
      const id = Number(req.params.id);
      const { pipeline_round } = req.body || {};
      const VALID_ROUNDS = [
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
      if (
        pipeline_round !== null &&
        pipeline_round !== undefined &&
        !VALID_ROUNDS.includes(pipeline_round)
      ) {
        return res.status(400).json({ error: "Invalid pipeline_round value" });
      }
      await pool.query<ResultSetHeader>(
        `UPDATE client_documents SET pipeline_round = ? WHERE id = ?`,
        [pipeline_round || null, id],
      );
      res.json({ ok: true });
    },
  );

  // Serve decrypted document file to admin (streamed, authenticated)
  app.get(
    "/api/admin/documents/:id/file",
    requireAdmin,
    async (req: AuthedRequest, res) => {
      const id = Number(req.params.id);
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT file_storage_key, file_name, file_mime
         FROM client_task_completions WHERE id = ? LIMIT 1`,
        [id],
      );
      if (rows.length === 0 || !rows[0].file_storage_key)
        return res.status(404).json({ error: "Not found" });
      const doc = rows[0];
      const parts = (doc.file_storage_key as string).split("|");
      if (parts.length !== 3)
        return res.status(500).json({ error: "Invalid storage key format" });
      const [cdnKey, iv, tag] = parts;
      try {
        const cdnRes = await fetch(cdnKey);
        if (!cdnRes.ok)
          return res.status(404).json({ error: "File not available" });
        const encrypted = Buffer.from(await cdnRes.arrayBuffer());
        const buf = decryptFile(encrypted, iv, tag);
        res.set(
          "Content-Type",
          (doc.file_mime as string) || "application/octet-stream",
        );
        res.set(
          "Content-Disposition",
          `inline; filename="${encodeURIComponent(doc.file_name as string)}"`,
        );
        res.set("Content-Length", String(buf.length));
        res.set("Cache-Control", "no-store, no-cache");
        res.send(buf);
      } catch {
        res.status(404).json({ error: "File not found" });
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
        `SELECT d.id, d.doc_type, d.client_id, c.first_name, c.email, c.phone, c.preferred_language
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
          lang: d.preferred_language || "en",
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
          // Notify client that all their documents have been approved
          const portalUrl = `${APP_URL}/portal/documents`;
          const approvedTpl = tplAllDocsApproved({
            firstName: d.first_name,
            portalUrl,
            lang: d.preferred_language || "en",
          });
          await sendEmail({
            to: d.email,
            subject: approvedTpl.subject,
            html: approvedTpl.html,
          }).catch(() => null);
          if (d.phone) {
            await sendSms({
              to: d.phone,
              body: `Optimum Credit: great news! All your documents have been verified and your case is now being processed. Log in to track your progress: ${APP_URL}/portal`,
            }).catch(() => null);
          }
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
        `SELECT first_name, email, phone, preferred_language FROM clients WHERE id = ? LIMIT 1`,
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
          lang: c.preferred_language || "en",
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

  // ── Upload PDF for a round report (multiple PDFs per round supported) ────
  app.post(
    "/api/admin/clients/:clientId/round-reports/:round/pdf",
    requireSuperAdmin,
    upload.single("pdf"),
    async (req: AuthedRequest, res) => {
      const clientId = Number(req.params.clientId);
      const roundNumber = Number(req.params.round);
      if (
        !clientId ||
        isNaN(clientId) ||
        isNaN(roundNumber) ||
        roundNumber < 1 ||
        roundNumber > 5
      ) {
        return res
          .status(400)
          .json({ error: "Invalid clientId or round number" });
      }
      const file = req.file;
      if (!file) return res.status(400).json({ error: "PDF file required" });
      if (file.mimetype !== "application/pdf") {
        return res.status(400).json({ error: "Only PDF files are accepted" });
      }

      // Encrypt the PDF
      const { encrypted, iv, tag } = encryptFile(file.buffer);
      const safeOrigName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
      const cdnUrl = await uploadToCDN(
        encrypted,
        `round${roundNumber}_${Date.now()}_${safeOrigName}.enc`,
        "application/octet-stream",
        clientId,
      );

      // Ensure the round_report row exists (upsert without touching pdf_ columns)
      await pool.query<ResultSetHeader>(
        `INSERT INTO client_round_reports (client_id, round_number, created_by_admin_id)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE created_by_admin_id = created_by_admin_id`,
        [clientId, roundNumber, req.auth!.id],
      );
      const [[roundReportRow]] = await pool.query<RowDataPacket[]>(
        `SELECT id FROM client_round_reports WHERE client_id = ? AND round_number = ? LIMIT 1`,
        [clientId, roundNumber],
      );
      const roundReportId = roundReportRow?.id ?? null;

      // Check if this is the first PDF for this round (for email notification)
      const [[{ pdfCount }]] = await pool.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS pdfCount FROM round_report_pdfs WHERE client_id = ? AND round_number = ?`,
        [clientId, roundNumber],
      );
      const isFirstPdf = Number(pdfCount) === 0;

      // Insert into round_report_pdfs
      const [insertResult] = await pool.query<ResultSetHeader>(
        `INSERT INTO round_report_pdfs
           (client_id, round_number, round_report_id, file_name, storage_key, storage_provider, encrypted, enc_iv, enc_tag, uploaded_by_admin_id)
         VALUES (?, ?, ?, ?, ?, 'cdn', 1, ?, ?, ?)`,
        [
          clientId,
          roundNumber,
          roundReportId,
          file.originalname,
          cdnUrl,
          iv,
          tag,
          req.auth!.id,
        ],
      );
      const newPdfId = insertResult.insertId;

      // Fetch the new pdf row to return
      const [[newPdf]] = await pool.query<RowDataPacket[]>(
        `SELECT id, client_id, round_number, round_report_id, file_name, uploaded_at
         FROM round_report_pdfs WHERE id = ?`,
        [newPdfId],
      );

      // Fetch the parent report row
      const [reportRows] = await pool.query<RowDataPacket[]>(
        `SELECT id, round_number, score_before, score_after, items_removed, items_disputed, summary_md,
                pdf_file_name, (pdf_storage_key IS NOT NULL) AS has_pdf, pdf_uploaded_at, created_at
         FROM client_round_reports WHERE client_id = ? AND round_number = ? LIMIT 1`,
        [clientId, roundNumber],
      );
      await attachPdfsToReports(clientId, reportRows);
      const report = reportRows[0] ?? null;

      // Notify client via email on first PDF upload for this round
      if (isFirstPdf) {
        const [crows] = await pool.query<RowDataPacket[]>(
          `SELECT first_name, email, preferred_language FROM clients WHERE id = ? LIMIT 1`,
          [clientId],
        );
        const c = crows[0];
        if (c) {
          const tpl = tplRoundPdfReady({
            firstName: c.first_name as string,
            roundNumber,
            portalUrl: `${APP_URL}/portal/reports`,
            lang: c.preferred_language as string,
          });
          await sendEmail({
            to: c.email as string,
            subject: tpl.subject,
            html: tpl.html,
          }).catch(() => null);
        }
      }

      res.json({ ok: true, pdf: newPdf, report });
    },
  );

  // ── Serve a specific round_report_pdfs entry (admin) ─────────────────────
  app.get(
    "/api/admin/round-report-pdfs/:pdfId",
    requireAdmin,
    async (req, res) => {
      const pdfId = Number(req.params.pdfId);
      if (!pdfId || isNaN(pdfId))
        return res.status(400).json({ error: "Invalid id" });

      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT file_name, storage_key, storage_provider, encrypted, enc_iv, enc_tag
         FROM round_report_pdfs WHERE id = ? LIMIT 1`,
        [pdfId],
      );
      if (rows.length === 0)
        return res.status(404).json({ error: "PDF not found" });
      const r = rows[0];
      try {
        const cdnRes = await fetch(r.storage_key as string);
        if (!cdnRes.ok)
          return res.status(404).json({ error: "File not available" });
        const raw = Buffer.from(await cdnRes.arrayBuffer());
        const buf =
          r.encrypted && r.enc_iv && r.enc_tag
            ? decryptFile(raw, r.enc_iv as string, r.enc_tag as string)
            : raw;
        res.set("Content-Type", "application/pdf");
        res.set(
          "Content-Disposition",
          `inline; filename="${encodeURIComponent(r.file_name as string)}"`,
        );
        res.set("Content-Length", String(buf.length));
        res.set("Cache-Control", "no-store, no-cache");
        res.send(buf);
      } catch {
        res.status(500).json({ error: "Failed to retrieve PDF" });
      }
    },
  );

  // ── Delete a specific round_report_pdfs entry (super_admin) ──────────────
  app.delete(
    "/api/admin/round-report-pdfs/:pdfId",
    requireSuperAdmin,
    async (req, res) => {
      const pdfId = Number(req.params.pdfId);
      if (!pdfId || isNaN(pdfId))
        return res.status(400).json({ error: "Invalid id" });

      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id, client_id, round_number FROM round_report_pdfs WHERE id = ? LIMIT 1`,
        [pdfId],
      );
      if (rows.length === 0)
        return res.status(404).json({ error: "PDF not found" });

      await pool.query(`DELETE FROM round_report_pdfs WHERE id = ?`, [pdfId]);
      res.json({ ok: true });
    },
  );

  // ── Legacy: serve latest PDF for a round report row (admin) ──────────────
  app.get(
    "/api/admin/round-reports/:reportId/pdf",
    requireAdmin,
    async (req, res) => {
      const reportId = Number(req.params.reportId);
      if (!reportId || isNaN(reportId))
        return res.status(400).json({ error: "Invalid id" });

      // Try new table first
      const [newRows] = await pool.query<RowDataPacket[]>(
        `SELECT rrp.file_name, rrp.storage_key, rrp.storage_provider, rrp.encrypted, rrp.enc_iv, rrp.enc_tag
         FROM round_report_pdfs rrp WHERE rrp.round_report_id = ?
         ORDER BY rrp.uploaded_at DESC LIMIT 1`,
        [reportId],
      );
      // Fall back to legacy pdf_ columns
      const [legacyRows] =
        newRows.length === 0
          ? await pool.query<RowDataPacket[]>(
              `SELECT pdf_file_name AS file_name, pdf_storage_key AS storage_key,
                  pdf_storage_provider AS storage_provider, pdf_encrypted AS encrypted,
                  pdf_enc_iv AS enc_iv, pdf_enc_tag AS enc_tag
           FROM client_round_reports WHERE id = ? AND pdf_storage_key IS NOT NULL LIMIT 1`,
              [reportId],
            )
          : [[] as RowDataPacket[]];
      const r = newRows[0] ?? legacyRows[0] ?? null;
      if (!r) return res.status(404).json({ error: "PDF not found" });
      try {
        const cdnRes = await fetch(r.storage_key as string);
        if (!cdnRes.ok)
          return res.status(404).json({ error: "File not available" });
        const raw = Buffer.from(await cdnRes.arrayBuffer());
        const buf =
          r.encrypted && r.enc_iv && r.enc_tag
            ? decryptFile(raw, r.enc_iv as string, r.enc_tag as string)
            : raw;
        res.set("Content-Type", "application/pdf");
        res.set(
          "Content-Disposition",
          `inline; filename="${encodeURIComponent((r.file_name as string) || `round-report-${reportId}.pdf`)}"`,
        );
        res.set("Content-Length", String(buf.length));
        res.set("Cache-Control", "no-store, no-cache");
        res.send(buf);
      } catch {
        res.status(500).json({ error: "Failed to retrieve PDF" });
      }
    },
  );

  // ── Serve a specific round_report_pdfs entry (client portal) ─────────────
  app.get(
    "/api/portal/round-report-pdfs/:pdfId",
    requireClient,
    async (req: AuthedRequest, res) => {
      const clientId = req.auth!.id;
      const pdfId = Number(req.params.pdfId);
      if (!pdfId || isNaN(pdfId))
        return res.status(400).json({ error: "Invalid id" });

      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT file_name, storage_key, storage_provider, encrypted, enc_iv, enc_tag
         FROM round_report_pdfs WHERE id = ? AND client_id = ? LIMIT 1`,
        [pdfId, clientId],
      );
      if (rows.length === 0)
        return res.status(404).json({ error: "PDF not found" });
      const r = rows[0];
      try {
        const cdnRes = await fetch(r.storage_key as string);
        if (!cdnRes.ok)
          return res.status(404).json({ error: "File not available" });
        const raw = Buffer.from(await cdnRes.arrayBuffer());
        const buf =
          r.encrypted && r.enc_iv && r.enc_tag
            ? decryptFile(raw, r.enc_iv as string, r.enc_tag as string)
            : raw;
        res.set("Content-Type", "application/pdf");
        res.set(
          "Content-Disposition",
          `inline; filename="${encodeURIComponent(r.file_name as string)}"`,
        );
        res.set("Content-Length", String(buf.length));
        res.set("Cache-Control", "no-store, no-cache");
        res.send(buf);
      } catch {
        res.status(500).json({ error: "Failed to retrieve PDF" });
      }
    },
  );

  // ── Legacy: serve latest PDF for a round (client portal) ─────────────────
  app.get(
    "/api/portal/round-reports/:round/pdf",
    requireClient,
    async (req: AuthedRequest, res) => {
      const clientId = req.auth!.id;
      const roundNumber = Number(req.params.round);
      if (isNaN(roundNumber) || roundNumber < 1 || roundNumber > 5) {
        return res.status(400).json({ error: "Invalid round number" });
      }

      // Try new table first (latest PDF for this round)
      const [newRows] = await pool.query<RowDataPacket[]>(
        `SELECT file_name, storage_key, storage_provider, encrypted, enc_iv, enc_tag
         FROM round_report_pdfs WHERE client_id = ? AND round_number = ?
         ORDER BY uploaded_at DESC LIMIT 1`,
        [clientId, roundNumber],
      );
      // Fall back to legacy pdf_ columns
      const [legacyRows] =
        newRows.length === 0
          ? await pool.query<RowDataPacket[]>(
              `SELECT pdf_file_name AS file_name, pdf_storage_key AS storage_key,
                  pdf_storage_provider AS storage_provider, pdf_encrypted AS encrypted,
                  pdf_enc_iv AS enc_iv, pdf_enc_tag AS enc_tag
           FROM client_round_reports
           WHERE client_id = ? AND round_number = ? AND pdf_storage_key IS NOT NULL LIMIT 1`,
              [clientId, roundNumber],
            )
          : [[] as RowDataPacket[]];
      const r = newRows[0] ?? legacyRows[0] ?? null;
      if (!r) return res.status(404).json({ error: "PDF not found" });
      try {
        const cdnRes = await fetch(r.storage_key as string);
        if (!cdnRes.ok)
          return res.status(404).json({ error: "File not available" });
        const raw = Buffer.from(await cdnRes.arrayBuffer());
        const buf =
          r.encrypted && r.enc_iv && r.enc_tag
            ? decryptFile(raw, r.enc_iv as string, r.enc_tag as string)
            : raw;
        const fileName =
          (r.file_name as string) || `round-${roundNumber}-report.pdf`;
        res.set("Content-Type", "application/pdf");
        res.set(
          "Content-Disposition",
          `inline; filename="${encodeURIComponent(fileName)}"`,
        );
        res.set("Content-Length", String(buf.length));
        res.set("Cache-Control", "no-store, no-cache");
        res.send(buf);
      } catch {
        res.status(500).json({ error: "Failed to retrieve PDF" });
      }
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

  // Support FAQ — admin CRUD
  app.get("/api/admin/support-faq", requireAdmin, async (_req, res) => {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, question, answer, category, sort_order, is_active, created_at, updated_at FROM support_faq ORDER BY sort_order ASC, id ASC`,
    );
    res.json({ faqs: rows });
  });

  app.post("/api/admin/support-faq", requireAdmin, async (req, res) => {
    const { question, answer, category, sort_order, is_active } =
      req.body || {};
    if (!question || !answer)
      return res
        .status(400)
        .json({ error: "question and answer are required" });
    const [r] = await pool.query<ResultSetHeader>(
      `INSERT INTO support_faq (question, answer, category, sort_order, is_active) VALUES (?, ?, ?, ?, ?)`,
      [
        question,
        answer,
        category || "general",
        sort_order ?? 0,
        is_active !== false ? 1 : 0,
      ],
    );
    res.json({ id: r.insertId });
  });

  app.put("/api/admin/support-faq/:id", requireAdmin, async (req, res) => {
    const { question, answer, category, sort_order, is_active } =
      req.body || {};
    await pool.query<ResultSetHeader>(
      `UPDATE support_faq SET question = COALESCE(?, question), answer = COALESCE(?, answer), category = COALESCE(?, category), sort_order = COALESCE(?, sort_order), is_active = COALESCE(?, is_active) WHERE id = ?`,
      [
        question ?? null,
        answer ?? null,
        category ?? null,
        sort_order ?? null,
        is_active != null ? (is_active ? 1 : 0) : null,
        req.params.id,
      ],
    );
    res.json({ ok: true });
  });

  app.delete("/api/admin/support-faq/:id", requireAdmin, async (req, res) => {
    await pool.query<ResultSetHeader>(`DELETE FROM support_faq WHERE id = ?`, [
      req.params.id,
    ]);
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

  // Upload a file to CDN and return the URL (no DB write)
  app.post(
    "/api/admin/educational-content/upload",
    requireAdmin,
    upload.single("file"),
    async (req, res) => {
      const f = (req as any).file as Express.Multer.File | undefined;
      if (!f) return res.status(400).json({ error: "No file provided" });
      try {
        const cdnUrl = await uploadToCDN(
          f.buffer,
          f.originalname,
          f.mimetype,
          "education",
        );
        res.json({ url: cdnUrl, mime_type: f.mimetype, size: f.size });
      } catch (err: any) {
        res.status(500).json({ error: err.message || "Upload failed" });
      }
    },
  );

  app.post("/api/admin/videos", requireAdmin, async (req, res) => {
    const {
      title,
      content_type,
      description,
      video_url,
      file_url,
      thumbnail_url,
      duration_seconds,
      category,
      language,
      is_published,
      sort_order,
    } = req.body || {};
    if (!title) return res.status(400).json({ error: "title is required" });
    const ctype = content_type || "video";
    if (ctype === "video" && !video_url && !file_url)
      return res
        .status(400)
        .json({ error: "video_url or file_url required for video content" });
    if (["pdf", "image", "article"].includes(ctype) && !file_url && !video_url)
      return res
        .status(400)
        .json({ error: "file_url required for this content type" });
    const [r] = await pool.query<ResultSetHeader>(
      `INSERT INTO educational_videos
         (title, content_type, description, video_url, file_url, thumbnail_url,
          duration_seconds, category, language, is_published, sort_order)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        title,
        ctype,
        description || null,
        video_url || null,
        file_url || null,
        thumbnail_url || null,
        duration_seconds || null,
        category || null,
        language || "en",
        is_published === false || is_published === 0 ? 0 : 1,
        sort_order || 0,
      ],
    );
    res.json({ id: r.insertId });
  });

  app.put("/api/admin/videos/:id", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const {
      title,
      content_type,
      description,
      video_url,
      file_url,
      thumbnail_url,
      duration_seconds,
      category,
      language,
      is_published,
      sort_order,
    } = req.body || {};
    if (!title) return res.status(400).json({ error: "title is required" });
    await pool.query<ResultSetHeader>(
      `UPDATE educational_videos
       SET title=?, content_type=?, description=?, video_url=?, file_url=?,
           thumbnail_url=?, duration_seconds=?, category=?, language=?,
           is_published=?, sort_order=?
       WHERE id=?`,
      [
        title,
        content_type || "video",
        description || null,
        video_url || null,
        file_url || null,
        thumbnail_url || null,
        duration_seconds || null,
        category || null,
        language || "en",
        is_published === false || is_published === 0 ? 0 : 1,
        sort_order ?? 0,
        id,
      ],
    );
    res.json({ ok: true });
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
      `SELECT p.id AS package_id, p.name AS package_name,
              COUNT(DISTINCT c.id) AS sold,
              COALESCE(SUM(CASE WHEN pay.status = 'succeeded' THEN pay.amount_cents ELSE 0 END), 0) AS revenue
       FROM packages p
       LEFT JOIN clients c ON c.package_id = p.id
       LEFT JOIN payments pay ON pay.client_id = c.id
       GROUP BY p.id, p.name ORDER BY sold DESC`,
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

  // GET /api/portal/section-locks — client portal sections (requires client auth)
  app.get("/api/portal/section-locks", requireClient, async (_req, res) => {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT section_key, label, is_locked, lock_reason
       FROM section_locks WHERE section_key LIKE 'portal_%' ORDER BY id ASC`,
    );
    res.json({
      section_locks: rows.map((r) => ({
        ...r,
        is_locked: Boolean(r.is_locked),
      })),
    });
  });

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

  // ============================================================================
  // ONBOARDING TASK TEMPLATES (admin + portal)
  // ============================================================================

  // GET /api/admin/task-templates — list task templates with optional search/filter
  app.get("/api/admin/task-templates", requireAdmin, async (req, res) => {
    const { search, type, active } = req.query as Record<string, string>;

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (search?.trim()) {
      conditions.push(
        "(title_en LIKE ? OR title_es LIKE ? OR slug LIKE ? OR COALESCE(description_en,'') LIKE ?)",
      );
      const q = `%${search.trim()}%`;
      params.push(q, q, q, q);
    }
    if (type && type !== "all") {
      conditions.push("task_type = ?");
      params.push(type);
    }
    if (active === "active") {
      conditions.push("is_active = 1");
    } else if (active === "inactive") {
      conditions.push("is_active = 0");
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, slug, task_type, title_en, title_es, description_en, description_es,
              content_html_en, content_html_es, form_fields_json, upload_config_json,
              is_required, is_system, sort_order, is_active, auto_assign, created_at, updated_at
       FROM onboarding_task_templates
       ${where}
       ORDER BY sort_order ASC, id ASC`,
      params,
    );
    res.json({ tasks: rows });
  });

  // POST /api/admin/task-templates — create a new task template
  app.post("/api/admin/task-templates", requireAdmin, async (req, res) => {
    const {
      slug,
      task_type,
      title_en,
      title_es,
      description_en,
      description_es,
      content_html_en,
      content_html_es,
      form_fields_json,
      upload_config_json,
      is_required,
      sort_order,
      is_active,
      auto_assign,
    } = req.body || {};

    if (!slug || !task_type || !title_en || !title_es) {
      return res
        .status(400)
        .json({ error: "slug, task_type, title_en, title_es are required" });
    }
    const validTypes = ["form", "upload", "sign_document"];
    if (!validTypes.includes(task_type)) {
      return res.status(400).json({ error: "Invalid task_type" });
    }

    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO onboarding_task_templates
        (slug, task_type, title_en, title_es, description_en, description_es,
         content_html_en, content_html_es, form_fields_json, upload_config_json,
         is_required, sort_order, is_active, auto_assign)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        slug.toLowerCase().replace(/\s+/g, "_"),
        task_type,
        title_en,
        title_es,
        description_en || null,
        description_es || null,
        content_html_en || null,
        content_html_es || null,
        form_fields_json ? JSON.stringify(form_fields_json) : null,
        upload_config_json ? JSON.stringify(upload_config_json) : null,
        is_required !== false ? 1 : 0,
        sort_order ?? 0,
        is_active !== false ? 1 : 0,
        auto_assign !== false ? 1 : 0,
      ],
    );

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM onboarding_task_templates WHERE id = ?`,
      [result.insertId],
    );
    res.status(201).json({ task: rows[0] });
  });

  // PUT /api/admin/task-templates/:id — update a task template
  app.put("/api/admin/task-templates/:id", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid id" });

    const [existing] = await pool.query<RowDataPacket[]>(
      `SELECT id, is_system FROM onboarding_task_templates WHERE id = ? LIMIT 1`,
      [id],
    );
    if (!existing[0]) return res.status(404).json({ error: "Task not found" });

    const {
      slug,
      task_type,
      title_en,
      title_es,
      description_en,
      description_es,
      content_html_en,
      content_html_es,
      form_fields_json,
      upload_config_json,
      is_required,
      sort_order,
      is_active,
      auto_assign,
    } = req.body || {};

    const updates: Record<string, unknown> = {};
    if (!existing[0].is_system && slug)
      updates.slug = slug.toLowerCase().replace(/\s+/g, "_");
    if (!existing[0].is_system && task_type) updates.task_type = task_type;
    if (title_en !== undefined) updates.title_en = title_en;
    if (title_es !== undefined) updates.title_es = title_es;
    if (description_en !== undefined)
      updates.description_en = description_en || null;
    if (description_es !== undefined)
      updates.description_es = description_es || null;
    if (content_html_en !== undefined)
      updates.content_html_en = content_html_en || null;
    if (content_html_es !== undefined)
      updates.content_html_es = content_html_es || null;
    if (form_fields_json !== undefined)
      updates.form_fields_json = form_fields_json
        ? JSON.stringify(form_fields_json)
        : null;
    if (upload_config_json !== undefined)
      updates.upload_config_json = upload_config_json
        ? JSON.stringify(upload_config_json)
        : null;
    if (is_required !== undefined) updates.is_required = is_required ? 1 : 0;
    if (sort_order !== undefined) updates.sort_order = sort_order;
    if (is_active !== undefined) updates.is_active = is_active ? 1 : 0;
    if (auto_assign !== undefined) updates.auto_assign = auto_assign ? 1 : 0;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    const setClauses = Object.keys(updates)
      .map((k) => `\`${k}\` = ?`)
      .join(", ");
    const values = [...Object.values(updates), id];
    await pool.query<ResultSetHeader>(
      `UPDATE onboarding_task_templates SET ${setClauses} WHERE id = ?`,
      values,
    );

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM onboarding_task_templates WHERE id = ?`,
      [id],
    );
    res.json({ task: rows[0] });
  });

  // DELETE /api/admin/task-templates/:id — delete (blocked for system tasks or those with completions)
  app.delete(
    "/api/admin/task-templates/:id",
    requireAdmin,
    async (req, res) => {
      const id = Number(req.params.id);
      if (!id) return res.status(400).json({ error: "Invalid id" });

      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id, is_system FROM onboarding_task_templates WHERE id = ? LIMIT 1`,
        [id],
      );
      if (!rows[0]) return res.status(404).json({ error: "Task not found" });
      if (rows[0].is_system) {
        return res
          .status(400)
          .json({ error: "System tasks cannot be deleted" });
      }

      const [completions] = await pool.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS cnt FROM client_task_completions WHERE task_template_id = ? AND status = 'completed'`,
        [id],
      );
      if ((completions[0] as RowDataPacket).cnt > 0) {
        return res.status(400).json({
          error: `This task has ${(completions[0] as RowDataPacket).cnt} completed submission(s) and cannot be deleted. Deactivate it instead.`,
        });
      }

      await pool.query<ResultSetHeader>(
        `DELETE FROM onboarding_task_templates WHERE id = ?`,
        [id],
      );
      res.json({ ok: true });
    },
  );

  // POST /api/admin/clients/:id/assign-tasks — manually trigger auto-assign for a client
  app.post(
    "/api/admin/clients/:id/assign-tasks",
    requireAdmin,
    async (req, res) => {
      const clientId = Number(req.params.id);
      if (!clientId)
        return res.status(400).json({ error: "Invalid client id" });

      const [client] = await pool.query<RowDataPacket[]>(
        `SELECT id FROM clients WHERE id = ? LIMIT 1`,
        [clientId],
      );
      if (!client[0])
        return res.status(404).json({ error: "Client not found" });

      await autoAssignTasksForClient(clientId);
      res.json({ ok: true, message: "Tasks assigned" });
    },
  );

  // GET /api/admin/clients/:id/task-completions — view a client's task progress
  app.get(
    "/api/admin/clients/:id/task-completions",
    requireAdmin,
    async (req, res) => {
      const clientId = Number(req.params.id);
      if (!clientId)
        return res.status(400).json({ error: "Invalid client id" });

      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT t.id AS template_id, t.slug, t.task_type,
                t.title_en, t.title_es, t.description_en, t.description_es,
                t.is_required, t.is_system, t.sort_order, t.is_active,
                c.id AS completion_id, c.status AS completion_status,
                c.signature_name, c.file_name, c.file_mime,
                c.completed_at, c.admin_review_status, c.admin_notes,
                c.admin_reviewed_at
         FROM onboarding_task_templates t
         LEFT JOIN client_task_completions c
           ON c.task_template_id = t.id AND c.client_id = ?
         WHERE t.is_active = 1
         ORDER BY t.sort_order ASC, t.id ASC`,
        [clientId],
      );

      // Normalize: `id` = completion row id (used for approve/reject/preview actions)
      // `template_id` = template reference
      const tasks = (rows as any[]).map((r) => ({
        id: r.completion_id ?? null,
        template_id: r.template_id,
        slug: r.slug,
        task_type: r.task_type,
        title_en: r.title_en,
        title_es: r.title_es,
        description_en: r.description_en,
        description_es: r.description_es,
        is_required: r.is_required,
        is_system: r.is_system,
        sort_order: r.sort_order,
        is_active: r.is_active,
        completion_status: r.completion_status ?? null,
        signature_name: r.signature_name ?? null,
        file_name: r.file_name ?? null,
        file_mime: r.file_mime ?? null,
        completed_at: r.completed_at ?? null,
        admin_review_status: r.admin_review_status ?? null,
        admin_notes: r.admin_notes ?? null,
        admin_reviewed_at: r.admin_reviewed_at ?? null,
      }));

      res.json({ tasks });
    },
  );

  // GET /api/portal/tasks — get all active tasks with this client's completion status
  app.get(
    "/api/portal/tasks",
    requireClient,
    async (req: AuthedRequest, res) => {
      const clientId = req.auth!.id;
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT t.id, t.slug, t.task_type, t.title_en, t.title_es,
              t.description_en, t.description_es,
              t.content_html_en, t.content_html_es,
              t.form_fields_json, t.upload_config_json,
              t.is_required, t.is_system, t.sort_order,
              c.id AS completion_id, c.status AS completion_status,
              c.signature_name, c.file_name, c.completed_at,
              c.admin_review_status, c.admin_notes, c.admin_reviewed_at
       FROM onboarding_task_templates t
       LEFT JOIN client_task_completions c
         ON c.task_template_id = t.id AND c.client_id = ?
       WHERE t.is_active = 1
       ORDER BY t.sort_order ASC, t.id ASC`,
        [clientId],
      );
      const tasks = (rows as any[]).map((r) => ({
        id: r.id,
        slug: r.slug,
        task_type: r.task_type,
        title_en: r.title_en,
        title_es: r.title_es,
        description_en: r.description_en,
        description_es: r.description_es,
        content_html_en: r.content_html_en,
        content_html_es: r.content_html_es,
        form_fields_json: r.form_fields_json,
        upload_config_json: r.upload_config_json,
        is_required: r.is_required,
        is_system: r.is_system,
        sort_order: r.sort_order,
        completion: r.completion_id
          ? {
              id: r.completion_id,
              status: r.completion_status,
              signature_name: r.signature_name,
              file_name: r.file_name,
              completed_at: r.completed_at,
              admin_review_status: r.admin_review_status,
              admin_notes: r.admin_notes,
              admin_reviewed_at: r.admin_reviewed_at,
            }
          : null,
      }));
      res.json({ tasks });
    },
  );

  // POST /api/portal/tasks/:id/complete — submit a task
  app.post(
    "/api/portal/tasks/:id/complete",
    requireClient,
    upload.single("file"),
    async (req: AuthedRequest, res) => {
      const clientId = req.auth!.id;
      const templateId = Number(req.params.id);
      if (!templateId)
        return res.status(400).json({ error: "Invalid task id" });

      const [tRows] = await pool.query<RowDataPacket[]>(
        `SELECT id, task_type FROM onboarding_task_templates WHERE id = ? AND is_active = 1 LIMIT 1`,
        [templateId],
      );
      if (!tRows[0]) return res.status(404).json({ error: "Task not found" });
      const taskType: string = tRows[0].task_type;

      let fileStorageKey: string | null = null;
      let fileName: string | null = null;
      let fileMime: string | null = null;
      let formData: unknown = null;
      let signatureName: string | null = null;
      const signatureIp = req.ip || null;

      if (taskType === "upload") {
        const file = req.file as Express.Multer.File | undefined;
        if (!file)
          return res
            .status(400)
            .json({ error: "File is required for upload tasks" });
        const { encrypted, iv, tag } = encryptFile(file.buffer);
        const cdnKey = await uploadToCDN(
          encrypted,
          file.originalname + ".enc",
          "application/octet-stream",
          clientId,
        );
        fileStorageKey = `${cdnKey}|${iv}|${tag}`;
        fileName = file.originalname;
        fileMime = file.mimetype;
      } else if (taskType === "form") {
        try {
          formData =
            typeof req.body.form_data === "string"
              ? JSON.parse(req.body.form_data)
              : req.body.form_data;
        } catch {
          return res.status(400).json({ error: "Invalid form_data JSON" });
        }
        if (!formData)
          return res.status(400).json({ error: "form_data required" });
      } else if (taskType === "sign_document") {
        signatureName = (req.body.signature_name || "").trim();
        if (!signatureName)
          return res.status(400).json({ error: "signature_name required" });
      }

      await pool.query<ResultSetHeader>(
        `INSERT INTO client_task_completions
          (client_id, task_template_id, status, form_data_json,
           file_storage_key, file_name, file_mime,
           signature_name, signature_ip, completed_at)
         VALUES (?,?, 'completed', ?, ?, ?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE
           status = 'completed',
           form_data_json = VALUES(form_data_json),
           file_storage_key = VALUES(file_storage_key),
           file_name = VALUES(file_name),
           file_mime = VALUES(file_mime),
           signature_name = VALUES(signature_name),
           signature_ip = VALUES(signature_ip),
           completed_at = NOW(),
           admin_review_status = 'pending',
           admin_notes = NULL,
           admin_reviewed_at = NULL`,
        [
          clientId,
          templateId,
          formData ? JSON.stringify(formData) : null,
          fileStorageKey,
          fileName,
          fileMime,
          signatureName,
          signatureIp,
        ],
      );

      res.json({ ok: true, completed_at: new Date().toISOString() });
    },
  );

  // GET /api/portal/tasks/:id/file — client views their own submitted file
  app.get(
    "/api/portal/tasks/:id/file",
    requireClient,
    async (req: AuthedRequest, res) => {
      const clientId = req.auth!.id;
      const templateId = Number(req.params.id);
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT file_storage_key, file_name, file_mime
         FROM client_task_completions
         WHERE task_template_id = ? AND client_id = ? LIMIT 1`,
        [templateId, clientId],
      );
      if (rows.length === 0 || !rows[0].file_storage_key)
        return res.status(404).json({ error: "File not found" });

      const { file_storage_key, file_name, file_mime } = rows[0];
      const parts = (file_storage_key as string).split("|");
      if (parts.length !== 3)
        return res.status(500).json({ error: "Invalid storage key" });
      const [cdnKey, iv, tag] = parts;
      try {
        const cdnRes = await fetch(cdnKey);
        if (!cdnRes.ok)
          return res.status(404).json({ error: "File not available" });
        const encrypted = Buffer.from(await cdnRes.arrayBuffer());
        const decrypted = decryptFile(encrypted, iv, tag);
        res.set(
          "Content-Type",
          (file_mime as string) || "application/octet-stream",
        );
        res.set(
          "Content-Disposition",
          `inline; filename="${encodeURIComponent(file_name as string)}"`,
        );
        res.set("Content-Length", String(decrypted.length));
        res.set("Cache-Control", "no-store, no-cache");
        res.send(decrypted);
      } catch {
        res.status(404).json({ error: "File could not be decrypted" });
      }
    },
  );

  app.put(
    "/api/admin/task-completions/:id/review",
    requireAdmin,
    async (req: AuthedRequest, res) => {
      const completionId = Number(req.params.id);
      if (!completionId || isNaN(completionId))
        return res.status(400).json({ error: "Invalid completion id" });

      const { admin_review_status, admin_notes } = req.body || {};
      if (!["approved", "rejected"].includes(admin_review_status))
        return res
          .status(400)
          .json({ error: "admin_review_status must be approved or rejected" });

      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT ctc.id, ctc.client_id, ctc.status, ctc.task_template_id,
                ott.title_en, ott.is_required, ott.is_active,
                c.first_name, c.email, c.phone, c.preferred_language,
                cr.id AS case_id, cr.pipeline_stage
         FROM client_task_completions ctc
         JOIN clients c ON c.id = ctc.client_id
         JOIN onboarding_task_templates ott ON ott.id = ctc.task_template_id
         LEFT JOIN credit_repair_cases cr ON cr.client_id = ctc.client_id AND cr.status NOT IN ('cancelled')
         WHERE ctc.id = ? LIMIT 1`,
        [completionId],
      );
      if (rows.length === 0)
        return res.status(404).json({ error: "Task completion not found" });

      const row = rows[0];
      const clientId = row.client_id as number;
      const caseId = row.case_id as number | null;

      await pool.query<ResultSetHeader>(
        `UPDATE client_task_completions
         SET admin_review_status = ?, admin_notes = ?, admin_reviewed_at = NOW()
         WHERE id = ?`,
        [admin_review_status, admin_notes ?? null, completionId],
      );

      // Send rejection notification
      if (admin_review_status === "rejected") {
        const taskLabel = row.title_en as string;
        const portalUrl = `${APP_URL}/portal/documents`;
        if (row.email) {
          const subj =
            row.preferred_language === "es"
              ? `Acción requerida: ${taskLabel}`
              : `Action required: ${taskLabel}`;
          const body =
            row.preferred_language === "es"
              ? `<p>Hola ${row.first_name},</p><p>Una de tus tareas fue rechazada: <strong>${taskLabel}</strong>.</p>${admin_notes ? `<p>Motivo: ${admin_notes}</p>` : ""}<p><a href="${portalUrl}">Ingresa al portal</a> para volver a enviarla.</p>`
              : `<p>Hi ${row.first_name},</p><p>One of your tasks was rejected: <strong>${taskLabel}</strong>.</p>${admin_notes ? `<p>Reason: ${admin_notes}</p>` : ""}<p><a href="${portalUrl}">Log in to the portal</a> to re-submit.</p>`;
          await sendEmail({
            to: row.email as string,
            subject: subj,
            html: body,
          }).catch(() => null);
        }
        if (row.phone) {
          await sendSms({
            to: row.phone as string,
            body: `Optimum Credit: your task "${taskLabel}" was rejected. ${admin_notes ? `Reason: ${admin_notes}. ` : ""}Log in to re-submit: ${portalUrl}`,
          }).catch(() => null);
        }
      }

      // Auto-advance to docs_ready when all required tasks are approved
      if (admin_review_status === "approved" && caseId) {
        const [[reqRow]] = await pool.query<RowDataPacket[]>(
          `SELECT COUNT(*) AS required_total FROM onboarding_task_templates
           WHERE is_active = 1 AND is_required = 1`,
        );
        const [[approvedRow]] = await pool.query<RowDataPacket[]>(
          `SELECT COUNT(*) AS approved_count
           FROM client_task_completions ctc
           JOIN onboarding_task_templates ott ON ott.id = ctc.task_template_id
           WHERE ctc.client_id = ? AND ctc.admin_review_status = 'approved'
             AND ott.is_required = 1 AND ott.is_active = 1`,
          [clientId],
        );
        const requiredTotal = Number(reqRow.required_total);
        const approvedCount = Number(approvedRow.approved_count);

        if (
          approvedCount >= requiredTotal &&
          row.pipeline_stage === "new_client"
        ) {
          await pool.query<ResultSetHeader>(
            `UPDATE credit_repair_cases SET pipeline_stage = 'docs_ready', pipeline_stage_changed_at = NOW() WHERE id = ?`,
            [caseId],
          );
          await pool.query<ResultSetHeader>(
            `UPDATE clients SET pipeline_stage = 'docs_ready', pipeline_stage_changed_at = NOW(), status = 'active' WHERE id = ?`,
            [clientId],
          );
          await pool.query<ResultSetHeader>(
            `INSERT INTO client_pipeline_history (client_id, from_stage, to_stage, changed_by_admin_id, notes) VALUES (?, 'new_client', 'docs_ready', ?, 'Auto-advanced: all required tasks approved')`,
            [clientId, req.auth!.id],
          );
          // Notify client
          const portalUrl = `${APP_URL}/portal/documents`;
          if (row.email) {
            const subj =
              row.preferred_language === "es"
                ? "¡Tus tareas fueron aprobadas! — Optimum Credit"
                : "All tasks approved — Optimum Credit";
            const body =
              row.preferred_language === "es"
                ? `<p>Hola ${row.first_name},</p><p>¡Todas tus tareas requeridas han sido aprobadas! Tu caso avanzó a la siguiente etapa.</p><p><a href="${portalUrl}">Accede al portal</a></p>`
                : `<p>Hi ${row.first_name},</p><p>All your required tasks have been approved! Your case has advanced to the next stage.</p><p><a href="${portalUrl}">Access your portal</a></p>`;
            await sendEmail({
              to: row.email as string,
              subject: subj,
              html: body,
            }).catch(() => null);
          }
        }
      }

      res.json({ ok: true });
    },
  );

  // ── GET /api/admin/task-completions/:id/file — serve decrypted file ───────
  app.get(
    "/api/admin/task-completions/:id/file",
    requireAdmin,
    async (_req: AuthedRequest, res) => {
      const id = Number(_req.params.id);
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT file_storage_key, file_name, file_mime
         FROM client_task_completions WHERE id = ? LIMIT 1`,
        [id],
      );
      if (rows.length === 0 || !rows[0].file_storage_key)
        return res.status(404).json({ error: "File not found" });

      const { file_storage_key, file_name, file_mime } = rows[0];
      // Format: cdnUrl|iv|tag
      const parts = (file_storage_key as string).split("|");
      if (parts.length !== 3)
        return res.status(500).json({ error: "Invalid storage key format" });
      const [cdnKey, iv, tag] = parts;

      try {
        const cdnRes = await fetch(cdnKey);
        if (!cdnRes.ok)
          return res.status(404).json({ error: "File not available" });
        const encrypted = Buffer.from(await cdnRes.arrayBuffer());
        const decrypted = decryptFile(encrypted, iv, tag);
        res.set(
          "Content-Type",
          (file_mime as string) || "application/octet-stream",
        );
        res.set(
          "Content-Disposition",
          `inline; filename="${encodeURIComponent(file_name as string)}"`,
        );
        res.set("Content-Length", String(decrypted.length));
        res.set("Cache-Control", "no-store, no-cache");
        res.send(decrypted);
      } catch {
        res.status(404).json({ error: "File could not be decrypted" });
      }
    },
  );

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
