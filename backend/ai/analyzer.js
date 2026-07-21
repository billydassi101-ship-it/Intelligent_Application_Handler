const Groq = require('groq-sdk');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const ANALYSIS_MODEL = 'llama-3.1-8b-instant';
const GENERATION_MODEL = 'llama-3.1-70b-versatile';

/**
 * Analyze an email to determine if it's a job application acknowledgment
 * Returns structured data about the candidature
 */
async function analyzeEmail(email) {
  const prompt = `Tu es un assistant expert en analyse d'emails de recrutement français.

Analyse cet email et détermine s'il s'agit d'un accusé de réception d'une candidature (notamment pour de l'alternance, un stage, un CDI, ou CDD).

Email à analyser:
- Sujet: ${email.subject}
- Expéditeur: ${email.from}
- Date: ${email.date}
- Contenu: ${email.bodyText || email.snippet}

Réponds UNIQUEMENT avec un objet JSON valide (pas de markdown, pas d'explication), avec exactement cette structure:
{
  "est_accuse_reception": true/false,
  "entreprise": "nom de l'entreprise ou null",
  "poste": "intitulé du poste ou null",
  "type_contrat": "alternance" | "stage" | "cdi" | "cdd" | "autre" | null,
  "cv_mentionne": true/false,
  "confiance": 0.0 à 1.0,
  "raison": "courte explication"
}`;

  try {
    const completion = await groq.chat.completions.create({
      model: ANALYSIS_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 300,
    });

    const content = completion.choices[0]?.message?.content?.trim() || '{}';
    // Extract JSON even if there's extra text
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { est_accuse_reception: false, confiance: 0 };
    
    const result = JSON.parse(jsonMatch[0]);
    return result;
  } catch (err) {
    console.error('AI analysis error:', err.message);
    // Fallback to keyword detection
    return keywordFallback(email);
  }
}

/**
 * Keyword-based fallback when AI is unavailable
 */
function keywordFallback(email) {
  const text = `${email.subject} ${email.bodyText} ${email.snippet}`.toLowerCase();
  
  const positiveKeywords = [
    'accusé de réception', 'bonne réception', 'bien reçu', 'candidature reçue',
    'nous avons bien reçu', 'candidature enregistrée', 'votre candidature',
    'nous accusons réception', 'pris en compte', 'candidature prise en compte',
    'alternance', 'apprentissage', 'contrat d\'apprentissage'
  ];
  
  const negativeKeywords = ['newsletter', 'unsubscribe', 'désabonner', 'promotion', 'offre spéciale'];
  
  const hasPositive = positiveKeywords.some(kw => text.includes(kw));
  const hasNegative = negativeKeywords.some(kw => text.includes(kw));
  
  return {
    est_accuse_reception: hasPositive && !hasNegative,
    entreprise: null,
    poste: null,
    type_contrat: text.includes('alternance') || text.includes('apprentissage') ? 'alternance' : null,
    cv_mentionne: text.includes('cv') || text.includes('curriculum'),
    confiance: hasPositive ? 0.6 : 0.1,
    raison: 'Détection par mots-clés (fallback)',
  };
}

/**
 * Generate a polite follow-up (relance) message for a candidature
 */
async function generateRelanceMessage(candidature, userEmail) {
  const daysSince = Math.floor(
    (Date.now() - new Date(candidature.date_accuse_reception).getTime()) / (1000 * 60 * 60 * 24)
  );

  const prompt = `Tu es un assistant qui aide à rédiger des emails de relance professionnels et polis pour des candidatures en France.

Contexte:
- Candidature pour: ${candidature.poste} chez ${candidature.entreprise}
- Type de contrat: ${candidature.type_contrat || 'alternance'}
- Accusé de réception reçu il y a: ${daysSince} jours
- Mon email: ${userEmail}

Rédige un email de relance COURT, POLI et PROFESSIONNEL en français.
L'email doit:
1. Rappeler la candidature (poste + entreprise)
2. Montrer de l'intérêt et de la motivation
3. Demander poliment si la candidature a été étudiée
4. Rester ouvert à un entretien
5. Être en moins de 150 mots

Réponds UNIQUEMENT avec l'email (objet + corps), sans explication, dans ce format JSON:
{
  "sujet": "Relance - Candidature [poste] - [Prénom Nom]",
  "corps": "Corps de l'email ici..."
}`;

  try {
    const completion = await groq.chat.completions.create({
      model: GENERATION_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 500,
    });

    const content = completion.choices[0]?.message?.content?.trim() || '{}';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found');
    
    return JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.error('Relance generation error:', err.message);
    // Fallback template
    return {
      sujet: `Relance - Candidature ${candidature.poste} - ${userEmail.split('@')[0]}`,
      corps: `Madame, Monsieur,

Je me permets de vous recontacter concernant ma candidature au poste de ${candidature.poste} déposée il y a ${daysSince} jours.

Toujours très motivé(e) par cette opportunité chez ${candidature.entreprise}, je souhaite savoir si vous avez eu l'occasion d'examiner mon dossier et si vous envisagez de donner suite à ma candidature.

Je reste disponible pour tout entretien à votre convenance.

Dans l'attente de votre retour, je vous adresse mes cordiales salutations.`
    };
  }
}

module.exports = { analyzeEmail, generateRelanceMessage, keywordFallback };
