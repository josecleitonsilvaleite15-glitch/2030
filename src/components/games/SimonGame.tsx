import React, { useState, useEffect, useRef, useCallback } from 'react';
import { TactileButton } from '../TactileButton';
import { GameCompletionPanel } from '../GameCompletionPanel';
import { GameId } from '../../types/game';
import { calmAudio } from '../../utils/audio';

interface SimonGameProps {
  onSelectGame: (game: GameId) => void;
}

type SpeedMode = 'devagar' | 'normal' | 'rapido';

interface PadSpec {
  id: number;
  label: string;
  symbol: string;
  idleBg: string;
  litBg: string;
  border: string;
  freq: number;
}

const PADS: PadSpec[] = [
  {
    id: 0,
    label: 'Azul',
    symbol: '●',
    idleBg: '#DBEAFE',
    litBg: '#3B9AE1',
    border: '#60A5FA',
    freq: 523.25, // C5
  },
  {
    id: 1,
    label: 'Amarelo',
    symbol: '★',
    idleBg: '#FEF9C3',
    litBg: '#FACC15',
    border: '#EAB308',
    freq: 587.33, // D5
  },
  {
    id: 2,
    label: 'Verde',
    symbol: '▲',
    idleBg: '#D1FAE5',
    litBg: '#34D399',
    border: '#10B981',
    freq: 659.25, // E5
  },
  {
    id: 3,
    label: 'Coral',
    symbol: '■',
    idleBg: '#FFE4E6',
    litBg: '#FB7185',
    border: '#F43F5E',
    freq: 783.99, // G5
  },
];

const SPEED_TIMINGS: Record<SpeedMode, { onMs: number; gapMs: number; label: string }> = {
  devagar: { onMs: 850, gapMs: 360, label: 'Devagar' },
  normal: { onMs: 560, gapMs: 240, label: 'Normal' },
  rapido: { onMs: 340, gapMs: 140, label: 'Rápido' },
};

// 10 phases: 1..6 presses from Phase 1 to 6, then distinct 6-press combinations in Phases 7..10
const PHASE_SEQ_LENGTHS = [1, 2, 3, 4, 5, 6, 6, 6, 6, 6];

function generateDistinctSixCombo(usedKeys: Set<string>): number[] {
  for (let attempt = 0; attempt < 40; attempt++) {
    const seq: number[] = [];
    for (let i = 0; i < 6; i++) {
      seq.push(Math.floor(Math.random() * PADS.length));
    }
    const key = seq.join('-');
    // Ensure a varied, genuinely different 6-press combination
    if (!usedKeys.has(key) && new Set(seq).size >= 3) {
      usedKeys.add(key);
      return seq;
    }
  }
  const fallback = [0, 1, 2, 3, 1, 0];
  usedKeys.add(fallback.join('-'));
  return fallback;
}

export const SimonGame: React.FC<SimonGameProps> = ({ onSelectGame }) => {
  const [speed, setSpeed] = useState<SpeedMode>('normal');
  const [phaseIndex, setPhaseIndex] = useState(0);
  const [sequence, setSequence] = useState<number[]>(() => [Math.floor(Math.random() * PADS.length)]);
  const [playerStep, setPlayerStep] = useState(0);
  const [activePad, setActivePad] = useState<number | null>(null);
  const [phase, setPhase] = useState<'showing' | 'listening' | 'replaying' | 'won'>('showing');
  const [message, setMessage] = useState('Observe a luz que vai acender...');

  const timeoutsRef = useRef<number[]>([]);
  const speedRef = useRef<SpeedMode>(speed);
  const usedSixCombosRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  const clearTimers = useCallback(() => {
    timeoutsRef.current.forEach((id) => window.clearTimeout(id));
    timeoutsRef.current = [];
  }, []);

  const playSequence = useCallback(
    (seq: number[]) => {
      clearTimers();
      setPhase('showing');
      setActivePad(null);
      setPlayerStep(0);

      const { onMs, gapMs } = SPEED_TIMINGS[speedRef.current];
      const stepTotal = onMs + gapMs;

      seq.forEach((padId, index) => {
        const startDelay = 500 + index * stepTotal;

        const tOn = window.setTimeout(() => {
          setActivePad(padId);
          calmAudio.playSimonNote(PADS[padId].freq, onMs / 1000);
        }, startDelay);

        const tOff = window.setTimeout(() => {
          setActivePad(null);
        }, startDelay + onMs);

        timeoutsRef.current.push(tOn, tOff);
      });

      const finishDelay = 500 + seq.length * stepTotal + 120;
      const tDone = window.setTimeout(() => {
        setPhase('listening');
        setMessage('Sua vez! Toque na mesma ordem.');
      }, finishDelay);

      timeoutsRef.current.push(tDone);
    },
    [clearTimers]
  );

  // Trigger sequence playback on mount or when sequence changes
  useEffect(() => {
    if (phase === 'won') return;
    playSequence(sequence);
    return () => clearTimers();
  }, [sequence]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return () => clearTimers();
  }, [clearTimers]);

  const handleRestart = () => {
    clearTimers();
    usedSixCombosRef.current.clear();
    setPhaseIndex(0);
    setPhase('showing');
    setMessage('Observe a luz que vai acender...');
    setSequence([Math.floor(Math.random() * PADS.length)]);
  };

  const handlePadPress = (padId: number) => {
    if (phase !== 'listening') return;

    // Flash pressed pad briefly
    setActivePad(padId);
    calmAudio.playSimonNote(PADS[padId].freq, 0.28);
    window.setTimeout(() => {
      setActivePad((curr) => (curr === padId ? null : curr));
    }, 240);

    const expectedPad = sequence[playerStep];

    if (padId === expectedPad) {
      const nextStep = playerStep + 1;

      if (nextStep >= sequence.length) {
        // Phase complete!
        if (phaseIndex >= PHASE_SEQ_LENGTHS.length - 1) {
          calmAudio.playCelebrate();
          setPhase('replaying');
          setMessage('Incrível! Você completou todas as 10 fases! 🌟');
          const tWin = window.setTimeout(() => {
            setPhase('won');
          }, 850);
          timeoutsRef.current.push(tWin);
          return;
        }

        const nextIdx = phaseIndex + 1;
        const isSixComboPhase = nextIdx >= 6; // Phases 7, 8, 9, 10 (indices 6..9)

        if (phaseIndex === 5) {
          usedSixCombosRef.current.add(sequence.join('-'));
        }

        setPhase('replaying');
        setMessage(
          isSixComboPhase
            ? `Muito bem! Na Fase ${nextIdx + 1} vem uma nova combinação de 6! ✅`
            : 'Muito bem! Agora vem mais uma cor... ✅'
        );
        calmAudio.playSuccess();

        const tNext = window.setTimeout(() => {
          setPhaseIndex(nextIdx);
          setMessage(
            isSixComboPhase
              ? `Fase ${nextIdx + 1}: observe a nova sequência de 6...`
              : 'Observe com atenção...'
          );
          if (isSixComboPhase) {
            setSequence(generateDistinctSixCombo(usedSixCombosRef.current));
          } else {
            setSequence((prev) => [...prev, Math.floor(Math.random() * PADS.length)]);
          }
        }, 1050);
        timeoutsRef.current.push(tNext);
      } else {
        setPlayerStep(nextStep);
      }
    } else {
      // Wrong tap: show sequence again without punishment!
      calmAudio.playTryAgain();
      setPhase('replaying');
      setMessage('Sem problemas! Vamos ver a sequência de novo.');

      const tReplay = window.setTimeout(() => {
        setMessage('Observe a ordem novamente...');
        playSequence(sequence);
      }, 1150);
      timeoutsRef.current.push(tReplay);
    }
  };

  if (phase === 'won') {
    return (
      <div className="py-6 px-4">
        <GameCompletionPanel
          currentGame="simon"
          title="Incrível! Você completou as 10 fases!"
          subtitle={`Você lembrou todas as ${PHASE_SEQ_LENGTHS.length} fases de luzes e sons no seu ritmo.`}
          onReplay={handleRestart}
          onSelectGame={onSelectGame}
        />
      </div>
    );
  }

  const seqLen = PHASE_SEQ_LENGTHS[phaseIndex];

  return (
    <div className="w-full px-3.5 py-4 flex flex-col items-center">
      {/* Phase & Speed Control Row */}
      <div className="w-full flex flex-col items-center gap-2.5 mb-4">
        <div className="text-xs font-semibold text-[#4A6B8C] tabular-nums flex items-center gap-1.5">
          <span>Fase {phaseIndex + 1} de {PHASE_SEQ_LENGTHS.length}</span>
          <span aria-hidden="true">·</span>
          <span>{seqLen} {seqLen === 1 ? 'aperto' : 'apertos'}</span>
        </div>

        {/* Speed Selector */}
        <div className="w-full flex items-center justify-between gap-1 p-1 bg-sky-100/80 border border-sky-200 rounded-2xl">
          <span className="text-[11px] font-semibold text-[#4A6B8C] px-2">Velocidade:</span>
          <div className="flex items-center gap-1">
            {(['devagar', 'normal', 'rapido'] as SpeedMode[]).map((mode) => (
              <TactileButton
                key={mode}
                type="button"
                onClick={() => setSpeed(mode)}
                className={`px-2.5 py-1.5 min-h-[34px] rounded-xl text-xs font-semibold transition-colors whitespace-nowrap ${
                  speed === mode
                    ? 'bg-white text-[#1A365D] shadow-xs'
                    : 'text-[#4A6B8C] hover:text-[#1A365D]'
                }`}
              >
                {SPEED_TIMINGS[mode].label}
              </TactileButton>
            ))}
          </div>
        </div>
      </div>

      {/* Status Message */}
      <div
        role="status"
        aria-live="polite"
        className="w-full mb-4 px-4 py-3 rounded-2xl bg-white border border-sky-200 text-center font-display font-semibold text-sm text-[#1A365D]"
      >
        {message}
      </div>

      {/* 2x2 Tactile Simon Pads (4 buttons) */}
      <div className="grid grid-cols-2 gap-3.5 w-full max-w-[310px] aspect-square">
        {PADS.map((pad) => {
          const isLit = activePad === pad.id;
          return (
            <TactileButton
              key={pad.id}
              type="button"
              silentTap
              disabled={phase !== 'listening'}
              onClick={() => handlePadPress(pad.id)}
              aria-label={`Luz ${pad.label}`}
              className={`rounded-3xl flex flex-col items-center justify-center gap-1.5 transition-all duration-150 disabled:opacity-100 ${
                isLit ? 'scale-[1.03] shadow-lg' : 'shadow-xs hover:brightness-[0.98]'
              }`}
              style={{
                backgroundColor: isLit ? pad.litBg : pad.idleBg,
                border: `3px solid ${pad.border}`,
                color: isLit ? '#FFFFFF' : '#1A365D',
              }}
            >
              <span className="text-4xl select-none" aria-hidden="true">
                {pad.symbol}
              </span>
              <span className="font-display font-bold text-base">
                {pad.label}
              </span>
            </TactileButton>
          );
        })}
      </div>

      {/* Replay Sequence Helper Button */}
      <div className="mt-5">
        <TactileButton
          type="button"
          disabled={phase === 'showing'}
          onClick={() => playSequence(sequence)}
          className="px-5 py-2.5 min-h-[44px] rounded-2xl bg-white hover:bg-sky-50 border border-sky-200 text-xs font-semibold text-[#1A365D]"
        >
          Ver sequência de novo
        </TactileButton>
      </div>
    </div>
  );
};
