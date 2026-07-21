require('dotenv').config();
const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const path = require('path');
const fs = require('fs');

// ─── LOG FILE REDIRECTION ──────────────────────────────────────────────────
const logDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}
const logFile = fs.createWriteStream(path.join(logDir, 'app.log'), { flags: 'a' });

const originalLog = console.log;
const originalError = console.error;

console.log = function(...args) {
  const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(' ');
  const logLine = `[${new Date().toISOString()}] [INFO] ${message}\n`;
  logFile.write(logLine);
  originalLog.apply(console, args);
};

console.error = function(...args) {
  const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(' ');
  const logLine = `[${new Date().toISOString()}] [ERROR] ${message}\n`;
  logFile.write(logLine);
  originalError.apply(console, args);
};

const passport = require('./auth/googleAuth');
const { sendEmail } = require('./email/gmailClient');
const { generateRelanceMessage, isNoReplyAddress, extractEmail } = require('./ai/analyzer');
const { 
  getCandidaturesByUser, getCandidaturesByStatut, getCandidatureById,
  updateStatut, markRelanceEnvoyee, markReponseRecue, updateRelanceMessage,
  updateReplyTo, updateNotes, deleteCandidature, getStats, getTimeline, getUserById
} = require('./db/queries');
const { startWatcher, stopWatcher, startDailyCron, addSSEClient, removeSSEClient } = require('./scheduler/watcher');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Ensure data directory exists
const dataDir = path.join(__dirname, '../data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// Sessions with file store
app.use(session({
  store: new FileStore({ path: path.join(__dirname, '../data/sessions'), retries: 1 }),
  secret: process.env.SESSION_SECRET || 'fallback_secret_change_me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  },
}));

app.use(passport.initialize());
app.use(passport.session());

// Serve static frontend files
app.use(express.static(path.join(__dirname, '../frontend')));

// ─── AUTH GUARD ───────────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ error: 'Non authentifié', redirect: '/login.html' });
}

// ─── AUTH ROUTES ──────────────────────────────────────────────────────────────
app.get('/auth/google', passport.authenticate('google', {
  scope: [
    'profile', 'email',
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.modify',
  ],
  accessType: 'offline',
  prompt: 'consent',
}));

app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/login.html?error=auth_failed' }),
  async (req, res) => {
    // Start email watcher for newly logged in user
    try {
      startWatcher(req.user);
    } catch (err) {
      console.error('Failed to start watcher:', err.message);
    }
    res.redirect('/');
  }
);

app.post('/auth/logout', (req, res) => {
  const userId = req.user?.id;
  req.logout((err) => {
    if (userId) stopWatcher(userId);
    req.session.destroy();
    res.json({ success: true, redirect: '/login.html' });
  });
});

app.get('/api/me', (req, res) => {
  if (!req.isAuthenticated()) {
    return res.json({ authenticated: false });
  }
  const { id, email, name, avatar } = req.user;
  res.json({ authenticated: true, user: { id, email, name, avatar } });
});

// ─── SSE — REAL-TIME UPDATES ──────────────────────────────────────────────────
app.get('/api/events', requireAuth, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Send initial ping
  res.write('event: connected\ndata: {"status":"ok"}\n\n');

  const userId = req.user.id;
  addSSEClient(userId, res);

  // Heartbeat every 30s
  const heartbeat = setInterval(() => {
    try { res.write(':ping\n\n'); } catch (e) {}
  }, 30000);

  req.on('close', () => {
    clearInterval(heartbeat);
    removeSSEClient(userId, res);
  });
});

// ─── CANDIDATURES API ─────────────────────────────────────────────────────────

// GET all candidatures
app.get('/api/candidatures', requireAuth, (req, res) => {
  const { statut } = req.query;
  let candidatures;
  
  if (statut) {
    candidatures = getCandidaturesByStatut.all(req.user.id, statut);
  } else {
    candidatures = getCandidaturesByUser.all(req.user.id);
  }
  
  // Parse relance_message JSON if present
  candidatures = candidatures.map(c => {
    if (c.relance_message) {
      try { c.relance_message_parsed = JSON.parse(c.relance_message); } catch (e) {}
    }
    // Calculate days since reception
    const daysSince = Math.floor(
      (Date.now() - new Date(c.date_accuse_reception).getTime()) / (1000 * 60 * 60 * 24)
    );
    c.jours_depuis_accuse = daysSince;
    c.jours_avant_relance = Math.max(0, 21 - daysSince);
    c.progression_relance = Math.min(100, Math.round((daysSince / 21) * 100));
    return c;
  });
  
  res.json({ success: true, candidatures });
});

// GET single candidature
app.get('/api/candidatures/:id', requireAuth, (req, res) => {
  const cand = getCandidatureById.get(parseInt(req.params.id), req.user.id);
  if (!cand) return res.status(404).json({ error: 'Candidature non trouvée' });
  
  if (cand.relance_message) {
    try { cand.relance_message_parsed = JSON.parse(cand.relance_message); } catch (e) {}
  }
  
  res.json({ success: true, candidature: cand });
});

// POST send relance
app.post('/api/candidatures/:id/relance/send', requireAuth, async (req, res) => {
  const cand = getCandidatureById.get(parseInt(req.params.id), req.user.id);
  if (!cand) return res.status(404).json({ error: 'Candidature non trouvée' });
  
  const toEmail = req.body.reply_to_email || cand.reply_to_email;
  
  if (!toEmail) {
    return res.status(400).json({ 
      error: "Impossible d'envoyer la relance : l'adresse email de destination est vide ou est un no-reply. Veuillez renseigner une adresse email de contact valide." 
    });
  }

  if (isNoReplyAddress(toEmail)) {
    return res.status(400).json({ 
      error: `L'adresse renseignée (${toEmail}) est une adresse 'no-reply'. Veuillez la modifier pour une adresse email valide afin que votre relance arrive au bon destinataire.` 
    });
  }
  
  let relanceData;
  
  // Use custom message if provided, else use stored one
  if (req.body.sujet && req.body.corps) {
    relanceData = { sujet: req.body.sujet, corps: req.body.corps };
  } else if (cand.relance_message) {
    relanceData = JSON.parse(cand.relance_message);
  } else {
    // Generate on the fly
    relanceData = await generateRelanceMessage(cand, req.user.email, req.user.name);
  }

  try {
    await sendEmail(req.user, {
      to: toEmail,
      subject: relanceData.sujet,
      body: relanceData.corps,
    });

    markRelanceEnvoyee.run(cand.id, req.user.id);
    res.json({ success: true, message: 'Relance envoyée avec succès !' });
  } catch (err) {
    console.error('Send relance error:', err);
    res.status(500).json({ error: 'Échec de l\'envoi : ' + err.message });
  }
});

// POST regenerate relance message
app.post('/api/candidatures/:id/relance/regenerate', requireAuth, async (req, res) => {
  const cand = getCandidatureById.get(parseInt(req.params.id), req.user.id);
  if (!cand) return res.status(404).json({ error: 'Candidature non trouvée' });
  
  try {
    const relance = await generateRelanceMessage(cand, req.user.email, req.user.name);
    updateRelanceMessage.run(JSON.stringify(relance), cand.id, req.user.id);
    res.json({ success: true, relance });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH update relance message manually
app.patch('/api/candidatures/:id/relance', requireAuth, (req, res) => {
  const { sujet, corps } = req.body;
  updateRelanceMessage.run(JSON.stringify({ sujet, corps }), parseInt(req.params.id), req.user.id);
  res.json({ success: true });
});

// PATCH update reply_to_email manually
app.patch('/api/candidatures/:id/reply-to', requireAuth, (req, res) => {
  const { reply_to_email } = req.body;
  const cleanedEmail = extractEmail(reply_to_email);
  updateReplyTo.run(cleanedEmail || null, parseInt(req.params.id), req.user.id);
  res.json({ success: true });
});

// DELETE candidature
app.delete('/api/candidatures/:id', requireAuth, (req, res) => {
  deleteCandidature.run(parseInt(req.params.id), req.user.id);
  res.json({ success: true });
});

// GET logs
app.get('/api/logs', requireAuth, (req, res) => {
  const logFilePath = path.join(__dirname, '../logs/app.log');
  if (!fs.existsSync(logFilePath)) {
    return res.json({ success: true, logs: "Aucun log disponible pour le moment." });
  }
  
  try {
    const logs = fs.readFileSync(logFilePath, 'utf8');
    const lines = logs.split('\n');
    const lastLines = lines.slice(-200).join('\n');
    res.json({ success: true, logs: lastLines });
  } catch (err) {
    res.status(500).json({ error: "Impossible de lire les logs : " + err.message });
  }
});

// PATCH mark as replied
app.patch('/api/candidatures/:id/reponse', requireAuth, (req, res) => {
  markReponseRecue.run(parseInt(req.params.id), req.user.id);
  res.json({ success: true });
});

// PATCH update notes
app.patch('/api/candidatures/:id/notes', requireAuth, (req, res) => {
  updateNotes.run(req.body.notes, parseInt(req.params.id), req.user.id);
  res.json({ success: true });
});

// PATCH update statut manually
app.patch('/api/candidatures/:id/statut', requireAuth, (req, res) => {
  updateStatut.run(req.body.statut, parseInt(req.params.id), req.user.id);
  res.json({ success: true });
});

// ─── STATS & DASHBOARD ────────────────────────────────────────────────────────
app.get('/api/stats', requireAuth, (req, res) => {
  const stats = getStats(req.user.id);
  const timeline = getTimeline.all(req.user.id);
  res.json({ success: true, stats, timeline });
});

// ─── SERVE FRONTEND ───────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  if (!req.isAuthenticated()) {
    return res.redirect('/login.html');
  }
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.get('/login.html', (req, res) => {
  if (req.isAuthenticated()) return res.redirect('/');
  res.sendFile(path.join(__dirname, '../frontend/login.html'));
});

// ─── START SERVER ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
🚀 Intelligent Application Handler démarré !
   → http://localhost:${PORT}
   → Environnement: ${process.env.NODE_ENV || 'development'}
  `);
  
  // Start daily cron
  startDailyCron();
});

module.exports = app;
