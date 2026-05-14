import { Resend } from 'resend';
import { env } from '../env.js';
import { logger } from '../logger.js';

let _resend: Resend | null = null;
function r(): Resend {
  if (!_resend) _resend = new Resend(env().RESEND_API_KEY);
  return _resend;
}

export async function sendEmail(opts: {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
}): Promise<void> {
  const e = env();
  try {
    await r().emails.send({
      from: e.RESEND_FROM,
      to: Array.isArray(opts.to) ? opts.to : [opts.to],
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    });
  } catch (err) {
    logger.error({ err, to: opts.to, subject: opts.subject }, 'Resend send failed');
    throw err;
  }
}

// ───── Templates ─────

export function magicLinkEmail(url: string): { subject: string; html: string; text: string } {
  return {
    subject: 'Sign in to YouTube Automation',
    html: `<div style="font-family:system-ui,sans-serif;max-width:520px">
      <h2>Sign in</h2>
      <p>Click the button below to sign in. This link expires in 15 minutes.</p>
      <p><a href="${url}" style="display:inline-block;background:#111;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Sign in</a></p>
      <p style="color:#666;font-size:12px">If the button doesn't work, paste this URL: ${url}</p>
    </div>`,
    text: `Sign in: ${url}\nExpires in 15 minutes.`,
  };
}

export function pendingApprovalEmail(opts: {
  channel: string;
  title: string;
  type: string;
  scheduledAt: string;     // human readable, in NY time
  filename: string;
  reviewUrl: string;
}): { subject: string; html: string; text: string } {
  return {
    subject: `[${opts.channel}] Pending approval: ${opts.title}`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:560px">
      <h2>New ${opts.type} ready for review</h2>
      <p><b>Channel:</b> ${opts.channel}<br/>
         <b>Title:</b> ${opts.title}<br/>
         <b>File:</b> ${opts.filename}<br/>
         <b>Scheduled:</b> ${opts.scheduledAt}</p>
      <p><a href="${opts.reviewUrl}" style="display:inline-block;background:#111;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Review &amp; approve</a></p>
    </div>`,
    text: `New ${opts.type} ready for review\nChannel: ${opts.channel}\nTitle: ${opts.title}\nFile: ${opts.filename}\nScheduled: ${opts.scheduledAt}\n\nReview: ${opts.reviewUrl}`,
  };
}

export function failureEmail(opts: {
  channel: string;
  title: string;
  filename: string;
  error: string;
  reviewUrl: string;
}): { subject: string; html: string; text: string } {
  return {
    subject: `[${opts.channel}] FAILED: ${opts.title}`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:560px">
      <h2>Upload failed</h2>
      <p><b>Channel:</b> ${opts.channel}<br/>
         <b>Title:</b> ${opts.title}<br/>
         <b>File:</b> ${opts.filename}</p>
      <pre style="background:#f6f6f6;padding:10px;border-radius:6px;white-space:pre-wrap">${opts.error}</pre>
      <p><a href="${opts.reviewUrl}">Open in dashboard</a></p>
    </div>`,
    text: `Upload failed\nChannel: ${opts.channel}\nTitle: ${opts.title}\nFile: ${opts.filename}\nError: ${opts.error}\n${opts.reviewUrl}`,
  };
}
