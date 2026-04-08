import React, { useState, useEffect } from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMapEvents, Polyline } from 'react-leaflet'
import L from 'leaflet'
import { motion, AnimatePresence } from 'framer-motion'
import confetti from 'canvas-confetti'
import { GoogleMap, StreetViewPanorama, useJsApiLoader } from '@react-google-maps/api'

// ╔══════════════════════════════════════════════════════════╗
// ║   🔧 CONFIGURE ICI — METS TES CLES API (DB + GOOGLE)    ║
// ╚══════════════════════════════════════════════════════════╝
const SUPABASE_URL = "https://vromnbvyylhtpxgfwhkt.supabase.co"; // ← ton URL
const SUPABASE_ANON_KEY = "sb_publishable_O__eJlMAsw8-Cgw2_5vmsw_EHfoXjg1"; // ← ta clé anon
const GOOGLE_MAPS_API_KEY = ""; // ← METS TA CLE STREET VIEW ICI !

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

const StreetViewComponent = ({ lat, lng, matched }: { lat: number, lng: number, matched: boolean }) => {
  const { isLoaded } = useJsApiLoader({
    googleMapsApiKey: GOOGLE_MAPS_API_KEY
  });

  if (!isLoaded) return <div className="w-full h-full flex flex-col items-center justify-center bg-[#0f172a] border-0"><div className="spinner mb-3"></div><div className="text-slate-400 text-xs font-bold uppercase tracking-widest">Chargement...</div></div>;

  return (
    <div className={`w-full h-full transition-opacity duration-1000 ${matched ? 'opacity-30' : 'opacity-100'}`}>
      <GoogleMap mapContainerStyle={{ width: '100%', height: '100%' }}>
        <StreetViewPanorama
          options={{
            position: { lat, lng },
            visible: true,
            addressControl: false, // Cache l'adresse pour ne pas tricher !
            showRoadLabels: false,
            zoomControl: true,
            disableDefaultUI: true, // Cache l'interface
            clickToGo: true,
            linksControl: true,
            panControl: true,
            enableCloseButton: false,
          }}
        />
      </GoogleMap>
    </div>
  );
};

function App() {
  const [userPos, setUserPos] = useState<{ lat: number, lon: number } | null>(null);

  useEffect(() => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserPos({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude
        });
      },
      (err) => console.log("Localisation refusée"),
      { enableHighAccuracy: true }
    );
  }, []);

  const [users, setUsers] = useState<Utilisateur[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [matched, setMatched] = useState(false);
  const [matchStatus, setMatchStatus] = useState<'MATCH' | 'SUPER_LIKE' | 'LIKE' | 'GHOST' | 'TIME_OUT' | null>(null);

  const [guessMarker, setGuessMarker] = useState<{ lat: number; lng: number } | null>(null);
  const [distance, setDistance] = useState<number | null>(null);

  // Game States for Jokers & Profiles
  const [pointsLocked, setPointsLocked] = useState(false);
  const [jokers, setJokers] = useState(3);
  const [showProfileSheet, setShowProfileSheet] = useState(false);
  const [timeLeft, setTimeLeft] = useState(30);

  useEffect(() => {
    if (loading || users.length === 0 || matched || pointsLocked) return;

    if (timeLeft > 0) {
      const timer = setTimeout(() => setTimeLeft(timeLeft - 1), 1000);
      return () => clearTimeout(timer);
    } else {
      setMatchStatus('TIME_OUT');
      setPointsLocked(true);
    }
  }, [timeLeft, loading, users, matched, pointsLocked]);

  // Match / Messages States
  const [matchedUsers, setMatchedUsers] = useState<Utilisateur[]>([]);
  const [showSidebar, setShowSidebar] = useState(false);
  const [activeChat, setActiveChat] = useState<Utilisateur | null>(null);

  // My Profile States
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [myProfile, setMyProfile] = useState<{ pseudo: string, photo: string, bio: string, streak: number, superLikes: number }>(() => {
    const saved = localStorage.getItem('my_geomatch_profile');
    return saved ? JSON.parse(saved) : { pseudo: 'Aventurier', photo: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Aventurier', bio: "Prêt(e) à découvrir de nouveaux lieux ! 🌍", streak: 0, superLikes: 0 };
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

  const handleLocationClick = (lat: number, lng: number) => {
    if (users.length === 0 || matched || pointsLocked) return;

    const user = users[currentIndex];
    setGuessMarker({ lat, lng });

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

  return (
    <div className="fixed inset-0 w-full h-[100dvh] flex flex-col grain-bg bg-slate-950 text-slate-50 overscroll-none overflow-hidden">

      {/* ── HEADER (Floating Glass Panel) ── */}
      <header className="absolute top-0 inset-x-0 z-[100] px-6 py-4 pt-safe flex items-center justify-between glass-panel rounded-b-3xl">
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
      </header>

      {/* ── TOP HALF: PROFILE CARD ── */}
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
            {/* GeoGuessr Street View (si la clé API est ajoutée) ou photo floutée par défaut */}
            {GOOGLE_MAPS_API_KEY && GOOGLE_MAPS_API_KEY !== "" ? (
              <StreetViewComponent lat={user.latitude} lng={user.longitude} matched={matched} />
            ) : (
              <img
                src={user.photo_url}
                alt={user.nom}
                className={`w-full h-full object-cover transition-all duration-1000 ease-in-out ${matched ? 'blur-0 scale-100' : 'blur-xl scale-110'}`}
              />
            )}

            {/* Soft dark gradient at bottom so text is readable */}
            <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-900/40 to-transparent pointer-events-none" />

            {/* User Info (Revealed on match) */}
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

      {/* ── ACTION DIVIDER AREA (Floating Pills between map and card) ── */}
      <div className="absolute top-[50dvh] lg:top-[45dvh] inset-x-0 z-40 flex justify-center -translate-y-[60%] pointer-events-none">
        <AnimatePresence mode="wait">
          {!matched && !matchStatus && (
            <motion.div
              key="hint"
              initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0, opacity: 0 }}
              className="glass-panel bg-slate-800/80 px-6 py-3 rounded-full text-xs font-bold uppercase tracking-widest text-slate-300 pointer-events-auto shadow-xl"
            >
              👆 Touche la carte pour deviner
            </motion.div>
          )}

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

      {/* ── BOTTOM HALF: INTERACTIVE MAP ── */}
      <div className="relative flex-grow w-full z-10 rounded-t-[40px] overflow-hidden shadow-[0_-20px_50px_rgba(0,0,0,0.6)] border-t border-white/10 bg-slate-900">
        <MapContainer center={[46.5, 2.5]} zoom={5} zoomControl={false} style={{ width: '100%', height: '100%' }} className="leaf-map-container">
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
                      <li key={i} onClick={() => setActiveChat(mu)} className="group flex items-center gap-4 p-3 rounded-2xl hover:bg-slate-800 cursor-pointer transition-colors border border-transparent hover:border-white/5">
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
                    {/* Simulation message d'accueil */}
                    <div className="bg-rose-500/20 text-rose-200 text-[10px] uppercase font-bold text-center tracking-widest py-1 px-3 rounded-full mx-auto w-max mb-4">
                      Nouveau Match (Moins de 30km) !
                    </div>
                    <div className="bg-slate-800 border border-white/5 p-4 rounded-2xl rounded-tl-sm text-sm text-slate-200 shadow-lg w-[85%] relative">
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
                    <button onClick={() => setMyProfile({ ...myProfile, photo: `https://api.dicebear.com/7.x/avataaars/svg?seed=${Math.random()}` })} className="text-[11px] text-indigo-400 mt-2 hover:text-indigo-300 font-medium px-1 underline underline-offset-2">🔄 Générer un avatar aléatoire</button>
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
                  <button onClick={() => setIsEditingProfile(false)} className="mt-4 w-full bg-indigo-500 hover:bg-indigo-400 text-white font-bold py-3.5 rounded-full shadow-[0_5px_20px_rgba(99,102,241,0.3)] active:scale-95 transition-transform flex items-center justify-center gap-2">
                    Enregistrer ✔️
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-center text-center mt-2">
                  <div className="relative group">
                    <img src={myProfile.photo} alt="Mon Profil" className="w-36 h-36 bg-slate-800 rounded-full object-cover border-4 border-slate-800 shadow-xl" />
                    <button onClick={() => setIsEditingProfile(true)} className="absolute bottom-1 right-1 w-11 h-11 bg-rose-500 rounded-full border-4 border-slate-950 flex items-center justify-center text-white text-lg shadow-lg hover:bg-rose-400 hover:scale-105 active:scale-95 transition-all">
                      🖍️
                    </button>
                  </div>
                  <h3 className="mt-6 text-3xl font-serif font-bold text-white drop-shadow-md">{myProfile.pseudo}</h3>
                  <div className="bg-slate-900 border border-white/5 rounded-3xl p-5 mt-8 w-full shadow-inner relative text-left">
                    <span className="absolute -top-3 left-6 bg-slate-950 px-3 text-[10px] font-black text-rose-400 tracking-widest rounded-full border border-white/5 py-1">MA BIO</span>
                    <p className="text-slate-300 text-sm leading-relaxed mt-1 font-medium whitespace-pre-wrap">{myProfile.bio}</p>
                  </div>

                  <div className="w-full grid grid-cols-2 gap-4 mt-6">
                    <div className="bg-slate-900 rounded-3xl p-4 flex flex-col items-center justify-center border border-white/5 shadow-md relative overflow-hidden group">
                      <div className="absolute inset-0 bg-gradient-to-t from-orange-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                      <span className="text-3xl mb-2 opacity-80 relative z-10 group-hover:scale-110 transition-transform">🔥</span>
                      <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider text-center relative z-10">Série de Matchs</span>
                      <span className="font-mono text-xl font-bold text-white mt-1 relative z-10">{myProfile.streak || 0}</span>
                    </div>
                    <div className="bg-slate-900 rounded-3xl p-4 flex flex-col items-center justify-center border border-white/5 shadow-md relative overflow-hidden group">
                      <div className="absolute inset-0 bg-gradient-to-t from-yellow-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                      <span className="text-3xl mb-2 opacity-80 relative z-10 group-hover:scale-110 transition-transform">⭐</span>
                      <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider text-center relative z-10">Super Likes</span>
                      <span className="font-mono text-xl font-bold text-white mt-1 relative z-10">{myProfile.superLikes || 0}</span>
                    </div>
                  </div>
                </div>
              )}
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

      {/* ── FLOATING SKIP BUTTON (Bottom Right) ── */}
      {!showProfileSheet && !showSidebar && (
        <button
          onClick={nextUser}
          className="fixed bottom-6 right-6 z-[500] bg-slate-900/90 backdrop-blur-md border border-white/20 text-slate-200 text-xs font-bold px-5 py-3.5 rounded-full shadow-[0_10px_30px_rgba(0,0,0,0.5)] hover:bg-slate-800 active:scale-95 transition-transform flex items-center gap-2"
        >
          Profil Suivant ⏭️
        </button>
      )}

    </div>
  )
}

export default App
