import React, { useState, useEffect, useCallback } from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMapEvents, Polyline } from 'react-leaflet'
import L from 'leaflet'
import { motion, AnimatePresence } from 'framer-motion'
import confetti from 'canvas-confetti'

// ╔══════════════════════════════════════════════════════════════════╗
// ║   🔧 CONFIGURE ICI — METS TES CLES API                          ║
// ╚══════════════════════════════════════════════════════════════════╝
const SUPABASE_URL = "https://vromnbvyylhtpxgfwhkt.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_O__eJlMAsw8-Cgw2_5vmsw_EHfoXjg1";
const STRIPE_PAYMENT_LINK = "https://buy.stripe.com/TON_LIEN_ICI"; // ← Colle ton lien Stripe

// ── CONSTANTS ──
const FREE_DAILY_LIMIT = 10;
const PREMIUM_PRICE_DISPLAY = "4,99€/mois";

// ── ICONS ──
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

// ── UTILS ──
function haversine(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function calcPoints(distKm: number, streak: number): number {
  let base = 0;
  if (distKm <= 10) base = 1000;
  else if (distKm <= 30) base = 700;
  else if (distKm <= 50) base = 400;
  else if (distKm <= 80) base = 150;
  else base = 50;
  const multiplier = Math.min(1 + (streak * 0.1), 2.5);
  return Math.round(base * multiplier);
}

function getTodayKey() {
  return new Date().toISOString().slice(0, 10); // "2025-01-15"
}

function safeLocalGet<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

function safeLocalSet(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

// ── TYPES ──
type Utilisateur = {
  id?: number;
  nom: string;
  photo_url: string;
  indice: string;
  latitude: number;
  longitude: number;
  bio?: string;
  age?: number;
};

type MatchStatus = 'MATCH' | 'SUPER_LIKE' | 'LIKE' | 'GHOST' | 'TIME_OUT';

type GameHistoryEntry = {
  nom: string;
  photo_url: string;
  distanceKm: number;
  status: MatchStatus;
  points: number;
  playedAt: string;
};

type MyProfile = {
  pseudo: string;
  photo: string;
  bio: string;
  streak: number;
  superLikes: number;
  totalPoints: number;
  totalMatchs: number;
  totalDistanceKm: number;
  gamesPlayed: number;
  isPremium: boolean;
  premiumUntil?: string;
};

// ── SUPABASE HELPERS ──
async function supabaseFetch(path: string, options?: RequestInit) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
      ...(options?.headers || {})
    }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase ${res.status}: ${text}`);
  }
  const ct = res.headers.get('content-type') || '';
  return ct.includes('json') ? res.json() : null;
}

async function upsertScore(pseudo: string, photo: string, totalPoints: number, totalMatchs: number, streak: number) {
  try {
    await supabaseFetch('scores?on_conflict=pseudo', {
      method: 'POST',
      headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ pseudo, photo_url: photo, total_points: totalPoints, total_matchs: totalMatchs, best_streak: streak, updated_at: new Date().toISOString() })
    });
  } catch (e) { console.warn('Score sync failed', e); }
}

async function fetchLeaderboard(): Promise<{ pseudo: string; photo_url: string; total_points: number; total_matchs: number; best_streak: number }[]> {
  try {
    return await supabaseFetch('scores?select=pseudo,photo_url,total_points,total_matchs,best_streak&order=total_points.desc&limit=10');
  } catch { return []; }
}

// ── MAP CLICK EVENTS ──
function MapClickEvents({ onLocationClick, locked }: { onLocationClick: (lat: number, lng: number) => void; locked: boolean }) {
  useMapEvents({
    click(e) {
      if (!locked) onLocationClick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

// ── PAYWALL MODAL ──
function PaywallModal({ onClose, remainingToday }: { onClose: () => void; remainingToday: number }) {
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[20000] flex items-center justify-center p-6 bg-black/70 backdrop-blur-sm"
    >
      <motion.div
        initial={{ scale: 0.8, y: 40 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.8, y: 40 }}
        transition={{ type: 'spring', stiffness: 320, damping: 28 }}
        className="relative w-full max-w-sm bg-slate-950 border border-yellow-500/30 rounded-[2rem] overflow-hidden shadow-[0_0_80px_rgba(234,179,8,0.2)]"
      >
        {/* Gold glow top */}
        <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-yellow-600 via-yellow-400 to-yellow-600" />

        <div className="p-8 flex flex-col items-center text-center gap-5">
          <div className="text-5xl">👑</div>
          <h2 className="font-serif text-3xl font-black text-white leading-tight">
            Tu as utilisé<br /><span className="text-yellow-400">{FREE_DAILY_LIMIT} matchs</span> aujourd'hui
          </h2>
          <p className="text-slate-400 text-sm leading-relaxed">
            La version gratuite est limitée à <strong className="text-white">{FREE_DAILY_LIMIT} matchs par jour</strong>.<br />
            Reviens demain, ou passe à <strong className="text-yellow-400">GeoMatch Premium</strong> pour jouer sans limites.
          </p>

          {/* Benefits */}
          <div className="w-full bg-slate-900 rounded-2xl p-5 text-left space-y-3">
            {[
              ['♾️', 'Matchs illimités chaque jour'],
              ['🃏', '+5 jokers de départ (au lieu de 3)'],
              ['👑', 'Badge Premium doré sur le leaderboard'],
              ['⚡', 'Profils exclusifs et rares'],
              ['📊', 'Stats avancées & heatmap de tes guess'],
            ].map(([icon, text]) => (
              <div key={text} className="flex items-center gap-3 text-sm text-slate-200">
                <span className="text-base">{icon}</span> {text}
              </div>
            ))}
          </div>

          <div className="text-xs text-slate-500">
            Seulement <span className="text-yellow-400 font-bold">{PREMIUM_PRICE_DISPLAY}</span> — résiliable à tout moment
          </div>

          <a
            href={STRIPE_PAYMENT_LINK}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full bg-yellow-500 hover:bg-yellow-400 text-slate-950 font-black text-lg py-4 rounded-full shadow-[0_8px_30px_rgba(234,179,8,0.4)] active:scale-95 transition-transform flex items-center justify-center gap-2"
          >
            Devenir Premium 👑
          </a>

          <button onClick={onClose} className="text-xs text-slate-500 hover:text-slate-300 transition-colors underline underline-offset-2">
            Non merci, revenir demain
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── LEADERBOARD MODAL ──
function LeaderboardModal({ onClose, myPseudo }: { onClose: () => void; myPseudo: string }) {
  const [leaders, setLeaders] = useState<{ pseudo: string; photo_url: string; total_points: number; total_matchs: number; best_streak: number }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchLeaderboard().then(data => { setLeaders(data); setLoading(false); });
  }, []);

  const medals = ['🥇', '🥈', '🥉'];

  return (
    <motion.div
      initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
      transition={{ type: 'spring', damping: 28, stiffness: 220 }}
      className="fixed inset-y-0 right-0 w-80 max-w-[90vw] bg-slate-950 border-l border-white/10 shadow-2xl z-[12000] flex flex-col"
    >
      <div className="p-5 bg-slate-900 border-b border-white/5 flex justify-between items-center pt-safe">
        <h2 className="font-bold text-white font-serif text-xl">🏆 Leaderboard</h2>
        <button onClick={onClose} className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white">✕</button>
      </div>
      <div className="flex-grow overflow-y-auto p-4 space-y-3">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="spinner" />
          </div>
        ) : leaders.length === 0 ? (
          <div className="text-center text-slate-500 text-sm mt-10">Aucun score enregistré pour l'instant.<br />Joue pour apparaître ici !</div>
        ) : leaders.map((l, i) => (
          <div
            key={l.pseudo}
            className={`flex items-center gap-3 p-3 rounded-2xl border transition-colors ${l.pseudo === myPseudo ? 'bg-rose-500/10 border-rose-500/30' : 'bg-slate-900/60 border-white/5'}`}
          >
            <span className="text-xl w-8 text-center shrink-0">{medals[i] || `#${i + 1}`}</span>
            <img src={l.photo_url} className="w-10 h-10 rounded-full object-cover bg-slate-800 shrink-0" alt="" />
            <div className="flex flex-col min-w-0">
              <span className="font-bold text-sm text-slate-100 truncate">{l.pseudo} {l.pseudo === myPseudo ? '(toi)' : ''}</span>
              <span className="text-xs text-slate-400">{l.total_points.toLocaleString()} pts · {l.total_matchs} matchs</span>
            </div>
            {i === 0 && <span className="ml-auto text-yellow-400 text-xs font-bold shrink-0">🔥 {l.best_streak}</span>}
          </div>
        ))}
      </div>
    </motion.div>
  );
}

// ── HISTORY MODAL ──
function HistoryModal({ onClose, history }: { onClose: () => void; history: GameHistoryEntry[] }) {
  const statusLabel: Record<MatchStatus, string> = {
    MATCH: '💘 Match', SUPER_LIKE: '🌟 Super Like', LIKE: '👍 Like', GHOST: '👻 Ghost', TIME_OUT: '⏳ Timeout'
  };
  const statusColor: Record<MatchStatus, string> = {
    MATCH: 'text-rose-400', SUPER_LIKE: 'text-yellow-400', LIKE: 'text-blue-400', GHOST: 'text-slate-400', TIME_OUT: 'text-slate-400'
  };

  return (
    <motion.div
      initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }}
      transition={{ type: 'spring', damping: 28, stiffness: 220 }}
      className="fixed inset-y-0 left-0 w-80 max-w-[90vw] bg-slate-950 border-r border-white/10 shadow-2xl z-[12000] flex flex-col"
    >
      <div className="p-5 bg-slate-900 border-b border-white/5 flex justify-between items-center pt-safe">
        <h2 className="font-bold text-white font-serif text-xl">📋 Historique</h2>
        <button onClick={onClose} className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white">✕</button>
      </div>
      <div className="flex-grow overflow-y-auto p-4 space-y-3">
        {history.length === 0 ? (
          <div className="text-center text-slate-500 text-sm mt-10">Aucune partie jouée encore. Commence à jouer !</div>
        ) : [...history].reverse().map((entry, i) => (
          <div key={i} className="flex items-center gap-3 p-3 rounded-2xl bg-slate-900/60 border border-white/5">
            <img src={entry.photo_url} className="w-12 h-12 rounded-full object-cover bg-slate-800 shrink-0" alt="" />
            <div className="flex flex-col min-w-0 flex-grow">
              <span className="font-bold text-sm text-slate-100 truncate">{entry.nom}</span>
              <span className={`text-xs font-bold ${statusColor[entry.status]}`}>{statusLabel[entry.status]}</span>
              <span className="text-xs text-slate-500">{entry.distanceKm} km · {entry.points} pts</span>
            </div>
            <div className="text-xs text-slate-600 shrink-0 text-right">{new Date(entry.playedAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}</div>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

// ── MAIN APP ──
function App() {
  // ── User & location ──
  const [userPos, setUserPos] = useState<{ lat: number; lon: number } | null>(null);

  useEffect(() => {
    navigator.geolocation.getCurrentPosition(
      (pos) => setUserPos({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => {}, { enableHighAccuracy: true }
    );
  }, []);

  // ── Profiles DB ──
  const [users, setUsers] = useState<Utilisateur[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // ── Game state ──
  const [currentIndex, setCurrentIndex] = useState(0);
  const [matched, setMatched] = useState(false);
  const [matchStatus, setMatchStatus] = useState<MatchStatus | null>(null);
  const [guessMarker, setGuessMarker] = useState<{ lat: number; lng: number } | null>(null);
  const [distance, setDistance] = useState<number | null>(null);
  const [pointsLocked, setPointsLocked] = useState(false);
  const [timeLeft, setTimeLeft] = useState(30);
  const [lastEarnedPoints, setLastEarnedPoints] = useState(0);
  const [showProfileSheet, setShowProfileSheet] = useState(false);

  // ── Premium / Freemium ──
  const [showPaywall, setShowPaywall] = useState(false);
  const [dailyCount, setDailyCount] = useState<number>(() => {
    const data = safeLocalGet<{ date: string; count: number }>('gm_daily', { date: getTodayKey(), count: 0 });
    if (data.date !== getTodayKey()) return 0;
    return data.count;
  });

  const incrementDailyCount = useCallback(() => {
    setDailyCount(prev => {
      const next = prev + 1;
      safeLocalSet('gm_daily', { date: getTodayKey(), count: next });
      return next;
    });
  }, []);

  // ── Jokers ──
  const [jokers, setJokers] = useState(3);

  // ── My Profile ──
  const [myProfile, setMyProfile] = useState<MyProfile>(() => safeLocalGet('gm_profile_v2', {
    pseudo: 'Aventurier',
    photo: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Aventurier',
    bio: "Prêt(e) à découvrir de nouveaux lieux ! 🌍",
    streak: 0,
    superLikes: 0,
    totalPoints: 0,
    totalMatchs: 0,
    totalDistanceKm: 0,
    gamesPlayed: 0,
    isPremium: false,
  }));

  useEffect(() => { safeLocalSet('gm_profile_v2', myProfile); }, [myProfile]);

  // ── Game History ──
  const [gameHistory, setGameHistory] = useState<GameHistoryEntry[]>(() => safeLocalGet('gm_history', []));
  useEffect(() => { safeLocalSet('gm_history', gameHistory.slice(-50)); }, [gameHistory]);

  // ── Matched users (for chat) ──
  const [matchedUsers, setMatchedUsers] = useState<Utilisateur[]>([]);

  // ── UI Panels ──
  const [showSidebar, setShowSidebar] = useState(false);
  const [activeChat, setActiveChat] = useState<Utilisateur | null>(null);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // ── Timer ──
  useEffect(() => {
    if (loading || users.length === 0 || matched || pointsLocked) return;
    if (timeLeft > 0) {
      const t = setTimeout(() => setTimeLeft(tl => tl - 1), 1000);
      return () => clearTimeout(t);
    } else {
      setMatchStatus('TIME_OUT');
      setPointsLocked(true);
    }
  }, [timeLeft, loading, users, matched, pointsLocked]);

  // ── Fetch profiles ──
  useEffect(() => {
    supabaseFetch('utilisateurs?select=nom,photo_url,indice,latitude,longitude,bio,age')
      .then(data => {
        if (!data || data.length === 0) throw new Error('Aucun utilisateur trouvé dans la table.');
        // Shuffle for variety
        const shuffled = [...data].sort(() => Math.random() - 0.5);
        setUsers(shuffled);
        setLoading(false);
      })
      .catch((err: Error) => { setErrorMsg(err.message); setLoading(false); });
  }, []);

  // ── Handle guess ──
  const handleLocationClick = useCallback((lat: number, lng: number) => {
    if (users.length === 0 || matched || pointsLocked) return;

    // Freemium gate
    if (!myProfile.isPremium && dailyCount >= FREE_DAILY_LIMIT) {
      setShowPaywall(true);
      return;
    }

    const user = users[currentIndex];
    setGuessMarker({ lat, lng });

    const dist = Math.round(haversine(lat, lng, user.latitude, user.longitude));
    setDistance(dist);

    let status: MatchStatus;
    if (dist <= 30) status = 'MATCH';
    else if (dist <= 50) status = 'SUPER_LIKE';
    else if (dist <= 80) status = 'LIKE';
    else status = 'GHOST';

    setMatchStatus(status);
    incrementDailyCount();

    const pts = calcPoints(dist, myProfile.streak);
    setLastEarnedPoints(pts);

    setMyProfile(prev => {
      const newStreak = status === 'MATCH' ? prev.streak + 1 : 0;
      const newSuperLikes = status === 'SUPER_LIKE' ? prev.superLikes + 1 : prev.superLikes;
      const updated = {
        ...prev,
        streak: newStreak,
        superLikes: newSuperLikes,
        totalPoints: prev.totalPoints + pts,
        totalMatchs: status === 'MATCH' ? prev.totalMatchs + 1 : prev.totalMatchs,
        totalDistanceKm: prev.totalDistanceKm + dist,
        gamesPlayed: prev.gamesPlayed + 1,
      };
      // Sync leaderboard
      upsertScore(updated.pseudo, updated.photo, updated.totalPoints, updated.totalMatchs, updated.streak);
      return updated;
    });

    setGameHistory(prev => [...prev, {
      nom: user.nom,
      photo_url: user.photo_url,
      distanceKm: dist,
      status,
      points: pts,
      playedAt: new Date().toISOString()
    }]);

    if (status === 'MATCH') {
      setMatched(true);
      setMatchedUsers(prev => prev.find(u => u.nom === user.nom) ? prev : [...prev, user]);
      confetti({ particleCount: 150, spread: 90, origin: { y: 0.6 }, colors: ['#f43f5e', '#ffffff', '#fbbf24'] });
      if ((myProfile.streak + 1) % 3 === 0) setJokers(j => j + 1);
    } else {
      setPointsLocked(true);
    }
  }, [users, currentIndex, matched, pointsLocked, myProfile, dailyCount, incrementDailyCount]);

  // ── Next user ──
  const nextUser = useCallback(() => {
    if (!myProfile.isPremium && dailyCount >= FREE_DAILY_LIMIT) {
      setShowPaywall(true);
      return;
    }
    setCurrentIndex(prev => (prev + 1) % users.length);
    setMatched(false);
    setMatchStatus(null);
    setGuessMarker(null);
    setDistance(null);
    setPointsLocked(false);
    setShowProfileSheet(false);
    setTimeLeft(30);
    setLastEarnedPoints(0);
  }, [users.length, myProfile.isPremium, dailyCount]);

  // ── Use joker ──
  const useJoker = () => {
    if (jokers > 0) {
      setJokers(j => j - 1);
      setPointsLocked(false);
      setMatchStatus(null);
      setGuessMarker(null);
      setDistance(null);
      setTimeLeft(30);
    }
  };

  // ── Computed rank ──
  const rank = myProfile.totalPoints >= 10000 ? '🏆 Légende' :
    myProfile.totalPoints >= 5000 ? '💎 Expert' :
    myProfile.totalPoints >= 2000 ? '🌟 Avancé' :
    myProfile.totalPoints >= 500 ? '🔵 Confirmé' : '🟢 Débutant';

  // ── Daily remaining ──
  const dailyRemaining = Math.max(0, FREE_DAILY_LIMIT - dailyCount);
  const isFreeLimitReached = !myProfile.isPremium && dailyCount >= FREE_DAILY_LIMIT;

  // ── Render: Loading ──
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
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-3xl p-8 max-w-sm text-center">
          <h2 className="text-xl font-bold text-rose-400 mb-4">⚠️ Erreur de connexion</h2>
          <p className="text-sm text-slate-300 leading-relaxed mb-6">{errorMsg}</p>
          <p className="text-xs text-slate-500">Vérifiez SUPABASE_URL et SUPABASE_ANON_KEY.</p>
        </div>
      </div>
    );
  }

  if (users.length === 0) return null;

  const user = users[currentIndex];

  return (
    <div className="fixed inset-0 w-full h-[100dvh] flex flex-col grain-bg bg-slate-950 text-slate-50 overscroll-none overflow-hidden">

      {/* ── PAYWALL ── */}
      <AnimatePresence>
        {showPaywall && <PaywallModal onClose={() => setShowPaywall(false)} remainingToday={dailyRemaining} />}
      </AnimatePresence>

      {/* ── LEADERBOARD ── */}
      <AnimatePresence>
        {showLeaderboard && <LeaderboardModal onClose={() => setShowLeaderboard(false)} myPseudo={myProfile.pseudo} />}
      </AnimatePresence>

      {/* ── HISTORY ── */}
      <AnimatePresence>
        {showHistory && <HistoryModal onClose={() => setShowHistory(false)} history={gameHistory} />}
      </AnimatePresence>

      {/* ── HEADER ── */}
      <header className="absolute top-0 inset-x-0 z-[100] px-4 py-3 pt-safe flex items-center justify-between glass-panel rounded-b-3xl">
        <div className="flex items-center gap-2.5">
          <button onClick={() => setShowProfileMenu(true)} className="relative active:scale-95 transition-transform group shadow-md shrink-0">
            <div className="absolute inset-0 bg-rose-500 rounded-full blur opacity-20 group-hover:opacity-60 transition"></div>
            <img src={myProfile.photo} className="w-10 h-10 rounded-full object-cover border-2 border-slate-600 relative z-10 bg-slate-800" alt="Profil" />
            {myProfile.isPremium && <span className="absolute -top-1 -right-1 text-xs z-20">👑</span>}
          </button>
          <div className="font-serif text-xl font-black tracking-tight">
            Geo<span className="text-rose-500">Match</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Daily counter (Freemium) */}
          {!myProfile.isPremium && (
            <button
              onClick={() => setShowPaywall(true)}
              className={`text-[10px] font-bold px-2.5 py-1.5 rounded-full border shadow-md flex items-center gap-1 transition-colors ${isFreeLimitReached ? 'bg-rose-900/80 border-rose-400/30 text-rose-300 animate-pulse' : 'bg-slate-900/80 border-slate-600/30 text-slate-300'}`}
            >
              🎮 {dailyRemaining}/{FREE_DAILY_LIMIT}
            </button>
          )}

          {/* History */}
          <button onClick={() => setShowHistory(true)} className="w-9 h-9 rounded-full bg-slate-900 border border-white/20 flex items-center justify-center hover:bg-slate-800 transition shadow-md active:scale-95 text-sm">
            📋
          </button>

          {/* Leaderboard */}
          <button onClick={() => setShowLeaderboard(true)} className="w-9 h-9 rounded-full bg-slate-900 border border-white/20 flex items-center justify-center hover:bg-slate-800 transition shadow-md active:scale-95 text-sm">
            🏆
          </button>

          {/* Chat */}
          <button onClick={() => setShowSidebar(true)} className="relative w-9 h-9 rounded-full bg-slate-900 border border-white/20 flex items-center justify-center hover:bg-slate-800 transition shadow-md active:scale-95 text-sm">
            💬
            {matchedUsers.length > 0 && <span className="absolute top-0 right-0 w-3 h-3 bg-rose-500 rounded-full border border-slate-900 animate-pulse" />}
          </button>

          {/* Timer */}
          <div className={`text-[10px] font-bold px-2.5 py-1.5 rounded-full border shadow-md flex items-center gap-1 transition-colors ${timeLeft <= 5 && !matched && !pointsLocked ? 'bg-rose-900/80 border-rose-400/30 text-rose-300 animate-pulse' : 'bg-slate-900/80 border-indigo-400/30 text-indigo-300'}`}>
            ⏳ {timeLeft}s
          </div>

          {/* Jokers */}
          <div className="text-[10px] font-bold px-2.5 py-1.5 bg-slate-900/80 rounded-full border border-indigo-400/30 text-indigo-300 shadow-md flex items-center gap-1">
            🃏 x{jokers}
          </div>
        </div>
      </header>

      {/* ── PROFILE CARD ── */}
      <div className="relative w-full h-[50dvh] lg:h-[45dvh] z-20 flex flex-col items-center justify-end px-4 pb-12 pt-24 pointer-events-none">
        <AnimatePresence mode="popLayout">
          <motion.div
            key={user.nom}
            initial={{ opacity: 0, scale: 0.9, x: 100, rotate: 5 }}
            animate={{ opacity: 1, scale: 1, x: 0, rotate: 0 }}
            exit={{ opacity: 0, scale: 0.9, x: -100, rotate: -5 }}
            transition={{ type: "spring", stiffness: 300, damping: 25 }}
            className="w-full max-w-[400px] h-full relative rounded-[32px] overflow-hidden glass-panel pointer-events-auto border border-white/10 shadow-2xl"
            style={{ maxHeight: '420px', backgroundColor: '#0f172a' }}
          >
            <img
              src={user.photo_url}
              alt={user.nom}
              className={`w-full h-full object-cover transition-all duration-1000 ease-in-out ${matched ? 'blur-0 scale-100' : 'blur-xl scale-110'}`}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-900/40 to-transparent pointer-events-none" />
            <div className="absolute bottom-0 inset-x-0 p-6 pt-12">
              <h2 className={`font-serif text-[2.5rem] font-bold leading-none mb-2 drop-shadow-lg transition-all duration-[800ms] ${matched ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
                {user.nom}
              </h2>
              <div className="flex items-start gap-2 mt-2 w-full">
                <p className="indice-text text-sm md:text-base font-medium leading-snug drop-shadow-md w-full">
                  <span className="mr-2">💡</span>"{user.indice}"
                </p>
              </div>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* ── ACTION DIVIDER ── */}
      <div className="absolute top-[50dvh] lg:top-[45dvh] inset-x-0 z-40 flex justify-center -translate-y-[60%] pointer-events-none">
        <AnimatePresence mode="wait">
          {!matched && !matchStatus && !isFreeLimitReached && (
            <motion.div
              key="hint"
              initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0, opacity: 0 }}
              className="glass-panel bg-slate-800/80 px-6 py-3 rounded-full text-xs font-bold uppercase tracking-widest text-slate-300 pointer-events-auto shadow-xl"
            >
              👆 Touche la carte pour deviner
            </motion.div>
          )}

          {isFreeLimitReached && !matchStatus && (
            <motion.div
              key="limit"
              initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0, opacity: 0 }}
              className="pointer-events-auto"
            >
              <button
                onClick={() => setShowPaywall(true)}
                className="glass-panel bg-yellow-900/90 border border-yellow-500/50 px-6 py-3 rounded-full shadow-[0_10px_30px_rgba(234,179,8,0.2)] flex items-center gap-2 font-bold text-yellow-300 text-sm"
              >
                👑 Limite atteinte — Passer Premium
              </button>
            </motion.div>
          )}

          {!matched && matchStatus && (
            <motion.div
              key="distance"
              initial={{ scale: 0, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0, opacity: 0 }}
              className="flex flex-col items-center gap-3 pointer-events-auto"
            >
              {/* Points earned */}
              {lastEarnedPoints > 0 && (
                <motion.div
                  initial={{ y: -10, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
                  className="text-xs font-black text-yellow-400 bg-yellow-900/60 border border-yellow-500/30 px-4 py-1.5 rounded-full"
                >
                  +{lastEarnedPoints} pts {myProfile.streak > 1 ? `· 🔥 x${Math.min(myProfile.streak, 25) / 10 + 1}` : ''}
                </motion.div>
              )}

              {matchStatus === 'SUPER_LIKE' && (
                <div className="glass-panel bg-yellow-900/90 border border-yellow-500/50 px-6 py-3 rounded-full shadow-[0_10px_30px_rgba(234,179,8,0.2)] flex flex-col items-center gap-1">
                  <div className="flex items-center gap-2 font-bold text-yellow-400 text-sm"><span className="text-xl">🌟</span> Super Like (à {distance} km)</div>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-yellow-300/80">Oh, tu as presque eu le profil !</span>
                </div>
              )}
              {matchStatus === 'LIKE' && (
                <div className="glass-panel bg-blue-900/90 border border-blue-500/50 px-6 py-3.5 rounded-full text-sm font-bold text-blue-300 shadow-lg flex items-center gap-2">
                  <span className="text-xl">👍</span> Pas mal ! Like (à {distance} km)
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
                  <button onClick={useJoker} className="glass-panel bg-indigo-500/80 hover:bg-indigo-400 border border-indigo-400 text-white text-sm font-bold px-5 py-2.5 rounded-full shadow-lg active:scale-95 transition-transform">
                    🃏 Joker (-1)
                  </button>
                )}
                {pointsLocked && (
                  <button
                    onClick={nextUser}
                    className={matchStatus === 'SUPER_LIKE' || matchStatus === 'LIKE'
                      ? "glass-panel bg-rose-500/90 hover:bg-rose-400 border border-rose-400 text-white text-sm font-bold px-5 py-2.5 rounded-full shadow-[0_5px_20px_rgba(244,63,94,0.4)] active:scale-95 transition-transform flex items-center gap-1"
                      : "glass-panel bg-slate-800/80 hover:bg-slate-700 border border-slate-600 text-white text-sm font-bold px-5 py-2.5 rounded-full shadow-lg active:scale-95 transition-transform flex items-center gap-1"}
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

      {/* ── MAP ── */}
      <div className="relative flex-grow w-full z-10 rounded-t-[40px] overflow-hidden shadow-[0_-20px_50px_rgba(0,0,0,0.6)] border-t border-white/10 bg-slate-900">
        <MapContainer center={[46.5, 2.5]} zoom={5} zoomControl={false} style={{ width: '100%', height: '100%' }} className="leaf-map-container">
          <TileLayer
            attribution='&copy; CARTO'
            url='https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
            maxZoom={18}
          />
          <MapClickEvents onLocationClick={handleLocationClick} locked={matched || pointsLocked} />
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

      {/* ── MATCH OVERLAY ── */}
      <AnimatePresence>
        {matched && !showProfileSheet && (
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

      {/* ── CHAT SIDEBAR ── */}
      <AnimatePresence>
        {showSidebar && (
          <motion.div
            initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            className="fixed inset-y-0 right-0 w-80 max-w-[85vw] bg-slate-950 border-l border-white/10 shadow-2xl z-[12000] flex flex-col pointer-events-auto"
          >
            <div className="p-5 bg-slate-900 border-b border-white/5 flex justify-between items-center pt-safe cursor-default">
              <h2 className="font-bold text-white font-serif text-xl tracking-tight">Matchs <span className="text-rose-500">({matchedUsers.length})</span></h2>
              <button onClick={() => { setShowSidebar(false); setActiveChat(null); }} className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white">✕</button>
            </div>
            <div className="flex-grow overflow-y-auto">
              {!activeChat ? (
                matchedUsers.length === 0 ? (
                  <div className="p-8 text-center text-slate-400 text-sm leading-relaxed mt-10">
                    <span className="text-4xl block mb-4 opacity-50">👻</span>
                    Aucun match pour le moment. Fais tes preuves à moins de 30km !
                  </div>
                ) : (
                  <ul className="p-3 space-y-2">
                    {matchedUsers.map((mu, i) => (
                      <li key={i} onClick={() => setActiveChat(mu)} className="flex items-center gap-4 p-3 rounded-2xl hover:bg-slate-800 cursor-pointer transition-colors border border-transparent hover:border-white/5">
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
                    <div className="bg-rose-500/20 text-rose-200 text-[10px] uppercase font-bold text-center tracking-widest py-1 px-3 rounded-full mx-auto w-max mb-4">
                      Match (Moins de 30km) !
                    </div>
                    <div className="bg-slate-800 border border-white/5 p-4 rounded-2xl rounded-tl-sm text-sm text-slate-200 shadow-lg w-[85%]">
                      Salut ! Trop fort, tu m'as trouvé en plein dans le mille ! 😊
                    </div>
                  </div>
                  <div className="p-4 bg-slate-900 border-t border-white/5 flex gap-2">
                    <input type="text" placeholder="Écrire un message..." className="flex-grow bg-slate-950 border border-white/10 rounded-full px-5 py-2.5 text-sm text-white focus:outline-none focus:border-rose-500" />
                    <button className="w-10 h-10 shrink-0 rounded-full bg-rose-500 flex items-center justify-center shadow-lg active:scale-95 transition-transform text-white">💌</button>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── MY PROFILE SIDEBAR ── */}
      <AnimatePresence>
        {showProfileMenu && (
          <motion.div
            initial={{ x: "-100%" }} animate={{ x: 0 }} exit={{ x: "-100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            className="fixed inset-y-0 left-0 w-80 max-w-[85vw] bg-slate-950 border-r border-white/10 shadow-2xl z-[12000] flex flex-col pointer-events-auto"
          >
            <div className="p-5 bg-slate-900 border-b border-white/5 flex justify-between items-center pt-safe cursor-default">
              <h2 className="font-bold text-white font-serif text-xl tracking-tight">Mon Profil</h2>
              <button onClick={() => { setShowProfileMenu(false); setIsEditingProfile(false); }} className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white">✕</button>
            </div>

            <div className="flex-grow overflow-y-auto p-6">
              {isEditingProfile ? (
                <div className="flex flex-col gap-5">
                  <div className="text-center font-bold text-indigo-400 mb-2">Modifier mon profil</div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest pl-1">Photo URL</label>
                    <input
                      type="text"
                      value={myProfile.photo}
                      onChange={(e) => setMyProfile({ ...myProfile, photo: e.target.value })}
                      className="w-full mt-1.5 bg-slate-900 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-indigo-500 transition-colors"
                    />
                    <button onClick={() => setMyProfile({ ...myProfile, photo: `https://api.dicebear.com/7.x/avataaars/svg?seed=${Math.random()}` })} className="text-[11px] text-indigo-400 mt-2 hover:text-indigo-300 font-medium px-1 underline underline-offset-2">🔄 Avatar aléatoire</button>
                  </div>
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
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest pl-1">Ma Bio</label>
                    <textarea
                      value={myProfile.bio}
                      onChange={(e) => setMyProfile({ ...myProfile, bio: e.target.value })}
                      className="w-full mt-1.5 bg-slate-900 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-indigo-500 transition-colors resize-none h-28"
                    />
                  </div>

                  {/* Premium toggle (dev only — in prod, controlled by Stripe webhook) */}
                  <div className="flex items-center justify-between p-3 bg-slate-900 rounded-xl border border-yellow-500/20">
                    <span className="text-sm text-yellow-400 font-bold">👑 Mode Premium (test)</span>
                    <button
                      onClick={() => setMyProfile(p => ({ ...p, isPremium: !p.isPremium, jokers: !p.isPremium ? 8 : 3 } as any))}
                      className={`w-12 h-6 rounded-full transition-colors ${myProfile.isPremium ? 'bg-yellow-500' : 'bg-slate-700'} flex items-center px-1`}
                    >
                      <div className={`w-4 h-4 rounded-full bg-white shadow transition-transform ${myProfile.isPremium ? 'translate-x-6' : 'translate-x-0'}`} />
                    </button>
                  </div>

                  <button onClick={() => setIsEditingProfile(false)} className="mt-2 w-full bg-indigo-500 hover:bg-indigo-400 text-white font-bold py-3.5 rounded-full shadow-[0_5px_20px_rgba(99,102,241,0.3)] active:scale-95 transition-transform">
                    Enregistrer ✔️
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-center text-center mt-2 gap-4">
                  {/* Avatar */}
                  <div className="relative group">
                    <img src={myProfile.photo} alt="Mon Profil" className="w-32 h-32 bg-slate-800 rounded-full object-cover border-4 border-slate-800 shadow-xl" />
                    {myProfile.isPremium && (
                      <div className="absolute -top-2 inset-x-0 flex justify-center">
                        <span className="bg-yellow-500 text-slate-950 text-[10px] font-black px-3 py-0.5 rounded-full">PREMIUM 👑</span>
                      </div>
                    )}
                    <button onClick={() => setIsEditingProfile(true)} className="absolute bottom-1 right-1 w-10 h-10 bg-rose-500 rounded-full border-4 border-slate-950 flex items-center justify-center text-white text-base shadow-lg hover:bg-rose-400 active:scale-95 transition-all">
                      🖍️
                    </button>
                  </div>

                  <div>
                    <h3 className="text-2xl font-serif font-bold text-white">{myProfile.pseudo}</h3>
                    <div className="mt-1 text-sm font-bold">{rank}</div>
                  </div>

                  {/* Bio */}
                  <div className="bg-slate-900 border border-white/5 rounded-3xl p-4 w-full text-left relative">
                    <span className="absolute -top-3 left-5 bg-slate-950 px-2 text-[10px] font-black text-rose-400 tracking-widest rounded-full border border-white/5 py-0.5">MA BIO</span>
                    <p className="text-slate-300 text-sm leading-relaxed mt-1 font-medium whitespace-pre-wrap">{myProfile.bio}</p>
                  </div>

                  {/* Stats grid */}
                  <div className="w-full grid grid-cols-2 gap-3">
                    {[
                      { icon: '🔥', label: 'Série', value: myProfile.streak },
                      { icon: '💘', label: 'Matchs', value: myProfile.totalMatchs },
                      { icon: '⭐', label: 'Super Likes', value: myProfile.superLikes },
                      { icon: '🎮', label: 'Parties', value: myProfile.gamesPlayed },
                      { icon: '🏅', label: 'Points', value: myProfile.totalPoints.toLocaleString() },
                      { icon: '🗺️', label: 'Dist. totale', value: `${Math.round(myProfile.totalDistanceKm).toLocaleString()} km` },
                    ].map(({ icon, label, value }) => (
                      <div key={label} className="bg-slate-900 rounded-2xl p-3 flex flex-col items-center border border-white/5">
                        <span className="text-2xl mb-1">{icon}</span>
                        <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">{label}</span>
                        <span className="font-mono text-base font-bold text-white mt-0.5">{value}</span>
                      </div>
                    ))}
                  </div>

                  {/* Premium CTA if not premium */}
                  {!myProfile.isPremium && (
                    <button
                      onClick={() => { setShowProfileMenu(false); setShowPaywall(true); }}
                      className="w-full mt-2 bg-yellow-500/90 hover:bg-yellow-400 text-slate-950 font-black py-3.5 rounded-full shadow-[0_5px_20px_rgba(234,179,8,0.3)] active:scale-95 transition-transform flex items-center justify-center gap-2"
                    >
                      👑 Passer Premium — {PREMIUM_PRICE_DISPLAY}
                    </button>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── PROFILE SHEET (after match) ── */}
      <AnimatePresence>
        {showProfileSheet && (
          <motion.div
            initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 350, damping: 30 }}
            className="fixed inset-0 z-[10000] flex flex-col justify-end pointer-events-none"
          >
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/60 pointer-events-auto"
              onClick={() => setShowProfileSheet(false)}
            />
            <div className="relative w-full h-[85dvh] max-h-[800px] bg-[#0f172a] rounded-t-[40px] shadow-[0_-20px_50px_rgba(0,0,0,0.8)] border-t border-white/10 flex flex-col overflow-hidden pointer-events-auto">
              <div className="absolute top-0 inset-x-0 z-50 h-16 bg-gradient-to-b from-black/50 to-transparent flex justify-center items-start pt-4 pointer-events-none">
                <div className="w-12 h-1.5 bg-white/40 rounded-full" />
              </div>
              <button onClick={() => setShowProfileSheet(false)} className="absolute right-5 top-5 z-50 bg-black/40 backdrop-blur-md w-9 h-9 rounded-full flex items-center justify-center text-white font-bold border border-white/20 active:scale-95">✕</button>

              <div className="flex-grow overflow-y-auto pb-safe overscroll-contain">
                <div className="w-full relative aspect-[3/4]">
                  <img src={user.photo_url} className="w-full h-full object-cover" alt={user.nom} />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#0f172a] via-[#0f172a]/20 to-transparent" />
                  <div className="absolute bottom-0 inset-x-0 p-6">
                    <h2 className="font-serif text-[3.5rem] leading-none font-bold text-white drop-shadow-md">
                      {user.nom}<span className="text-3xl text-slate-300 ml-3">{user.age ?? 24}</span>
                    </h2>
                  </div>
                </div>

                <div className="p-6">
                  <div className="inline-flex items-center gap-2 bg-rose-500/10 border border-rose-500/30 text-rose-400 px-4 py-2 rounded-full text-xs font-bold font-mono tracking-widest mb-6">
                    💘 MATCH — {distance !== null ? `${distance} km` : '< 30 km'}
                  </div>

                  <h3 className="text-xs font-black text-indigo-400 uppercase tracking-[0.2em] mb-4">À Propos</h3>
                  <p className="text-slate-200 text-lg leading-relaxed mb-10 font-medium">
                    {user.bio ?? "Salut ! J'adore l'aventure et deviner des lieux obscurs. Tu as réussi à me trouver, bien joué ! Prêt(e) pour aller boire un verre quelque part sur Terre ? 🌍🍸"}
                  </p>

                  <h3 className="text-xs font-black text-indigo-400 uppercase tracking-[0.2em] mb-4">Plus de photos</h3>
                  <div className="flex gap-4 overflow-x-auto pb-6 snap-x snap-mandatory hide-scrollbars">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="w-[140px] h-[180px] rounded-3xl overflow-hidden snap-start shrink-0">
                        <img src={user.photo_url} className="w-full h-full object-cover grayscale opacity-60 hover:grayscale-0 hover:opacity-100 transition-all duration-300" alt="Gallery" />
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="p-6 bg-[#0f172a] border-t border-white/5 z-50">
                <button
                  onClick={() => { setShowProfileSheet(false); setShowSidebar(true); setActiveChat(user); nextUser(); }}
                  className="w-full bg-rose-500 hover:bg-rose-400 text-white text-lg font-black tracking-wide py-4 rounded-full shadow-[0_10px_30px_rgba(244,63,94,0.3)] active:scale-95 transition-transform h-14"
                >
                  Envoyer un message 💌
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── SKIP BUTTON ── */}
      {!showProfileSheet && !showSidebar && !showLeaderboard && !showHistory && (
        <button
          onClick={nextUser}
          className="fixed bottom-6 right-6 z-[500] bg-slate-900/90 backdrop-blur-md border border-white/20 text-slate-200 text-xs font-bold px-5 py-3.5 rounded-full shadow-[0_10px_30px_rgba(0,0,0,0.5)] hover:bg-slate-800 active:scale-95 transition-transform flex items-center gap-2"
        >
          Profil Suivant ⏭️
        </button>
      )}

    </div>
  );
}

export default App;
