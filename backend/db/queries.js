const db = require('./database');

// ─── USERS ────────────────────────────────────────────────────────────────────

const upsertUser = db.prepare(`
  INSERT INTO users (id, google_id, email, name, avatar, access_token, refresh_token, last_login)
  VALUES (@id, @google_id, @email, @name, @avatar, @access_token, @refresh_token, CURRENT_TIMESTAMP)
  ON CONFLICT(google_id) DO UPDATE SET
    email = excluded.email,
    name = excluded.name,
    avatar = excluded.avatar,
    access_token = excluded.access_token,
    refresh_token = excluded.refresh_token,
    last_login = CURRENT_TIMESTAMP
`);

const getUserById = db.prepare('SELECT * FROM users WHERE id = ?');
const getUserByGoogleId = db.prepare('SELECT * FROM users WHERE google_id = ?');

const updateUserTokens = db.prepare(`
  UPDATE users SET access_token = ?, refresh_token = ? WHERE id = ?
`);

// ─── CANDIDATURES ─────────────────────────────────────────────────────────────

const insertCandidature = db.prepare(`
  INSERT OR IGNORE INTO candidatures 
  (user_id, entreprise, poste, type_contrat, email_expediteur, date_accuse_reception,
   email_message_id, email_subject, email_body_excerpt, cv_mentionne, relance_message)
  VALUES 
  (@user_id, @entreprise, @poste, @type_contrat, @email_expediteur, @date_accuse_reception,
   @email_message_id, @email_subject, @email_body_excerpt, @cv_mentionne, @relance_message)
`);

const getCandidaturesByUser = db.prepare(`
  SELECT * FROM candidatures WHERE user_id = ? ORDER BY date_accuse_reception DESC
`);

const getCandidaturesByStatut = db.prepare(`
  SELECT * FROM candidatures WHERE user_id = ? AND statut = ? ORDER BY date_accuse_reception DESC
`);

const getCandidatureById = db.prepare(`
  SELECT * FROM candidatures WHERE id = ? AND user_id = ?
`);

const updateStatut = db.prepare(`
  UPDATE candidatures SET statut = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?
`);

const markRelanceEnvoyee = db.prepare(`
  UPDATE candidatures 
  SET statut = 'relance_envoyee', relance_envoyee_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
  WHERE id = ? AND user_id = ?
`);

const markReponseRecue = db.prepare(`
  UPDATE candidatures 
  SET statut = 'repondu', reponse_recue_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
  WHERE id = ? AND user_id = ?
`);

const updateRelanceMessage = db.prepare(`
  UPDATE candidatures SET relance_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?
`);

const updateNotes = db.prepare(`
  UPDATE candidatures SET notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?
`);

// Check candidatures that need follow-up (J+21 and still en_attente)
const getCandidaturesNeedingRelance = db.prepare(`
  SELECT * FROM candidatures 
  WHERE user_id = ?
  AND statut = 'en_attente'
  AND date_accuse_reception <= datetime('now', '-21 days')
`);

const getStats = (userId) => {
  const total = db.prepare('SELECT COUNT(*) as count FROM candidatures WHERE user_id = ?').get(userId);
  const en_attente = db.prepare("SELECT COUNT(*) as count FROM candidatures WHERE user_id = ? AND statut = 'en_attente'").get(userId);
  const relance_a_valider = db.prepare("SELECT COUNT(*) as count FROM candidatures WHERE user_id = ? AND statut = 'relance_a_valider'").get(userId);
  const relance_envoyee = db.prepare("SELECT COUNT(*) as count FROM candidatures WHERE user_id = ? AND statut = 'relance_envoyee'").get(userId);
  const repondu = db.prepare("SELECT COUNT(*) as count FROM candidatures WHERE user_id = ? AND statut = 'repondu'").get(userId);
  
  return {
    total: total.count,
    en_attente: en_attente.count,
    relance_a_valider: relance_a_valider.count,
    relance_envoyee: relance_envoyee.count,
    repondu: repondu.count,
    taux_reponse: total.count > 0 ? Math.round((repondu.count / total.count) * 100) : 0
  };
};

// Monthly timeline for charts
const getTimeline = db.prepare(`
  SELECT 
    strftime('%Y-%m', date_accuse_reception) as mois,
    COUNT(*) as count
  FROM candidatures 
  WHERE user_id = ?
  GROUP BY mois
  ORDER BY mois DESC
  LIMIT 6
`);

// ─── EMAIL LOG ────────────────────────────────────────────────────────────────

const logEmail = db.prepare(`
  INSERT OR IGNORE INTO email_log (user_id, email_message_id, subject, from_address, received_at, analyzed, is_candidature, candidature_id)
  VALUES (@user_id, @email_message_id, @subject, @from_address, @received_at, @analyzed, @is_candidature, @candidature_id)
`);

module.exports = {
  upsertUser, getUserById, getUserByGoogleId, updateUserTokens,
  insertCandidature, getCandidaturesByUser, getCandidaturesByStatut,
  getCandidatureById, updateStatut, markRelanceEnvoyee, markReponseRecue,
  updateRelanceMessage, updateNotes, getCandidaturesNeedingRelance,
  getStats, getTimeline, logEmail
};
