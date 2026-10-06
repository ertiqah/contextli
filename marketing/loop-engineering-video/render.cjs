// Usage:
//   node render.cjs <concept.html> <out.mp4> [fps]       → renders the full video
//   node render.cjs <concept.html> --stills t1,t2,... dir → PNG stills for review
//   add --vertical anywhere for the 9:16 (1080×1920) layout
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

(async () => {
  const argv = process.argv.slice(2), vertical = argv.includes('--vertical');
  const [file, out, arg3, arg4] = argv.filter(a => a !== '--vertical');
  const [vw, vh] = vertical ? [1080, 1920] : [1920, 1080];
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1 });
  page.on('pageerror', e => console.error('PAGE ERROR', e.message));
  await page.goto('file://' + path.resolve(file) + (vertical ? '?render=1&v=1' : '?render=1'));
  await page.waitForFunction('window.__ready === true', null, { timeout: 30000 });
  if (out === '--stills') {
    for (const t of arg3.split(',').map(Number)) {
      await page.evaluate(t => window.__seek(t), t);
      await page.screenshot({ path: path.join(arg4, `${path.basename(file, '.html')}${vertical ? '-v' : ''}-${t.toFixed(2)}.png`) });
    }
    await browser.close();
    return;
  }
  const fps = Number(arg3 || 30);
  const dur = await page.evaluate('window.__duration');
  const n = Math.round(dur * fps);
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
  for (let f = 0; f < n; f++) {
    await page.evaluate(t => window.__seek(t), f / fps);
    const buf = await page.screenshot({ type: 'png' });
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    if (f % 150 === 0) console.log(`${path.basename(file)} ${f}/${n}`);
  }
  ff.stdin.end();
  await new Promise(r => ff.on('close', r));
  await browser.close();
  console.log('wrote', out);
})();
