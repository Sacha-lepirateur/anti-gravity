import { useState, useEffect, useRef } from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMapEvents, Polyline } from 'react-leaflet'
import L from 'leaflet'
import { motion, AnimatePresence } from 'framer-motion'
import confetti from 'canvas-confetti'
import { GoogleMap, StreetViewPanorama, useJsApiLoader } from '@react-google-maps/api'
import { createClient } from '@supabase/supabase-js'

// ╔══════════════════════════════════════════════════════════╗
// ║   🔧 CONFIGURE ICI — METS TES CLES API (DB + GOOGLE)    ║
// ╚══════════════════════════════════════════════════════════╝
const SUPABASE_URL = "https://vromnbvyylhtpxgfwhkt.supabase.co"; // ← ton URL
const SUPABASE_ANON_KEY = "sb_publishable_O__eJlMAsw8-Cgw2_5vmsw_EHfoXjg1"; // ← ta clé anon
const GOOGLE_MAPS_API_KEY: string = "AIzaSyAmMk8Lr_fiZ32RdrUT_SHsV8ouvDVG-m0"; // ← METS TA CLE STREET VIEW ICI !
const HUGGINGFACE_API_KEY: string = import.meta.env.VITE_HUGGINGFACE_API_KEY || ""; // ← clé Hugging Face dans .env, optionnel

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

type ChatMessage = { role: 'user' | 'model'; text: string };

const redIcon = L.icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34]
});

const defaultIcon = L.icon({
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34]
});

function haversine(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

type Utilisateur = {
  nom: string;
  photo_url: string;
  indice: string;
  latitude: number;
  longitude: number;
  bio?: string;
  age?: number;
};

type Message = {
  id: string;
  sender: string;
  receiver: string;
  content: string;
  timestamp: string;
};

// Component that captures map clicks securely based on game state
function MapClickEvents({ onLocationClick, matched, pointsLocked }: { onLocationClick: (lat: number, lng: number) => void, matched: boolean, pointsLocked: boolean }) {
  useMapEvents({
    click(e) {
      if (!matched && !pointsLocked) {
        onLocationClick(e.latlng.lat, e.latlng.lng);
      }
    },
  });
  return null;
}

function App() {
  const [session, setSession] = useState<any>(null);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [isLoginMode, setIsLoginMode] = useState(true);
  const [authLoading, setAuthLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthLoading(true);
    let error = null;
    if (isLoginMode) {
      const res = await supabase.auth.signInWithPassword({ email: authEmail, password: authPassword });
      error = res.error;
    } else {
      const res = await supabase.auth.signUp({ email: authEmail, password: authPassword });
      error = res.error;
      if (!error) alert("Inscription réussie !");
    }
    if (error) alert("Erreur : " + error.message);
    setAuthLoading(false);
  };

  const [userPos, setUserPos] = useState<{ lat: number, lon: number } | null>(null);

  useEffect(() => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserPos({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude
        });
      },
      (err) => console.log("Localisation refusée", err),
      { enableHighAccuracy: true }
    );
  }, []);

  const [users, setUsers] = useState<Utilisateur[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [matched, setMatched] = useState(false);
  const [showMatchOverlay, setShowMatchOverlay] = useState(false);
  const [matchStatus, setMatchStatus] = useState<'MATCH' | 'SUPER_LIKE' | 'LIKE' | 'GHOST' | 'TIME_OUT' | null>(null);

  // IA Chat States
  const [chats, setChats] = useState<Record<string, ChatMessage[]>>({});
  const [isTyping, setIsTyping] = useState(false);
  const [currentMessageInput, setCurrentMessageInput] = useState("");

  const handleSendMessage = async () => {
    if (!currentMessageInput.trim() || !activeChat) return;

    if (!myProfile.apiKey) {
      alert("🚨 Tu n'as pas configuré ta clé Claude ! Ajoute-la dans les Paramètres de ton profil.");
      return;
    }

    const userText = currentMessageInput.trim();
    setCurrentMessageInput("");
    setIsTyping(true);

    const historyForApi = chats[activeChat.nom] || [{ role: 'model', text: "Salut ! Trop fort, tu m'as trouvé en plein dans le mille ! 😊" }];

    setChats(prev => ({ ...prev, [activeChat.nom]: [...historyForApi, { role: 'user', text: userText }] }));

    try {
      const url = `https://api.anthropic.com/v1/messages`;
      const promptSystem = `Tu es ${activeChat.nom}, ${activeChat.age || 24} ans. Ta bio est: "${activeChat.bio || "Prêt(e) à découvrir de nouveaux lieux!"}". Tu es sur une application de rencontre appelée GeoMatch. La personne vient de deviner ta localisation exacte grâce à l'indice "${activeChat.indice}". Garde un ton naturel, flirtant si approprié, et fais des phrases courtes comme dans un vrai chat. Pas de hashtags. Le tout premier message que tu avais dit ("Salut ! Trop fort, tu m'as trouvé en plein dans le mille ! 😊") a déjà été envoyé, ceci est la suite de la conversation.`;

      const messagesForClaude = historyForApi.map(msg => ({ role: msg.role === 'model' ? 'assistant' : 'user', content: msg.text }));
      messagesForClaude.push({ role: 'user', content: userText });

      const response = await fetch(url, {
        method: 'POST',
        headers: { 
          'content-type': 'application/json',
          'x-api-key': myProfile.apiKey || "",
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model: 'claude-3-haiku-20240307',
          max_tokens: 150,
          system: promptSystem,
          messages: messagesForClaude
        })
      });

      if (!response.ok) throw new Error("API Error");

      const data = await response.json();
      const modelReply = data.content?.[0]?.text || "Oops, problème de connexion !";

      setChats(prev => ({
        ...prev,
        [activeChat.nom]: [...(prev[activeChat.nom] || []), { role: 'model', text: modelReply }]
      }));
    } catch (err) {
      setChats(prev => ({
        ...prev,
        [activeChat.nom]: [...(prev[activeChat.nom] || []), { role: 'model', text: "*(Message non envoyé, vérifie ta clé Claude dans App.tsx)*" }]
      }));
    } finally {
      setIsTyping(false);
    }
  };

  useEffect(() => {
    if (matched && matchStatus === 'MATCH') {
      setShowMatchOverlay(true);
      const timer = setTimeout(() => setShowMatchOverlay(false), 2000);
      return () => clearTimeout(timer);
    } else {
      setShowMatchOverlay(false);
    }
  }, [matched, matchStatus]);

  const [guessMarker, setGuessMarker] = useState<{ lat: number; lng: number } | null>(null);
  const [distance, setDistance] = useState<number | null>(null);

  // Game States for Jokers & Profiles
  const [pointsLocked, setPointsLocked] = useState(false);
  const [jokers, setJokers] = useState(3);
  const [showProfileSheet, setShowProfileSheet] = useState(false);
  const [timeLeft, setTimeLeft] = useState(30);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [gameStarted, setGameStarted] = useState(false);

  useEffect(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio('/timer-music.mp3');
      audioRef.current.loop = false;
    }
  }, []);

  useEffect(() => {
    if (loading || users.length === 0 || matched || pointsLocked || !gameStarted) {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      return;
    }

    if (timeLeft === 30 && audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(e => console.log('Autoplay bloqué par le navigateur', e));
    }

    if (timeLeft > 0) {
      const timer = setTimeout(() => setTimeLeft(timeLeft - 1), 1000);
      return () => clearTimeout(timer);
    } else {
      setMatchStatus('TIME_OUT');
      setPointsLocked(true);
      if (audioRef.current) {
        audioRef.current.pause();
      }
    }
  }, [timeLeft, loading, users, matched, pointsLocked, gameStarted]);

  // Match / Messages States
  const [matchedUsers, setMatchedUsers] = useState<Utilisateur[]>([]);
  const [showSidebar, setShowSidebar] = useState(false);
  const [activeChat, setActiveChat] = useState<Utilisateur | null>(null);
  const [messages, setMessages] = useState<{[key: string]: Message[]}>({});
  const [newMessage, setNewMessage] = useState('');

  // My Profile States
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [myProfile, setMyProfile] = useState<{ pseudo: string, photo: string, bio: string, streak: number, superLikes: number, apiKey?: string }>(() => {
    const saved = localStorage.getItem('my_geomatch_profile');
    return saved ? JSON.parse(saved) : { pseudo: 'Aventurier', photo: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Aventurier', bio: "Prêt(e) à découvrir de nouveaux lieux ! 🌍", streak: 0, superLikes: 0, apiKey: "" };
  });

  useEffect(() => {
    localStorage.setItem('my_geomatch_profile', JSON.stringify(myProfile));
  }, [myProfile]);

  useEffect(() => {
    async function fetchUtilisateurs() {
      const url = `${SUPABASE_URL}/rest/v1/utilisateurs?select=nom,photo_url,indice,latitude,longitude`;

      try {
        const res = await fetch(url, {
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json'
          }
        });

        if (!res.ok) throw new Error(`HTTP ${res.status} — ${res.statusText}`);

        const data = await res.json();

        if (!data || data.length === 0) throw new Error('Aucun utilisateur trouvé dans la table.');

        setUsers(data);
        setLoading(false);
      } catch (err: any) {
        setErrorMsg(err.message);
        setLoading(false);
      }
    }

    fetchUtilisateurs();
  }, []);

  // Supabase helper function
  const supabaseFetch = async (path: string, options?: RequestInit) => {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        ...options?.headers
      },
      ...options
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Supabase ${res.status}: ${text}`);
    }

    return res.json();
  };

  // Message functions
  const fetchMessages = async (otherUser: string) => {
    try {
      const chatKey = [myProfile.pseudo, otherUser].sort().join('-');
      const data = await supabaseFetch(`messages?or=(and(sender.eq.${myProfile.pseudo},receiver.eq.${otherUser}),and(sender.eq.${otherUser},receiver.eq.${myProfile.pseudo}))&order=timestamp.asc`);
      setMessages(prev => ({ ...prev, [chatKey]: data }));
    } catch (err) {
      console.log('Error fetching messages:', err);
    }
  };

  const sendMessage = async (receiver: string, content: string) => {
    if (!content.trim()) return;

    try {
      const messageData = {
        sender: myProfile.pseudo,
        receiver,
        content: content.trim(),
        timestamp: new Date().toISOString()
      };

      await supabaseFetch('messages', {
        method: 'POST',
        body: JSON.stringify(messageData)
      });

      const chatKey = [myProfile.pseudo, receiver].sort().join('-');
      setMessages(prev => ({
        ...prev,
        [chatKey]: [...(prev[chatKey] || []), { ...messageData, id: Date.now().toString() }]
      }));
      setNewMessage('');

      // Générer une réponse automatique de l'IA après 2-5 secondes
      const currentMessages = messages[chatKey] || [];
      const delay = 2000 + Math.random() * 3000; // 2-5 secondes
      
      setTimeout(async () => {
        const aiResponse = await generateAIResponse(content, receiver, [...currentMessages, { ...messageData, id: Date.now().toString() }]);
        
        const aiMessageData = {
          sender: receiver,
          receiver: myProfile.pseudo,
          content: aiResponse,
          timestamp: new Date().toISOString()
        };

        // Sauvegarder la réponse IA dans la DB aussi
        try {
          await supabaseFetch('messages', {
            method: 'POST',
            body: JSON.stringify(aiMessageData)
          });
        } catch (err) {
          console.log('Error saving AI response:', err);
        }

        setMessages(prev => ({
          ...prev,
          [chatKey]: [...(prev[chatKey] || []), { ...aiMessageData, id: Date.now().toString() + '_ai' }]
        }));
      }, delay);

    } catch (err) {
      console.log('Error sending message:', err);
    }
  };

  const handleLocationClick = (lat: number, lng: number) => {
    if (users.length === 0 || matched || pointsLocked) return;
    setGuessMarker({ lat, lng });
  };

  const handleValidateGuess = () => {
    if (!guessMarker || users.length === 0 || matched || pointsLocked) return;

    const user = users[currentIndex];
    const { lat, lng } = guessMarker;

    const dist = haversine(lat, lng, user.latitude, user.longitude);
    const distKm = Math.round(dist);
    setDistance(distKm);

    if (distKm <= 30) {
      setMatchStatus('MATCH');
      setMatched(true);
      setMatchedUsers(prev => prev.find(u => u.nom === user.nom) ? prev : [...prev, user]);

      confetti({
        particleCount: 150,
        spread: 90,
        origin: { y: 0.6 },
        colors: ['#f43f5e', '#ffffff', '#fbbf24']
      });

      setMyProfile(prev => {
        const newStreak = (prev.streak || 0) + 1;
        if (newStreak % 3 === 0) setJokers(j => j + 1);
        return { ...prev, streak: newStreak };
      });
    } else if (distKm <= 50) {
      setMatchStatus('SUPER_LIKE');
      setPointsLocked(true);
      setMyProfile(prev => ({ ...prev, streak: 0, superLikes: (prev.superLikes || 0) + 1 }));
    } else if (distKm <= 80) {
      setMatchStatus('LIKE');
      setPointsLocked(true);
      setMyProfile(prev => ({ ...prev, streak: 0 }));
    } else {
      setMatchStatus('GHOST');
      setPointsLocked(true);
      setMyProfile(prev => ({ ...prev, streak: 0 }));
    }
  };

  const nextUser = () => {
    setCurrentIndex((prev) => (prev + 1) % users.length);
    setMatched(false);
    setMatchStatus(null);
    setGuessMarker(null);
    setDistance(null);
    setPointsLocked(false);
    setShowProfileSheet(false);
    setTimeLeft(30);
  };

  const useJoker = () => {
    if (jokers > 0) {
      setJokers((prev) => prev - 1);
      setPointsLocked(false);
      setMatchStatus(null);
      setGuessMarker(null);
      setDistance(null);
      setTimeLeft(30);
    }
  };

  // IA Response Generator
  const generateAIResponse = async (userMessage: string, receiverName: string, conversationHistory: Message[]) => {
    try {
      // Si on a une clé Hugging Face, on utilise l'API
      if (HUGGINGFACE_API_KEY) {
        const context = conversationHistory.slice(-5).map(msg => 
          `${msg.sender === myProfile.pseudo ? 'Moi' : receiverName}: ${msg.content}`
        ).join('\n');

        const prompt = `Tu es ${receiverName}, un utilisateur d'une app de rencontre. Réponds de manière naturelle et engageante à ce message. Contexte de la conversation:\n${context}\n\nMessage reçu: "${userMessage}"\n\nRéponse:`;

        const response = await fetch('https://api-inference.huggingface.co/models/microsoft/DialoGPT-medium', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${HUGGINGFACE_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            inputs: prompt,
            parameters: {
              max_length: 100,
              temperature: 0.8,
              do_sample: true
            }
          })
        });

        const data = await response.json();
        return data[0]?.generated_text?.split('Réponse:')[1]?.trim() || getFallbackResponse(userMessage);
      } else {
        // Réponses prédéfinies si pas de clé API
        return getFallbackResponse(userMessage);
      }
    } catch (error) {
      console.log('Erreur IA:', error);
      return getFallbackResponse(userMessage);
    }
  };

  const getFallbackResponse = (userMessage: string): string => {
    const responses = {
      'salut': ['Salut ! 😊', 'Hey ! Comment ça va ?', 'Salut toi !'],
      'ça va': ['Super et toi ?', 'Bien merci ! Et toi ?', 'Ça roule !'],
      'quoi': ['Rien de spécial, et toi ?', 'Je me détends un peu', 'Je pense à toi 😏'],
      'où': ['Je suis dans le coin, et toi ?', 'Pas loin d\'ici !', 'Dans la région'],
      'âge': ['J\'ai 25 ans, et toi ?', '24 ans !', '25 ans 😊'],
      'travail': ['Je suis développeur', 'Je travaille dans la tech', 'Je suis designer'],
      'loisir': ['J\'aime voyager et découvrir', 'La musique et les sorties', 'Le sport et la nature'],
      'rencontre': ['On se voit bientôt ?', 'Ça te dit qu\'on se rencontre ?', 'On pourrait se voir !'],
      'default': ['Intéressant !', 'Ah oui ?', 'Raconte-moi plus !', 'C\'est cool ça', 'J\'adore !']
    };

    const lowerMessage = userMessage.toLowerCase();
    
    for (const [key, value] of Object.entries(responses)) {
      if (key !== 'default' && lowerMessage.includes(key)) {
        return value[Math.floor(Math.random() * value.length)];
      }
    }
    
    return responses.default[Math.floor(Math.random() * responses.default.length)];
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-slate-950 flex flex-col items-center justify-center z-[100]">
        <div className="spinner"></div>
        <p className="mt-6 text-xs font-bold tracking-widest text-slate-400 uppercase">Recherche des profils…</p>
      </div>
    );
  }

  if (errorMsg) {
    return (
      <div className="fixed inset-0 bg-slate-950 flex items-center justify-center p-6 z-[100]">
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-3xl p-8 max-w-sm text-center shadow-[0_0_40px_rgba(244,63,94,0.1)]">
          <h2 className="text-xl font-bold text-rose-400 mb-4">⚠️ Erreur de connexion</h2>
          <p className="text-sm text-slate-300 leading-relaxed mb-6">{errorMsg}</p>
          <p className="text-xs text-slate-500">
            Vérifiez SUPABASE_URL et SUPABASE_ANON_KEY en haut de App.tsx.
          </p>
        </div>
      </div>
    );
  }

  if (users.length === 0) return null;

  const user = users[currentIndex];

  const renderProfileContent = () => {
    if (!session) {
      return (
        <div className="flex flex-col items-center justify-center h-full w-full max-w-sm mx-auto text-left py-2 pb-6">
          <div className="w-20 h-20 bg-slate-800 rounded-full flex items-center justify-center text-4xl mb-4 border border-rose-500/50 shadow-[0_0_20px_rgba(244,63,94,0.3)]">
            🔒
          </div>
          <h2 className="text-3xl font-serif font-bold text-white mb-2">{isLoginMode ? "Connexion" : "Inscription"}</h2>
          <p className="text-slate-400 text-sm mb-6 text-center leading-relaxed">Connecte-toi pour sauvegarder ton profil et discuter avec tes Matchs.</p>

          <form onSubmit={handleAuth} className="w-full flex flex-col gap-4 relative z-10 pointer-events-auto border-t border-white/10 pt-6">
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest pl-1">Email</label>
              <input
                type="email"
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
                required
                className="w-full mt-1.5 bg-slate-900 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-rose-500 transition-colors pointer-events-auto"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest pl-1">Mot de passe</label>
              <input
                type="password"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                required
                className="w-full mt-1.5 bg-slate-900 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-rose-500 transition-colors pointer-events-auto"
              />
            </div>
            
            <button type="submit" disabled={authLoading} style={{ pointerEvents: 'auto' }} className="mt-4 z-20 pointer-events-auto w-full bg-rose-500 hover:bg-rose-400 disabled:bg-slate-700 text-white font-bold py-3.5 rounded-full shadow-[0_5px_20px_rgba(244,63,94,0.3)] active:scale-95 transition-transform flex items-center justify-center gap-2">
              {authLoading ? "⏳ Chargement..." : (isLoginMode ? "Se connecter ➡️" : "Créer le compte 🚀")}
            </button>
          </form>

          <button
            style={{ pointerEvents: 'auto' }}
            onClick={(e) => { e.preventDefault(); setIsLoginMode(!isLoginMode); }}
            className="mt-6 z-20 text-sm text-indigo-400 hover:text-indigo-300 transition underline underline-offset-4 pointer-events-auto"
          >
            {isLoginMode ? "Pas encore de compte ? S'inscrire" : "Déjà un compte ? Se connecter"}
          </button>
        </div>
      );
    }

    return (
      <div className="flex-grow overflow-y-auto relative w-full h-full pb-4">
        {isEditingProfile ? (
        <div className="flex flex-col gap-4 text-left w-full max-w-md mx-auto">
          <div className="text-center font-bold text-indigo-400 mb-2">Modifier mon profil & Réglages</div>
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest pl-1">Pseudo</label>
            <input
              type="text"
              value={myProfile.pseudo}
              onChange={(e) => setMyProfile({ ...myProfile, pseudo: e.target.value })}
              className="w-full mt-1.5 bg-slate-900 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-indigo-500 transition-colors"
            />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest pl-1">Photo URL</label>
            <input
              type="text"
              value={myProfile.photo}
              onChange={(e) => setMyProfile({ ...myProfile, photo: e.target.value })}
              className="w-full mt-1.5 bg-slate-900 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-indigo-500 transition-colors"
            />
            <button onClick={() => setMyProfile({ ...myProfile, photo: `https://api.dicebear.com/7.x/avataaars/svg?seed=${Math.random()}` })} className="text-[10px] text-indigo-400 mt-2 hover:text-indigo-300 font-medium px-1 underline underline-offset-2">🔄 Générer avatar aléatoire</button>
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest pl-1">Ma Bio</label>
            <textarea
              value={myProfile.bio}
              onChange={(e) => setMyProfile({ ...myProfile, bio: e.target.value })}
              className="w-full mt-1.5 bg-slate-900 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-indigo-500 transition-colors resize-none h-20"
            />
          </div>
          <div className="pt-3 border-t border-white/10 mt-2">
            <label className="text-[10px] font-bold text-rose-400 uppercase tracking-widest pl-1 flex items-center gap-1">🔑 Clé API Claude-3</label>
            <input
              type="password"
              placeholder="sk-ant-api03-..."
              value={myProfile.apiKey || ""}
              onChange={(e) => setMyProfile({ ...myProfile, apiKey: e.target.value })}
              className="w-full mt-1.5 bg-slate-900 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-rose-500 transition-colors"
            />
            <p className="text-[10px] text-slate-500 mt-2 pl-1 leading-relaxed">Cette clé est sauvegardée localement dans ton navigateur et permet à l'IA des prospects de te répondre !</p>
          </div>
          <button onClick={() => setIsEditingProfile(false)} className="mt-4 w-full bg-indigo-500 hover:bg-indigo-400 text-white font-bold py-3.5 rounded-full shadow-[0_5px_20px_rgba(99,102,241,0.3)] active:scale-95 transition-transform flex items-center justify-center gap-2">
            Enregistrer ✔️
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-center text-center mt-2 w-full max-w-md mx-auto">
          <div className="relative group">
            <img src={myProfile.photo} alt="Mon Profil" className="w-32 h-32 bg-slate-800 rounded-full object-cover border-4 border-slate-800 shadow-xl" />
            <button onClick={() => setIsEditingProfile(true)} className="absolute bottom-0 right-0 w-10 h-10 bg-indigo-500 rounded-full border-4 border-slate-900 flex items-center justify-center text-white text-md shadow-lg hover:bg-indigo-400 hover:scale-105 active:scale-95 transition-all">
              ⚙️
            </button>
          </div>
          <h3 className="mt-5 text-3xl font-serif font-bold text-white drop-shadow-md">{myProfile.pseudo}</h3>
          
          {myProfile.apiKey ? (
             <div className="mt-2 text-[10px] font-mono text-green-400 bg-green-400/10 px-3 py-1 rounded-full border border-green-400/20">🟢 API Claude Connectée</div>
          ) : (
             <div className="mt-2 text-[10px] font-mono text-rose-400 bg-rose-400/10 px-3 py-1 rounded-full border border-rose-400/20 flex flex-col gap-1 items-center">
               <span>🔴 API Claude Manquante</span>
               <button onClick={() => setIsEditingProfile(true)} className="underline cursor-pointer">Ajouter la clé</button>
             </div>
          )}

          <div className="bg-slate-900/80 border border-white/5 rounded-3xl p-5 mt-6 w-full shadow-inner relative text-left">
            <span className="absolute -top-3 left-6 bg-slate-900 px-3 text-[10px] font-black text-rose-400 tracking-widest rounded-full border border-white/5 py-1">MA BIO</span>
            <p className="text-slate-300 text-sm leading-relaxed mt-1 font-medium whitespace-pre-wrap">{myProfile.bio}</p>
          </div>

          <div className="w-full grid grid-cols-2 gap-4 mt-5">
            <div className="bg-slate-900/80 rounded-3xl p-4 flex flex-col items-center justify-center border border-white/5 shadow-md relative overflow-hidden group">
              <div className="absolute inset-0 bg-gradient-to-t from-orange-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              <span className="text-2xl mb-1 opacity-80 relative z-10 group-hover:scale-110 transition-transform">🔥</span>
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider text-center relative z-10">Série</span>
              <span className="font-mono text-xl font-bold text-white relative z-10">{myProfile.streak || 0}</span>
            </div>
            <div className="bg-slate-900/80 rounded-3xl p-4 flex flex-col items-center justify-center border border-white/5 shadow-md relative overflow-hidden group">
              <div className="absolute inset-0 bg-gradient-to-t from-yellow-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              <span className="text-2xl mb-1 opacity-80 relative z-10 group-hover:scale-110 transition-transform">⭐</span>
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider text-center relative z-10">Super Likes</span>
              <span className="font-mono text-xl font-bold text-white relative z-10">{myProfile.superLikes || 0}</span>
            </div>
          </div>
          <button onClick={() => supabase.auth.signOut()} style={{ pointerEvents: 'auto' }} className="mt-8 w-full max-w-xs block mx-auto bg-slate-900/50 text-rose-400 font-bold py-3 rounded-full border border-rose-500/20 hover:bg-rose-500/10 cursor-pointer pointer-events-auto transition active:scale-95">Se déconnecter 🚪</button>
        </div>
      )}
    </div>
    );
  };

  return (
    <div className="relative min-h-[100dvh] w-full flex flex-col grain-bg bg-slate-950 text-slate-50 overflow-y-auto">
      <AnimatePresence>
        {!gameStarted && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 1.05, filter: "blur(10px)" }}
            transition={{ duration: 0.5 }}
            className="fixed inset-0 z-[20000] bg-slate-950/80 backdrop-blur-3xl overflow-y-auto pointer-events-auto flex items-center justify-center p-4 md:p-8"
          >
            <div className="w-full max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-8 items-center lg:h-[700px]">
              {/* Colonne Gauche: Pitch */}
              <div className="text-center lg:text-left flex flex-col justify-center p-6 h-full">
                <h1 className="text-6xl md:text-8xl font-black font-serif text-white mb-6 drop-shadow-2xl tracking-tighter">Geo<span className="text-rose-500">Match</span> <span className="text-4xl md:text-6xl">💘</span></h1>
                <div className="w-20 h-2 bg-rose-500 rounded-full mb-8 mx-auto lg:mx-0 shadow-[0_0_20px_rgba(244,63,94,0.5)]" />
                <p className="text-slate-300 text-xl leading-relaxed font-medium mb-10 max-w-lg mx-auto lg:mx-0">
                  Séduisez le monde entier... Si vous parvenez à les retrouver d'abord.<br/><br/>
                  Vous avez <strong className="text-rose-400">30 secondes</strong> pour deviner leur position exacte ! Mettez votre clé API depuis les paramètres pour pouvoir parler aux profils qui ont matché.
                </p>
                
                <button 
                  onClick={() => setGameStarted(true)}
                  disabled={!session}
                  className={`font-black px-12 py-6 rounded-[2rem] text-2xl active:scale-95 transition-all w-full md:w-max mx-auto lg:mx-0 uppercase tracking-widest border border-rose-400/50 ${!session ? "bg-slate-800 text-slate-500 cursor-not-allowed opacity-50" : "bg-rose-500 hover:bg-rose-400 text-white shadow-[0_15px_50px_rgba(244,63,94,0.4)]"}`}
                  style={{ pointerEvents: 'auto' }}
                >
                  {session ? "START MATCHING 🚀" : "CONNEXION REQUISE 🔒"}
                </button>
              </div>

              {/* Colonne Droite: Profil et Paramètres */}
              <div className="bg-slate-900 border border-white/10 rounded-[3rem] p-8 md:p-10 shadow-[0_30px_100px_rgba(0,0,0,0.8)] relative overflow-hidden h-full flex flex-col pointer-events-auto">
                <div className="absolute top-0 right-0 p-6 pointer-events-none opacity-20">
                  <span className="text-8xl drop-shadow-lg">⚙️</span>
                </div>
                {renderProfileContent()}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div id="top-anchor"></div>

      {/* ── HEADER (Floating Glass Panel) ── */}
      <header className="fixed top-0 inset-x-0 z-[100] px-6 py-4 pt-safe flex flex-col gap-4 glass-panel rounded-b-3xl">
        <div className="flex items-center justify-between w-full">
          <div className="font-serif text-2xl font-black tracking-tight drop-shadow-md flex items-center gap-3">
            <button onClick={() => setShowProfileMenu(true)} className="relative active:scale-95 transition-transform group shadow-md shrink-0">
              <div className="absolute inset-0 bg-rose-500 rounded-full blur opacity-20 group-hover:opacity-60 transition"></div>
              <img src={myProfile.photo} className="w-10 h-10 rounded-full object-cover border-2 border-slate-600 relative z-10 bg-slate-800" alt="Profil" />
            </button>
            <div>
              Geo<span className="text-rose-500">Match</span> <span className="text-xl">💘</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowSidebar(true)}
              className="relative w-10 h-10 rounded-full bg-slate-900 border border-white/20 flex items-center justify-center hover:bg-slate-800 transition shadow-md active:scale-95"
            >
              💬
              {matchedUsers.length > 0 && <span className="absolute top-0 right-0 w-3 h-3 bg-rose-500 rounded-full border border-slate-900 animate-pulse" />}
            </button>

            <div className={`text-[10px] font-bold px-3 py-1.5 rounded-full border shadow-md flex items-center gap-1 transition-colors ${timeLeft <= 5 && !matched && !pointsLocked ? 'bg-rose-900/80 border-rose-400/30 text-rose-300 animate-pulse' : 'bg-slate-900/80 border-indigo-400/30 text-indigo-300'}`}>
              <span className="text-sm">⏳</span> {timeLeft}s
            </div>

            <div className="text-[10px] font-bold px-3 py-1.5 bg-slate-900/80 rounded-full border border-indigo-400/30 text-indigo-300 shadow-md flex items-center gap-1">
              <span className="text-sm">🃏</span> x {jokers}
            </div>
          </div>
        </div>

        {/* Anchor Navigation */}
        <div className="flex justify-center gap-4 pb-2">
          <button
            onClick={() => document.getElementById('top-anchor')?.scrollIntoView({ behavior: 'smooth' })}
            style={{ zIndex: 10000, pointerEvents: 'auto' }}
            className="text-[11px] font-black uppercase tracking-widest px-4 py-2 rounded-full border border-white/10 bg-white/5 hover:bg-white/10 active:scale-95 transition-all text-slate-300"
          >
            1. Voir le lieu 👁️
          </button>
          <button
            onClick={() => document.getElementById('game-map')?.scrollIntoView({ behavior: 'smooth' })}
            style={{ zIndex: 10000, pointerEvents: 'auto' }}
            className="text-[11px] font-black uppercase tracking-widest px-4 py-2 rounded-full border border-white/10 bg-white/5 hover:bg-white/10 active:scale-95 transition-all text-slate-300"
          >
            2. Deviner sur la carte 📍
          </button>
        </div>
      </header>

      {/* ── TOP HALF: PROFILE CARD ── */}
      <div className="relative w-full z-20 flex flex-col items-center px-4 pb-0 pt-44 pointer-events-none">

        <AnimatePresence mode="popLayout">
          <motion.div
            key={user.nom}
            initial={{ opacity: 0, scale: 0.9, y: 30 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: -30 }}
            transition={{ type: "spring", stiffness: 300, damping: 25 }}
            className="w-full max-w-[1000px] pointer-events-auto"
          >
            {/* Split Screen Layout */}
            <div style={{ display: 'flex', gap: '20px', alignItems: 'start', marginTop: '20px', width: '100%' }}>

              {/* COLONNE GAUCHE : Street View (70% de largeur) */}
              <div style={{ flex: 7, height: '500px', borderRadius: '15px', overflow: 'hidden', boxShadow: '0 4px 15px rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', position: 'relative' }}>
                <iframe
                  width="100%"
                  height="100%"
                  style={{ border: 0 }}
                  loading="lazy"
                  src={`https://www.google.com/maps/embed/v1/streetview?key=${GOOGLE_MAPS_API_KEY}&location=${user.latitude},${user.longitude}`}
                ></iframe>

                {/* Panneau venant cacher le bandeau d'information (carré rouge) de Google Maps Embed */}
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '90px', background: 'linear-gradient(180deg, #111827 0%, rgba(17,24,39,0.8) 70%, transparent 100%)', pointerEvents: 'none', zIndex: 10 }} />
                <div style={{ position: 'absolute', top: '10px', left: '-1px', width: '380px', height: '65px', display: 'flex', alignItems: 'center', background: '#0f172a', borderRadius: '0 8px 8px 0', border: '1px solid rgba(255,255,255,0.1)', borderLeft: 'none', color: 'white', fontWeight: 'bold', fontSize: '18px', zIndex: 11, padding: '0 20px', boxShadow: '4px 4px 15px rgba(0,0,0,0.5)', pointerEvents: 'none' }}>
                  🕵️‍♂️ Lieu Mystère
                </div>
              </div>

              {/* COLONNE DROITE : Infos de la personne (30% de largeur) */}
              <div style={{ flex: 3, backgroundColor: '#1f2937', padding: '20px', borderRadius: '15px', color: 'white', minHeight: '500px', boxShadow: '0 4px 15px rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)' }}>
                <h2 style={{ fontSize: '24px', marginBottom: '10px', color: '#ec4899', fontWeight: 'bold' }}>{user.nom}</h2>
                <p style={{ fontStyle: 'italic', color: '#9ca3af', marginBottom: '20px' }}>"{user.bio || "Prêt(e) à l'aventure !"}"</p>

                <div style={{ borderTop: '1px solid #374151', paddingTop: '15px' }}>
                  <p><strong>📍 Indice :</strong> {user.indice}</p>
                </div>
              </div>
            </div>

            {/* Bouton "CONTINUER 💌" centré sur une ligne avec marges aérées */}
            <div style={{ width: '100%', display: 'flex', justifyContent: 'center', marginTop: '40px', marginBottom: '40px' }}>
              <button
                onClick={matched ? nextUser : handleValidateGuess}
                style={{
                  width: '100%',
                  maxWidth: '500px',
                  padding: '18px',
                  fontSize: '20px',
                  fontWeight: 'bold',
                  borderRadius: '50px',
                  border: 'none',
                  backgroundColor: matched ? '#10b981' : '#3b82f6',
                  color: 'white',
                  cursor: (matched || pointsLocked || guessMarker) ? 'pointer' : 'default',
                  boxShadow: '0 10px 20px rgba(0,0,0,0.2)',
                  transition: 'all 0.3s ease',
                  opacity: (matched || pointsLocked || guessMarker) ? 1 : 0.6
                }}
              >
                {matched ? "CONTINUER 💌" : "VALIDER MA POSITION 📍"}
              </button>
            </div>
          </motion.div>
        </AnimatePresence>

      </div>

      {/* ── ACTION DIVIDER AREA (Floating Pills between map and card) ── */}
      <div className="absolute top-[50dvh] lg:top-[45dvh] inset-x-0 z-40 flex justify-center -translate-y-[60%] pointer-events-none">
        <AnimatePresence mode="wait">


          {/* Bouton de validation redondant retiré */}

          {!matched && matchStatus && (
            <motion.div
              key="distance"
              initial={{ scale: 0, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0, opacity: 0 }}
              className="flex flex-col items-center gap-3 pointer-events-auto"
            >

              {/* EVALUATION CHIP */}
              {matchStatus === 'SUPER_LIKE' && (
                <div className="glass-panel bg-yellow-900/90 border border-yellow-500/50 px-6 py-3 rounded-full shadow-[0_10px_30px_rgba(234,179,8,0.2)] flex flex-col items-center gap-1">
                  <div className="flex items-center gap-2 font-bold text-yellow-400 text-sm"><span className="text-xl">🌟</span> Super Like (À {distance} km)</div>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-yellow-300/80">Oh, tu as presque eu le profil !</span>
                </div>
              )}
              {matchStatus === 'LIKE' && (
                <div className="glass-panel bg-blue-900/90 border border-blue-500/50 px-6 py-3.5 rounded-full text-sm font-bold text-blue-300 shadow-lg flex items-center gap-2">
                  <span className="text-xl">👍</span> Pas mal ! Like (À {distance} km)
                </div>
              )}
              {matchStatus === 'GHOST' && (
                <div className="glass-panel bg-slate-800/95 border border-slate-500/40 px-6 py-3.5 rounded-full text-sm font-bold text-slate-300 shadow-lg flex items-center gap-2">
                  <span className="text-xl opacity-60">👻</span> Aïe... Tu t'es perdu à {distance} km !
                </div>
              )}
              {matchStatus === 'TIME_OUT' && (
                <div className="glass-panel bg-slate-800/95 border border-slate-500/40 px-6 py-3.5 rounded-full text-sm font-bold text-slate-300 shadow-lg flex items-center gap-2">
                  <span className="text-xl opacity-60">⏳</span> Temps écoulé !
                </div>
              )}

              <div className="flex gap-2">
                {jokers > 0 && pointsLocked && (
                  <button
                    onClick={useJoker}
                    className="glass-panel bg-indigo-500/80 hover:bg-indigo-400 border border-indigo-400 text-white text-sm font-bold px-5 py-2.5 rounded-full shadow-lg active:scale-95 transition-transform"
                  >
                    🃏 Joker (-1)
                  </button>
                )}

                {pointsLocked && (
                  <button
                    onClick={nextUser}
                    className={
                      matchStatus === 'SUPER_LIKE' || matchStatus === 'LIKE'
                        ? "glass-panel bg-rose-500/90 hover:bg-rose-400 border border-rose-400 text-white text-sm font-bold px-5 py-2.5 rounded-full shadow-[0_5px_20px_rgba(244,63,94,0.4)] active:scale-95 transition-transform flex items-center gap-1"
                        : "glass-panel bg-slate-800/80 hover:bg-slate-700 border border-slate-600 text-white text-sm font-bold px-5 py-2.5 rounded-full shadow-lg active:scale-95 transition-transform flex items-center gap-1"
                    }
                  >
                    {matchStatus === 'SUPER_LIKE' || matchStatus === 'LIKE' ? 'CONTINUER 💌' : 'Passer 👉'}
                  </button>
                )}
              </div>
            </motion.div>
          )}

          {matched && !showProfileSheet && (
            <motion.div
              key="matchControls"
              initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -30 }}
              className="flex flex-col items-center gap-3 pointer-events-auto"
            >
              <button
                onClick={() => setShowProfileSheet(true)}
                className="bg-indigo-600/95 backdrop-blur-md border border-indigo-400/50 text-white font-bold px-10 py-5 rounded-full flex items-center gap-2 shadow-[0_0_40px_rgba(79,70,229,0.5)] active:scale-95 transition-transform text-lg"
              >
                👀 Voir le Profil de {user.nom}
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── BOTTOM HALF: INTERACTIVE MAP (Agrandie & Remontée) ── */}
      <div id="game-map" className="relative w-[95%] lg:w-1/2 mx-auto z-10 rounded-[40px] overflow-hidden shadow-[0_10px_50px_rgba(0,0,0,0.8)] border border-white/10 bg-slate-900 mb-12" style={{ height: '80vh', minHeight: '700px', marginTop: '40px' }}>
        <MapContainer center={[46.5, 2.5]} zoom={5} scrollWheelZoom={true} touchZoom={true} dragging={true} zoomControl={true} style={{ width: '100%', height: '100%' }} className="leaf-map-container">
          <TileLayer
            attribution='&copy; CARTO'
            url='https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
            maxZoom={18}
          />
          <MapClickEvents onLocationClick={handleLocationClick} matched={matched} pointsLocked={pointsLocked} />

          {guessMarker && (
            <Marker position={[guessMarker.lat, guessMarker.lng]} icon={redIcon}>
              <Popup className="font-sans font-bold">📍 Ton choix</Popup>
            </Marker>
          )}

          {(matched || pointsLocked) && (
            <Marker position={[user.latitude, user.longitude]} icon={defaultIcon}>
              <Popup className="font-sans font-bold text-rose-500">🎯 {user.nom} était ici !</Popup>
            </Marker>
          )}

          {guessMarker && (matched || pointsLocked) && (
            <Polyline
              positions={[[guessMarker.lat, guessMarker.lng], [user.latitude, user.longitude]]}
              pathOptions={{ color: '#fbbf24', dashArray: '5, 8', weight: 4, opacity: 0.8 }}
            />
          )}
        </MapContainer>

        {/* Live Distance Over Map Component */}
        {userPos && (
          <div className="absolute bottom-[4dvh] inset-x-0 flex justify-center pointer-events-none z-[400]">
            <div className="glass-panel bg-slate-900/80 border border-white/10 px-5 py-2.5 rounded-full shadow-lg flex items-center gap-2">
              <span className="text-xl animate-pulse">📡</span>
              <span className="text-sm font-bold text-white tracking-wide">
                À {haversine(userPos.lat, userPos.lon, user.latitude, user.longitude).toFixed(1)} km de toi
              </span>
            </div>
          </div>
        )}
      </div>

      {/* ── SIDEBAR CONVERSATIONS ── */}
      <AnimatePresence>
        {showSidebar && (
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            className="fixed inset-y-0 right-0 w-80 max-w-[85vw] bg-slate-950 border-l border-white/10 shadow-2xl z-[12000] flex flex-col pointer-events-auto"
          >
            <div className="p-5 bg-slate-900 border-b border-white/5 flex justify-between items-center pt-safe cursor-default">
              <h2 className="font-bold text-white font-serif text-xl tracking-tight">Matchs <span className="text-rose-500">({matchedUsers.length})</span></h2>
              <button
                onClick={() => { setShowSidebar(false); setActiveChat(null); }}
                className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white"
              >✕</button>
            </div>

            <div className="flex-grow overflow-y-auto">
              {!activeChat ? (
                matchedUsers.length === 0 ? (
                  <div className="p-8 text-center text-slate-400 text-sm leading-relaxed mt-10">
                    <span className="text-4xl block mb-4 opacity-50">👻</span>
                    Aucun match pour le moment. Fais tes preuves à moins de 30km sur la carte !
                  </div>
                ) : (
                  <ul className="p-3 space-y-2">
                    {matchedUsers.map((mu, i) => (
                      <li key={i} onClick={() => { setActiveChat(mu); fetchMessages(mu.nom); }} className="group flex items-center gap-4 p-3 rounded-2xl hover:bg-slate-800 cursor-pointer transition-colors border border-transparent hover:border-white/5">
                        <div className="relative">
                          <img src={mu.photo_url} className="w-14 h-14 rounded-full object-cover shadow-md" />
                          <div className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-green-500 border-2 border-slate-900 rounded-full" />
                        </div>
                        <div className="flex flex-col">
                          <span className="font-bold text-slate-100">{mu.nom}</span>
                          <span className="text-xs text-rose-400 font-medium font-mono">1 Nouveau profil</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )
              ) : (
                <div className="flex flex-col h-full bg-[#0b1121]">
                  <div className="p-3 bg-slate-900 flex items-center gap-3 shadow-md">
                    <button onClick={() => setActiveChat(null)} className="text-slate-400 hover:text-white p-1 ml-1 text-lg">←</button>
                    <img src={activeChat.photo_url} className="w-9 h-9 rounded-full object-cover" />
                    <span className="font-bold text-white text-sm">{activeChat.nom}</span>
                  </div>
                  <div className="flex-grow p-4 overflow-y-auto space-y-4">
<<<<<<< HEAD
                    {/* Badge Match Info */}
                    <div className="bg-rose-500/20 text-rose-200 text-[10px] uppercase font-bold text-center tracking-widest py-1 px-3 rounded-full mx-auto w-max mb-4">
                      Nouveau Match (Moins de 30km) !
                    </div>

                    {/* Messages Mapping */}
                    {(chats[activeChat.nom] || [{ role: 'model', text: "Salut ! Trop fort, tu m'as trouvé en plein dans le mille ! 😊" }]).map((msg, idx) => (
                      <div key={idx} className={`max-w-[85%] p-3.5 rounded-2xl text-sm shadow-lg relative ${msg.role === 'user' ? 'bg-indigo-500 text-white self-end rounded-br-sm ml-auto' : 'bg-slate-800 border border-white/5 text-slate-200 rounded-tl-sm w-max'}`}>
                        {msg.text}
                      </div>
                    ))}

                    {/* Typing Indicator */}
                    {isTyping && (
                      <div className="bg-slate-800 border border-white/5 p-3.5 rounded-2xl rounded-tl-sm w-max shadow-lg flex items-center gap-2">
                        <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"></span>
                        <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                        <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                      </div>
                    )}
                  </div>
                  <div className="p-4 bg-slate-900 border-t border-white/5 flex gap-2">
                    <input
                      type="text"
                      placeholder="Surprends ton match..."
                      value={currentMessageInput}
                      onChange={(e) => setCurrentMessageInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleSendMessage() }}
                      className="flex-grow bg-slate-950 border border-white/10 rounded-full px-5 py-2.5 text-sm text-white focus:outline-none focus:border-rose-500 transition-colors"
                    />
                    <button
                      onClick={handleSendMessage}
                      disabled={isTyping || !currentMessageInput.trim()}
                      className="w-10 h-10 shrink-0 rounded-full bg-rose-500 flex items-center justify-center shadow-lg active:scale-95 transition-transform text-white disabled:opacity-50 disabled:active:scale-100"
=======
                    {/* Badge Match Info */}
                    <div className="bg-rose-500/20 text-rose-200 text-[10px] uppercase font-bold text-center tracking-widest py-1 px-3 rounded-full mx-auto w-max mb-4">
                      Nouveau Match (Moins de 30km) !
                    </div>

                    {/* Messages Mapping */}
                    {(chats[activeChat.nom] || [{ role: 'model', text: "Salut ! Trop fort, tu m'as trouvé en plein dans le mille ! 😊" }]).map((msg, idx) => (
                      <div key={idx} className={`max-w-[85%] p-3.5 rounded-2xl text-sm shadow-lg relative ${msg.role === 'user' ? 'bg-indigo-500 text-white self-end rounded-br-sm ml-auto' : 'bg-slate-800 border border-white/5 text-slate-200 rounded-tl-sm w-max'}`}>
                        {msg.text}
                      </div>
                    ))}

                    {/* Typing Indicator */}
                    {isTyping && (
                      <div className="bg-slate-800 border border-white/5 p-3.5 rounded-2xl rounded-tl-sm w-max shadow-lg flex items-center gap-2">
                        <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"></span>
                        <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                        <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                      </div>
                    )}
                  </div>
                  <div className="p-4 bg-slate-900 border-t border-white/5 flex gap-2">
                    <input
                      type="text"
                      placeholder="Surprends ton match..."
                      value={currentMessageInput}
                      onChange={(e) => setCurrentMessageInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleSendMessage() }}
                      className="flex-grow bg-slate-950 border border-white/10 rounded-full px-5 py-2.5 text-sm text-white focus:outline-none focus:border-rose-500 transition-colors"
                    />
                    <button
                      onClick={handleSendMessage}
                      disabled={isTyping || !currentMessageInput.trim()}
                      className="w-10 h-10 shrink-0 rounded-full bg-rose-500 flex items-center justify-center shadow-lg active:scale-95 transition-transform text-white disabled:opacity-50 disabled:active:scale-100"
>>>>>>> db453a28ade0fdf75c59244ed579b61dc757962a
                    >
                      💌
                    </button>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── MY PROFILE MENU (Left Sidebar) ── */}
      <AnimatePresence>
        {showProfileMenu && (
          <motion.div
            initial={{ x: "-100%" }}
            animate={{ x: 0 }}
            exit={{ x: "-100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            className="fixed inset-y-0 left-0 w-80 max-w-[85vw] bg-slate-950 border-r border-white/10 shadow-2xl z-[12000] flex flex-col pointer-events-auto"
          >
            <div className="p-5 bg-slate-900 border-b border-white/5 flex justify-between items-center pt-safe cursor-default">
              <h2 className="font-bold text-white font-serif text-xl tracking-tight">Mon Profil</h2>
              <button
                onClick={() => { setShowProfileMenu(false); setIsEditingProfile(false); }}
                className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white"
              >✕</button>
            </div>

            <div className="flex-grow overflow-y-auto p-6 relative">
              {renderProfileContent()}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── THE DETAILED PROFILE BOTTOM SHEET ── */}
      <AnimatePresence>
        {showProfileSheet && (
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 350, damping: 30 }}
            className="fixed inset-0 z-[10000] flex flex-col justify-end pointer-events-none"
          >
            {/* Backdrop click to close */}
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/60 pointer-events-auto"
              onClick={() => setShowProfileSheet(false)}
            />

            {/* Sheet Content */}
            <div className="relative w-full h-[85dvh] max-h-[800px] bg-[#0f172a] rounded-t-[40px] shadow-[0_-20px_50px_rgba(0,0,0,0.8)] border-t border-white/10 flex flex-col overflow-hidden pointer-events-auto">

              {/* Drag Handle & Close */}
              <div className="absolute top-0 inset-x-0 z-50 h-16 bg-gradient-to-b from-black/50 to-transparent flex justify-center items-start pt-4 pointer-events-none">
                <div className="w-12 h-1.5 bg-white/40 rounded-full" />
              </div>
              <button
                onClick={() => setShowProfileSheet(false)}
                className="absolute right-5 top-5 z-50 bg-black/40 backdrop-blur-md w-9 h-9 rounded-full flex items-center justify-center text-white font-bold border border-white/20 active:scale-95"
              >✕</button>

              {/* Scrollable Content */}
              <div className="flex-grow overflow-y-auto pb-safe overscroll-contain">
                {/* Hero Photo */}
                <div className="w-full relative aspect-[3/4]">
                  <img src={user.photo_url} className="w-full h-full object-cover" alt={user.nom} />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#0f172a] via-[#0f172a]/20 to-transparent" />
                  <div className="absolute bottom-0 inset-x-0 p-6">
                    <div className="flex items-end justify-between">
                      <h2 className="font-serif text-[3.5rem] leading-none font-bold text-white drop-shadow-md">
                        {user.nom}<span className="text-3xl text-slate-300 ml-3">{user.age ? user.age : '24'}</span>
                      </h2>
                    </div>
                  </div>
                </div>

                {/* Profile Details */}
                <div className="p-6">
                  <div className="inline-flex flex-row items-center gap-2 bg-rose-500/10 border border-rose-500/30 text-rose-400 px-4 py-2 rounded-full text-xs font-bold font-mono tracking-widest mb-8">
                    💘 100% MATCH
                  </div>

                  <h3 className="text-xs font-black text-indigo-400 uppercase tracking-[0.2em] mb-4">À Propos</h3>
                  <p className="text-slate-200 text-lg leading-relaxed mb-10 font-medium">
                    {user.bio ? user.bio : "Salut ! J'adore l'aventure et deviner des lieux obscurs sur des cartes nulles. Tu as réussi à me trouver, bien joué ! Prêt(e) pour aller boire un verre quelque part sur Terre ? 🌍🍸"}
                  </p>

                  <h3 className="text-xs font-black text-indigo-400 uppercase tracking-[0.2em] mb-4">Plus de photos</h3>
                  <div className="flex gap-4 overflow-x-auto pb-6 snap-x snap-mandatory hide-scrollbars">
                    {/* Fake gallery using the same photo since DB has only one */}
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="w-[140px] h-[180px] rounded-3xl overflow-hidden snap-start shrink-0">
                        <img
                          src={user.photo_url}
                          className="w-full h-full object-cover grayscale opacity-60 hover:grayscale-0 hover:opacity-100 transition-all duration-300"
                          alt="Gallery"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Action Bar at very bottom of the sheet */}
              <div className="p-6 bg-[#0f172a] border-t border-white/5 relative z-50">
                <button
                  onClick={() => { setShowProfileSheet(false); setShowSidebar(true); setActiveChat(user); }}
                  className="w-full bg-rose-500 hover:bg-rose-400 text-white text-lg font-black tracking-wide py-4.5 rounded-full shadow-[0_10px_30px_rgba(244,63,94,0.3)] active:scale-95 transition-transform h-14"
                >
                  Envoyer un message 💌
                </button>
              </div>

            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── THE MATCH OVERLAY (Only visible if sheet is NOT open) ── */}
      <AnimatePresence>
        {showMatchOverlay && (
          <motion.div
            initial={{ scale: 0, rotate: -20, opacity: 0 }}
            animate={{ scale: 1.1, rotate: 0, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 20 }}
            className="fixed inset-0 z-[9999] pointer-events-none flex items-center justify-center px-4"
          >
            <div className="match-inner bg-rose-500 text-white font-serif font-black flex items-center justify-center text-center shadow-[0_0_80px_#f43f5e] border-4 border-white rounded-[2rem] px-8 py-10" style={{ fontSize: 'clamp(2rem, 8vw, 4rem)', transform: 'rotate(-4deg)' }}>
              💘 C'EST<br />UN MATCH !
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── FLOATING CONTROLS (Bottom Right) ── */}
      {!showProfileSheet && !showSidebar && (
        <div className="fixed bottom-6 right-6 z-[500] flex flex-col gap-3 items-end">
          <button
            onClick={nextUser}
            style={{
              zIndex: 10000,
              position: 'fixed',
              bottom: '24px',
              right: '24px',
              pointerEvents: 'auto'
            }}
            className="bg-rose-500/90 backdrop-blur-md border border-white/20 text-white text-xs font-bold px-5 py-3.5 rounded-full shadow-[0_10px_30px_rgba(244,63,94,0.3)] hover:bg-rose-400 active:scale-95 transition-transform flex items-center gap-2"
          >
            Profil Suivant ⏭️
          </button>
        </div>
      )}

    </div>
  )
}

export default App
