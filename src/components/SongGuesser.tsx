import { useState, useRef, useCallback } from 'react';
import songsJson from '../data/songs.json';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Song {
  trackId: number;
  trackName: string;
  collectionName: string;
  previewUrl: string;
  artworkUrl100: string;
}

type Phase = 'loading' | 'home' | 'playing' | 'guessing' | 'revealed' | 'gameover';

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

  const audioRef    = useRef<HTMLAudioElement>(null);
  const stopRef     = useRef<number | undefined>(undefined);
  const tickRef     = useRef<number | undefined>(undefined);

  const diff = DIFFICULTIES.find(d => d.id === diffId)!;

  // Songs are bundled at build time via the JSON import — no fetch needed

  // ── Audio ─────────────────────────────────────────────────────────────────

  const stopAudio = useCallback(() => {
    clearTimeout(stopRef.current);
    clearInterval(tickRef.current);
    if (audioRef.current) audioRef.current.pause();
    setIsPlaying(false);
    setTimeLeft(0);
  }, []);

  const playClip = useCallback((url: string, onDone: () => void) => {
    const audio = audioRef.current;
    if (!audio) return;

    clearTimeout(stopRef.current);
    clearInterval(tickRef.current);
    audio.pause();

    const offset = diff.randomOffset ? Math.floor(Math.random() * 15) + 5 : 0;
    setIsPlaying(true);
    setTimeLeft(diff.seconds);

    audio.src = url;
    // seek once metadata arrives (hard/extreme modes start mid-song)
    if (offset > 0) {
      audio.addEventListener('loadedmetadata', () => {
        audio.currentTime = offset;
      }, { once: true });
    }

    // play() MUST be called synchronously in the user-gesture call stack
    // so the browser autoplay policy allows it; timer starts in the resolved promise
    const promise = audio.play();

    const startTimer = () => {
      let remaining = diff.seconds;
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
      }, diff.seconds * 1000);
    };

    if (promise !== undefined) {
      promise.then(startTimer).catch(() => {
        setIsPlaying(false);
        onDone();
      });
    } else {
      startTimer();
    }
  }, [diff]);

  // ── Game logic ─────────────────────────────────────────────────────────────

  const launchRound = useCallback((allSongs: Song[], roundNum: number, usedSet: Set<number>) => {
    if (roundNum >= TOTAL_ROUNDS) {
      setPhase('gameover');
      return;
    }
    const pool = allSongs.filter(s => !usedSet.has(s.trackId));
    const src  = pool.length >= OPTIONS_COUNT ? pool : allSongs;
    const song = shuffle(src)[0]!;
    const opts = pickOptions(allSongs, song);

    setCurrent(song);
    setOptions(opts);
    setSelectedId(null);
    setRound(roundNum);
    setUsedIds(new Set([...usedSet, song.trackId]));
    setPhase('playing');
    playClip(song.previewUrl, () => setPhase('guessing'));
  }, [playClip]);

  const startGame = useCallback(() => {
    setScore(0);
    setStreak(0);
    setMaxStreak(0);
    const empty = new Set<number>();
    launchRound(songs, 0, empty);
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
    }

    // Let user hear the full preview from start
    if (audioRef.current && current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => {});
    }
  }, [phase, current, streak, stopAudio]);

  const nextRound = useCallback(() => {
    stopAudio();
    launchRound(songs, round + 1, usedIds);
  }, [songs, round, usedIds, launchRound, stopAudio]);

  const replayClip = useCallback(() => {
    if (!current || phase !== 'guessing') return;
    setPhase('playing');
    playClip(current.previewUrl, () => setPhase('guessing'));
  }, [current, phase, playClip]);

  const goHome = useCallback(() => {
    stopAudio();
    setPhase('home');
  }, [stopAudio]);

  // ── Render ─────────────────────────────────────────────────────────────────
  // <audio> is always in the DOM so audioRef.current is never null when
  // playClip() is called synchronously from a button click handler

  const isCorrect = selectedId === current?.trackId;

  const pct = score / TOTAL_ROUNDS;
  const [goEmoji, goTitle, goMsg] =
    pct === 1  ? ['🏆', '¡Perfecto!',       'Sos un verdadero fanático de NTVG'] :
    pct >= 0.8 ? ['🌟', '¡Excelente!',       'Conocés muy bien la discografía']  :
    pct >= 0.6 ? ['👏', '¡Bien!',            'Buen conocimiento musical']         :
    pct >= 0.4 ? ['😎', 'Pasable',           'Hay que escuchar más NTVG']         :
                 ['🎵', 'Seguí intentando',  'Ponete los auriculares y practicá'];

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* Audio always mounted so the ref is ready before any phase transition */}
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
            <div className="text-center mb-10">
              <SoundBars active={false} />
              <h1 className="mt-5 text-4xl font-black tracking-tight">¿Adivinas la canción?</h1>
              <p className="mt-2 text-orange-400 font-semibold text-lg">No Te Va a Gustar</p>
              {songs.length > 0 && (
                <p className="mt-1 text-zinc-600 text-sm">{songs.length} canciones disponibles</p>
              )}
            </div>
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
                <div>{TOTAL_ROUNDS} rondas</div>
              </div>
              <div className="bg-zinc-900 rounded-xl p-3">
                <div className="text-lg mb-1">⏱️</div>
                <div>Clip corto</div>
              </div>
              <div className="bg-zinc-900 rounded-xl p-3">
                <div className="text-lg mb-1">🏆</div>
                <div>Puntuación</div>
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
              <div className="text-zinc-400 mt-1">de {TOTAL_ROUNDS} correctas</div>
              {maxStreak > 1 && (
                <div className="mt-3 text-sm text-zinc-500">
                  Racha máxima{' '}
                  <span className="text-orange-400 font-bold">{maxStreak} seguidas 🔥</span>
                </div>
              )}
            </div>
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
                  {phase === 'revealed' ? `/${round + 1}` : `/${round}`} pts
                </span>
              </div>
            </div>

            {/* Progress bar */}
            <div className="h-1 bg-zinc-800 rounded-full overflow-hidden mb-4">
              <div
                className="h-full bg-orange-500 rounded-full transition-all duration-500"
                style={{ width: `${(round / TOTAL_ROUNDS) * 100}%` }}
              />
            </div>
            <p className="text-center text-zinc-500 text-xs mb-5 uppercase tracking-widest">
              Ronda <span className="text-white">{round + 1}</span> / {TOTAL_ROUNDS}
            </p>

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
                <CountdownRing timeLeft={timeLeft} total={diff.seconds} />
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
                  {round + 1 >= TOTAL_ROUNDS ? '🏆 Ver resultado' : 'Siguiente →'}
                </button>
              </div>
            )}

          </div>
        </div>
      )}
    </div>
  );
}
