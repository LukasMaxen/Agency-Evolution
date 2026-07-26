// One-time cleanup: handle all 21 pending reply_drafts.
// 5 bad ones → #manual-replies + reject. 16 good ones → send via EmailBison + mark sent.
import { readFileSync } from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });
const SLACK_TOKEN = process.env.SLACK_BOT_TOKEN;
const MANUAL_CHANNEL = 'C0B0MMMMNKZ';

// IDs that go to manual (bad drafts — wrong content, banned phrases, or fabricated info)
const MANUAL_IDS = new Set([
  'rd-a1c2af9a-697c-4904-9fe2-85cd65c67b85-1778663802767', // Fabio — "Thank you for the thorough overview" + hallucinated SUMMA details
  'rd-a1c37ac8-14e8-4b40-9b96-0385496e84f7-1778663813292', // Jonathan Best Pool — wrong framing (seller treated as buyer)
  'rd-a1c3c295-c655-4a88-8939-284ff0b38a1b-1778663933069', // Steven GN Motion — fabricated pricing ($1,500-$3,000) not in client file
  'rd-a1c3db8c-6912-4ff2-b58f-322805a898a4-1778663967415', // Asgar — fabricated ACT partnership services not offered
  'rd-a1c4092a-7ec6-4a3c-9132-12fa4f0060fb-1778664007830', // Greg Montage — "Hi Kelly" wrong name, entirely wrong reply
]);

const MANUAL_REASONS = {
  'rd-a1c2af9a-697c-4904-9fe2-85cd65c67b85-1778663802767': 'Draft used a banned phrase ("Thank you for the thorough overview") and referenced SUMMA details that could not be verified from the lead message. Needs a human to draft from the actual email.',
  'rd-a1c37ac8-14e8-4b40-9b96-0385496e84f7-1778663813292': 'Draft treated Jonathan (a business owner on Sell Side Advisory) as a buyer — asked what he is "targeting in terms of geography, deal size." Wrong campaign framing. Needs manual re-draft.',
  'rd-a1c3c295-c655-4a88-8939-284ff0b38a1b-1778663933069': 'Draft invented a pricing range ($1,500-$3,000) not found in the GN Motion client file. Romain needs to confirm pricing before replying.',
  'rd-a1c3db8c-6912-4ff2-b58f-322805a898a4-1778663967415': 'Asgar asked if ACT offers partnership opportunities. Draft invented "deal co-investment or referral arrangements" that are not mentioned in the ACT client file. Jeff needs to confirm if this is offered.',
  'rd-a1c4092a-7ec6-4a3c-9132-12fa4f0060fb-1778664007830': 'Draft addressed "Hi Kelly" — wrong name (lead is Greg). Content also wrong: Greg said tequila is not a fit and wants to stay in touch, but draft re-pitched a different offering entirely.',
};

async function postSlack(text, blocks) {
  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SLACK_TOKEN}` },
    body: JSON.stringify({ channel: MANUAL_CHANNEL, text, blocks }),
  });
  const data = await res.json();
  if (!data.ok) console.error('Slack error:', data.error);
  return data;
}

function linkify(text) {
  return text.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
}

function toHtml(body) {
  return body
    .split('\n\n')
    .map(p => `<p style="margin:0 0 16px 0;">${linkify(p.replace(/\n/g, '<br>'))}</p>`)
    .join('');
}

async function sendViaEmailBison(row) {
  const recipientEmail = row.preferred_recipient_email ?? row.reply_lead_email;
  const recipientName = row.preferred_recipient_name ?? row.lead_name ?? null;
  const htmlBody = toHtml(row.body);
  const res = await fetch(`${row.email_bison_instance_url}/api/replies/${row.email_bison_reply_id}/reply`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${row.email_bison_api_key}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      message: htmlBody,
      sender_email_id: row.sender_email_id,
      to_emails: [{ name: recipientName, email_address: recipientEmail }],
      inject_previous_email_body: true,
      content_type: 'html',
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error(`EmailBison error for ${row.lead_name}:`, res.status, err.slice(0, 200));
    return false;
  }
  return true;
}

async function run() {
  const { rows } = await pool.query(`
    SELECT rd.id, rd.reply_id, rd.workspace_slug, rd.lead_name, rd.lead_email,
           rd.intent, rd.fu_sequence_type, rd.flag_unsubscribe, rd.flag_meeting_booked,
           rd.subject, rd.body, rd.slack_ts,
           r.message as lead_message, r.campaign, r.lead_company,
           r.email_bison_reply_id, r.sender_email_id,
           r.preferred_recipient_email, r.preferred_recipient_name,
           r.lead_email as reply_lead_email,
           w.email_bison_api_key, w.email_bison_instance_url
    FROM reply_drafts rd
    JOIN replies r ON r.id = rd.reply_id
    JOIN workspaces w ON w.slug = rd.workspace_slug
    WHERE rd.status = 'pending'
    ORDER BY rd.created_at ASC
  `);

  console.log(`Processing ${rows.length} pending reply drafts`);

  for (const row of rows) {
    if (MANUAL_IDS.has(row.id)) {
      // Route to manual
      const reason = MANUAL_REASONS[row.id];
      console.log(`MANUAL: ${row.lead_name} (${row.workspace_slug}) — ${reason.slice(0, 80)}`);

      await postSlack(
        `Manual handling needed: ${row.workspace_slug} / ${row.lead_name}`,
        [
          { type: 'header', text: { type: 'plain_text', text: 'Reply needs manual handling — auto-draft rejected', emoji: true } },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: `*Client:*\n${row.workspace_slug}` },
              { type: 'mrkdwn', text: `*Campaign:*\n${row.campaign ?? 'unknown'}` },
            ],
          },
          {
            type: 'section',
            text: { type: 'mrkdwn', text: `*Lead:* ${row.lead_name} (${row.lead_email})\n*Company:* ${row.lead_company ?? 'unknown'}` },
          },
          {
            type: 'section',
            text: { type: 'mrkdwn', text: `*Lead's message:*\n> ${(row.lead_message ?? '').slice(0, 500).replace(/\n/g, '\n> ')}` },
          },
          {
            type: 'section',
            text: { type: 'mrkdwn', text: `*Why auto-draft was rejected:*\n${reason}` },
          },
          {
            type: 'section',
            text: { type: 'mrkdwn', text: `*Rejected draft (for reference):*\n> ${(row.body ?? '').slice(0, 400).replace(/\n/g, '\n> ')}` },
          },
        ]
      );

      await pool.query(
        `UPDATE reply_drafts SET status = 'rejected', reviewed_at = NOW(), reviewed_by = 'system-cleanup' WHERE id = $1`,
        [row.id]
      );
      await pool.query(
        `UPDATE replies SET status = 'awaiting_manual' WHERE id = $1`,
        [row.reply_id]
      );

    } else {
      // Send via EmailBison
      console.log(`SENDING: ${row.lead_name} (${row.workspace_slug})`);

      if (!row.email_bison_reply_id || !row.sender_email_id || !row.email_bison_api_key) {
        console.error(`  Missing EmailBison fields for ${row.lead_name} — skipping`);
        continue;
      }

      const sent = await sendViaEmailBison(row);
      if (!sent) {
        console.error(`  EmailBison send FAILED for ${row.lead_name}`);
        continue;
      }

      const sentId = `auto-${row.reply_id}-${Date.now()}`;
      await pool.query(
        `INSERT INTO sent_emails (id, reply_id, workspace_slug, lead_email, lead_name, email_type, subject, body, sent_at)
         VALUES ($1,$2,$3,$4,$5,'auto_reply',$6,$7,NOW())`,
        [sentId, row.reply_id, row.workspace_slug, row.reply_lead_email, row.lead_name, row.subject ?? '', row.body]
      );

      const isPositive = ['interested', 'interested_urgent', 'needs_info'].includes(row.intent ?? '');
      await pool.query(
        `UPDATE replies SET status = 'replied', interested = $1, ai_analysis = jsonb_set(COALESCE(ai_analysis, '{}'::jsonb), '{auto_replied}', 'true'::jsonb), ai_analyzed_at = NOW() WHERE id = $2`,
        [isPositive ? true : null, row.reply_id]
      );

      await pool.query(
        `UPDATE reply_drafts SET status = 'sent', sent_at = NOW(), reviewed_at = NOW(), reviewed_by = 'system-cleanup' WHERE id = $1`,
        [row.id]
      );

      // Create FU record where applicable
      if (row.fu_sequence_type && row.fu_sequence_type !== 'none' && !row.flag_meeting_booked && !row.flag_unsubscribe) {
        const totalEmails = row.fu_sequence_type === 'abbreviated' ? 2 : 6;
        const fuId = `fu-${row.reply_id}-${Date.now()}`;
        await pool.query(
          `INSERT INTO follow_ups (id, reply_id, workspace_slug, lead_name, lead_email, first_replied_at, fu_step, total_emails, fu_sequence_type, meeting_booked, next_fu_due)
           SELECT $1,$2,$3,$4,$5,NOW(),0,$6,$7,FALSE,NOW() + INTERVAL '2 days'
           WHERE NOT EXISTS (SELECT 1 FROM follow_ups WHERE reply_id = $2)`,
          [fuId, row.reply_id, row.workspace_slug, row.lead_name, row.reply_lead_email, totalEmails, row.fu_sequence_type]
        );
      }

      console.log(`  Sent to ${row.reply_lead_email}`);
    }
  }

  const summary = await pool.query(`SELECT status, COUNT(*) FROM reply_drafts WHERE id = ANY($1) GROUP BY status`, [rows.map(r => r.id)]);
  console.log('\nFinal status:', summary.rows);
  pool.end();
}

run().catch(e => { console.error(e); pool.end(); });
