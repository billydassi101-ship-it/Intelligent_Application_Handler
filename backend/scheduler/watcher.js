const cron = require('node-cron');
const { fetchEmails, fetchEmailsSinceHistory, getCurrentHistoryId } = require('../email/gmailClient');
const { analyzeEmail, generateRelanceMessage } = require('../ai/analyzer');
const { 
  insertCandidature, logEmail, getCandidaturesNeedingRelance, 
  updateStatut, updateRelanceMessage, getUserById 
} = require('../db/queries');
const db = require('../db/database');

// Store active watchers per user: userId -> { historyId, interval }
const activeWatchers = new Map();

// SSE clients: userId -> [res, ...]
const sseClients = new Map();

/**
 * Register a new SSE client for real-time updates
 */
function addSSEClient(userId, res) {
  if (!sseClients.has(userId)) sseClients.set(userId, []);
  sseClients.get(userId).push(res);
}

function removeSSEClient(userId, res) {
  if (!sseClients.has(userId)) return;
  const clients = sseClients.get(userId).filter(c => c !== res);
  sseClients.set(userId, clients);
}

function broadcastToUser(userId, eventType, data) {
  const clients = sseClients.get(userId) || [];
  const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  clients.forEach(res => {
    try { res.write(payload); } catch (e) {}
  });
}

/**
 * Process a single email: analyze with AI, store if candidature
 */
async function processEmail(user, email) {
  // Check if already processed
  const existing = db.prepare('SELECT id FROM email_log WHERE email_message_id = ? AND user_id = ?')
    .get(email.id, user.id);
  if (existing) return;

  const analysis = await analyzeEmail(email);
  
  const logEntry = {
    user_id: user.id,
    email_message_id: email.id,
    subject: email.subject,
    from_address: email.from,
    received_at: email.date?.toISOString() || new Date().toISOString(),
    analyzed: 1,
    is_candidature: analysis.est_accuse_reception && analysis.confiance >= 0.5 ? 1 : 0,
    candidature_id: null,
  };

  if (analysis.est_accuse_reception && analysis.confiance >= 0.5) {
    const entreprise = analysis.entreprise || extractDomain(email.from);
    const poste = analysis.poste || 'Poste non précisé';
    
    // Generate initial relance message
    let relanceMsg = null;
    try {
      const relance = await generateRelanceMessage({
        poste, entreprise,
        type_contrat: analysis.type_contrat || 'alternance',
        date_accuse_reception: email.date?.toISOString() || new Date().toISOString(),
      }, user.email);
      relanceMsg = JSON.stringify(relance);
    } catch (e) {
      console.error('Could not pre-generate relance:', e.message);
    }

    const result = insertCandidature.run({
      user_id: user.id,
      entreprise,
      poste,
      type_contrat: analysis.type_contrat || 'alternance',
      email_expediteur: email.from,
      date_accuse_reception: email.date?.toISOString() || new Date().toISOString(),
      email_message_id: email.id,
      email_subject: email.subject,
      email_body_excerpt: email.bodyText?.substring(0, 500) || email.snippet,
      cv_mentionne: analysis.cv_mentionne ? 1 : 0,
      relance_message: relanceMsg,
    });

    if (result.changes > 0) {
      logEntry.candidature_id = result.lastInsertRowid;
      
      // Broadcast new candidature to SSE clients
      broadcastToUser(user.id, 'nouvelle_candidature', {
        id: result.lastInsertRowid,
        entreprise, poste,
        date_accuse_reception: email.date?.toISOString(),
        email_subject: email.subject,
      });
      
      console.log(`✅ New candidature detected: ${entreprise} - ${poste}`);
    }
  }

  logEmail.run(logEntry);
}

/**
 * Extract company name from email address domain
 */
function extractDomain(fromHeader) {
  const match = fromHeader.match(/@([^>]+)/);
  if (!match) return 'Entreprise inconnue';
  const domain = match[1].split('.')[0];
  return domain.charAt(0).toUpperCase() + domain.slice(1);
}

/**
 * Start email watching for a user
 */
async function startWatcher(user) {
  if (activeWatchers.has(user.id)) return;

  console.log(`👁️ Starting email watcher for ${user.email}`);

  // Initial fetch: scan recent emails
  try {
    const emails = await fetchEmails(user, 'in:inbox newer_than:30d', 100);
    for (const email of emails) {
      await processEmail(user, email);
    }
  } catch (err) {
    console.error('Initial email fetch failed:', err.message);
  }

  // Get current historyId for polling
  let currentHistoryId = null;
  try {
    currentHistoryId = await getCurrentHistoryId(user);
  } catch (e) {}

  // Poll every 5 minutes for new emails
  const interval = setInterval(async () => {
    try {
      const freshUser = getUserById.get(user.id);
      if (!freshUser) { stopWatcher(user.id); return; }
      
      if (currentHistoryId) {
        const { emails, historyId } = await fetchEmailsSinceHistory(freshUser, currentHistoryId);
        if (historyId) currentHistoryId = historyId;
        for (const email of emails) {
          await processEmail(freshUser, email);
        }
      } else {
        const emails = await fetchEmails(freshUser, 'in:inbox newer_than:1d', 20);
        for (const email of emails) {
          await processEmail(freshUser, email);
        }
        currentHistoryId = await getCurrentHistoryId(freshUser);
      }
    } catch (err) {
      console.error(`Watcher error for ${user.email}:`, err.message);
    }
  }, 5 * 60 * 1000); // Every 5 minutes

  activeWatchers.set(user.id, { interval, historyId: currentHistoryId });
}

/**
 * Stop watching for a user (on logout)
 */
function stopWatcher(userId) {
  const watcher = activeWatchers.get(userId);
  if (watcher) {
    clearInterval(watcher.interval);
    activeWatchers.delete(userId);
    console.log(`🛑 Stopped watcher for user ${userId}`);
  }
}

/**
 * Daily cron: check for candidatures reaching J+21, trigger relance alert
 */
function startDailyCron() {
  // Run every day at 9:00 AM
  cron.schedule('0 9 * * *', async () => {
    console.log('🕘 Daily check: candidatures needing relance...');
    
    // Get all active users
    const activeUsers = db.prepare("SELECT * FROM users").all();
    
    for (const user of activeUsers) {
      try {
        const needingRelance = getCandidaturesNeedingRelance.all(user.id);
        
        for (const cand of needingRelance) {
          // Update status to relance_a_valider
          updateStatut.run('relance_a_valider', cand.id, user.id);
          
          // Generate relance message if not already done
          if (!cand.relance_message) {
            try {
              const relance = await generateRelanceMessage(cand, user.email);
              updateRelanceMessage.run(JSON.stringify(relance), cand.id, user.id);
            } catch (e) {
              console.error('Relance generation failed:', e.message);
            }
          }
          
          // Notify via SSE
          broadcastToUser(user.id, 'relance_due', {
            candidature_id: cand.id,
            entreprise: cand.entreprise,
            poste: cand.poste,
          });
          
          console.log(`🔔 Relance due: ${cand.entreprise} - ${cand.poste} (user: ${user.email})`);
        }
      } catch (err) {
        console.error(`Cron error for user ${user.email}:`, err.message);
      }
    }
  });

  console.log('⏰ Daily cron started (runs at 09:00 every day)');
}

module.exports = { startWatcher, stopWatcher, startDailyCron, addSSEClient, removeSSEClient, broadcastToUser };
