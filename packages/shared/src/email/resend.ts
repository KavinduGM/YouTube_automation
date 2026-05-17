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

export function editorInviteEmail(opts: {
  loginUrl: string;
}): { subject: string; html: string; text: string } {
  return {
    subject: 'You\'ve been invited as a video editor',
    html: `<div style="font-family:system-ui,sans-serif;max-width:520px">
      <h2>Welcome to YT Automation</h2>
      <p>You've been added as a video editor. Click below to sign in (link valid for 15 minutes).</p>
      <p><a href="${opts.loginUrl}" style="display:inline-block;background:#111;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Sign in</a></p>
      <p style="color:#666;font-size:12px">Bookmark the dashboard after signing in — your session lasts a year.</p>
    </div>`,
    text: `You've been invited as a video editor.\nSign in: ${opts.loginUrl}\nLink valid 15 minutes.`,
  };
}

export function editorTaskAssignedEmail(opts: {
  channel: string;
  rawFilename: string;
  finalFilename: string;
  detectedType: string;
  scheduledAt: string;
  reviewUrl: string;
}): { subject: string; html: string; text: string } {
  return {
    subject: `[${opts.channel}] New video to edit — ${opts.rawFilename}`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:560px">
      <h2>New editing task</h2>
      <p><b>Channel:</b> ${opts.channel}<br/>
         <b>Raw file:</b> ${opts.rawFilename}<br/>
         <b>Detected type:</b> ${opts.detectedType}<br/>
         <b>Scheduled to publish:</b> ${opts.scheduledAt}</p>
      <p>Save the edited file as:</p>
      <pre style="background:#f6f6f6;padding:10px;border-radius:6px"><code>${opts.finalFilename}</code></pre>
      <p><a href="${opts.reviewUrl}" style="display:inline-block;background:#111;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Open task</a></p>
    </div>`,
    text: `New editing task\nChannel: ${opts.channel}\nRaw: ${opts.rawFilename}\nDetected: ${opts.detectedType}\nScheduled: ${opts.scheduledAt}\nFinal filename: ${opts.finalFilename}\n\n${opts.reviewUrl}`,
  };
}

export function editorRevisionEmail(opts: {
  channel: string;
  finalFilename: string;
  notes: string;
  reviewUrl: string;
}): { subject: string; html: string; text: string } {
  return {
    subject: `[${opts.channel}] Revision requested — ${opts.finalFilename}`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:560px">
      <h2>Revision requested</h2>
      <p><b>Channel:</b> ${opts.channel}<br/>
         <b>File:</b> ${opts.finalFilename}</p>
      <p><b>Notes:</b></p>
      <pre style="background:#f6f6f6;padding:10px;border-radius:6px;white-space:pre-wrap">${opts.notes}</pre>
      <p><a href="${opts.reviewUrl}">Open task</a></p>
    </div>`,
    text: `Revision requested\nChannel: ${opts.channel}\nFile: ${opts.finalFilename}\nNotes: ${opts.notes}\n${opts.reviewUrl}`,
  };
}

export function overdueAlertEmail(opts: {
  items: Array<{ channel: string; finalFilename: string; scheduledAt: string; status: string; reviewUrl: string }>;
}): { subject: string; html: string; text: string } {
  const rows = opts.items.map((i) =>
    `<tr><td>${i.channel}</td><td><a href="${i.reviewUrl}">${i.finalFilename}</a></td><td>${i.scheduledAt}</td><td>${i.status}</td></tr>`
  ).join('');
  const text = opts.items.map((i) => `${i.channel} ${i.finalFilename} (${i.status}) sched=${i.scheduledAt}\n${i.reviewUrl}`).join('\n');
  return {
    subject: `[YT Automation] ${opts.items.length} overdue item${opts.items.length === 1 ? '' : 's'}`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:680px">
      <h2>Overdue items</h2>
      <p>These items were scheduled to publish but haven't completed all stages:</p>
      <table style="border-collapse:collapse;width:100%">
        <thead><tr style="background:#f6f6f6"><th align="left">Channel</th><th align="left">Filename</th><th align="left">Scheduled</th><th align="left">Status</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`,
    text,
  };
}
