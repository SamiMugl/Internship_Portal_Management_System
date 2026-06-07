/**
 * SMTP transport for outbound emails.
 * Uses Gmail (or any SMTP) when SMTP_USER is set — delivers to real inboxes.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import nodemailer, { Transporter } from 'nodemailer';
import { env } from './env';

let transporter: Transporter | null = null;
let etherealInboxUrl: string | null = null;

function getLocalIpv4(): string | null {
  const nets = os.networkInterfaces();
  for (const ifaces of Object.values(nets)) {
    for (const net of ifaces ?? []) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return null;
}

/** URL used in email links — must be reachable from the user's phone on the same Wi‑Fi */
export function getPublicAppUrl(): string {
  if (process.env.PUBLIC_APP_URL) {
    return process.env.PUBLIC_APP_URL.replace(/\/$/, '');
  }

  const base = env.APP_BASE_URL.replace(/\/$/, '');
  if (!base.includes('localhost') && !base.includes('127.0.0.1')) {
    return base;
  }

  const ip = getLocalIpv4();
  if (ip && env.NODE_ENV === 'development') {
    return `http://${ip}:${env.PORT}`;
  }

  return base;
}

export function getPublicFrontendUrl(): string {
  if (process.env.FRONTEND_URL) {
    return process.env.FRONTEND_URL.replace(/\/$/, '');
  }

  const appUrl = getPublicAppUrl();
  if (appUrl.includes('localhost')) {
    return 'http://localhost:5173';
  }

  return appUrl.replace(`:${env.PORT}`, ':5173');
}

function etherealCachePath(): string {
  return path.resolve(process.cwd(), '.ethereal-smtp.json');
}

async function loadOrCreateEtherealTransport(): Promise<Transporter> {
  const cacheFile = etherealCachePath();

  if (fs.existsSync(cacheFile)) {
    const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8')) as {
      user: string;
      pass: string;
      web: string;
    };
    etherealInboxUrl = cached.web;
    console.log('[mail] Using cached Ethereal SMTP (testing only — not real inbox).');
    console.log(`[mail] View caught emails at: ${cached.web}`);
    return nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: { user: cached.user, pass: cached.pass },
    });
  }

  const account = await nodemailer.createTestAccount();
  fs.writeFileSync(
    cacheFile,
    JSON.stringify({ user: account.user, pass: account.pass, web: account.web }, null, 2),
  );
  etherealInboxUrl = account.web;
  console.log('[mail] Created Ethereal test SMTP account.');
  console.log(`[mail] View caught emails at: ${account.web}`);
  return nodemailer.createTransport({
    host: account.smtp.host,
    port: account.smtp.port,
    secure: account.smtp.secure,
    auth: { user: account.user, pass: account.pass },
  });
}

export async function initMailTransport(): Promise<void> {
  if (env.SMTP_USER && env.SMTP_PASS) {
    const isGmail = env.SMTP_HOST.includes('gmail');

    transporter = nodemailer.createTransport(
      isGmail
        ? {
            service: 'gmail',
            auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
          }
        : {
            host: env.SMTP_HOST,
            port: env.SMTP_PORT,
            secure: env.SMTP_SECURE,
            auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
          },
    );

    await transporter.verify();
    console.log(`[mail] SMTP ready — real emails will be sent via ${env.SMTP_USER}`);
    console.log(`[mail] Verification links use: ${getPublicAppUrl()}`);
    return;
  }

  transporter = await loadOrCreateEtherealTransport();
  console.warn(
    '[mail] SMTP_USER not set — using Ethereal test mail (emails do NOT reach your real inbox).',
  );
  console.warn('[mail] For real email on mobile, set Gmail SMTP in .env — run: npm run setup:gmail');
}

export function getMailTransporter(): Transporter {
  if (!transporter) {
    throw new Error('Mail transport not initialized — call initMailTransport() at startup');
  }
  return transporter;
}

export function isRealSmtpConfigured(): boolean {
  return Boolean(env.SMTP_USER && env.SMTP_PASS);
}

export function getEtherealInboxUrl(): string | null {
  return etherealInboxUrl;
}
