// ---- Ambience ----
//
// Background sound on loop while focusing. Rain, waves and fireplace are
// made in the browser from noise; cafe and nature play recordings from
// the sounds folder. One plays at a time.
//
//   ToolkitSounds.play("rain")   start (or switch to) an ambience
//   ToolkitSounds.stopAmbience() stop it
//   ToolkitSounds.setVolume(0.5) change the volume while it plays
//   ToolkitSounds.current()      the name playing, or null
//
// The chosen volume is kept with the focus settings ("focus-settings").
// The left sidebar shows a small icon while ambience plays.

(function () {
  "use strict";

  const SETTINGS_KEY = "focus-settings";
  const NAMES = ["cafe", "fireplace", "nature", "rain", "waves"];
  // Recordings sit in the sounds folder beside this script
  const BASE = new URL(".", document.currentScript.src);
  const FILES = {
    cafe: new URL("sounds/cafe.ogg", BASE).href,
    nature: new URL("sounds/nature.ogg", BASE).href
  };

  let ctx = null, master = null, playing = null, stopFns = [];
  const listeners = [];

  function settings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; }
    catch { return {}; }
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
      master.connect(ctx.destination);
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  // Seconds of looping noise: white, or brown (deeper, like distant surf)
  function noise(kind, seconds = 4) {
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

  // A slow wobble on a value: [node.param, centre, depth, seconds per cycle]
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

  const MAKERS = {
    // Steady hiss, plus a brighter patter that rises and falls
    rain() {
      const hiss = noise("white"), patter = noise("white");
      chain(hiss, filter("lowpass", 5200), filter("highpass", 500), gain(0.32), master);
      const pg = gain(0.12);
      chain(patter, filter("bandpass", 3200, 0.9), pg, master);
      wobble(pg.gain, 0.12, 0.05, 7);
      hiss.start();
      patter.start();
      stopFns.push(() => { hiss.stop(); patter.stop(); });
    },
    // Deep surf that swells and draws back every 9 seconds
    waves() {
      const surf = noise("brown", 6), spray = noise("white", 4);
      const sg = gain(0.6), lp = filter("lowpass", 700);
      chain(surf, lp, sg, master);
      wobble(sg.gain, 0.55, 0.45, 9);
      wobble(lp.frequency, 700, 350, 9);
      const fg = gain(0.04);
      chain(spray, filter("highpass", 2500), fg, master);
      wobble(fg.gain, 0.04, 0.035, 9);
      surf.start();
      spray.start();
      stopFns.push(() => { surf.stop(); spray.stop(); });
    },
    // A low rumble with random crackles
    fireplace() {
      const rumble = noise("brown", 5);
      chain(rumble, filter("lowpass", 320), gain(0.55), master);
      rumble.start();
      const crackle = noise("white", 2);
      const env = gain(0);
      chain(crackle, filter("bandpass", 2600, 1.2), env, master);
      crackle.start();
      let timer = 0;
      const pop = () => {
        const at = ctx.currentTime, size = 0.15 + Math.random() * 0.5;
        env.gain.cancelScheduledValues(at);
        env.gain.setValueAtTime(size, at);
        env.gain.exponentialRampToValueAtTime(0.0001, at + 0.02 + Math.random() * 0.05);
        timer = setTimeout(pop, 40 + Math.random() * (Math.random() < 0.2 ? 900 : 260));
      };
      pop();
      stopFns.push(() => { clearTimeout(timer); rumble.stop(); crackle.stop(); });
    }
  };

  // Cafe and nature: a recording on loop, through the same volume
  function playFile(name) {
    const el = new Audio(FILES[name]);
    el.loop = true;
    const src = ctx.createMediaElementSource(el);
    src.connect(master);
    el.play().catch(() => stopAmbience());
    stopFns.push(() => { el.pause(); el.src = ""; });
  }

  function notify() {
    if (window.ToolkitSidebar && ToolkitSidebar.setAmbience) {
      ToolkitSidebar.setAmbience(playing);
    }
    listeners.forEach(fn => fn(playing));
  }

  function stopNodes() {
    stopFns.forEach(fn => { try { fn(); } catch {} });
    stopFns = [];
  }

  function play(name) {
    if (!NAMES.includes(name)) return;
    audio();
    stopNodes();
    // A short fade in, to avoid a click
    const at = ctx.currentTime;
    master.gain.cancelScheduledValues(at);
    master.gain.setValueAtTime(0, at);
    master.gain.linearRampToValueAtTime(volume(), at + 0.6);
    if (FILES[name]) playFile(name);
    else MAKERS[name]();
    playing = name;
    notify();
  }

  function stopAmbience() {
    if (!playing) return;
    const at = ctx.currentTime;
    master.gain.cancelScheduledValues(at);
    master.gain.setValueAtTime(master.gain.value, at);
    master.gain.linearRampToValueAtTime(0, at + 0.3);
    const fns = stopFns;
    stopFns = [];
    setTimeout(() => fns.forEach(fn => { try { fn(); } catch {} }), 350);
    playing = null;
    notify();
  }

  function setVolume(v) {
    if (!ctx || !playing) return;
    const at = ctx.currentTime;
    master.gain.cancelScheduledValues(at);
    master.gain.setTargetAtTime(Math.min(1, Math.max(0, v)), at, 0.05);
  }

  window.ToolkitSounds = {
    current: () => playing,
    names: NAMES,
    onChange: fn => listeners.push(fn),
    play,
    setVolume,
    stopAmbience
  };
})();
