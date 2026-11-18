// A short notification chime for «Mi pedido». Browsers only allow sound after a user gesture, so
// nothing plays until the page has seen one; the mute switch is kept in localStorage, which can
// be missing or throw (private window, blocked data), so every access is guarded.

const KEY = "unifood.client.orderSound";

export function readMuted(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "off";
  } catch {
    return false;
  }
}

export function writeMuted(muted: boolean) {
  try {
    if (muted) window.localStorage.setItem(KEY, "off");
    else window.localStorage.removeItem(KEY);
  } catch {
    // The choice then lasts only until the page closes.
  }
}

type AudioWindow = Window & { webkitAudioContext?: typeof AudioContext };

let context: AudioContext | null = null;

function unlock() {
  if (context) return;
  const Context =
    window.AudioContext ?? (window as AudioWindow).webkitAudioContext;
  if (!Context) return;
  try {
    context = new Context();
    void context.resume();
  } catch {
    context = null;
  }
}

/**
 * Starts listening for the first gesture (or uses the one the page already had) and returns
 * the cleanup. Until then `playChime` stays silent instead of failing.
 */
export function armChime(): () => void {
  if (typeof window === "undefined") return () => undefined;
  if (navigator.userActivation?.hasBeenActive) unlock();
  if (context) return () => undefined;
  const events = ["pointerdown", "keydown", "touchstart"] as const;
  const onGesture = () => {
    unlock();
    if (context) off();
  };
  const off = () =>
    events.forEach((name) => window.removeEventListener(name, onGesture));
  events.forEach((name) =>
    window.addEventListener(name, onGesture, { passive: true }),
  );
  return off;
}

/** Two soft notes. Returns false when the browser has not allowed sound yet. */
export function playChime(): boolean {
  if (!context || context.state === "closed") return false;
  try {
    void context.resume();
    const now = context.currentTime;
    [
      { frequency: 880, start: 0 },
      { frequency: 1174.66, start: 0.18 },
    ].forEach(({ frequency, start }) => {
      const oscillator = context!.createOscillator();
      const gain = context!.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, now + start);
      gain.gain.exponentialRampToValueAtTime(0.18, now + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + start + 0.4);
      oscillator.connect(gain).connect(context!.destination);
      oscillator.start(now + start);
      oscillator.stop(now + start + 0.45);
    });
    return true;
  } catch {
    return false;
  }
}
