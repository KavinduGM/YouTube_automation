# YouTube Automation — User Guide

How to use the tool day-to-day, end to end. Aimed at the approver and the editor.

- **Dashboard**: https://dashboard.groovymark.com
- **Time zone**: everything is shown in **America/New_York**

---

## 1. First-time setup (one-off, ~15 minutes)

You only do this once, when the tool goes live.

### 1.1 Sign in

1. Open https://dashboard.groovymark.com.
2. Type your email (must be in the approver list configured on the server).
3. Check inbox → click the **Sign in** link in the email.
4. You're in.

> If the email never arrives: check spam. Confirm with your admin that your email is in `ALLOWED_APPROVER_EMAILS` on the server.

### 1.2 Connect Google (Drive + Sheets) — once for the whole team

1. Top nav → **Channels**.
2. Click **Connect Google (Drive + Sheets)**.
3. Sign in with the Google account that **owns the team's monthly Drive folders and Google Sheets**.
4. Approve all the permission prompts.
5. You'll be redirected back. Top of the page should show: `Connected as <your-email>`.

### 1.3 Add the three channels

For each of **OAP**, **OAG**, **Nursing** — repeat these steps:

1. In the **Add channel** form (bottom of Channels page):
   - Slug: `OAP` (or `OAG` / `NUR`)
   - Display name: e.g. `Online Allied Prep`
   - Click **Create / update**

2. The new channel card appears. Click **Connect YouTube**.

3. **CRITICAL**: switch your browser's active Google account to the one that owns **that specific YouTube channel** before clicking. Otherwise you'll connect the wrong channel.

   *Tip: easiest way is to open the channel connect in a private/incognito window so you're forced to pick.*

4. After redirect, the card shows the **YouTube Channel ID**. Click it to open the channel in a new tab — make sure it's the right one.

5. Create that channel's Drive folder for the current month, e.g.:
   - In Drive, create folder `OAP/2026-05/`
   - Open the folder → copy the ID from the URL (the long string after `/folders/`)
   - Paste it into **Drive folder ID** on the channel card → click outside the field (it auto-saves)

6. (Optional) Paste the monthly Google Sheet ID into **Default sheet ID** if you want status write-back. See [Section 6](#6-optional-sheet-write-back).

When done, all three channel cards should show:
- ✓ YouTube Channel ID filled in
- ✓ Drive folder ID filled in
- (Optional) Default sheet ID filled in

---

## 2. Each month, before the month starts (~1–2 hours)

You pre-fill the dashboard with one item for every video you plan to publish that month. The system uses these to match files when your editor uploads them.

For each planned video:

1. Top nav → **New item**.
2. Pick the **Channel**.
3. **Type**: `long`, `short`, or `post` (posts are not auto-published in v1).
4. **Filename builder** — fill these and the system builds `expectedFilename`:
   - **Date**: `2026-05-16` for daily content, or `2026-05-W3` for weekly long videos.
   - **Slot**: `1` or `2` for daily; for long videos use the exam code (or `1`).
   - **Tag** (optional): e.g. `D330` for exam-specific long videos.
   - **Extension**: `mp4` (default).
5. **Title**: ≤ 100 chars (YouTube's hard cap).
6. **Description**: paste the full long-form copy. Up to 4,000+ words is fine.
7. **Tags**: comma-separated.
8. **Publish at (America/New_York)**: when YouTube should make it public.
9. **Sheet ID** (optional): the monthly content sheet ID for status write-back.
10. Click **Create item**.

Status starts as `planned`. The system now waits for the file to appear in Drive.

> Tip: after creating an item, copy the **Expected filename** from the item detail page and paste it into your editor's task list, so they save the file with that exact name.

---

## 3. Daily — editor's job (no clicks needed)

1. The editor exports the video from their editing tool (Premiere, CapCut, etc.).
2. Renames it **exactly** to the `expectedFilename`. Examples:
   - `OAP_2026-05-16_short_1.mp4`
   - `OAG_2026-05-W3_long_D330.mp4`
   - `NUR_2026-05-16_short_2.mp4`
3. Uploads it into the channel's monthly Drive folder.
4. **(Optional but recommended)**: also upload a thumbnail with the same base name and `.jpg` or `.png` extension:
   - `OAP_2026-05-16_short_1.jpg`

That's it. No dashboard work. The system polls Drive every 2 minutes.

### Filename rules — read this once, follow it forever

```
{CHANNEL}_{DATE}_{TYPE}_{SLOT}[_{TAG}].{ext}
```

| Field   | Allowed values |
|---------|----------------|
| CHANNEL | `OAP` `OAG` `NUR` (uppercase) |
| DATE    | `YYYY-MM-DD` (daily) or `YYYY-MM-Wn` (weekly long) |
| TYPE    | `long` `short` `post` (lowercase) |
| SLOT    | integer (`1`, `2`, …) or exam code |
| TAG     | optional, e.g. `D330` |
| ext     | `mp4` `mov` `m4v` `webm` for videos; `jpg` `png` for thumbnails |

**Common mistakes** that break the match:
- Spaces in filename (`OAP 2026...`) → use underscores
- Lowercase channel (`oap_...`) → must be uppercase
- Wrong date format (`5-16-2026`) → must be `YYYY-MM-DD`
- Different base name for thumbnail (`thumb.jpg`) → must match the video exactly except for extension

---

## 4. Daily — approver's job (~5 minutes)

When a file is detected, you get an email titled something like:
> [OAP] Pending approval: How to crush the D330 exam

### Approve a single item

1. Click the **Review & approve** link in the email (or open the dashboard → **Inbox**).
2. The item page shows:
   - Title, description, tags, scheduled publish time
   - Link to the video file in Drive (preview if you click)
   - Thumbnail link (if uploaded)
3. **Edit anything if needed** — title typo, missing tag, wrong publish time. Edits are saved when you click the button below.
4. Click one of:
   - **Approve & schedule** → uploads to YouTube with `publishAt` = the scheduled time
   - **Reject** with a reason → editor uploads a fresh version under the same name

### What happens after Approve

Status flips: `approved → scheduling → scheduled` (within ~1 minute).

The item card now shows the **YouTube URL**. Click it — in YouTube Studio you'll see the video as **Scheduled** until publish time.

After the publish time passes, the system confirms it went live and flips the status to `published`.

### Reject vs. just edit

| Situation | Action |
|---|---|
| Small typo in title/desc | Edit fields → Approve |
| Wrong scheduled time | Edit time → Approve |
| Wrong video file uploaded | **Reject** with reason → editor re-uploads |
| Right video, wrong metadata you want to fix permanently | Edit + Approve, then update for next time too |

---

## 5. Monitoring & handling failures

### Check status of all items

Top nav → **Items** → filter by status:

| Status | Meaning |
|---|---|
| `planned` | Item created but no file in Drive yet |
| `pending_approval` | File detected, waiting for you |
| `approved` | You approved; system about to upload |
| `scheduling` | Currently uploading to YouTube |
| `scheduled` | Live on YouTube as scheduled, awaits publish time |
| `published` | Confirmed public on YouTube |
| `failed` | Upload failed (3 attempts) — see below |
| `rejected` | You rejected; editor needs to re-upload |

### A failed item

Open the item → the **Last error** field shows what went wrong. Common causes:

| Error | Fix |
|---|---|
| `quotaExceeded` | YouTube's API quota burned through (rare with 2–3/day). Wait until tomorrow + click **Retry**. |
| `Video file is too large` | YouTube cap is 256 GB / 12 hours. Re-export smaller and re-upload. |
| `Invalid refresh token` | The channel's YouTube connection expired. Channels page → **Reconnect YouTube** for that channel. |
| `Title contains an invalid character` | YouTube rejects `<` and `>`. Edit title → Retry. |
| `Drive download failed` | Editor moved/renamed the file. Restore in Drive, then **Retry**. |

After fixing, click **Retry** on the item — it goes back to `approved` and the worker picks it up again.

---

## 6. (Optional) Sheet write-back

If you want the system to write status into your monthly content sheet:

1. Make sure row 1 of the sheet has these column headers (case-insensitive, in any order):

   | Required | Optional |
   |---|---|
   | `filename` | `status`, `youtube url`, `youtube_id`, `published_at`, `scheduled_at`, `approved_by` |

2. When creating a content item, paste the **Sheet ID** (the long string in the sheet URL, between `/d/` and `/edit`).

3. (Optional) tab name — defaults to the first tab.

The system finds the row whose `filename` cell matches the item's expected filename and updates the recognised columns. Other columns are left alone.

---

## 7. Reconnecting a YouTube channel

You'll need to do this if:
- A refresh token expires (every 7 days while in OAuth Testing mode)
- A channel's password changes and Google revokes tokens
- You see `Invalid refresh token` errors

Steps:
1. Channels page.
2. Click **Reconnect YouTube** on the affected channel card.
3. **Switch to that channel's Google account** in your browser before clicking.
4. Approve.

The next scheduled upload will use the fresh token.

---

## 8. Adding a new month

When a new month starts:

1. Update each channel's **Drive folder ID** to point at the new monthly folder (e.g. `OAP/2026-06/`). Just paste the new ID into the field on the Channels page.
2. (Optional) Update each channel's **Default sheet ID** to the new monthly sheet.
3. Pre-fill content items for the new month (Section 2).

Old items from previous months stay in the dashboard — filter by status `published` to see history.

---

## 9. Quick reference card

```
SIGN IN:          dashboard.groovymark.com → email link
INBOX:            top nav, shows what needs approval
NEW ITEM:         pre-fill metadata for an upcoming video
CHANNELS:         connect YouTube + paste Drive folder IDs
ITEMS:            full list, filter by status

FILENAME:         OAP_2026-05-16_short_1.mp4
                  OAG_2026-05-W3_long_D330.mp4

THUMBNAIL:        same base name, .jpg or .png
                  OAP_2026-05-16_short_1.jpg

DETECTION TIME:   ~2 minutes after Drive upload
APPROVAL TIME:    you, whenever
UPLOAD TIME:      ~30 sec to a few minutes after Approve
```

---

## 10. Common questions

**Q: Can I edit an item after it's been scheduled?**
A: No — once on YouTube as `scheduled`, edit it directly in YouTube Studio. The dashboard locks editing at that point.

**Q: What if the editor uploads with a slightly wrong filename?**
A: The watcher will skip it (logs a warning). Rename in Drive to the exact `expectedFilename` and within 2 minutes it'll be picked up.

**Q: What if I miss the scheduled publish time before approving?**
A: The system publishes immediately when you finally approve (with a short delay so YouTube accepts the request).

**Q: Can two items share the same filename?**
A: No — `expectedFilename` is unique. The form prevents duplicates.

**Q: How do I delete an item?**
A: Item detail page → only allowed before it reaches YouTube. After `scheduled`/`published`, manage in YouTube Studio.

**Q: Community posts?**
A: Not auto-published in v1. YouTube's official API doesn't support creating community posts. Keep doing those manually.
