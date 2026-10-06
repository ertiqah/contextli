# Loop Engineering — motion concepts

Three 1920×1080 / 30fps silent motion videos (captions carry the story, so they work muted in feeds).

| Concept | Length | Idea |
|---|---|---|
| `concept-1-ten-terminals` | 30s | Before/after: 10 Claude terminals → one phone + one loop. |
| `concept-2-you-think-it-ships` | 28.5s | Follow one idea from a walk to "done", then every idea all day. |
| `concept-3-junkie-vs-orchestrator` | 23.5s | Split screen, same day: code junkie vs orchestrator. |

Rendered files: `out/*.mp4`.

## Edit & re-render
- Open any `concept-*.html` in a browser to preview (space = pause, click bar to scrub, `?t=12` to jump).
- Brand colors are tokens at the top of `shared.css` (`--accent` etc.). The logo is a placeholder in `shared.js` → `logo()`.
- Render: `NODE_PATH=$(npm root -g) node render.cjs concept-1-ten-terminals.html out/concept-1-ten-terminals.mp4 30`
