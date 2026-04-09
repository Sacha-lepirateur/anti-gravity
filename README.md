# GeoMatch - App de Rencontre avec IA 🤖💕

Une app de rencontre innovante où vous devinez des lieux sur Google Street View pour matcher avec des personnes !

## ✨ Fonctionnalités

- **Jeu de localisation** : Devinez où se trouvent les profils à partir de Street View
- **Matching intelligent** : Match si vous êtes à moins de 30km !
- **Chat avec IA** : Discutez avec vos matches - une IA répond automatiquement !
- **Système de points** : Gagnez des points et des jokers
- **Profils personnalisables** : Modifiez votre pseudo, photo et bio

## 🚀 Installation & Configuration

### 1. Cloner et installer
```bash
git clone <repository-url>
cd anti-gravity-main
npm install
```

### 2. Configuration des APIs

Tu peux maintenant configurer l'IA avec un fichier `.env`.

Crée un fichier `.env` à la racine du projet et ajoute :

```env
VITE_HUGGINGFACE_API_KEY=ta_cle_huggingface
```

Si tu n'as pas de clé Hugging Face, le chat fonctionnera quand même avec des réponses basiques prédéfinies.

Pour toutes les clés, tu peux laisser celles de `src/App.tsx` comme elles sont ou les remplacer si tu veux personnaliser l'app.

```typescript
const SUPABASE_URL = "votre-url-supabase";
const SUPABASE_ANON_KEY = "votre-cle-anon-supabase";
const GOOGLE_MAPS_API_KEY = "votre-cle-google-maps";
```

### 3. Base de données Supabase

Créez ces tables dans votre projet Supabase :

#### Table `utilisateurs`
```sql
CREATE TABLE utilisateurs (
  id SERIAL PRIMARY KEY,
  nom TEXT NOT NULL,
  photo_url TEXT,
  indice TEXT,
  latitude FLOAT,
  longitude FLOAT,
  bio TEXT,
  age INTEGER
);
```

#### Table `messages` (pour le chat)
Exécutez le fichier `setup_messages_table.sql` dans l'onglet SQL Editor de Supabase.

### 4. Clé API IA (Optionnel mais recommandé)

Pour des réponses d'IA plus intelligentes :

1. Allez sur [Hugging Face](https://huggingface.co/)
2. Créez un compte gratuit
3. Allez dans Settings > Access Tokens
4. Créez un nouveau token
5. Copiez-le dans `HUGGINGFACE_API_KEY`

**Sans clé API** : L'app utilise des réponses prédéfinies intelligentes basées sur des mots-clés.

## 🎮 Comment jouer

1. **Voir le lieu** : Observez la vue Street View
2. **Deviner** : Cliquez sur la carte pour placer votre marqueur
3. **Valider** : Si vous êtes à moins de 30km, c'est un MATCH ! 🎉
4. **Discuter** : Ouvrez le chat (💬) et discutez avec vos matches
5. **L'IA répond** : Une IA simule les réponses de vos matches automatiquement !

## 🏆 Système de points

- **Match (≤30km)** : 1000+ points selon votre série
- **Super Like (≤50km)** : +1 Super Like
- **Like (≤80km)** : Rien de spécial
- **Échec (>80km)** : Série remise à zéro

Tous les 3 matches consécutifs : +1 Joker !

## 🤖 L'IA de chat

L'IA répond automatiquement à vos messages avec :
- **Avec clé Hugging Face** : Réponses générées par IA, contextuelles et naturelles
- **Sans clé API** : Réponses prédéfinies intelligentes basées sur le contenu de votre message

Les réponses arrivent après 2-5 secondes pour simuler une conversation réaliste.

## 🛠️ Développement

```bash
npm run dev      # Démarrer en développement
npm run build    # Build de production
npm run preview  # Prévisualiser la build
```

## 📱 Technologies utilisées

- **React 18** + TypeScript
- **Vite** pour le build
- **Tailwind CSS** pour le styling
- **Framer Motion** pour les animations
- **Leaflet** pour les cartes
- **Supabase** pour la base de données
- **Google Maps API** pour Street View
- **Hugging Face API** pour l'IA (optionnel)

## 🎨 Personnalisation

- Modifiez les couleurs dans `tailwind.config.js`
- Changez les icônes et emojis dans le code
- Ajustez les distances de matching dans `handleValidateGuess`
- Personnalisez les réponses IA dans `getFallbackResponse`

## 📄 Licence

Ce projet est open source. Amusez-vous bien ! 🚀