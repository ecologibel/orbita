// ---- Ambience ----
//
// Background sound on loop while focusing. Café, fire, nature and rain
// play recordings from the sounds folder (sources in sounds/README.md);
// waves is made in the browser from noise. One plays at a time.
//
//   ToolkitSounds.play("rain")   start (or switch to) an ambience
//   ToolkitSounds.play()         start the last one played
//   ToolkitSounds.stopAmbience() stop it (fadeOut(s) stops it slowly)
//   ToolkitSounds.setVolume(0.5) change the volume while it plays
//   ToolkitSounds.current()      the name playing, or null
//   ToolkitSounds.label("cafe")  "café", for showing
//
// The volume and last sound are kept with the focus settings
// ("focus-settings"). Each sound has a level that brings it to about the
// same loudness, so the volume slider means the same for all of them.

(function () {
  "use strict";

  // Inside the app shell, use the shell's player, which stays open while
  // pages change, so ambience keeps playing
  try {
    if (window.parent !== window && window.parent.ToolkitSounds) {
      window.ToolkitSounds = window.parent.ToolkitSounds;
      return;
    }
  } catch {}

  const SETTINGS_KEY = "focus-settings";
  const NAMES = ["cafe", "fireplace", "nature", "rain", "waves"];
  const LABELS = { cafe: "café", fireplace: "fire", nature: "nature",
    rain: "rain", waves: "waves" };
  // Gain for each sound, measured so they start at a similar loudness
  // (fire and rain are quiet recordings; a limiter catches their peaks)
  const LEVELS = { cafe: 0.54, fireplace: 5.2, nature: 15, rain: 2.1,
    waves: 0.31 };
  // The loudest the volume slider goes, the same for every sound
  const MAX_GAIN = 0.4;

  // Recordings sit in the sounds folder beside this script
  const BASE = new URL(".", document.currentScript.src);
  const FILES = {
    cafe: new URL("sounds/cafe.ogg", BASE).href,
    fireplace: new URL("sounds/fire.ogg", BASE).href,
    nature: new URL("sounds/bushland.webm", BASE).href,
    rain: new URL("sounds/rain.mp3", BASE).href
  };

  let ctx = null, master = null, meterNode = null, playing = null;
  let stopFns = [];
  const listeners = [];

  function settings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; }
    catch { return {}; }
  }

  function saveSetting(patch) {
    try {
      localStorage.setItem(SETTINGS_KEY,
        JSON.stringify(Object.assign(settings(), patch)));
    } catch {}
  }

  function volume() {
    const v = settings().ambienceVolume;
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.5;
  }

  function audio() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0;
      meterNode = ctx.createAnalyser();
      meterNode.fftSize = 2048;
      // A limiter, so raised quiet recordings never clip on loud moments
      const limit = ctx.createDynamicsCompressor();
      limit.threshold.value = -6;
      limit.knee.value = 3;
      limit.ratio.value = 20;
      limit.attack.value = 0.003;
      limit.release.value = 0.25;
      master.connect(limit);
      limit.connect(ctx.destination);
      limit.connect(meterNode);
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  // ---- Waves, made from noise ----

  // Seconds of looping brown noise (deeper, like distant surf) or white
  function noise(kind, seconds) {
    const len = ctx.sampleRate * seconds;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === "brown") {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      } else {
        d[i] = w;
      }
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    return src;
  }

  function filter(type, freq, q = 0.7) {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  function gain(v) {
    const g = ctx.createGain();
    g.gain.value = v;
    return g;
  }

  // A slow wobble on a value: [param, centre, depth, seconds per cycle]
  function wobble(param, centre, depth, period) {
    const lfo = ctx.createOscillator(), amt = gain(depth);
    lfo.frequency.value = 1 / period;
    param.value = centre;
    lfo.connect(amt);
    amt.connect(param);
    lfo.start();
    stopFns.push(() => lfo.stop());
  }

  function chain(...nodes) {
    for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
    return nodes[nodes.length - 1];
  }

  // Deep surf that swells and draws back every 9 seconds
  function waves(out) {
    const surf = noise("brown", 6), spray = noise("white", 4);
    const sg = gain(0.6), lp = filter("lowpass", 700);
    chain(surf, lp, sg, out);
    wobble(sg.gain, 0.55, 0.45, 9);
    wobble(lp.frequency, 700, 350, 9);
    const fg = gain(0.04);
    chain(spray, filter("highpass", 2500), fg, out);
    wobble(fg.gain, 0.04, 0.035, 9);
    surf.start();
    spray.start();
    stopFns.push(() => { surf.stop(); spray.stop(); });
  }

  // ---- Recordings ----

  // A recording on loop, through the same volume
  function playFile(name, out) {
    const el = new Audio(FILES[name]);
    el.loop = true;
    const src = ctx.createMediaElementSource(el);
    src.connect(out);
    el.play().catch(() => stopAmbience());
    stopFns.push(() => { el.pause(); el.src = ""; });
  }

  // ---- Playing ----

  // Tell this page's sidebar, and the page in the shell's frame, so the
  // sidebar's ambience controls follow
  function notify() {
    const wins = [window];
    document.querySelectorAll("iframe").forEach(f => {
      try { if (f.contentWindow) wins.push(f.contentWindow); } catch {}
    });
    wins.forEach(w => {
      try {
        if (w.ToolkitSidebar && w.ToolkitSidebar.setAmbience) {
          w.ToolkitSidebar.setAmbience(playing);
        }
      } catch {}
    });
    listeners.slice().forEach(fn => { try { fn(playing); } catch {} });
  }

  function stopNodes() {
    stopFns.forEach(fn => { try { fn(); } catch {} });
    stopFns = [];
  }

  function last() {
    return NAMES.includes(settings().ambience) ? settings().ambience : "rain";
  }

  function play(name) {
    name = name || last();
    if (!NAMES.includes(name)) return;
    audio();
    stopNodes();
    // A short fade in, to avoid a click
    const at = ctx.currentTime;
    master.gain.cancelScheduledValues(at);
    master.gain.setValueAtTime(0, at);
    master.gain.linearRampToValueAtTime(volume() * MAX_GAIN, at + 0.6);
    const level = gain(LEVELS[name]);
    level.connect(master);
    stopFns.push(() => level.disconnect());
    if (FILES[name]) playFile(name, level);
    else waves(level);
    playing = name;
    saveSetting({ ambience: name });
    notify();
  }

  // Stop, fading out over the given seconds
  function fadeOut(seconds) {
    if (!playing) return;
    const at = ctx.currentTime;
    master.gain.cancelScheduledValues(at);
    master.gain.setValueAtTime(master.gain.value, at);
    master.gain.linearRampToValueAtTime(0, at + seconds);
    const fns = stopFns;
    stopFns = [];
    setTimeout(() => fns.forEach(fn => { try { fn(); } catch {} }),
      seconds * 1000 + 50);
    playing = null;
    notify();
  }

  function stopAmbience() {
    fadeOut(0.3);
  }

  function setVolume(v) {
    v = Math.min(1, Math.max(0, v));
    saveSetting({ ambienceVolume: v });
    if (!ctx || !playing) return;
    const at = ctx.currentTime;
    master.gain.cancelScheduledValues(at);
    master.gain.setTargetAtTime(v * MAX_GAIN, at, 0.05);
  }

  // Loudness of what's playing now (root mean square, 0 to 1)
  function meter() {
    if (!meterNode) return 0;
    const d = new Float32Array(meterNode.fftSize);
    meterNode.getFloatTimeDomainData(d);
    let sum = 0;
    for (let i = 0; i < d.length; i++) sum += d[i] * d[i];
    return Math.sqrt(sum / d.length);
  }

  window.ToolkitSounds = {
    current: () => playing,
    fadeOut,
    label: name => LABELS[name] || name,
    last,
    meter,
    names: NAMES,
    onChange: fn => listeners.push(fn),
    // A page that leaves the shell's frame stops listening
    offChange: fn => {
      const i = listeners.indexOf(fn);
      if (i !== -1) listeners.splice(i, 1);
    },
    play,
    setVolume,
    stopAmbience
  };
})();
