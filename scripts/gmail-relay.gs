/**
 * TVK Gmail relay  -  paste this whole file into https://script.google.com
 * (signed in as the Gmail account the emails should be sent FROM).
 *
 * Why it exists: some hosts (Render's free plan) block the normal email ports, so the server
 * cannot talk to Gmail directly. Instead it sends each email here over ordinary HTTPS, and this
 * script sends it from the Gmail account. Setup steps are in the server README ("Email on Render").
 *
 * Limits (Google's, for a free gmail.com account): 100 email RECIPIENTS per day in total. A message to
 * two addresses uses 2. The server logs how many are left when it starts.
 */

// 1. Replace this with a long random text, and put the SAME text in the server's MAIL_RELAY_SECRET.
//    Anyone who has both the web-app URL and this secret could send mail as you - keep both private.
const SECRET = 'CHANGE-ME-to-a-long-random-text';

// Name shown as the sender (the address itself is always this Gmail account).
const SENDER_NAME = 'TVK Complaints';

function doPost(e) {
  try {
    if (!SECRET || SECRET.indexOf('CHANGE-ME') === 0) {
      return reply({ ok: false, code: 'ERROR', error: 'SECRET has not been set in the script yet' });
    }

    const data = JSON.parse(e.postData.contents);
    if (data.secret !== SECRET) {
      return reply({ ok: false, code: 'AUTH', error: 'Wrong secret' });
    }

    // A health check from the server - sends nothing.
    if (data.action === 'ping') {
      return reply({ ok: true, remaining: MailApp.getRemainingDailyQuota() });
    }

    if (!data.to || !data.subject) {
      return reply({ ok: false, code: 'ERROR', error: 'Missing "to" or "subject"' });
    }

    const attachments = (data.attachments || []).map(function (a) {
      return Utilities.newBlob(Utilities.base64Decode(a.contentBase64), a.contentType, a.filename);
    });

    MailApp.sendEmail({
      to: data.to,
      subject: data.subject,
      body: data.text || '',
      htmlBody: data.html || undefined,
      attachments: attachments,
      name: data.fromName || SENDER_NAME,
    });

    return reply({ ok: true, remaining: MailApp.getRemainingDailyQuota() });
  } catch (err) {
    const message = String((err && err.message) || err);
    const quota = /too many times|quota|limit exceeded/i.test(message);
    return reply({ ok: false, code: quota ? 'QUOTA' : 'ERROR', error: message });
  }
}

// Open the web-app URL in a browser to check it is alive (shows a short message, nothing else).
function doGet() {
  return reply({ ok: true, message: 'TVK Gmail relay is running' });
}

// Run this ONCE from the editor (select "authorize", press Run) so Google asks you to allow the script to send mail.
function authorize() {
  Logger.log('Emails you can still send today: ' + MailApp.getRemainingDailyQuota());
}

function reply(object) {
  return ContentService.createTextOutput(JSON.stringify(object)).setMimeType(ContentService.MimeType.JSON);
}
