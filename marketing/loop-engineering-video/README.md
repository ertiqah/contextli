# Loop Engineering — motion videos

Three 1920×1080 / 30fps spots in the Contextli brand (Paper/Studio palette, Newsreader + Hanken Grotesk + JetBrains Mono, canonical mark from `contextli-dev/brand/BRAND_GUIDELINES.md`).

| Concept | Length | Idea |
|---|---|---|
| `concept-1-ten-terminals` | 30s | Before/after: 10 Claude terminals → one phone + one loop. |
| `concept-2-you-think-it-ships` | 28.5s | Follow one idea from a walk to "done", then every idea all day. |
| `concept-3-junkie-vs-orchestrator` | 23.5s | Split screen, same day: code junkie vs orchestrator. |

## Pipeline
1. **Picture** — `concept-*.html` (deterministic, time-driven). Render: `NODE_PATH=$(npm root -g) node render.cjs concept-1-ten-terminals.html out/concept-1-ten-terminals.mp4 30`
2. **Sound design** — `python3 audio/sfx.py` → `audio/sfx/*.wav` (synthesized, synced to the animation, stereo-panned).
3. **VO + music + mix** — `ELEVENLABS_API_KEY=... node produce.mjs` → `out/final/*.mp4` + `.srt`.
   - VO script, timings, voice and music briefs live in `audio/cues.json`.
   - Voice: Brian by default; `ELEVENLABS_VOICE_ID=<id>` to use another (e.g. your own clone).
   - Music: ElevenLabs Music (`music_v1`) from a sectioned brief matched to each cut.
   - Mix: per-stem loudness, music ducked under VO, master −14 LUFS / −1 dBTP (social standard).
   - Without a key it produces SFX-only cuts.

Preview any concept by opening its HTML (space = pause, click bar to scrub, `?t=12` to jump).
