import { useState, useRef, useCallback, useEffect } from 'react';
import songsJson from '../data/songs.json';
import { getTopScores, submitScore, type ScoreEntry } from '../lib/firebase';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Song {
  trackId: number;
  trackName: string;
  collectionName: string;
  previewUrl: string;
  artworkUrl100: string;
}

type Phase = 'loading' | 'home' | 'playing' | 'guessing' | 'revealed' | 'gameover';
type Mode  = 'classic' | 'infinite';

// ─── Constants ────────────────────────────────────────────────────────────────

const DIFFICULTIES = [
  { id: 'easy'    as const, label: 'Fácil',   seconds: 10, randomOffset: false },
  { id: 'normal'  as const, label: 'Normal',  seconds: 5,  randomOffset: false },
  { id: 'hard'    as const, label: 'Difícil', seconds: 2,  randomOffset: true  },
  { id: 'extreme' as const, label: 'Extremo', seconds: 1,  randomOffset: true  },
];

type DifficultyId = (typeof DIFFICULTIES)[number]['id'];

const TOTAL_ROUNDS = 10;
const OPTIONS_COUNT = 4;

const INFINITE_START_SECONDS = 5;
const INFINITE_MIN_SECONDS   = 1;
const INFINITE_STEP          = 5; // aciertos necesarios para bajar 1s
const HIGH_SCORE_KEY         = 'ntvg-infinite-highscore';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

function pickOptions(songs: Song[], correct: Song): Song[] {
  const others = songs.filter(s => s.trackId !== correct.trackId);
  return shuffle([correct, ...shuffle(others).slice(0, OPTIONS_COUNT - 1)]);
}

function artUrl(url: string, size = 400): string {
  if (!url) return '';
  return url.replace('100x100bb', `${size}x${size}bb`);
}

function infiniteSecondsFor(score: number): number {
  return Math.max(
    INFINITE_MIN_SECONDS,
    INFINITE_START_SECONDS - Math.floor(score / INFINITE_STEP),
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SoundBars({ active }: { active: boolean }) {
  const heights = [30, 55, 75, 60, 45, 70, 40, 65, 50, 80];
  return (
    <div className="flex items-end justify-center gap-1" style={{ height: '3.5rem' }}>
      {heights.map((h, i) => (
        <div
          key={i}
          className="w-1.5 rounded-full bg-orange-500 origin-bottom"
          style={{
            height: active ? `${h}%` : '15%',
            animation: active ? `soundbar 0.7s ease-in-out infinite` : 'none',
            animationDelay: `${i * 0.07}s`,
            transition: 'height 0.4s ease',
          }}
        />
      ))}
    </div>
  );
}

function CountdownRing({ timeLeft, total }: { timeLeft: number; total: number }) {
  const r = 36;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - Math.max(0, timeLeft) / total);
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: 88, height: 88 }}>
      <svg className="absolute" style={{ transform: 'rotate(-90deg)', width: 88, height: 88 }}>
        <circle cx="44" cy="44" r={r} fill="none" stroke="#27272a" strokeWidth="7" />
        <circle
          cx="44" cy="44" r={r}
          fill="none"
          stroke="#f97316"
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.1s linear' }}
        />
      </svg>
      <span className="text-2xl font-black text-orange-400 tabular-nums">
        {Math.ceil(timeLeft)}
      </span>
    </div>
  );
}

function OptionBtn({
  letter, song, phase, isCorrect, isSelected, onClick,
}: {
  letter: string; song: Song; phase: Phase;
  isCorrect: boolean; isSelected: boolean; onClick: () => void;
}) {
  let wrap = 'flex items-center gap-3 p-4 rounded-xl text-left w-full transition-all duration-200 border ';
  let badge = 'w-8 h-8 rounded-lg flex-shrink-0 flex items-center justify-center text-sm font-bold ';

  if (phase === 'revealed') {
    if (isCorrect) {
      wrap  += 'bg-emerald-900/40 border-emerald-500 text-emerald-100';
      badge += 'bg-emerald-500 text-white';
    } else if (isSelected) {
      wrap  += 'bg-red-900/40 border-red-500 text-red-200';
      badge += 'bg-red-500 text-white';
    } else {
      wrap  += 'bg-zinc-800/40 border-zinc-700/50 text-zinc-500 opacity-50';
      badge += 'bg-zinc-700 text-zinc-400';
    }
  } else {
    wrap  += 'bg-zinc-800/80 border-zinc-700 text-white hover:border-orange-500 hover:bg-zinc-700/80 cursor-pointer active:scale-[0.98]';
    badge += 'bg-zinc-700 text-orange-400';
  }

  return (
    <button className={wrap} onClick={onClick} disabled={phase === 'revealed'}>
      <span className={badge}>
        {phase === 'revealed'
          ? isCorrect ? '✓' : isSelected ? '✗' : letter
          : letter}
      </span>
      <span className="text-sm font-semibold leading-snug">{song.trackName}</span>
    </button>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function SongGuesser() {
  const [songs,      setSongs]      = useState<Song[]>(songsJson as Song[]);
  const [phase,      setPhase]      = useState<Phase>('home');
  const [mode,       setMode]       = useState<Mode>('classic');
  const [diffId,     setDiffId]     = useState<DifficultyId>('normal');
  const [current,    setCurrent]    = useState<Song | null>(null);
  const [options,    setOptions]    = useState<Song[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [score,      setScore]      = useState(0);
  const [round,      setRound]      = useState(0);
  const [streak,     setStreak]     = useState(0);
  const [maxStreak,  setMaxStreak]  = useState(0);
  const [isPlaying,  setIsPlaying]  = useState(false);
  const [timeLeft,   setTimeLeft]   = useState(0);
  const [error,      setError]      = useState<string | null>(null);
  const [usedIds,    setUsedIds]    = useState<Set<number>>(new Set());
  const [highScore,  setHighScore]  = useState(0);
  const [isNewRecord, setIsNewRecord] = useState(false);
  const [topScores,    setTopScores]    = useState<ScoreEntry[]>([]);
  const [loadingTop,   setLoadingTop]   = useState(false);
  const [playerName,   setPlayerName]   = useState('');
  const [savingScore,  setSavingScore]  = useState(false);
  const [scoreSaved,   setScoreSaved]   = useState(false);
  const [saveError,    setSaveError]    = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement>(null);
  const stopRef  = useRef<number | undefined>(undefined);
  const tickRef  = useRef<number | undefined>(undefined);

  const diff = DIFFICULTIES.find(d => d.id === diffId)!;

  // Load high score once on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(HIGH_SCORE_KEY);
      if (saved) setHighScore(parseInt(saved, 10) || 0);
    } catch {}
  }, []);

  const fetchTopScores = useCallback(async () => {
    setLoadingTop(true);
    try {
      const scores = await getTopScores(5);
      setTopScores(scores);
    } catch (e) {
      console.error('No se pudo cargar el ranking', e);
    } finally {
      setLoadingTop(false);
    }
  }, []);

  // Load leaderboard on mount
  useEffect(() => {
    fetchTopScores();
  }, [fetchTopScores]);

  const handleSubmitScore = useCallback(async () => {
    const name = playerName.trim();
    if (!name || savingScore || scoreSaved) return;
    setSavingScore(true);
    setSaveError(null);
    try {
      await submitScore(name, score);
      setScoreSaved(true);
      await fetchTopScores();
    } catch (e) {
      console.error(e);
      setSaveError('No se pudo guardar el puntaje. Probá de nuevo.');
    } finally {
      setSavingScore(false);
    }
  }, [playerName, savingScore, scoreSaved, score, fetchTopScores]);

  // ── Audio ─────────────────────────────────────────────────────────────────

  const stopAudio = useCallback(() => {
    clearTimeout(stopRef.current);
    clearInterval(tickRef.current);
    if (audioRef.current) audioRef.current.pause();
    setIsPlaying(false);
    setTimeLeft(0);
  }, []);

  const playClip = useCallback((
    url: string,
    seconds: number,
    randomOffset: boolean,
    onDone: () => void,
  ) => {
    const audio = audioRef.current;
    if (!audio) return;

    clearTimeout(stopRef.current);
    clearInterval(tickRef.current);
    audio.pause();

    const offset = randomOffset ? Math.floor(Math.random() * 15) + 5 : 0;
    setIsPlaying(true);
    setTimeLeft(seconds);

    audio.src = url;
    if (offset > 0) {
      audio.addEventListener('loadedmetadata', () => {
        audio.currentTime = offset;
      }, { once: true });
    }

    const promise = audio.play();

    const startTimer = () => {
      let remaining = seconds;
      tickRef.current = window.setInterval(() => {
        remaining -= 0.1;
        setTimeLeft(Math.max(0, remaining));
      }, 100);
      stopRef.current = window.setTimeout(() => {
        audio.pause();
        clearInterval(tickRef.current);
        setIsPlaying(false);
        setTimeLeft(0);
        onDone();
      }, seconds * 1000);
    };

    if (promise !== undefined) {
      promise.then(startTimer).catch(() => {
        setIsPlaying(false);
        onDone();
      });
    } else {
      startTimer();
    }
  }, []);

  // ── Game logic ─────────────────────────────────────────────────────────────

  const launchRound = useCallback((
    allSongs: Song[],
    roundNum: number,
    usedSet: Set<number>,
    currentScore: number,
  ) => {
    if (mode === 'classic' && roundNum >= TOTAL_ROUNDS) {
      setPhase('gameover');
      return;
    }

    const secs   = mode === 'infinite' ? infiniteSecondsFor(currentScore) : diff.seconds;
    const randOf = mode === 'infinite' ? false : diff.randomOffset;

    // If we ran out of unused songs, reset the pool to keep infinite mode going
    const pool        = allSongs.filter(s => !usedSet.has(s.trackId));
    const src         = pool.length >= OPTIONS_COUNT ? pool : allSongs;
    const nextUsedSet = pool.length >= OPTIONS_COUNT ? usedSet : new Set<number>();

    const song = shuffle(src)[0]!;
    const opts = pickOptions(allSongs, song);

    setCurrent(song);
    setOptions(opts);
    setSelectedId(null);
    setRound(roundNum);
    setUsedIds(new Set([...nextUsedSet, song.trackId]));
    setPhase('playing');
    playClip(song.previewUrl, secs, randOf, () => setPhase('guessing'));
  }, [mode, diff, playClip]);

  const startGame = useCallback(() => {
    setScore(0);
    setStreak(0);
    setMaxStreak(0);
    setIsNewRecord(false);
    setScoreSaved(false);
    setPlayerName('');
    setSaveError(null);
    launchRound(songs, 0, new Set<number>(), 0);
  }, [songs, launchRound]);

  const handleSelect = useCallback((song: Song) => {
    if (phase !== 'guessing') return;
    stopAudio();

    const correct = song.trackId === current?.trackId;
    setSelectedId(song.trackId);
    setPhase('revealed');

    if (correct) {
      const ns = streak + 1;
      setScore(s => s + 1);
      setStreak(ns);
      setMaxStreak(m => Math.max(m, ns));
    } else {
      setStreak(0);

      if (mode === 'infinite') {
        // Persist record now; game ends after the reveal
        if (score > highScore) {
          setHighScore(score);
          setIsNewRecord(true);
          try { localStorage.setItem(HIGH_SCORE_KEY, String(score)); } catch {}
        }
      }
    }

    if (audioRef.current && current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => {});
    }
  }, [phase, current, streak, stopAudio, mode, score, highScore]);

  const nextRound = useCallback(() => {
    stopAudio();
    // In infinite mode, a wrong answer ends the game
    if (mode === 'infinite' && selectedId !== null && selectedId !== current?.trackId) {
      setPhase('gameover');
      return;
    }
    launchRound(songs, round + 1, usedIds, score);
  }, [songs, round, usedIds, launchRound, stopAudio, mode, selectedId, current, score]);

  const replayClip = useCallback(() => {
    if (!current || phase !== 'guessing') return;
    const secs   = mode === 'infinite' ? infiniteSecondsFor(score) : diff.seconds;
    const randOf = mode === 'infinite' ? false : diff.randomOffset;
    setPhase('playing');
    playClip(current.previewUrl, secs, randOf, () => setPhase('guessing'));
  }, [current, phase, playClip, mode, score, diff]);

  const goHome = useCallback(() => {
    stopAudio();
    setPhase('home');
  }, [stopAudio]);

  // ── Render helpers ─────────────────────────────────────────────────────────

  const isCorrect = selectedId === current?.trackId;

  const currentSeconds = mode === 'infinite' ? infiniteSecondsFor(score) : diff.seconds;

  const pct = score / TOTAL_ROUNDS;
  const [goEmoji, goTitle, goMsg] =
    mode === 'infinite'
      ? (score >= 20 ? ['👑', '¡Leyenda!',       'Dominás el repertorio']
        : score >= 10 ? ['🌟', '¡Muy bien!',       'Buen oído para NTVG']
        : score >=  5 ? ['🎵', 'Nada mal',         'Podés mejorar tu récord']
        : score >    0 ? ['😎', 'Seguí probando',   'La próxima salís más lejos']
        :                ['💀', 'Ouch',             'Arrancamos mal, pero dale de nuevo'])
      : (pct === 1  ? ['🏆', '¡Perfecto!',       'Sos un verdadero fanático de NTVG']
      :  pct >= 0.8 ? ['🌟', '¡Excelente!',      'Conocés muy bien la discografía']
      :  pct >= 0.6 ? ['👏', '¡Bien!',           'Buen conocimiento musical']
      :  pct >= 0.4 ? ['😎', 'Pasable',          'Hay que escuchar más NTVG']
      :               ['🎵', 'Seguí intentando', 'Ponete los auriculares y practicá']);

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <audio ref={audioRef} />

      {/* ── Loading ── */}
      {phase === 'loading' && (
        <div className="min-h-screen flex flex-col items-center justify-center gap-6">
          <SoundBars active />
          <p className="text-zinc-400 text-sm tracking-widest uppercase animate-pulse">
            Cargando canciones...
          </p>
        </div>
      )}

      {/* ── Home ── */}
      {phase === 'home' && (
        <div className="min-h-screen flex items-center justify-center p-6">
          <div className="max-w-sm w-full">
            {error && (
              <div className="mb-6 p-4 bg-red-950/60 border border-red-800 rounded-xl text-red-300 text-sm text-center">
                {error}
              </div>
            )}
            <div className="text-center mb-8">
              <SoundBars active={false} />
              <h1 className="mt-5 text-4xl font-black tracking-tight">¿Adivinas la canción?</h1>
              <p className="mt-2 text-orange-400 font-semibold text-lg">No Te Va Gustar</p>
              {songs.length > 0 && (
                <p className="mt-1 text-zinc-600 text-sm">{songs.length} canciones disponibles</p>
              )}
            </div>

            {/* Mode selector */}
            <div className="mb-5">
              <p className="text-xs text-zinc-500 uppercase tracking-widest text-center mb-3">
                Modo
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setMode('classic')}
                  className={`py-3 rounded-xl font-bold text-sm transition-all ${
                    mode === 'classic'
                      ? 'bg-orange-500 text-white shadow-lg'
                      : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white'
                  }`}
                >
                  <div>Clásico</div>
                  <div className="text-xs font-normal opacity-70 mt-0.5">{TOTAL_ROUNDS} rondas</div>
                </button>
                <button
                  onClick={() => setMode('infinite')}
                  className={`py-3 rounded-xl font-bold text-sm transition-all ${
                    mode === 'infinite'
                      ? 'bg-orange-500 text-white shadow-lg'
                      : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white'
                  }`}
                >
                  <div>Infinito ∞</div>
                  <div className="text-xs font-normal opacity-70 mt-0.5">Hasta fallar</div>
                </button>
              </div>
            </div>

            {/* Classic: difficulty selector */}
            {mode === 'classic' && (
              <div className="mb-8">
                <p className="text-xs text-zinc-500 uppercase tracking-widest text-center mb-3">
                  Dificultad
                </p>
                <div className="grid grid-cols-4 gap-2">
                  {DIFFICULTIES.map(d => (
                    <button
                      key={d.id}
                      onClick={() => setDiffId(d.id)}
                      className={`py-3 rounded-xl font-bold text-sm transition-all ${
                        diffId === d.id
                          ? 'bg-orange-500 text-white shadow-lg'
                          : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white'
                      }`}
                    >
                      <div>{d.label}</div>
                      <div className="text-xs font-normal opacity-70 mt-0.5">{d.seconds}s</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Infinite: leaderboard + rules */}
            {mode === 'infinite' && (
              <div className="mb-8 space-y-3">
                <div className="p-4 bg-gradient-to-br from-orange-950/40 to-zinc-900 border border-orange-900/50 rounded-xl">
                  <div className="text-xs text-zinc-500 uppercase tracking-widest mb-3 text-center">
                    🏆 Top 5
                  </div>
                  {loadingTop ? (
                    <div className="text-center text-zinc-500 text-sm py-4">Cargando...</div>
                  ) : topScores.length === 0 ? (
                    <div className="text-center text-zinc-500 text-sm py-4">
                      Nadie jugó todavía. ¡Sé el primero!
                    </div>
                  ) : (
                    <ol className="space-y-1">
                      {topScores.map((entry, i) => (
                        <li
                          key={entry.id}
                          className="flex items-center justify-between py-1.5 px-2 rounded-lg bg-zinc-900/50"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-orange-400 font-bold w-5 tabular-nums">{i + 1}.</span>
                            <span className="truncate text-sm font-semibold">{entry.name}</span>
                          </div>
                          <span className="text-orange-400 font-black tabular-nums">{entry.score}</span>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
                <div className="p-3 bg-zinc-900 border border-zinc-800 rounded-xl text-xs text-zinc-400 text-center leading-relaxed">
                  Empezás con pistas de <span className="text-orange-400 font-bold">5s</span>.<br/>
                  Cada <span className="text-orange-400 font-bold">5 aciertos</span> el tiempo baja 1s (mínimo 1s).<br/>
                  <span className="text-red-400 font-bold">Fallás y se termina.</span>
                </div>
              </div>
            )}

            <button
              onClick={startGame}
              disabled={songs.length < OPTIONS_COUNT}
              className="w-full py-4 rounded-xl font-black text-lg bg-orange-500 hover:bg-orange-400 disabled:bg-zinc-800 disabled:text-zinc-600 transition-all active:scale-[0.98] shadow-xl"
            >
              {songs.length < OPTIONS_COUNT ? 'Cargando...' : 'Empezar juego'}
            </button>

            <div className="mt-6 grid grid-cols-3 gap-3 text-center text-xs text-zinc-500">
              <div className="bg-zinc-900 rounded-xl p-3">
                <div className="text-lg mb-1">🎵</div>
                <div>{mode === 'infinite' ? 'Sin límite' : `${TOTAL_ROUNDS} rondas`}</div>
              </div>
              <div className="bg-zinc-900 rounded-xl p-3">
                <div className="text-lg mb-1">⏱️</div>
                <div>{mode === 'infinite' ? 'Cada vez menos' : 'Clip corto'}</div>
              </div>
              <div className="bg-zinc-900 rounded-xl p-3">
                <div className="text-lg mb-1">🏆</div>
                <div>{mode === 'infinite' ? 'Récord' : 'Puntuación'}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Game Over ── */}
      {phase === 'gameover' && (
        <div className="min-h-screen flex items-center justify-center p-6">
          <div className="max-w-sm w-full text-center animate-fade-up">
            <div className="text-7xl mb-4">{goEmoji}</div>
            <h2 className="text-3xl font-black">{goTitle}</h2>
            <p className="mt-1 text-zinc-400">{goMsg}</p>

            <div className="my-8 bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
              <div className="text-7xl font-black text-orange-400">{score}</div>
              <div className="text-zinc-400 mt-1">
                {mode === 'infinite' ? 'aciertos' : `de ${TOTAL_ROUNDS} correctas`}
              </div>

              {mode === 'infinite' ? (
                <div className="mt-3 text-sm">
                  {isNewRecord ? (
                    <span className="text-orange-400 font-bold">¡Nuevo récord personal! 🎉</span>
                  ) : (
                    <span className="text-zinc-500">
                      Tu mejor <span className="text-orange-400 font-bold">{highScore}</span>
                    </span>
                  )}
                </div>
              ) : (
                maxStreak > 1 && (
                  <div className="mt-3 text-sm text-zinc-500">
                    Racha máxima{' '}
                    <span className="text-orange-400 font-bold">{maxStreak} seguidas 🔥</span>
                  </div>
                )
              )}
            </div>

            {/* Infinite: save score */}
            {mode === 'infinite' && score > 0 && !scoreSaved && (
              <div className="mb-6 p-4 bg-zinc-900 border border-zinc-800 rounded-xl">
                <p className="text-sm text-zinc-400 mb-3">Guardá tu puntaje en el ranking</p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={playerName}
                    onChange={e => setPlayerName(e.target.value.slice(0, 20))}
                    placeholder="Tu nombre"
                    maxLength={20}
                    className="flex-1 bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2 text-white placeholder:text-zinc-500 focus:outline-none focus:border-orange-500"
                    onKeyDown={e => { if (e.key === 'Enter') handleSubmitScore(); }}
                    disabled={savingScore}
                  />
                  <button
                    onClick={handleSubmitScore}
                    disabled={!playerName.trim() || savingScore}
                    className="px-4 py-2 rounded-xl font-bold bg-orange-500 hover:bg-orange-400 disabled:bg-zinc-800 disabled:text-zinc-600 transition-all"
                  >
                    {savingScore ? '...' : 'Guardar'}
                  </button>
                </div>
                {saveError && (
                  <p className="mt-2 text-xs text-red-400">{saveError}</p>
                )}
              </div>
            )}

            {mode === 'infinite' && scoreSaved && (
              <div className="mb-6 p-4 bg-emerald-950/50 border border-emerald-700 rounded-xl text-center text-emerald-400 font-bold">
                ✓ ¡Puntaje guardado!
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={startGame}
                className="flex-1 py-4 rounded-xl font-bold bg-orange-500 hover:bg-orange-400 transition-all active:scale-[0.98]"
              >
                Jugar de nuevo
              </button>
              <button
                onClick={goHome}
                className="px-5 py-4 rounded-xl text-zinc-300 bg-zinc-800 hover:bg-zinc-700 transition-all"
              >
                Inicio
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Playing / Guessing / Revealed ── */}
      {(phase === 'playing' || phase === 'guessing' || phase === 'revealed') && (
        <div className="p-4">
          <div className="max-w-md mx-auto">

            {/* Header */}
            <div className="flex items-center justify-between pt-2 mb-5">
              <button
                onClick={goHome}
                className="text-zinc-500 hover:text-white text-sm transition-colors"
              >
                ← Salir
              </button>
              <div className="flex items-center gap-3 text-sm">
                {streak > 1 && <span className="text-orange-400 font-bold">🔥 {streak}</span>}
                <span className="text-zinc-400">
                  <span className="text-white font-bold">{score}</span>
                  {mode === 'classic' && (phase === 'revealed' ? `/${round + 1}` : `/${round}`)}
                  {' '}pts
                </span>
              </div>
            </div>

            {/* Classic: progress bar */}
            {mode === 'classic' && (
              <>
                <div className="h-1 bg-zinc-800 rounded-full overflow-hidden mb-4">
                  <div
                    className="h-full bg-orange-500 rounded-full transition-all duration-500"
                    style={{ width: `${(round / TOTAL_ROUNDS) * 100}%` }}
                  />
                </div>
                <p className="text-center text-zinc-500 text-xs mb-5 uppercase tracking-widest">
                  Ronda <span className="text-white">{round + 1}</span> / {TOTAL_ROUNDS}
                </p>
              </>
            )}

            {/* Infinite: dynamic info */}
            {mode === 'infinite' && (
              <p className="text-center text-zinc-500 text-xs mb-5 uppercase tracking-widest">
                Modo infinito · Pistas de{' '}
                <span className="text-orange-400 font-bold">{currentSeconds}s</span>
              </p>
            )}

            {/* Album art */}
            {current && (
              <div className="flex justify-center mb-6">
                <div className="relative w-44 h-44">
                  {current.artworkUrl100 ? (
                    <img
                      src={artUrl(current.artworkUrl100, 400)}
                      alt="Álbum"
                      className={`w-full h-full rounded-2xl object-cover shadow-2xl transition-all duration-500 ${
                        phase !== 'revealed' ? 'blur-2xl scale-90' : 'blur-0 scale-100'
                      }`}
                    />
                  ) : (
                    <div className="w-full h-full rounded-2xl bg-zinc-800 flex items-center justify-center text-4xl">
                      🎵
                    </div>
                  )}
                  {isPlaying && (
                    <div className="absolute inset-0 rounded-2xl bg-zinc-950/55 flex items-center justify-center">
                      <SoundBars active />
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Playing */}
            {phase === 'playing' && (
              <div className="text-center animate-fade-up">
                <CountdownRing timeLeft={timeLeft} total={currentSeconds} />
                <p className="mt-2 text-zinc-500 text-sm">Escuchando...</p>
              </div>
            )}

            {/* Guessing */}
            {phase === 'guessing' && (
              <div className="animate-fade-up">
                <div className="text-center mb-4">
                  <p className="font-bold text-lg">¿Qué canción era?</p>
                  <button
                    onClick={replayClip}
                    className="mt-2 text-orange-400 hover:text-orange-300 text-sm transition-colors"
                  >
                    ▶ Escuchar de nuevo
                  </button>
                </div>
                <div className="flex flex-col gap-2">
                  {options.map((song, i) => (
                    <OptionBtn
                      key={song.trackId}
                      letter={['A', 'B', 'C', 'D'][i]!}
                      song={song}
                      phase={phase}
                      isCorrect={song.trackId === current?.trackId}
                      isSelected={song.trackId === selectedId}
                      onClick={() => handleSelect(song)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Revealed */}
            {phase === 'revealed' && (
              <div className="animate-fade-up">
                <div className={`text-center mb-4 p-4 rounded-xl border ${
                  isCorrect
                    ? 'bg-emerald-950/50 border-emerald-700'
                    : 'bg-red-950/50 border-red-700'
                }`}>
                  <p className={`font-black text-xl ${isCorrect ? 'text-emerald-400' : 'text-red-400'}`}>
                    {isCorrect ? '✓ ¡Correcto!' : '✗ Incorrecto'}
                  </p>
                  <p className="font-semibold mt-1">{current?.trackName}</p>
                  <p className="text-zinc-400 text-sm">{current?.collectionName}</p>
                </div>
                <div className="flex flex-col gap-2 mb-4">
                  {options.map((song, i) => (
                    <OptionBtn
                      key={song.trackId}
                      letter={['A', 'B', 'C', 'D'][i]!}
                      song={song}
                      phase={phase}
                      isCorrect={song.trackId === current?.trackId}
                      isSelected={song.trackId === selectedId}
                      onClick={() => {}}
                    />
                  ))}
                </div>
                <button
                  onClick={nextRound}
                  className="w-full py-4 rounded-xl font-bold bg-orange-500 hover:bg-orange-400 transition-all active:scale-[0.98]"
                >
                  {mode === 'classic'
                    ? (round + 1 >= TOTAL_ROUNDS ? '🏆 Ver resultado' : 'Siguiente →')
                    : (isCorrect ? 'Siguiente →' : '🏆 Ver resultado')}
                </button>
              </div>
            )}

          </div>
        </div>
      )}
    </div>
  );
}
