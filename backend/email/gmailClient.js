const { google } = require('googleapis');
const { getUserByGoogleId, updateUserTokens } = require('../db/queries');

/**
 * Create an authenticated Gmail API client for a given user
 */
function createGmailClient(user) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_CALLBACK_URL
  );

  oauth2Client.setCredentials({
    access_token: user.access_token,
    refresh_token: user.refresh_token,
  });

  // Auto-refresh token when expired
  oauth2Client.on('tokens', (tokens) => {
    if (tokens.access_token) {
      updateUserTokens.run(tokens.access_token, tokens.refresh_token || user.refresh_token, user.id);
    }
  });

  return google.gmail({ version: 'v1', auth: oauth2Client });
}

/**
 * Fetch emails from INBOX since a given date
 * @param {object} user - User object with tokens
 * @param {string} query - Gmail search query
 * @param {number} maxResults - Maximum number of emails to fetch
 */
async function fetchEmails(user, query = 'in:inbox', maxResults = 50) {
  const gmail = createGmailClient(user);
  
  const listRes = await gmail.users.messages.list({
    userId: 'me',
    q: query,
    maxResults,
  });

  const messages = listRes.data.messages || [];
  const emails = [];

  for (const msg of messages) {
    const msgData = await gmail.users.messages.get({
      userId: 'me',
      id: msg.id,
      format: 'full',
    });
    emails.push(parseEmailMessage(msgData.data));
  }

  return emails;
}

/**
 * Fetch only new emails since a given historyId (Gmail push notifications)
 */
async function fetchEmailsSinceHistory(user, startHistoryId) {
  const gmail = createGmailClient(user);
  
  try {
    const historyRes = await gmail.users.history.list({
      userId: 'me',
      startHistoryId,
      historyTypes: ['messageAdded'],
      labelId: 'INBOX',
    });

    const history = historyRes.data.history || [];
    const emails = [];

    for (const record of history) {
      for (const added of (record.messagesAdded || [])) {
        const msgData = await gmail.users.messages.get({
          userId: 'me',
          id: added.message.id,
          format: 'full',
        });
        emails.push(parseEmailMessage(msgData.data));
      }
    }

    return { emails, historyId: historyRes.data.historyId };
  } catch (err) {
    // If history is too old, fall back to full fetch
    console.warn('History fetch failed, falling back to full fetch:', err.message);
    return { emails: await fetchEmails(user, 'in:inbox newer_than:1d', 20), historyId: null };
  }
}

/**
 * Get current historyId for a user's mailbox
 */
async function getCurrentHistoryId(user) {
  const gmail = createGmailClient(user);
  const profile = await gmail.users.getProfile({ userId: 'me' });
  return profile.data.historyId;
}

/**
 * Parse a Gmail message object into a clean email object
 */
function parseEmailMessage(msgData) {
  const headers = msgData.payload?.headers || [];
  const getHeader = (name) => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';

  const subject = getHeader('Subject');
  const from = getHeader('From');
  const date = getHeader('Date');
  const messageId = getHeader('Message-ID') || msgData.id;
  const to = getHeader('To');

  // Extract body text
  let bodyText = '';
  const extractBody = (part) => {
    if (part.mimeType === 'text/plain' && part.body?.data) {
      bodyText += Buffer.from(part.body.data, 'base64').toString('utf-8');
    }
    if (part.parts) {
      part.parts.forEach(extractBody);
    }
  };
  extractBody(msgData.payload);

  // If no plain text, try HTML
  if (!bodyText) {
    const extractHtml = (part) => {
      if (part.mimeType === 'text/html' && part.body?.data) {
        const html = Buffer.from(part.body.data, 'base64').toString('utf-8');
        bodyText += html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      }
      if (part.parts) {
        part.parts.forEach(extractHtml);
      }
    };
    extractHtml(msgData.payload);
  }

  return {
    id: msgData.id,
    messageId,
    subject,
    from,
    to,
    date: date ? new Date(date) : new Date(),
    bodyText: bodyText.trim().substring(0, 2000), // Limit for AI analysis
    snippet: msgData.snippet || '',
    labels: msgData.labelIds || [],
  };
}

/**
 * Send an email on behalf of the user
 */
async function sendEmail(user, { to, subject, body }) {
  const gmail = createGmailClient(user);

  const message = [
    `To: ${to}`,
    `Subject: ${subject}`,
    `Content-Type: text/plain; charset=utf-8`,
    `MIME-Version: 1.0`,
    '',
    body,
  ].join('\n');

  const encodedMessage = Buffer.from(message).toString('base64url');

  const res = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw: encodedMessage },
  });

  return res.data;
}

module.exports = { createGmailClient, fetchEmails, fetchEmailsSinceHistory, getCurrentHistoryId, sendEmail, parseEmailMessage };
