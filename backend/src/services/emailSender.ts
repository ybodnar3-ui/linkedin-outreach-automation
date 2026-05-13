/**
 * emailSender.ts
 * Sends emails via SMTP (nodemailer).
 *
 * SMTP settings stored in app_settings:
 *   smtp_host     — e.g. smtp.gmail.com
 *   smtp_port     — e.g. 587
 *   smtp_user     — sender email address
 *   smtp_password — SMTP password or app password
 *   smtp_from     — display name + email, e.g. "John Smith <john@example.com>"
 *   smtp_secure   — '1' for TLS on port 465, '0' for STARTTLS
 */

import nodemailer from 'nodemailer';
import { getSetting } from './storage';
import { logger } from '../utils/logger';

interface SendEmailOptions {
  to: string;
  subject: string;
  body: string;  // Plain text body (template already rendered)
}

function getTransporter() {
  const host     = getSetting('smtp_host');
  const port     = parseInt(getSetting('smtp_port') || '587', 10);
  const user     = getSetting('smtp_user');
  const password = getSetting('smtp_password');
  const secure   = getSetting('smtp_secure') === '1';

  if (!host || !user || !password) {
    throw new Error('SMTP not configured. Set smtp_host, smtp_user, smtp_password in Settings.');
  }

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass: password },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
  });
}

export async function sendEmail(opts: SendEmailOptions): Promise<boolean> {
  const from = getSetting('smtp_from') || getSetting('smtp_user') || '';

  try {
    const transporter = getTransporter();
    await transporter.sendMail({
      from,
      to: opts.to,
      subject: opts.subject,
      text: opts.body,
    });
    logger.info('Email sent', { to: opts.to, subject: opts.subject });
    return true;
  } catch (err) {
    logger.error('Email send failed', { to: opts.to, error: String(err) });
    return false;
  }
}

export function isSmtpConfigured(): boolean {
  return Boolean(getSetting('smtp_host') && getSetting('smtp_user') && getSetting('smtp_password'));
}
