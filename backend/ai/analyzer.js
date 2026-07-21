const Groq = require('groq-sdk');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const ANALYSIS_MODEL = 'llama-3.1-8b-instant';
const GENERATION_MODEL = 'llama-3.3-70b-versatile';

// ─── PRÉ-FILTRES STRICTS ──────────────────────────────────────
// Expéditeurs connus comme non-pertinents (job alerts, marketing)
const BLOCKED_SENDER_DOMAINS = [
  'jobalert.indeed.com',
  'match.indeed.com',
  'jobalerts.linkedin.com',
  'jobs.linkedin.com',
  'alert.linkedin.com',
  'hellowork.com',
  'monster.fr',
  'cadremploi.fr',
  'welcometothejungle.com',
  'meteojob.com',
  'apec.fr',      // alertes APEC
  'pole-emploi.fr',
];

// Patterns de sujets qui indiquent une alerte emploi ou email non pertinent
const BLOCKED_SUBJECT_PATTERNS = [
  /job alert/i,
  /jobalert/i,
  /nouveaux? emplois?/i,
  /new jobs?/i,
  /offres? d.emploi/i,
  /alerte emploi/i,
  /jobs? matching/i,
  /\d+ (nouveaux?|new) (emplois?|jobs?|offres?)/i,
  /votre recherche d.emploi/i,
  /recommandations? d.emploi/i,
];

// Patterns dans le corps qui indiquent un job alert, pas un accusé de réception
const BLOCKED_BODY_PATTERNS = [
  /\d+ nouveaux? emplois?/i,
  /see matching results on indeed/i,
  /votre parcours pourrait correspondre/i,
  /nous avons trouvé \d+ offres?/i,
  /job alert/i,
  /utm_campaign=job_alerts/i,
  /envoyez votre candidature rapidement si vous êtes intéressé/i,
];

/**
 * Pre-filter: Return true if the email should be REJECTED immediately (before AI)
 */
function isDefinitelyNotCandidature(email) {
  // 1. Whitelist check: Must contain at least one recruitment keyword
  const whitelistKeywords = [
    "candidature", 
    "accusé de réception", 
    "recrutement", 
    "process de recrutement", 
    "votre profil",
    "postulé",
    "candidaté",
    "candidater",
    "bien reçu votre"
  ];
  
  const fullText = `${email.subject || ''} ${email.snippet || ''} ${email.bodyText || ''}`.toLowerCase();
  const matchesWhitelist = whitelistKeywords.some(kw => fullText.includes(kw));
  
  if (!matchesWhitelist) {
    console.log(`🚫 Pre-filter: Whitelist reject (no recruitment keywords) — ${email.subject}`);
    return true; // Reject immediately
  }

  // 2. Blacklist check: Reject if it matches known job alerts or spammers
  const fromLower = (email.from || '').toLowerCase();
  const bodyLower = (email.bodyText || email.snippet || '').toLowerCase();

  // Block known job alert domains
  for (const domain of BLOCKED_SENDER_DOMAINS) {
    if (fromLower.includes(domain)) {
      console.log(`🚫 Pre-filter: Blocked sender domain (${domain}) — ${email.subject}`);
      return true;
    }
  }

  // Block by subject pattern
  for (const pattern of BLOCKED_SUBJECT_PATTERNS) {
    if (pattern.test(email.subject || '')) {
      console.log(`🚫 Pre-filter: Blocked subject pattern — ${email.subject}`);
      return true;
    }
  }

  // Block by body pattern
  for (const pattern of BLOCKED_BODY_PATTERNS) {
    if (pattern.test(bodyLower)) {
      console.log(`🚫 Pre-filter: Blocked body pattern — ${email.subject}`);
      return true;
    }
  }

  return false;
}

/**
 * Detect if a sender email is a no-reply address
 */
function isNoReplyAddress(emailAddress) {
  if (!emailAddress) return false;
  const lower = emailAddress.toLowerCase();
  return (
    lower.includes('noreply') ||
    lower.includes('no-reply') ||
    lower.includes('donotreply') ||
    lower.includes('do-not-reply') ||
    lower.includes('ne-pas-repondre') ||
    lower.includes('nepasrepondre') ||
    lower.startsWith('noreply@') ||
    lower.startsWith('no_reply@')
  );
}

/**
 * Extract the actual reply-to email from the from header
 * e.g. "AXA Recrutement <recrutement@axa.fr>" → "recrutement@axa.fr"
 */
function extractEmail(fromHeader) {
  if (!fromHeader) return null;
  const match = fromHeader.match(/<([^>]+)>/);
  return match ? match[1] : fromHeader.trim();
}

/**
 * Analyze an email to determine if it's a job application acknowledgment.
 * Returns structured data about the candidature.
 */
async function analyzeEmail(email) {
  // Pre-filter before calling AI (saves API calls and is more reliable)
  if (isDefinitelyNotCandidature(email)) {
    return { est_accuse_reception: false, confiance: 0, raison: 'Pré-filtré: job alert ou email non pertinent' };
  }

  const prompt = `Tu es un expert en classification d'emails de recrutement français. Ta mission est TRÈS STRICTE.

Un "accusé de réception de candidature" valide doit impérativement :
✅ Confirmer ou faire suite à une candidature que le destinataire a DÉJÀ soumise à une offre d'emploi (spécifique ou spontanée)
✅ Venir d'un employeur, d'un cabinet de recrutement, ou d'un ATS (système de suivi de candidatures)
✅ Contenir des formulations indiquant que la candidature a été reçue ou qu'elle est en cours d'étude, ou remercier pour l'intérêt (ex: "Nous vous remercions de l'intérêt...", "Nous avons bien reçu votre candidature", "Sans nouvelles de notre part...", "Votre candidature a été enregistrée", "Votre candidature est en cours d'examen")

❌ CE N'EST PAS un accusé de réception si :
- C'est une alerte emploi ("3 nouveaux emplois", "Job Alert", "nouveaux emplois", "Votre parcours pourrait correspondre", "jobs matching your search")
- C'est une suggestion d'offre à postuler (l'employeur suggère une offre, mais aucune candidature n'a encore été déposée)
- C'est un email marketing, newsletter, promotion
- C'est une conversation personnelle ou administrative sans rapport avec une candidature
- C'est un email Indeed/LinkedIn d'alerte emploi
- L'expéditeur est Indeed job alert (donotreply@jobalert.indeed.com, donotreply@match.indeed.com)

Email à analyser :
- Sujet: ${email.subject}
- Expéditeur: ${email.from}
- Contenu: ${(email.bodyText || email.snippet || '').substring(0, 1000)}

Réponds UNIQUEMENT avec un JSON valide, sans markdown, sans explication :
{
  "est_accuse_reception": true/false,
  "entreprise": "nom exact de l'entreprise recrutrice (pas Indeed/LinkedIn) ou null",
  "poste": "intitulé exact du poste ou null (met 'Poste non précisé' si aucun titre n'est mentionné mais que c'est bien une candidature)",
  "type_contrat": "alternance" | "stage" | "cdi" | "cdd" | "autre" | null,
  "cv_mentionne": true/false,
  "confiance": 0.0 à 1.0,
  "raison": "explication en 1 phrase"
}`;

  try {
    const completion = await groq.chat.completions.create({
      model: ANALYSIS_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.05,
      max_tokens: 300,
    });

    const content = completion.choices[0]?.message?.content?.trim() || '{}';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { est_accuse_reception: false, confiance: 0 };

    const result = JSON.parse(jsonMatch[0]);
    
    // Extra safety: if AI says it's a candidature but confidence < 0.75, reject
    if (result.est_accuse_reception && result.confiance < 0.75) {
      console.log(`⚠️  AI uncertain (${result.confiance}) about: ${email.subject} — rejecting`);
      return { ...result, est_accuse_reception: false };
    }

    return result;
  } catch (err) {
    console.error('AI analysis error:', err.message);
    return keywordFallback(email);
  }
}

/**
 * Keyword-based fallback (strict version)
 */
function keywordFallback(email) {
  // First apply pre-filters
  if (isDefinitelyNotCandidature(email)) {
    return { est_accuse_reception: false, confiance: 0, raison: 'Pré-filtré (fallback)' };
  }

  const text = `${email.subject} ${email.bodyText} ${email.snippet}`.toLowerCase();

  // Very specific positive keywords that indicate a real acknowledgment
  const strongPositiveKeywords = [
    'accusé de réception',
    'nous avons bien reçu votre candidature',
    'votre candidature a été enregistrée',
    'votre candidature a bien été reçue',
    'nous accusons réception de votre candidature',
    'candidature prise en compte',
    'votre dossier de candidature a été reçu',
    'merci pour votre candidature',
    'bien reçu votre candidature',
    'candidature enregistrée',
  ];

  const negativeKeywords = [
    'job alert', 'jobalert', 'nouveaux emplois', 'new jobs',
    'newsletter', 'unsubscribe', 'désabonner', 'promotion',
    'votre parcours pourrait correspondre', 'envoyez votre candidature',
    'utm_campaign=job_alerts', 'see matching results',
  ];

  const hasStrong = strongPositiveKeywords.some(kw => text.includes(kw));
  const hasNegative = negativeKeywords.some(kw => text.includes(kw));

  return {
    est_accuse_reception: hasStrong && !hasNegative,
    entreprise: null,
    poste: null,
    type_contrat: text.includes('alternance') || text.includes('apprentissage') ? 'alternance' : null,
    cv_mentionne: text.includes(' cv ') || text.includes('curriculum vitae'),
    confiance: hasStrong ? 0.8 : 0.1,
    raison: hasStrong ? 'Détection par mots-clés forts (fallback)' : 'Pas un accusé de réception',
  };
}

/**
 * Generate a polite follow-up (relance) message for a candidature
 */
async function generateRelanceMessage(candidature, userEmail, userName) {
  const daysSince = Math.floor(
    (Date.now() - new Date(candidature.date_accuse_reception).getTime()) / (1000 * 60 * 60 * 24)
  );

  const prenom = userName ? userName.split(' ')[0] : userEmail.split('@')[0];

  const prompt = `Tu es un assistant qui aide à rédiger des emails de relance professionnels et polis pour des candidatures en France.

Contexte :
- Candidature pour : ${candidature.poste} chez ${candidature.entreprise}
- Type de contrat : ${candidature.type_contrat || 'alternance'}
- Accusé de réception reçu il y a : ${daysSince} jours
- Mon prénom : ${prenom}
- Mon email : ${userEmail}

Rédige un email de relance COURT (max 120 mots), POLI, PROFESSIONNEL et PERSONNALISÉ en français.
L'email doit :
1. Rappeler la candidature (poste + entreprise)
2. Exprimer la motivation de manière authentique
3. Demander poliment l'avancement du dossier
4. Proposer un entretien
5. Se signer avec le prénom

Réponds UNIQUEMENT dans ce format JSON (pas de markdown) :
{
  "sujet": "Relance candidature – [Poste] – [Prénom]",
  "corps": "Corps complet de l'email..."
}`;

  try {
    const completion = await groq.chat.completions.create({
      model: GENERATION_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 600,
    });

    const content = completion.choices[0]?.message?.content?.trim() || '{}';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found');

    return JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.error('Relance generation error:', err.message);
    return {
      sujet: `Relance candidature – ${candidature.poste} – ${prenom}`,
      corps: `Madame, Monsieur,

Je me permets de vous recontacter au sujet de ma candidature au poste de ${candidature.poste} déposée il y a ${daysSince} jours chez ${candidature.entreprise}.

Toujours très motivé(e) par cette opportunité, je souhaite savoir si vous avez eu l'occasion d'étudier mon dossier et si une suite peut y être donnée.

Je reste disponible pour un entretien à votre convenance.

Cordialement,
${prenom}`
    };
  }
}

module.exports = { analyzeEmail, generateRelanceMessage, keywordFallback, isNoReplyAddress, extractEmail, isDefinitelyNotCandidature };
