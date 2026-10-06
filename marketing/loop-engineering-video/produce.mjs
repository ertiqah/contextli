// Final audio mix + mux for the loop-engineering videos.
//
//   ELEVENLABS_API_KEY=... node produce.mjs                 # all concepts, VO + music + SFX
//   ELEVENLABS_API_KEY=... node produce.mjs concept-1-ten-terminals
//   node produce.mjs                                         # no key: SFX-only cut
//
// Optional env: ELEVENLABS_VOICE_ID (default from audio/cues.json), MUSIC_DB / VO_DB / SFX_DB (stem loudness, LUFS).
// Needs Node 18+ and ffmpeg/ffprobe on PATH. Generated VO/music is cached in audio/cache/ (re-runs cost nothing).
// Inputs: out/<concept>.mp4 (silent picture, from render.cjs) and audio/sfx/<concept>.wav (from audio/sfx.py).
// Outputs: out/final/<concept>.mp4 and out/final/<concept>.srt
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const CUES = JSON.parse(readFileSync(path.join(DIR, 'audio/cues.json'), 'utf8'));
const KEY = process.env.ELEVENLABS_API_KEY;
const API = 'https://api.elevenlabs.io/v1';
const CACHE = path.join(DIR, 'audio/cache');
const OUT = path.join(DIR, 'out/final');
const TARGET = { vo: +(process.env.VO_DB ?? -16), music: +(process.env.MUSIC_DB ?? -23), sfx: +(process.env.SFX_DB ?? -24), master: -14 };
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
    await eleven(`/text-to-speech/${voice}?output_format=mp3_44100_192`, body, f);
    const d = durationOf(f), room = line.end - line.t;
    const tempo = Math.min(1.15, Math.max(1, d / room));
    if (d / tempo > room + 0.05) console.warn(`  ! "${line.text}" runs ${(d / tempo - room).toFixed(2)}s past its window`);
    files.push({ ...line, file: f, tempo, dur: d / tempo });
  }
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
    return await eleven('/music?output_format=mp3_44100_192', { composition_plan: plan, model_id: 'music_v1' }, f);
  } catch (e) {
    console.warn('  composition plan rejected, falling back to a text prompt:', e.message.slice(0, 160));
    const prompt = `${m.global.join(', ')}. ` + m.sections.map(s => `${s.name} (${s.ms / 1000}s): ${s.styles.join(', ')}`).join('. ') + `. Avoid: ${m.negative.join(', ')}.`;
    return eleven('/music?output_format=mp3_44100_192', { prompt, music_length_ms: Math.round(c.duration * 1000), model_id: 'music_v1', force_instrumental: true }, f);
  }
}

const srtTime = s => { const ms = Math.round(s * 1000); const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, sec = Math.floor(ms / 1000) % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`; };

async function produce(name) {
  const c = CUES.concepts[name], D = c.duration;
  const video = path.join(DIR, 'out', `${name}.mp4`), sfx = path.join(DIR, 'audio/sfx', `${name}.wav`);
  if (!existsSync(video) || !existsSync(sfx)) throw new Error(`missing ${video} or ${sfx}`);
  console.log(`\n${name}`);
  const vo = KEY ? await voiceLines(c) : null;
  const mus = KEY ? await music(name, c) : null;

  // Static per-stem gains so each stem sits at its target loudness before the mix.
  const gain = (f, target) => `${(target - lufs(f)).toFixed(2)}dB`;
  const inputs = ['-i', video, '-i', sfx];
  const graph = [`[1:a]aresample=48000,volume=${gain(sfx, TARGET.sfx)},apad,atrim=0:${D}[sfx]`];
  const mixIns = ['[sfx]'];

  if (vo) {
    // build the VO stem first so we can measure it as one track
    const voStem = path.join(CACHE, `vostem-${name}-${sha(JSON.stringify(vo.map(v => [v.file, v.t, v.tempo])))}.wav`);
    if (!existsSync(voStem)) {
      const vin = vo.flatMap(v => ['-i', v.file]);
      const vg = vo.map((v, i) => `[${i}:a]aresample=48000,aformat=channel_layouts=stereo,atempo=${v.tempo.toFixed(3)},adelay=${Math.round(v.t * 1000)}:all=1[v${i}]`);
      vg.push(`${vo.map((_, i) => `[v${i}]`).join('')}amix=inputs=${vo.length}:normalize=0:duration=longest,apad,atrim=0:${D}[vo]`);
      ff([...vin, '-filter_complex', vg.join(';'), '-map', '[vo]', '-ar', '48000', voStem]);
    }
    inputs.push('-i', voStem, '-i', mus);
    graph.push(`[2:a]aresample=48000,volume=${gain(voStem, TARGET.vo)},asplit=2[vo][vokey]`);
    graph.push(`[3:a]aresample=48000,aformat=channel_layouts=stereo,volume=${gain(mus, TARGET.music)},apad,atrim=0:${D},afade=t=in:d=0.3,afade=t=out:st=${D - 2.2}:d=2.2[mraw]`);
    // duck music ~6 dB under the voice
    graph.push(`[mraw][vokey]sidechaincompress=threshold=0.03:ratio=5:attack=25:release=450:makeup=1[mus]`);
    mixIns.push('[vo]', '[mus]');
  }
  graph.push(`${mixIns.join('')}amix=inputs=${mixIns.length}:normalize=0:duration=first[mix]`);
  // master: static gain to target, then a true-peak limiter
  const pre = path.join(CACHE, `premaster-${name}.wav`);
  ff([...inputs, '-filter_complex', graph.join(';'), '-map', '[mix]', '-ar', '48000', '-t', String(D), pre]);
  const master = `volume=${((vo ? TARGET.master : -18) - lufs(pre)).toFixed(2)}dB,alimiter=limit=0.89:level=false:attack=3:release=60`;
  const dst = path.join(OUT, `${name}.mp4`);
  ff(['-i', video, '-i', pre, '-filter_complex', `[1:a]${master}[a]`, '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-t', String(D), '-movflags', '+faststart', dst]);
  console.log(`  wrote ${path.relative(DIR, dst)}  (${vo ? 'VO + music + SFX' : 'SFX only — set ELEVENLABS_API_KEY for VO + music'}), master ${lufs(dst).toFixed(1)} LUFS`);

  // captions from the VO script (actual spoken timing when VO exists)
  const lines = (vo || c.vo).map((v, i) => `${i + 1}\n${srtTime(v.t)} --> ${srtTime(vo ? v.t + v.dur : v.end)}\n${v.text}\n`);
  writeFileSync(path.join(OUT, `${name}.srt`), lines.join('\n'));
}

const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(CUES.concepts);
if (!KEY) console.warn('ELEVENLABS_API_KEY not set: producing SFX-only cuts.');
for (const n of names) await produce(n);
