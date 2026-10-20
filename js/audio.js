// ANVIL · Rest-timer cues: Web Audio tones + voice clips.
// Classic script (shared global scope, no build step); load order is set in index.html.
let ctx = null;
const clipBuffers = Object.create(null);
let clipsPrefetching = null;
const CLIP_URLS = {
  three: "sounds/three.mp3",
  two: "sounds/two.mp3",
  one: "sounds/one.mp3",
  "go-coach": "sounds/go-coach.mp3",
  "go-aussie": "sounds/go-aussie.mp3",
  "go-rude": "sounds/go-rude.mp3",
  "go-adult": "sounds/go-adult.mp3",
};
const COUNT_CLIP = { 3: "three", 2: "two", 1: "one" };

function unlockAudio(){
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 1, 22050);
      src.connect(ctx.destination);
      src.start(0);
    }
    if (ctx.state === "suspended") ctx.resume();
    prefetchClips();
  } catch { ctx = null; }
}

function prefetchClips(){
  if (!ctx || clipsPrefetching) return clipsPrefetching;
  clipsPrefetching = Promise.all(Object.entries(CLIP_URLS).map(async ([key, url]) => {
    if (clipBuffers[key]) return;
    try {
      const res = await fetch(url);
      if (!res.ok) return;
      const arr = await res.arrayBuffer();
      clipBuffers[key] = await ctx.decodeAudioData(arr.slice(0));
    } catch {}
  })).catch(() => {});
  return clipsPrefetching;
}

/** Soft ADSR tone — sine/triangle, no square-wave beeps. */
function playTone({ freq, dur = 0.14, type = "sine", attack = 0.01, release = 0.1, gain = 0.22, when = 0, slideTo = null }){
  if (!ctx) return;
  const vol = Math.max(0, Math.min(1, Number(state.soundVolume) || 0));
  if (vol <= 0) return;
  const t0 = when > 0 ? when : ctx.currentTime;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slideTo != null) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur * 0.85);
  const peak = Math.max(0.0001, Math.min(CUE_MAX_GAIN, vol * gain * CUE_LOUDNESS));
  const atk = Math.max(0.004, attack);
  const rel = Math.max(atk + 0.02, dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + atk);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + rel);
  o.connect(g); g.connect(ctx.destination);
  o.start(t0);
  o.stop(t0 + rel + 0.03);
}

function playTick(n, toneStyle){
  // Rising mid ticks for 3→2→1
  const base = { 3: 660, 2: 740, 1: 830 }[n] || 700;
  if (toneStyle === "pulse") {
    playTone({ freq: base * 0.45, dur: 0.11, type: "triangle", attack: 0.006, release: 0.1, gain: 0.32 });
    playTone({ freq: base * 0.9, dur: 0.08, type: "sine", attack: 0.004, release: 0.07, gain: 0.12 });
  } else if (toneStyle === "bell") {
    playTone({ freq: base * 1.15, dur: 0.1, type: "sine", attack: 0.005, release: 0.12, gain: 0.19 });
    playTone({ freq: base * 2.3, dur: 0.08, type: "sine", attack: 0.004, release: 0.09, gain: 0.08 });
  } else {
    // chime (default)
    playTone({ freq: base, dur: 0.1, type: "sine", attack: 0.008, release: 0.09, gain: 0.21 });
  }
}

function playEndChime(toneStyle, { soft = false } = {}){
  const t0 = ctx ? ctx.currentTime : 0;
  const gScale = soft ? 0.55 : 1;
  if (toneStyle === "pulse") {
    playTone({ freq: 140, dur: 0.22, type: "triangle", attack: 0.01, release: 0.2, gain: 0.36 * gScale, when: t0 });
    playTone({ freq: 220, dur: 0.28, type: "sine", attack: 0.012, release: 0.24, gain: 0.25 * gScale, when: t0 + 0.1 });
    playTone({ freq: 330, dur: 0.35, type: "sine", attack: 0.015, release: 0.3, gain: 0.21 * gScale, when: t0 + 0.22 });
  } else if (toneStyle === "bell") {
    playTone({ freq: 880, dur: 0.45, type: "sine", attack: 0.004, release: 0.42, gain: 0.23 * gScale, when: t0 });
    playTone({ freq: 1320, dur: 0.35, type: "sine", attack: 0.004, release: 0.32, gain: 0.12 * gScale, when: t0 });
    playTone({ freq: 1760, dur: 0.25, type: "sine", attack: 0.003, release: 0.22, gain: 0.06 * gScale, when: t0 + 0.02 });
    playTone({ freq: 1046, dur: 0.4, type: "sine", attack: 0.006, release: 0.36, gain: 0.16 * gScale, when: t0 + 0.16 });
  } else {
    // Warm ascending three-note chime (Strong/Hevy-ish)
    playTone({ freq: 523.25, dur: 0.18, type: "sine", attack: 0.01, release: 0.16, gain: 0.23 * gScale, when: t0 });
    playTone({ freq: 659.25, dur: 0.2, type: "sine", attack: 0.01, release: 0.18, gain: 0.23 * gScale, when: t0 + 0.12 });
    playTone({ freq: 783.99, dur: 0.32, type: "sine", attack: 0.012, release: 0.28, gain: 0.25 * gScale, when: t0 + 0.26 });
  }
}

function playClip(key){
  const vol = Math.max(0, Math.min(1, Number(state.soundVolume) || 0));
  if (!key || vol <= 0) return;
  const buf = clipBuffers[key];
  if (ctx && buf) {
    try {
      const src = ctx.createBufferSource();
      const g = ctx.createGain();
      g.gain.value = Math.min(CUE_MAX_GAIN, vol * CUE_LOUDNESS);
      src.buffer = buf;
      src.connect(g); g.connect(ctx.destination);
      src.start(0);
      return;
    } catch {}
  }
  // Element fallback if buffer not ready (still real file — not speechSynthesis)
  try {
    const url = CLIP_URLS[key];
    if (!url) return;
    const a = new Audio(url);
    a.volume = Math.min(CUE_MAX_GAIN, vol * CUE_LOUDNESS);
    a.play().catch(() => {});
  } catch {}
}

const CUE_PACKS = {
  chime:  { id:"chime",  name:"Chime",  blurb:"Soft ticks + warm ascending chime", kind:"tone", tone:"chime" },
  pulse:  { id:"pulse",  name:"Pulse",  blurb:"Deep thud ticks + strong end pulse", kind:"tone", tone:"pulse" },
  bell:   { id:"bell",   name:"Bell",   blurb:"Bright bell-like end alert", kind:"tone", tone:"bell" },
  coach:  { id:"coach",  name:"Coach",  blurb:"Aussie coach · Three · Two · One · Go time", kind:"voice", goClip:"go-coach", tone:"chime" },
  aussie: { id:"aussie", name:"Aussie", blurb:"Three · Two · One · Have a go", kind:"voice", goClip:"go-aussie", tone:"chime" },
  rude:   { id:"rude",   name:"Rude",   blurb:"Three · Two · One · Get into it", kind:"voice", goClip:"go-rude", tone:"chime" },
  adult:  { id:"adult",  name:"18+",    blurb:"Three · Two · One · Get fuckin' stuck in", kind:"voice", goClip:"go-adult", tone:"chime" },
};
const CUE_PACK_ALIASES = {
  classic: "chime",
  beeps: "chime",
  calm: "chime",
  drive: "aussie",
};

function getCuePack(){
  return CUE_PACKS[state.cuePack] || CUE_PACKS.chime;
}

function cueCountdown(n){
  const pack = getCuePack();
  playTick(n, pack.tone || "chime");
  if (pack.kind === "voice") {
    const clip = COUNT_CLIP[n];
    if (clip) playClip(clip);
  }
}

function cueComplete(){
  const pack = getCuePack();
  if (pack.kind === "voice") {
    if (pack.goClip) playClip(pack.goClip);
    // Light chime tail under the voice
    setTimeout(() => playEndChime(pack.tone || "chime", { soft: true }), 180);
  } else {
    playEndChime(pack.tone || "chime");
  }
}

function previewSound(){
  unlockAudio();
  const pack = getCuePack();
  toast(pack.name, pack.kind === "voice" ? "3 · 2 · 1 · voice Go" : "3 · 2 · 1 · chime");
  const steps = [
    () => cueCountdown(3),
    () => cueCountdown(2),
    () => cueCountdown(1),
    () => {
      cueComplete();
      if (navigator.vibrate) navigator.vibrate([120, 60, 120]);
    },
  ];
  steps.forEach((fn, i) => setTimeout(fn, i * 750));
}
