import { useEffect, useState } from 'react';
import { useT, type TKey } from './i18n';
import coffee from './assets/pet/coffee.png';
import sleep from './assets/pet/sleep.png';
import teach from './assets/pet/teach.png';

/** The desk sprite (pixel art from PixelLab): 8 frames of 64×64 per state, shown at twice the size. */
const SHEETS = { teach, coffee, sleep } as const;
type Mood = keyof typeof SHEETS;
const FRAME_MS: Record<Mood, number> = { teach: 140, coffee: 180, sleep: 260 };

/** No mouse or keyboard for this long: the sprite falls asleep. */
const SLEEP_AFTER_MS = 5 * 60_000;
/** A turn that never reported its end (a crashed window, say) stops counting as work after this. */
const STALE_MS = 10 * 60_000;

/**
 * What the app is doing, as the sprite shows it: at the chalkboard while an agent or a pipeline run is
 * working, with a coffee otherwise, asleep when the tutor has been away.
 */
function useMood(): Mood {
  const [working, setWorking] = useState(false);
  const [away, setAway] = useState(false);

  useEffect(() => {
    const active = new Map<string, number>();
    const update = () => {
      const now = Date.now();
      for (const [id, at] of active) if (now - at > STALE_MS) active.delete(id);
      setWorking(active.size > 0);
    };
    const offThreads = window.tutordesk.threads.onEvent((id, ev) => {
      if (ev.type === 'turn_end') active.delete(`t:${id}`);
      else active.set(`t:${id}`, Date.now());
      update();
    });
    const offRuns = window.tutordesk.runs.onEvent((id, ev) => {
      if (ev.type === 'finished') active.delete(`r:${id}`);
      else active.set(`r:${id}`, Date.now());
      update();
    });
    const timer = setInterval(update, 30_000);
    return () => {
      offThreads();
      offRuns();
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let timer = setTimeout(() => setAway(true), SLEEP_AFTER_MS);
    const wake = () => {
      clearTimeout(timer);
      setAway(false);
      timer = setTimeout(() => setAway(true), SLEEP_AFTER_MS);
    };
    const events = ['pointermove', 'keydown', 'wheel'] as const;
    for (const e of events) window.addEventListener(e, wake, { passive: true });
    return () => {
      clearTimeout(timer);
      for (const e of events) window.removeEventListener(e, wake);
    };
  }, []);

  return working ? 'teach' : away ? 'sleep' : 'coffee';
}

function useFrame(mood: Mood): number {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    setFrame(0);
    // Reduced motion: a still picture of the current state.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const h = setInterval(() => setFrame((f) => (f + 1) % 8), FRAME_MS[mood]);
    return () => clearInterval(h);
  }, [mood]);
  return frame;
}

export function Pet() {
  const t = useT();
  const mood = useMood();
  const frame = useFrame(mood);
  const label = t(`pet.${mood}` as TKey);
  return (
    <div data-testid="pet" data-mood={mood} className="flex justify-center pb-2" title={label}>
      <div
        role="img"
        aria-label={label}
        className="h-32 w-32"
        style={{ backgroundImage: `url(${SHEETS[mood]})`, backgroundSize: '1024px 128px', backgroundPosition: `-${frame * 128}px 0`, imageRendering: 'pixelated' }}
      />
    </div>
  );
}
