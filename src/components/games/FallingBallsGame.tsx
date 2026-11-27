import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Home } from 'lucide-react';
import { TactileButton } from '../TactileButton';
import { GameCompletionPanel } from '../GameCompletionPanel';
import { GameId } from '../../types/game';
import { calmAudio } from '../../utils/audio';

interface FallingBallsGameProps {
  onSelectGame: (game: GameId) => void;
}

interface ColorSpec {
  id: 'amarelo' | 'azul' | 'verde' | 'laranja' | 'lilas';
  label: string;
  hex: string;
  border: string;
  symbol: string;
}

const COLORS: ColorSpec[] = [
  { id: 'amarelo', label: 'amarelo', hex: '#FDE047', border: '#CA8A04', symbol: '★' },
  { id: 'azul', label: 'azul', hex: '#60A5FA', border: '#2563EB', symbol: '●' },
  { id: 'verde', label: 'verde', hex: '#6EE7B7', border: '#059669', symbol: '▲' },
  { id: 'laranja', label: 'laranja', hex: '#FDBA74', border: '#EA580C', symbol: '■' },
  { id: 'lilas', label: 'lilás', hex: '#C4B5FD', border: '#7C3AED', symbol: '◆' },
];

interface BallEntity {
  id: number;
  color: ColorSpec;
  xPx: number;
  yPx: number;
  speedPx: number; // pixels per second
  popping?: boolean;
}

// 10 progressive phases with gentle hit goals
const PHASE_GOALS = [4, 5, 5, 6, 6, 7, 7, 8, 9, 10];
const BALL_SIZE_PX = 70;
const ARENA_SIDE_PADDING = 10;
const MENU_APPEAR_DELAY_MS = 1000;
const BUTTON_GUARD_DELAY_MS = 450;

export const FallingBallsGame: React.FC<FallingBallsGameProps> = ({ onSelectGame }) => {
  const [phaseIndex, setPhaseIndex] = useState(0);
  const [targetColor, setTargetColor] = useState<ColorSpec>(() => COLORS[0]);
  const [hits, setHits] = useState(0);
  const [balls, setBalls] = useState<BallEntity[]>([]);
  const [feedback, setFeedback] = useState<string>('');
  const [finishingPhase, setFinishingPhase] = useState(false);
  const [phaseWon, setPhaseWon] = useState(false);
  const [menuButtonsReady, setMenuButtonsReady] = useState(false);
  const [completed, setCompleted] = useState(false);

  const arenaRef = useRef<HTMLDivElement>(null);
  const ballElsRef = useRef<Record<number, HTMLDivElement | null>>({});
  const ballsRef = useRef<BallEntity[]>([]);
  const nextIdRef = useRef(1);
  const hitsRef = useRef(0);
  const phaseRef = useRef(0);
  const targetRef = useRef(targetColor);
  const lastSpawnRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const transitionTimerRef = useRef<number | null>(null);

  useEffect(() => {
    hitsRef.current = hits;
  }, [hits]);

  useEffect(() => {
    phaseRef.current = phaseIndex;
  }, [phaseIndex]);

  useEffect(() => {
    targetRef.current = targetColor;
  }, [targetColor]);

  useEffect(() => {
    return () => {
      if (transitionTimerRef.current !== null) {
        window.clearTimeout(transitionTimerRef.current);
      }
    };
  }, []);

  // Extra safety delay so accidental taps right when the continue card appears don't trigger buttons
  useEffect(() => {
    if (!phaseWon) {
      setMenuButtonsReady(false);
      return;
    }
    const guardTimer = window.setTimeout(() => {
      setMenuButtonsReady(true);
    }, BUTTON_GUARD_DELAY_MS);
    return () => window.clearTimeout(guardTimer);
  }, [phaseWon]);

  const trySpawnBall = useCallback((): BallEntity | null => {
    const arenaWidth = arenaRef.current?.clientWidth || 340;
    const minX = ARENA_SIDE_PADDING;
    const maxX = Math.max(minX + 10, arenaWidth - BALL_SIZE_PX - ARENA_SIDE_PADDING);

    // Find an x position that doesn't overlap balls currently near the top entry zone
    const topBalls = ballsRef.current.filter((b) => b.yPx < BALL_SIZE_PX + 26);
    let chosenX: number | null = null;

    for (let attempt = 0; attempt < 10; attempt++) {
      const candidateX = minX + Math.random() * (maxX - minX);
      const overlaps = topBalls.some(
        (existing) => Math.abs(existing.xPx - candidateX) < BALL_SIZE_PX + 10
      );
      if (!overlaps) {
        chosenX = candidateX;
        break;
      }
    }

    // If top zone is temporarily crowded, wait for next frame instead of overlapping
    if (chosenX === null) {
      return null;
    }

    // 45% chance to spawn the target color so child never waits long
    const isTarget = Math.random() < 0.45;
    const otherColors = COLORS.filter((c) => c.id !== targetRef.current.id);
    const chosenColor = isTarget
      ? targetRef.current
      : otherColors[Math.floor(Math.random() * otherColors.length)];

    // Smooth calm speed in px/sec that scales gently across phases and hits
    const speedBoost = 1 + phaseRef.current * 0.07 + hitsRef.current * 0.04;
    const speedPx = (58 + Math.random() * 24) * speedBoost;

    return {
      id: nextIdRef.current++,
      color: chosenColor,
      xPx: chosenX,
      yPx: -BALL_SIZE_PX - 10, // Start completely above the top edge so it enters smoothly
      speedPx,
    };
  }, []);

  const startPhase = useCallback((nextPhaseIdx: number, forceYellow = false) => {
    if (transitionTimerRef.current !== null) {
      window.clearTimeout(transitionTimerRef.current);
      transitionTimerRef.current = null;
    }
    const nextColor = forceYellow
      ? COLORS[0]
      : COLORS[nextPhaseIdx % COLORS.length];
    setPhaseIndex(nextPhaseIdx);
    phaseRef.current = nextPhaseIdx;
    setTargetColor(nextColor);
    targetRef.current = nextColor;
    setHits(0);
    hitsRef.current = 0;
    ballsRef.current = [];
    ballElsRef.current = {};
    setBalls([]);
    setFeedback('');
    setFinishingPhase(false);
    setPhaseWon(false);
    setMenuButtonsReady(false);
    setCompleted(false);
    lastSpawnRef.current = 0;
  }, []);

  const resetGame = useCallback(() => {
    startPhase(0, true);
  }, [startPhase]);

  useEffect(() => {
    if (completed || phaseWon || finishingPhase) return;

    let lastTime = performance.now();
    // Spawn first ball quickly (250ms after phase starts)
    lastSpawnRef.current = lastTime - 950;

    const loop = (now: number) => {
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;

      const arenaHeight = arenaRef.current?.clientHeight || 380;
      const despawnY = arenaHeight + 16; // Only remove after completely exiting bottom edge

      let listChanged = false;
      const nextBalls: BallEntity[] = [];

      for (const ball of ballsRef.current) {
        if (!ball.popping) {
          ball.yPx += ball.speedPx * dt;
        }

        if (ball.yPx > despawnY) {
          listChanged = true;
          delete ballElsRef.current[ball.id];
          continue;
        }

        const el = ballElsRef.current[ball.id];
        if (el) {
          el.style.transform = `translate3d(${ball.xPx.toFixed(1)}px, ${ball.yPx.toFixed(1)}px, 0)`;
        }

        nextBalls.push(ball);
      }

      const spawnIntervalMs = Math.max(
        680,
        1250 - phaseRef.current * 35 - hitsRef.current * 30
      );

      if (now - lastSpawnRef.current >= spawnIntervalMs && nextBalls.length < 8) {
        const spawned = trySpawnBall();
        if (spawned) {
          nextBalls.push(spawned);
          lastSpawnRef.current = now;
          listChanged = true;
        }
      }

      ballsRef.current = nextBalls;

      if (listChanged) {
        // Snapshot current coordinates cleanly when balls are added/removed
        setBalls(nextBalls.map((b) => ({ ...b })));
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [completed, phaseWon, finishingPhase, trySpawnBall]);

  const goalHits = PHASE_GOALS[phaseIndex];

  const handleBallTap = (ballId: number) => {
    const targetBall = ballsRef.current.find((b) => b.id === ballId);
    if (!targetBall || completed || phaseWon || finishingPhase || targetBall.popping) return;

    targetBall.popping = true;
    setBalls(ballsRef.current.map((b) => ({ ...b })));

    window.setTimeout(() => {
      ballsRef.current = ballsRef.current.filter((b) => b.id !== ballId);
      delete ballElsRef.current[ballId];
      setBalls(ballsRef.current.map((b) => ({ ...b })));
    }, 150);

    if (targetBall.color.id === targetColor.id) {
      calmAudio.playSuccess();
      const nextHits = hits + 1;
      setHits(nextHits);

      if (nextHits >= goalHits) {
        calmAudio.playCelebrate();
        setFinishingPhase(true);
        setFeedback(`Fase ${phaseIndex + 1} concluída! Muito bem! 🌟`);

        transitionTimerRef.current = window.setTimeout(() => {
          ballsRef.current = [];
          ballElsRef.current = {};
          setBalls([]);
          setFinishingPhase(false);
          if (phaseIndex >= PHASE_GOALS.length - 1) {
            setCompleted(true);
          } else {
            setPhaseWon(true);
          }
        }, MENU_APPEAR_DELAY_MS);
      } else {
        setFeedback('Muito bem! Você acertou! ✅');
      }
    } else {
      // No punishment when tapping wrong color
      calmAudio.playTryAgain();
      setFeedback(`Sem problemas! Continue procurando o ${targetColor.label}.`);
    }
  };

  if (completed) {
    return (
      <div className="py-6 px-4">
        <GameCompletionPanel
          currentGame="balls"
          title="Muito bem! Você completou todas as 10 fases!"
          subtitle="Você encontrou todas as bolinhas coloridas com atenção e calma."
          onReplay={resetGame}
          onSelectGame={onSelectGame}
        />
      </div>
    );
  }

  const speedLevel = (1 + phaseIndex * 0.08 + hits * 0.04).toFixed(1);

  return (
    <div className="w-full px-3.5 py-4 flex flex-col items-center">
      {/* Phase counter */}
      <div className="text-xs font-semibold text-[#4A6B8C] mb-2.5 tabular-nums">
        Fase {phaseIndex + 1} de {PHASE_GOALS.length}
      </div>

      {/* Target Instruction Header */}
      <div className="w-full bg-white border border-sky-200 rounded-2xl px-4 py-3 mb-3 flex items-center justify-between gap-2 shadow-xs">
        <div className="flex items-center gap-2.5 min-w-0">
          <span
            className="w-9 h-9 rounded-full inline-flex items-center justify-center font-bold text-base shadow-xs shrink-0"
            style={{
              backgroundColor: targetColor.hex,
              border: `3px solid ${targetColor.border}`,
              color: '#1A365D',
            }}
            aria-hidden="true"
          >
            {targetColor.symbol}
          </span>
          <p className="font-display font-bold text-base text-[#1A365D] truncate">
            Toque só no {targetColor.label}!
          </p>
        </div>

        <div className="flex flex-col items-end text-xs font-semibold text-[#4A6B8C] tabular-nums shrink-0">
          <span>{hits} / {goalHits}</span>
          <span>Vel. {speedLevel}x</span>
        </div>
      </div>

      {/* Gentle non-punitive feedback line */}
      <div className="min-h-[28px] flex items-center justify-center mb-2.5 text-center" role="status" aria-live="polite">
        {feedback ? (
          <p className="text-xs font-semibold text-[#1A365D]">
            {feedback}
          </p>
        ) : (
          <p className="text-xs text-[#4A6B8C]">
            Se tocar em outra cor, sem problema, continua.
          </p>
        )}
      </div>

      {phaseWon ? (
        <div className="w-full bg-white border border-sky-200 rounded-3xl p-6 text-center shadow-sm mt-2 animate-view-enter">
          <p className="font-display font-bold text-xl text-[#1A365D] mb-1.5">
            Fase {phaseIndex + 1} de {PHASE_GOALS.length} concluída! 🎉
          </p>
          <p className="text-sm text-[#4A6B8C] mb-5">
            Na Fase {phaseIndex + 2}, vamos pegar {PHASE_GOALS[phaseIndex + 1]} bolinhas da cor{' '}
            <strong>{COLORS[(phaseIndex + 1) % COLORS.length].label}</strong>?
          </p>
          <div
            className={`flex flex-col gap-2.5 transition-opacity duration-200 ${
              menuButtonsReady ? 'opacity-100' : 'opacity-70 pointer-events-none'
            }`}
          >
            <TactileButton
              type="button"
              disabled={!menuButtonsReady}
              onClick={() => startPhase(phaseIndex + 1)}
              className="w-full px-5 py-3 min-h-[48px] rounded-2xl bg-[#3B9AE1] hover:bg-[#2F89CE] text-white font-display font-semibold text-base"
            >
              Continuar · Fase {phaseIndex + 2}
            </TactileButton>
            <TactileButton
              type="button"
              disabled={!menuButtonsReady}
              onClick={() => onSelectGame('menu')}
              className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 min-h-[44px] rounded-2xl bg-[#E8F3FF] hover:bg-sky-100 text-[#1A365D] font-display font-bold text-sm border-2 border-sky-300"
            >
              <Home className="w-4 h-4 text-[#3B9AE1]" />
              <span>Voltar para a tela inicial</span>
            </TactileButton>
          </div>
        </div>
      ) : (
        /* Minimalist Falling Arena with GPU-smooth translate3d physics */
        <div
          ref={arenaRef}
          className="relative w-full h-[380px] bg-white border border-sky-200 rounded-3xl overflow-hidden shadow-xs select-none"
          aria-label="Área de bolinhas caindo"
        >
          {finishingPhase && (
            <div className="absolute inset-0 z-10 bg-white/55 backdrop-blur-[1px] flex items-center justify-center pointer-events-auto">
              <div className="px-5 py-3 rounded-2xl bg-white border border-sky-200 shadow-sm font-display font-bold text-base text-[#1A365D]">
                Muito bem! 🌟
              </div>
            </div>
          )}

          {balls.map((ball) => (
            <div
              key={ball.id}
              ref={(el) => {
                if (el) {
                  ballElsRef.current[ball.id] = el;
                } else {
                  delete ballElsRef.current[ball.id];
                }
              }}
              className="absolute top-0 left-0 will-change-transform"
              style={{
                width: `${BALL_SIZE_PX}px`,
                height: `${BALL_SIZE_PX}px`,
                transform: `translate3d(${ball.xPx.toFixed(1)}px, ${ball.yPx.toFixed(1)}px, 0)`,
              }}
            >
              <TactileButton
                type="button"
                silentTap
                onPointerDown={() => handleBallTap(ball.id)}
                aria-label={`Bolinha ${ball.color.label}`}
                className={`w-full h-full rounded-full flex items-center justify-center shadow-sm transition-all duration-150 ${
                  ball.popping ? 'scale-125 opacity-0 pointer-events-none' : ''
                }`}
                style={{
                  backgroundColor: ball.color.hex,
                  border: `3px solid ${ball.color.border}`,
                  color: '#1A365D',
                }}
              >
                <span className="text-xl font-bold opacity-75 pointer-events-none" aria-hidden="true">
                  {ball.color.symbol}
                </span>
              </TactileButton>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
