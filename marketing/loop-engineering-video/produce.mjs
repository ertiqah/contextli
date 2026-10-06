// Final audio mix + mux for the loop-engineering videos (landscape and vertical cuts).
//
//   node produce.mjs                          # music + SFX (music from audio/cache, or generated if ELEVENLABS_API_KEY is set)
//   node produce.mjs concept-1-ten-terminals  # one concept
//   WITH_VO=1 ELEVENLABS_API_KEY=... node produce.mjs   # also add the ElevenLabs voiceover (off by default)
//
// In the cloud sandbox prefix NODE_USE_ENV_PROXY=1 so Node's fetch goes through the egress proxy.
// Optional env: ELEVENLABS_VOICE_ID, ELEVENLABS_FORMAT, MUSIC_DB / VO_DB / SFX_DB (stem loudness, LUFS).
// Needs Node 18+ and ffmpeg/ffprobe on PATH. Generated VO/music is cached in audio/cache/ (re-runs cost nothing).
// Inputs: out/<concept>.mp4 and out/<concept>-vertical.mp4 (silent picture, from render.cjs), audio/sfx/<concept>.wav (from audio/sfx.py).
// Outputs: out/final/<concept>.mp4, out/final/<concept>-vertical.mp4 (+ .srt when WITH_VO=1)
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const CUES = JSON.parse(readFileSync(path.join(DIR, 'audio/cues.json'), 'utf8'));
const KEY = process.env.ELEVENLABS_API_KEY;
const API = 'https://api.elevenlabs.io/v1';
const FMT = process.env.ELEVENLABS_FORMAT || 'mp3_44100_128'; // 192k needs the Creator tier
const CACHE = path.join(DIR, 'audio/cache');
const OUT = path.join(DIR, 'out/final');
const WITH_VO = !!process.env.WITH_VO;
// Stem loudness (LUFS). Without a voice the music carries the cut, so it sits higher.
const TARGET = WITH_VO
  ? { vo: +(process.env.VO_DB ?? -16), music: +(process.env.MUSIC_DB ?? -23), sfx: +(process.env.SFX_DB ?? -24), master: -14 }
  : { music: +(process.env.MUSIC_DB ?? -17), sfx: +(process.env.SFX_DB ?? -21), master: -14 };
mkdirSync(CACHE, { recursive: true }); mkdirSync(OUT, { recursive: true });

const sha = s => createHash('sha1').update(s).digest('hex').slice(0, 12);
const ff = args => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'inherit', 'inherit'] });
const durationOf = f => +execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim();
function lufs(f) {
  const err = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', f, '-af', 'ebur128', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
  const m = [...err.matchAll(/I:\s+(-?[\d.]+) LUFS/g)].pop();
  return m ? +m[1] : -70;
}

async function eleven(pathname, body, out) {
  if (existsSync(out)) return out;
  const res = await fetch(API + pathname, { method: 'POST', headers: { 'xi-api-key': KEY, 'content-type': 'application/json', accept: 'audio/mpeg' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${pathname} → ${res.status} ${await res.text()}`);
  writeFileSync(out, Buffer.from(await res.arrayBuffer()));
  return out;
}

async function voiceLines(c) {
  const v = CUES.voice, voice = process.env.ELEVENLABS_VOICE_ID || v.voice_id;
  const files = [];
  for (let i = 0; i < c.vo.length; i++) {
    const line = c.vo[i];
    const body = { text: line.text, model_id: v.model_id, voice_settings: v.voice_settings,
      previous_text: c.vo[i - 1]?.text, next_text: c.vo[i + 1]?.text };
    const f = path.join(CACHE, `vo-${sha(voice + JSON.stringify(body))}.mp3`);
    await eleven(`/text-to-speech/${voice}?output_format=${FMT}`, body, f);
    const d = durationOf(f), room = line.end - line.t;
    const tempo = Math.min(1.15, Math.max(1, d / room));
    if (d / tempo > room + 0.05) console.warn(`  ! "${line.text}" runs ${(d / tempo - room).toFixed(2)}s past its window`);
    // never let a line step on the previous one: nudge it later if needed
    const prev = files[files.length - 1], t = prev ? Math.max(line.t, prev.t + prev.dur + 0.12) : line.t;
    if (t > line.t + 0.01) console.warn(`  ~ "${line.text}" starts ${(t - line.t).toFixed(2)}s late to clear the previous line`);
    files.push({ ...line, t, file: f, tempo, dur: d / tempo });
  }
  console.log(files.map(v => `    ${v.t.toFixed(2)}–${(v.t + v.dur).toFixed(2)}s  x${v.tempo.toFixed(2)}  ${v.text}`).join('\n'));
  return files;
}

async function music(name, c) {
  const m = c.music;
  const plan = {
    positive_global_styles: m.global, negative_global_styles: m.negative,
    sections: m.sections.map(s => ({ section_name: s.name, positive_local_styles: s.styles, negative_local_styles: [], duration_ms: s.ms, lines: [] })),
  };
  const f = path.join(CACHE, `music-${name}-${sha(JSON.stringify(plan))}.mp3`);
  try {
    return await eleven(`/music?output_format=${FMT}`, { composition_plan: plan, model_id: 'music_v1' }, f);
  } catch (e) {
    console.warn('  composition plan rejected, falling back to a text prompt:', e.message.slice(0, 160));
    const prompt = `${m.global.join(', ')}. ` + m.sections.map(s => `${s.name} (${s.ms / 1000}s): ${s.styles.join(', ')}`).join('. ') + `. Avoid: ${m.negative.join(', ')}.`;
    return eleven(`/music?output_format=${FMT}`, { prompt, music_length_ms: Math.round(c.duration * 1000), model_id: 'music_v1', force_instrumental: true }, f);
  }
}

const srtTime = s => { const ms = Math.round(s * 1000); const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, sec = Math.floor(ms / 1000) % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`; };

async function produce(name) {
  const c = CUES.concepts[name], D = c.duration;
  const sfx = path.join(DIR, 'audio/sfx', `${name}.wav`);
  const videos = ['', '-vertical'].map(v => path.join(DIR, 'out', `${name}${v}.mp4`)).filter(existsSync);
  if (!videos.length || !existsSync(sfx)) throw new Error(`missing picture for ${name} or ${sfx}`);
  console.log(`\n${name}`);
  const vo = WITH_VO && KEY ? await voiceLines(c) : null;
  const mus = await music(name, c).catch(e => (console.warn('  no music:', e.message.slice(0, 140)), null));

  // Static per-stem gains so each stem sits at its target loudness before the mix.
  const gain = (f, target) => `${(target - lufs(f)).toFixed(2)}dB`;
  const inputs = ['-i', sfx];
  const graph = [`[0:a]aresample=48000,volume=${gain(sfx, TARGET.sfx)},apad,atrim=0:${D}[sfx]`];
  const mixIns = ['[sfx]'];
  const musChain = m => `[${m}:a]aresample=48000,aformat=channel_layouts=stereo,volume=${gain(mus, TARGET.music)},volume='${c.music_gain || 1}':eval=frame,apad,atrim=0:${D},afade=t=in:d=0.3,afade=t=out:st=${D - 2.2}:d=2.2`;

  if (vo) {
    // build the VO stem first so we can measure it as one track
    const voStem = path.join(CACHE, `vostem-${name}-${sha(JSON.stringify(vo.map(v => [v.file, v.t, v.tempo])))}.wav`);
    if (!existsSync(voStem)) {
      const vin = vo.flatMap(v => ['-i', v.file]);
      const vg = vo.map((v, i) => `[${i}:a]aresample=48000,aformat=channel_layouts=stereo,atempo=${v.tempo.toFixed(3)},adelay=${Math.round(v.t * 1000)}:all=1[v${i}]`);
      vg.push(`${vo.map((_, i) => `[v${i}]`).join('')}amix=inputs=${vo.length}:normalize=0:duration=longest,apad,atrim=0:${D}[vo]`);
      ff([...vin, '-filter_complex', vg.join(';'), '-map', '[vo]', '-ar', '48000', voStem]);
    }
    inputs.push('-i', voStem);
    graph.push(`[1:a]aresample=48000,volume=${gain(voStem, TARGET.vo)},asplit=2[vo][vokey]`);
    mixIns.push('[vo]');
    if (mus) {
      inputs.push('-i', mus);
      graph.push(`${musChain(2)}[mraw]`, `[mraw][vokey]sidechaincompress=threshold=0.03:ratio=5:attack=25:release=450:makeup=1[mus]`); // duck ~6 dB under the voice
      mixIns.push('[mus]');
    } else graph.push('[vokey]anullsink');
  } else if (mus) {
    inputs.push('-i', mus);
    graph.push(`${musChain(1)}[mus]`);
    mixIns.push('[mus]');
  }
  graph.push(`${mixIns.join('')}amix=inputs=${mixIns.length}:normalize=0:duration=first[mix]`);
  // master: static gain to target, then a true-peak limiter
  const pre = path.join(CACHE, `premaster-${name}.wav`);
  ff([...inputs, '-filter_complex', graph.join(';'), '-map', '[mix]', '-ar', '48000', '-t', String(D), pre]);
  const master = `volume=${(TARGET.master - lufs(pre)).toFixed(2)}dB,alimiter=limit=0.89:level=false:attack=3:release=60`;
  const what = [vo && 'VO', mus && 'music', 'SFX'].filter(Boolean).join(' + ');
  for (const video of videos) {
    const dst = path.join(OUT, path.basename(video));
    ff(['-i', video, '-i', pre, '-filter_complex', `[1:a]${master}[a]`, '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-t', String(D), '-movflags', '+faststart', dst]);
    console.log(`  wrote ${path.relative(DIR, dst)}  (${what}), master ${lufs(dst).toFixed(1)} LUFS`);
  }

  // captions from the VO script, only when there is a voice (the story is already on screen)
  if (vo) writeFileSync(path.join(OUT, `${name}.srt`), vo.map((v, i) => `${i + 1}\n${srtTime(v.t)} --> ${srtTime(v.t + v.dur)}\n${v.text}\n`).join('\n'));
}

const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(CUES.concepts);
for (const n of names) await produce(n);
