# 🤖 Intelligent Application Handler

> Outil intelligent de gestion des candidatures en alternance avec surveillance email en temps réel, analyse IA et relances automatiques.

![Version](https://img.shields.io/badge/version-1.0.0-7c3aed) ![Node](https://img.shields.io/badge/node-18+-green) ![License](https://img.shields.io/badge/license-MIT-blue)

---

## ✨ Fonctionnalités

- **🔐 Connexion Google OAuth2** — Connexion sécurisée, aucun mot de passe stocké
- **📬 Surveillance email temps réel** — Détection automatique des accusés de réception
- **🤖 Analyse IA (Groq / Llama)** — Classification et extraction des infos candidature
- **⏱️ Suivi J+21** — Cron quotidien, alerte et génération de relance automatique
- **📤 Relance 1 clic** — Message pré-rédigé par IA, envoyable d'un clic
- **📊 Dashboard premium** — Stats, graphiques, 4 onglets de suivi
- **🔔 Temps réel (SSE)** — Mises à jour live sans rafraîchissement
- **📱 Responsive** — Interface mobile-friendly

---

## 🚀 Installation

### Prérequis
- Node.js 18+
- Compte Google (Gmail)
- Clé API Groq ([console.groq.com](https://console.groq.com))

### 1. Cloner le repo

```bash
git clone https://github.com/TON_USERNAME/Intelligent_Application_Handler.git
cd Intelligent_Application_Handler
npm install
```

### 2. Configuration Google OAuth2

1. Aller sur [console.cloud.google.com](https://console.cloud.google.com)
2. Créer un nouveau projet
3. Activer **Gmail API** (`APIs & Services > Library > Gmail API`)
4. Créer des identifiants OAuth2 :
   - `APIs & Services > Credentials > Create Credentials > OAuth 2.0 Client ID`
   - Application type : **Web application**
   - Authorized redirect URIs : `http://localhost:3000/auth/google/callback`
5. Copier `Client ID` et `Client Secret`

### 3. Variables d'environnement

```bash
cp .env.example .env
```

Éditer `.env` :
```env
GOOGLE_CLIENT_ID=votre_client_id
GOOGLE_CLIENT_SECRET=votre_client_secret
GOOGLE_CALLBACK_URL=http://localhost:3000/auth/google/callback

GROQ_API_KEY=votre_clé_groq

SESSION_SECRET=une_longue_chaîne_aléatoire

PORT=3000
```

### 4. Lancer l'application

```bash
npm run dev    # Mode développement (avec rechargement auto)
# ou
npm start      # Mode production
```

Ouvrir [http://localhost:3000](http://localhost:3000) 🎉

---

## 📁 Structure

```
├── backend/
│   ├── server.js          # Express + routes API
│   ├── auth/              # Google OAuth2 (Passport.js)
│   ├── email/             # Gmail API client
│   ├── ai/                # Groq AI (analyse + relances)
│   ├── db/                # SQLite (schéma + requêtes)
│   └── scheduler/         # Watcher + cron quotidien
├── frontend/
│   ├── login.html         # Page de connexion
│   ├── index.html         # Dashboard principal
│   ├── css/style.css      # Design dark glassmorphism
│   └── js/app.js          # Logique frontend
├── data/                  # Base SQLite (auto-créée, gitignorée)
├── .env.example
└── package.json
```

---

## 🔒 Sécurité & Confidentialité

- Authentification via **OAuth2 Google officiel** (aucun mot de passe stocké)
- Tokens d'accès stockés uniquement en **session serveur** (jamais exposés)
- Données stockées **localement** dans SQLite (jamais envoyées sur le cloud)
- `.env` et base de données **exclus du dépôt Git**
- Chaque utilisateur voit uniquement **ses propres données**

---

## 🛠️ Déploiement

Pour déployer sur un serveur, changer `GOOGLE_CALLBACK_URL` dans `.env` :
```env
GOOGLE_CALLBACK_URL=https://ton-domaine.com/auth/google/callback
NODE_ENV=production
```

Et ajouter cette URL dans les URIs de redirection autorisées dans Google Cloud Console.

---

## 📝 Licence

MIT — Fait avec ❤️ et de l'IA
