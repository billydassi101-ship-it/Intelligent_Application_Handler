/* ═══════════════════════════════════════════════════════════════
   INTELLIGENT APPLICATION HANDLER — FRONTEND APP
   Handles routing, API calls, charts, and real-time updates
═══════════════════════════════════════════════════════════════ */

// ─── STATE ───────────────────────────────────────────────────
const state = {
  currentPage: 'dashboard',
  user: null,
  stats: null,
  candidatures: {},
  charts: { timeline: null, status: null },
  eventSource: null,
};

// ─── UTILS ───────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const formatDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};
const formatDateShort = (iso) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
};
const timeAgo = (iso) => {
  if (!iso) return '';
  const sec = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (sec < 60) return 'À l\'instant';
  if (sec < 3600) return `Il y a ${Math.floor(sec/60)} min`;
  if (sec < 86400) return `Il y a ${Math.floor(sec/3600)}h`;
  return `Il y a ${Math.floor(sec/86400)}j`;
};
const initials = (name) => name ? name.slice(0, 1).toUpperCase() : '?';

// ─── TOAST ───────────────────────────────────────────────────
function showToast(message, type = 'info', duration = 3500) {
  const container = $('toastContainer');
  const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span class="toast-icon">${icons[type] || 'ℹ️'}</span><span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('toast-out');
    toast.addEventListener('animationend', () => toast.remove());
  }, duration);
}

// ─── API ─────────────────────────────────────────────────────
async function api(endpoint, options = {}) {
  try {
    const res = await fetch(endpoint, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    if (res.status === 401) {
      window.location.href = '/login.html';
      return null;
    }
    return await res.json();
  } catch (err) {
    console.error('API error:', err);
    showToast('Erreur réseau', 'error');
    return null;
  }
}

// ─── AUTH ─────────────────────────────────────────────────────
async function loadUser() {
  const data = await api('/api/me');
  if (!data?.authenticated) {
    window.location.href = '/login.html';
    return;
  }
  state.user = data.user;
  
  // Update sidebar user
  const avatar = $('userAvatar');
  if (state.user.avatar) {
    avatar.src = state.user.avatar;
  } else {
    avatar.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(state.user.name || state.user.email)}&background=7c3aed&color=fff`;
  }
  $('userName').textContent = state.user.name || state.user.email;
  $('userEmail').textContent = state.user.email;
}

$('logoutBtn')?.addEventListener('click', async () => {
  const data = await api('/auth/logout', { method: 'POST' });
  if (data?.success) window.location.href = '/login.html';
});

// ─── STATS & CHARTS ───────────────────────────────────────────
async function loadStats() {
  const data = await api('/api/stats');
  if (!data?.success) return;
  
  const { stats, timeline } = data;
  state.stats = stats;
  
  // Update stat values
  $('sv-total').textContent = stats.total;
  $('sv-attente').textContent = stats.en_attente;
  $('sv-valider').textContent = stats.relance_a_valider;
  $('sv-envoyee').textContent = stats.relance_envoyee;
  $('sv-repondu').textContent = stats.repondu;
  $('sv-taux').textContent = `${stats.taux_reponse}%`;

  // Update nav badges
  $('badge-envoyee').textContent = stats.relance_envoyee;
  $('badge-valider').textContent = stats.relance_a_valider;
  $('badge-avenir').textContent = stats.en_attente;
  $('badge-repondu').textContent = stats.repondu;
  
  // Update last update time
  $('lastUpdate').textContent = `Mis à jour ${timeAgo(new Date().toISOString())}`;

  // Charts
  renderTimelineChart(timeline || []);
  renderStatusChart(stats);
}

function renderTimelineChart(timeline) {
  const ctx = document.getElementById('timelineChart').getContext('2d');
  const labels = timeline.map(t => {
    const [y, m] = t.mois.split('-');
    return new Date(y, m-1).toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' });
  }).reverse();
  const values = timeline.map(t => t.count).reverse();

  if (state.charts.timeline) state.charts.timeline.destroy();
  state.charts.timeline = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Candidatures',
        data: values,
        backgroundColor: 'rgba(124, 58, 237, 0.6)',
        borderColor: 'rgba(124, 58, 237, 1)',
        borderWidth: 2,
        borderRadius: 6,
        borderSkipped: false,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8', font: { size: 11 } } },
        y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8', font: { size: 11 }, stepSize: 1 }, beginAtZero: true },
      }
    }
  });
}

function renderStatusChart(stats) {
  const ctx = document.getElementById('statusChart').getContext('2d');
  const values = [stats.en_attente, stats.relance_a_valider, stats.relance_envoyee, stats.repondu];
  const hasData = values.some(v => v > 0);
  
  if (state.charts.status) state.charts.status.destroy();
  state.charts.status = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['En attente', 'À valider', 'Relancé', 'Répondu'],
      datasets: [{
        data: hasData ? values : [1, 0, 0, 0],
        backgroundColor: ['rgba(245, 158, 11, 0.7)', 'rgba(239, 68, 68, 0.7)', 'rgba(59, 130, 246, 0.7)', 'rgba(16, 185, 129, 0.7)'],
        borderColor: ['#f59e0b', '#ef4444', '#3b82f6', '#10b981'],
        borderWidth: 2,
        hoverOffset: 6,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '65%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: '#94a3b8', font: { size: 11 }, padding: 12, boxWidth: 12, boxHeight: 12, borderRadius: 4 }
        }
      }
    }
  });
}

// ─── CANDIDATURES ─────────────────────────────────────────────
async function loadCandidatures(statut) {
  const url = statut ? `/api/candidatures?statut=${statut}` : '/api/candidatures';
  const data = await api(url);
  if (!data?.success) return [];
  return data.candidatures;
}

function renderCandidatureCard(c, showActions = true) {
  const card = document.createElement('div');
  card.className = 'cand-card glass';
  card.dataset.id = c.id;

  const firstLetter = c.entreprise?.charAt(0) || '?';
  const badgeClass = {
    en_attente: 'badge-attente',
    relance_a_valider: 'badge-valider',
    relance_envoyee: 'badge-envoyee',
    repondu: 'badge-repondu',
  }[c.statut] || 'badge-attente';
  
  const badgeLabel = {
    en_attente: '⏳ En attente',
    relance_a_valider: '🔔 À valider',
    relance_envoyee: '📤 Relancé',
    repondu: '✅ Répondu',
  }[c.statut] || c.statut;

  let actionsHTML = '';
  if (showActions) {
    let specificButtons = '';
    if (c.statut === 'relance_a_valider') {
      specificButtons = `
        <button class="btn-primary btn-send-relance" data-id="${c.id}" onclick="event.stopPropagation(); sendRelance(${c.id})">
          📤 Envoyer la relance
        </button>
        <button class="btn-ghost" onclick="event.stopPropagation(); openDetail(${c.id})">✏️ Voir / Modifier</button>
      `;
    } else if (c.statut === 'relance_envoyee') {
      specificButtons = `
        <button class="btn-success" onclick="event.stopPropagation(); markRepondue(${c.id})">✅ Réponse reçue</button>
        <button class="btn-ghost" onclick="event.stopPropagation(); openDetail(${c.id})">Voir détail</button>
      `;
    } else if (c.statut === 'en_attente') {
      specificButtons = `
        <button class="btn-success" onclick="event.stopPropagation(); markRepondue(${c.id})">✅ Réponse reçue</button>
        <button class="btn-ghost" onclick="event.stopPropagation(); openDetail(${c.id})">Détail</button>
      `;
    } else if (c.statut === 'repondu') {
      specificButtons = `
        <button class="btn-ghost" onclick="event.stopPropagation(); openDetail(${c.id})">Détail</button>
      `;
    }
    
    actionsHTML = `
      ${specificButtons}
      <button class="btn-ghost" onclick="event.stopPropagation(); deleteCandidatureDirect(${c.id})" 
        style="background: rgba(239, 68, 68, 0.1); color: #fca5a5; border-color: rgba(239, 68, 68, 0.2);" 
        title="Supprimer définitivement la candidature">
        🗑️ Supprimer
      </button>
    `;
  }

  let progressHTML = '';
  if (c.statut === 'en_attente' && c.jours_depuis_accuse !== undefined) {
    const overdue = c.jours_depuis_accuse >= 21;
    progressHTML = `
      <div class="day-counter ${overdue ? 'overdue' : ''}">
        ${overdue ? `🔴 J+${c.jours_depuis_accuse} — Relance recommandée !` : `📅 J+${c.jours_depuis_accuse} — Relance dans ${c.jours_avant_relance} jours`}
      </div>
      <div class="progress-bar">
        <div class="progress-fill" style="width: ${c.progression_relance}%"></div>
      </div>
    `;
  }

  let relancePreviewHTML = '';
  if (c.statut === 'relance_a_valider' && c.relance_message_parsed) {
    relancePreviewHTML = `
      <div class="relance-preview">${c.relance_message_parsed.corps || ''}</div>
    `;
  }

  card.innerHTML = `
    <div class="cand-avatar">${firstLetter}</div>
    <div class="cand-info">
      <div class="cand-top">
        <span class="cand-entreprise">${escHtml(c.entreprise)}</span>
        <span class="cand-badge ${badgeClass}">${badgeLabel}</span>
      </div>
      <div class="cand-poste">💼 ${escHtml(c.poste)}</div>
      <div class="cand-meta">
        <span class="cand-date">📨 Accusé : ${formatDate(c.date_accuse_reception)}</span>
        ${c.type_contrat ? `<span class="cand-date">🎓 ${c.type_contrat}</span>` : ''}
        ${c.cv_mentionne ? `<span class="cand-date">📄 CV mentionné</span>` : ''}
        ${c.relance_envoyee_at ? `<span class="cand-date">📤 Relancé : ${formatDateShort(c.relance_envoyee_at)}</span>` : ''}
        ${c.reponse_recue_at ? `<span class="cand-date">✅ Répondu : ${formatDateShort(c.reponse_recue_at)}</span>` : ''}
      </div>
      ${progressHTML}
      ${relancePreviewHTML}
    </div>
    ${actionsHTML ? `<div class="cand-actions">${actionsHTML}</div>` : ''}
  `;

  card.addEventListener('click', () => openDetail(c.id));
  return card;
}

function escHtml(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── LOAD PAGES ───────────────────────────────────────────────
async function loadPage(page) {
  const pageMap = {
    'relance-envoyee': { container: 'list-envoyee', statut: 'relance_envoyee' },
    'relance-valider': { container: 'list-valider', statut: 'relance_a_valider' },
    'relance-a-venir': { container: 'list-avenir', statut: 'en_attente' },
    'repondu': { container: 'list-repondu', statut: 'repondu' },
  };

  const pageTitles = {
    'dashboard': ['Dashboard', 'Vue d\'ensemble de vos candidatures'],
    'relance-envoyee': ['Relances envoyées', 'Candidatures dont la relance a été envoyée'],
    'relance-valider': ['À valider', 'Relances prêtes à envoyer en 1 clic'],
    'relance-a-venir': ['Relance à venir', 'Suivi des délais avant relance'],
    'repondu': ['Répondus', 'Candidatures avec réponse reçue'],
  };

  const [title, subtitle] = pageTitles[page] || ['', ''];
  $('pageTitle').textContent = title;
  $('pageSubtitle').textContent = subtitle;

  if (page === 'dashboard') {
    await loadStats();
    return;
  }

  const config = pageMap[page];
  if (!config) return;

  const container = $(config.container);
  container.innerHTML = '<div class="empty-state"><div class="empty-icon">⏳</div><p>Chargement...</p></div>';

  const candidatures = await loadCandidatures(config.statut);

  container.innerHTML = '';
  if (candidatures.length === 0) {
    const emptyMessages = {
      'relance_envoyee': ['📤', 'Aucune relance envoyée', 'Les relances que vous envoyez apparaîtront ici.'],
      'relance_a_valider': ['🔔', 'Aucune relance à valider', 'Les candidatures atteignant J+21 apparaîtront ici.'],
      'en_attente': ['📅', 'Aucune candidature en attente', 'Connectez votre Gmail pour détecter vos candidatures.'],
      'repondu': ['✅', 'Aucune réponse enregistrée', 'Marquez une candidature comme répondue pour la voir ici.'],
    };
    const [icon, title, desc] = emptyMessages[config.statut] || ['📭', 'Aucun résultat', ''];
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">${icon}</div><h3>${title}</h3><p>${desc}</p></div>`;
    return;
  }

  candidatures.forEach(c => {
    container.appendChild(renderCandidatureCard(c));
  });
}

// ─── NAVIGATION ───────────────────────────────────────────────
function navigateTo(page) {
  // Update pages
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const pageEl = $(`page-${page}`);
  if (pageEl) pageEl.classList.add('active');

  // Update nav
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.page === page);
  });

  state.currentPage = page;
  loadPage(page);

  // Close sidebar on mobile
  $('sidebar')?.classList.remove('open');
}

document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    navigateTo(item.dataset.page);
  });
});

$('menuToggle')?.addEventListener('click', () => {
  $('sidebar')?.classList.toggle('open');
});

// ─── ACTIONS ──────────────────────────────────────────────────
async function sendRelance(id) {
  const btn = document.querySelector(`.btn-send-relance[data-id="${id}"]`);
  if (btn) { btn.disabled = true; btn.textContent = 'Envoi...'; }
  
  const data = await api(`/api/candidatures/${id}/relance/send`, { method: 'POST' });
  
  if (data?.success) {
    showToast('✉️ Relance envoyée avec succès !', 'success');
    loadPage(state.currentPage);
    loadStats();
  } else {
    showToast(data?.error || 'Échec de l\'envoi', 'error');
    if (btn) { btn.disabled = false; btn.textContent = '📤 Envoyer la relance'; }
  }
}

async function markRepondue(id) {
  const data = await api(`/api/candidatures/${id}/reponse`, { method: 'PATCH' });
  if (data?.success) {
    showToast('✅ Candidature marquée comme répondue !', 'success');
    loadPage(state.currentPage);
    loadStats();
  } else {
    showToast('Erreur lors de la mise à jour', 'error');
  }
}

// ─── DETAIL MODAL ─────────────────────────────────────────────

async function openDetail(id) {
  const data = await api(`/api/candidatures/${id}`);
  if (!data?.success) return;
  const c = data.candidature;
  
  const relance = c.relance_message_parsed || {};
  const daysSince = Math.floor((Date.now() - new Date(c.date_accuse_reception)) / 86400000);

  $('modalBody').innerHTML = `
    <h2 class="modal-title">
      ${escHtml(c.entreprise)}
      <span class="cand-poste" style="font-size:14px; font-weight:500; color: var(--text-secondary)">— ${escHtml(c.poste)}</span>
    </h2>

    <div class="modal-section">
      <div class="modal-section-title">Informations</div>
      <div class="modal-field-row">
        <div class="modal-field"><span class="modal-label">Entreprise</span><span class="modal-value">${escHtml(c.entreprise)}</span></div>
        <div class="modal-field"><span class="modal-label">Poste</span><span class="modal-value">${escHtml(c.poste)}</span></div>
        <div class="modal-field"><span class="modal-label">Type de contrat</span><span class="modal-value">${c.type_contrat || '—'}</span></div>
        <div class="modal-field"><span class="modal-label">CV mentionné</span><span class="modal-value">${c.cv_mentionne ? '✅ Oui' : '❌ Non'}</span></div>
        <div class="modal-field"><span class="modal-label">Expéditeur d'origine</span><span class="modal-value">${escHtml(c.email_expediteur || '—')}</span></div>
        <div class="modal-field"><span class="modal-label">Jours depuis accusé</span><span class="modal-value">J+${daysSince}</span></div>
      </div>
      
      <!-- Destinataire de relance modifiable -->
      <div class="modal-field" style="margin-top: 16px;">
        <span class="modal-label">Email destinataire pour la relance</span>
        <div style="display: flex; gap: 8px; margin-top: 4px; align-items: center;">
          <input id="replyToEmailInput" type="email" class="textarea-edit" style="flex: 1; padding: 10px 12px; border-radius:10px; font-size:13px; height:auto; margin: 0;"
            value="${escHtml(c.reply_to_email || '')}" placeholder="Entrez un email valide (ex: rh@entreprise.com)">
          <button class="btn-primary" onclick="saveReplyTo(${c.id})" style="padding: 10px 14px; height: 38px; display: flex; align-items: center; justify-content: center; box-shadow: none;">Enregistrer</button>
        </div>
        ${!c.reply_to_email ? `
          <div style="color: var(--color-warning); font-size: 12px; margin-top: 6px; display: flex; align-items: center; gap: 6px;">
            ⚠️ <span>L'adresse d'origine est un no-reply. Veuillez renseigner un email de contact valide avant de relancer.</span>
          </div>
        ` : ''}
      </div>
    </div>

    <div class="modal-section">
      <div class="modal-section-title">Chronologie</div>
      <div class="timeline">
        <div class="timeline-item done">
          <div class="timeline-date">${formatDate(c.date_accuse_reception)}</div>
          <div class="timeline-label">📨 Accusé de réception reçu</div>
        </div>
        ${c.relance_envoyee_at ? `
        <div class="timeline-item done">
          <div class="timeline-date">${formatDate(c.relance_envoyee_at)}</div>
          <div class="timeline-label">📤 Relance envoyée</div>
        </div>` : ''}
        ${c.reponse_recue_at ? `
        <div class="timeline-item done">
          <div class="timeline-date">${formatDate(c.reponse_recue_at)}</div>
          <div class="timeline-label">✅ Réponse reçue</div>
        </div>` : `
        <div class="timeline-item ${c.statut === 'relance_a_valider' || c.statut === 'relance_envoyee' ? 'active' : ''}">
          <div class="timeline-date">En attente</div>
          <div class="timeline-label">💬 Réponse de l'entreprise</div>
        </div>`}
      </div>
    </div>

    ${c.email_body_excerpt ? `
    <div class="modal-section">
      <div class="modal-section-title">Extrait de l'email</div>
      <div class="relance-preview" style="max-height: 120px">${escHtml(c.email_body_excerpt)}</div>
    </div>` : ''}

    <div class="modal-section">
      <div class="modal-section-title">Message de relance</div>
      <div style="margin-bottom: 8px;">
        <div class="modal-label" style="margin-bottom: 4px">Sujet</div>
        <input id="relanceSujet" type="text" class="textarea-edit" style="width:100%; padding:10px 12px; border-radius:10px; font-size:13px; resize:none; height:auto;"
          value="${escHtml(relance.sujet || '')}" placeholder="Sujet du message de relance">
      </div>
      <div class="modal-label" style="margin-bottom: 4px">Corps</div>
      <textarea id="relanceCorps" class="textarea-edit" rows="6">${escHtml(relance.corps || '')}</textarea>
      <div style="margin-top: 8px; display: flex; gap: 8px;">
        <button class="btn-ghost" onclick="regenerateRelance(${c.id})">🔄 Régénérer avec l'IA</button>
        <button class="btn-ghost" onclick="saveRelanceEdit(${c.id})">💾 Sauvegarder les modifications</button>
      </div>
    </div>

    <div class="modal-section">
      <div class="modal-section-title">Notes personnelles</div>
      <textarea id="notesField" class="textarea-edit" rows="3" placeholder="Ajouter des notes...">${escHtml(c.notes || '')}</textarea>
    </div>

    <div class="modal-actions">
      ${c.statut === 'relance_a_valider' ? `<button class="btn-primary" onclick="sendRelanceFromModal(${c.id})">📤 Envoyer la relance</button>` : ''}
      ${(c.statut !== 'repondu') ? `<button class="btn-success" onclick="markRepondue(${c.id}); closeModal();">✅ L'entreprise a répondu</button>` : ''}
      <button class="btn-ghost" onclick="saveNotes(${c.id})">💾 Sauvegarder notes</button>
      <button class="btn-ghost" onclick="deleteCandidatureFromModal(${c.id})" style="background: rgba(239, 68, 68, 0.1); color: #fca5a5; border-color: rgba(239, 68, 68, 0.2); margin-left: auto;">❌ Supprimer la candidature</button>
    </div>
  `;

  $('detailModal').classList.remove('hidden');
}

async function saveReplyTo(id) {
  const email = $('replyToEmailInput')?.value;
  if (email && !email.includes('@')) {
    showToast('Veuillez entrer une adresse email valide.', 'warning');
    return;
  }
  const data = await api(`/api/candidatures/${id}/reply-to`, {
    method: 'PATCH',
    body: JSON.stringify({ reply_to_email: email }),
  });
  if (data?.success) {
    showToast('✅ Email de destination mis à jour !', 'success');
    loadPage(state.currentPage);
  } else {
    showToast('Erreur lors de la sauvegarde de l\'email', 'error');
  }
}

function showConfirm(title, message, onConfirm) {
  $('confirmTitle').textContent = title;
  $('confirmMessage').textContent = message;
  $('confirmModal').classList.remove('hidden');

  const okBtn = $('confirmOkBtn');
  const cancelBtn = $('confirmCancelBtn');

  // Clone to remove previous event listeners
  const newOkBtn = okBtn.cloneNode(true);
  const newCancelBtn = cancelBtn.cloneNode(true);
  okBtn.parentNode.replaceChild(newOkBtn, okBtn);
  cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);

  newOkBtn.addEventListener('click', () => {
    $('confirmModal').classList.add('hidden');
    onConfirm();
  });

  newCancelBtn.addEventListener('click', () => {
    $('confirmModal').classList.add('hidden');
  });
}

function deleteCandidatureFromModal(id) {
  showConfirm(
    "Supprimer la candidature ?",
    "Voulez-vous vraiment supprimer cette candidature ? Cette action est irréversible et supprimera tout l'historique lié.",
    async () => {
      const data = await api(`/api/candidatures/${id}`, { method: 'DELETE' });
      if (data?.success) {
        showToast('🗑️ Candidature supprimée avec succès', 'success');
        closeModal();
        loadPage(state.currentPage);
        loadStats();
      } else {
        showToast('Erreur lors de la suppression', 'error');
      }
    }
  );
}

function deleteCandidatureDirect(id) {
  showConfirm(
    "Supprimer la candidature ?",
    "Voulez-vous vraiment supprimer cette candidature ? Cette action est irréversible.",
    async () => {
      const data = await api(`/api/candidatures/${id}`, { method: 'DELETE' });
      if (data?.success) {
        showToast('🗑️ Candidature supprimée avec succès', 'success');
        loadPage(state.currentPage);
        loadStats();
      } else {
        showToast('Erreur lors de la suppression', 'error');
      }
    }
  );
}

async function sendRelanceFromModal(id) {
  const sujet = $('relanceSujet')?.value;
  const corps = $('relanceCorps')?.value;
  const reply_to_email = $('replyToEmailInput')?.value;
  
  const data = await api(`/api/candidatures/${id}/relance/send`, {
    method: 'POST',
    body: JSON.stringify({ sujet, corps, reply_to_email }),
  });
  if (data?.success) {
    showToast('✉️ Relance envoyée !', 'success');
    closeModal();
    loadPage(state.currentPage);
    loadStats();
  } else {
    showToast(data?.error || 'Erreur d\'envoi', 'error');
  }
}

async function regenerateRelance(id) {
  showToast('🤖 Génération IA en cours...', 'info');
  const data = await api(`/api/candidatures/${id}/relance/regenerate`, { method: 'POST' });
  if (data?.success) {
    $('relanceSujet').value = data.relance.sujet || '';
    $('relanceCorps').value = data.relance.corps || '';
    showToast('✨ Message régénéré par l\'IA !', 'success');
  } else {
    showToast('Erreur de génération IA', 'error');
  }
}

async function saveRelanceEdit(id) {
  const sujet = $('relanceSujet')?.value;
  const corps = $('relanceCorps')?.value;
  const data = await api(`/api/candidatures/${id}/relance`, {
    method: 'PATCH',
    body: JSON.stringify({ sujet, corps }),
  });
  if (data?.success) showToast('✅ Message sauvegardé', 'success');
  else showToast('Erreur de sauvegarde', 'error');
}

async function saveNotes(id) {
  const notes = $('notesField')?.value;
  const data = await api(`/api/candidatures/${id}/notes`, {
    method: 'PATCH',
    body: JSON.stringify({ notes }),
  });
  if (data?.success) showToast('✅ Notes sauvegardées', 'success');
  else showToast('Erreur de sauvegarde', 'error');
}

function closeModal() {
  $('detailModal').classList.add('hidden');
}
$('modalClose')?.addEventListener('click', closeModal);
$('detailModal')?.addEventListener('click', (e) => {
  if (e.target === $('detailModal')) closeModal();
});

// ─── SSE — REAL-TIME ──────────────────────────────────────────
function connectSSE() {
  if (state.eventSource) state.eventSource.close();
  
  const es = new EventSource('/api/events');
  state.eventSource = es;

  es.addEventListener('connected', () => {
    console.log('🔗 SSE connected');
  });

  es.addEventListener('nouvelle_candidature', (e) => {
    const data = JSON.parse(e.data);
    showToast(`📬 Nouvelle candidature détectée : ${data.entreprise} — ${data.poste}`, 'info', 5000);
    addFeedItem(`Nouvelle candidature : ${data.entreprise}`, data.poste, new Date().toISOString());
    loadStats();
    if (state.currentPage !== 'dashboard') loadPage(state.currentPage);
  });

  es.addEventListener('relance_due', (e) => {
    const data = JSON.parse(e.data);
    showToast(`🔔 Relance due : ${data.entreprise} — ${data.poste} (J+21 atteint)`, 'warning', 6000);
    loadStats();
    if (state.currentPage === 'relance-valider') loadPage('relance-valider');
  });

  es.onerror = () => {
    console.warn('SSE disconnected, retrying in 10s...');
    setTimeout(connectSSE, 10000);
  };
}

function addFeedItem(title, subtitle, time) {
  const feed = $('recentFeed');
  const empty = feed.querySelector('.feed-empty');
  if (empty) empty.remove();

  const item = document.createElement('div');
  item.className = 'feed-item';
  item.innerHTML = `
    <span class="feed-dot"></span>
    <div class="feed-content">
      <div class="feed-title">${escHtml(title)}</div>
      <div class="feed-sub">${escHtml(subtitle)}</div>
    </div>
    <span class="feed-time">${timeAgo(time)}</span>
  `;
  feed.insertBefore(item, feed.firstChild);

  // Keep max 10 items
  const items = feed.querySelectorAll('.feed-item');
  if (items.length > 10) items[items.length - 1].remove();
}

// ─── INIT ─────────────────────────────────────────────────────
async function init() {
  await loadUser();
  await loadStats();
  connectSSE();

  // Refresh stats every 2 minutes
  setInterval(loadStats, 2 * 60 * 1000);
}

window.addEventListener('DOMContentLoaded', init);

// Make functions available globally (for inline onclick handlers)
window.sendRelance = sendRelance;
window.markRepondue = markRepondue;
window.openDetail = openDetail;
window.sendRelanceFromModal = sendRelanceFromModal;
window.regenerateRelance = regenerateRelance;
window.saveRelanceEdit = saveRelanceEdit;
window.saveNotes = saveNotes;
window.closeModal = closeModal;
window.navigateTo = navigateTo;
window.saveReplyTo = saveReplyTo;
window.deleteCandidatureFromModal = deleteCandidatureFromModal;
window.deleteCandidatureDirect = deleteCandidatureDirect;


