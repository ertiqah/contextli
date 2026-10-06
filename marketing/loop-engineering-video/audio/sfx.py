"""Procedural sound design for the loop-engineering videos.

Every sound is synthesized (no samples, nothing to license) and placed on the same
timeline the animations use. Output: audio/sfx/<concept>.wav (48 kHz stereo, 24-bit-ish float→16).

    python3 audio/sfx.py            # all concepts
    python3 audio/sfx.py concept-1-ten-terminals
"""
import sys, os, wave
import numpy as np
from scipy import signal

SR = 48000
rng = np.random.default_rng(7)
HERE = os.path.dirname(os.path.abspath(__file__))


def t_(dur):
    return np.arange(int(dur * SR)) / SR


def noise(dur):
    return rng.standard_normal(int(dur * SR))


def bp(x, lo, hi, order=2):
    sos = signal.butter(order, [lo, hi], btype='band', fs=SR, output='sos')
    return signal.sosfilt(sos, x)


def lp(x, f, order=2):
    return signal.sosfilt(signal.butter(order, f, btype='low', fs=SR, output='sos'), x)


def hp(x, f, order=2):
    return signal.sosfilt(signal.butter(order, f, btype='high', fs=SR, output='sos'), x)


def norm(x, peak=1.0):
    m = np.max(np.abs(x)) or 1
    return x / m * peak


def fade(x, a=0.002, b=0.01):
    n = len(x); ai, bi = int(a * SR), int(b * SR)
    if ai: x[:ai] *= np.linspace(0, 1, ai)
    if bi: x[-bi:] *= np.linspace(1, 0, bi)
    return x


def sweep_bp(x, f0, f1, q=2.5, block=256):
    """Band-pass whose centre glides f0→f1 (log), processed in blocks with carried state."""
    out = np.zeros_like(x); n = len(x); zi = None
    for i in range(0, n, block):
        fc = f0 * (f1 / f0) ** (i / max(1, n - 1))
        bw = fc / q
        lo, hi = max(30, fc - bw / 2), min(SR / 2 - 100, fc + bw / 2)
        sos = signal.butter(2, [lo, hi], btype='band', fs=SR, output='sos')
        if zi is None: zi = signal.sosfilt_zi(sos) * 0
        out[i:i + block], zi = signal.sosfilt(sos, x[i:i + block], zi=zi)
    return out


# ---------------------------------------------------------------- sounds (mono)
def pop(f=620, dur=0.11, drop=1.6):
    t = t_(dur)
    ph = 2 * np.pi * np.cumsum(f * (1 + drop * np.exp(-t * 55))) / SR
    x = np.sin(ph) * np.exp(-t * 38)
    x += 0.15 * hp(noise(dur), 3000) * np.exp(-t * 400)
    return fade(norm(x, 0.8))


def thock(dur=0.16):  # dark, woody terminal spawn
    t = t_(dur)
    x = np.sin(2 * np.pi * 150 * t * (1 + 0.8 * np.exp(-t * 40))) * np.exp(-t * 30)
    x += 0.4 * lp(noise(dur), 1800) * np.exp(-t * 70)
    return fade(norm(x, 0.8))


def click(dur=0.03):
    t = t_(dur)
    x = hp(noise(dur), 2500) * np.exp(-t * 500) + 0.5 * np.sin(2 * np.pi * 2200 * t) * np.exp(-t * 300)
    return fade(norm(x, 0.7), 0.0005, 0.005)


def alert(dur=0.16):  # tense two-step blip for "needs you"
    t = t_(dur); half = len(t) // 2
    f = np.where(np.arange(len(t)) < half, 990, 740)
    sq = np.sign(np.sin(2 * np.pi * np.cumsum(f) / SR))
    x = lp(sq, 2400) * np.exp(-(t % (dur / 2)) * 28)
    return fade(norm(x, 0.45))


def whoosh(dur=0.5, f0=350, f1=4200, peak_at=0.6):
    t = t_(dur); x = sweep_bp(noise(dur), f0, f1, q=1.8)
    e = np.where(t < dur * peak_at, (t / (dur * peak_at)) ** 2, np.exp(-(t - dur * peak_at) * 14))
    return fade(norm(x * e, 0.7), 0.002, 0.03)


def land(dur=0.22):
    t = t_(dur)
    x = np.sin(2 * np.pi * 95 * t) * np.exp(-t * 22) + 0.35 * lp(noise(dur), 900) * np.exp(-t * 45)
    return fade(norm(x, 0.6))


def mic_on(dur=0.18):
    t = t_(dur); f = 560 + 380 * np.clip(t / 0.09, 0, 1)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.sin(np.pi * np.clip(t / dur, 0, 1)) ** 0.6
    return fade(norm(x, 0.5))


def keytick(dur=0.025):
    t = t_(dur)
    return fade(norm(bp(noise(dur), 1800, 5000) * np.exp(-t * 260), 0.35), 0.0005, 0.004)


def mallet(f, dur=0.9):
    t = t_(dur)
    x = np.sin(2 * np.pi * f * t) * np.exp(-t * 6) + 0.35 * np.sin(2 * np.pi * f * 4.0 * t) * np.exp(-t * 30) \
        + 0.15 * np.sin(2 * np.pi * f * 2.0 * t) * np.exp(-t * 12)
    return fade(x)


def success(dur=0.9):  # quick major arpeggio
    out = np.zeros(int(dur * SR))
    for i, f in enumerate([1046.5, 1318.5, 1568.0]):
        s = mallet(f, dur - i * 0.06); o = int(i * 0.06 * SR); out[o:o + len(s)] += s * (0.8 + 0.1 * i)
    return norm(out, 0.55)


def notify(dur=1.1):  # gentle two-note chime
    out = np.zeros(int(dur * SR))
    for i, f in enumerate([1318.5, 1975.5]):
        s = mallet(f, dur - i * 0.12); o = int(i * 0.12 * SR); out[o:o + len(s)] += s
    return norm(out, 0.6)


def buzz(dur=0.55):  # phone vibration: two pulses
    t = t_(dur)
    saw = signal.sawtooth(2 * np.pi * 165 * t)
    gate = ((t < 0.22) | ((t > 0.3) & (t < 0.52))).astype(float)
    gate = lp(gate, 60)
    return fade(norm(lp(saw, 500) * gate, 0.5))


def drone(dur=7.2):  # tension bed under the terminal chaos
    t = t_(dur)
    x = np.sin(2 * np.pi * 55 * t) + 0.8 * np.sin(2 * np.pi * 58.3 * t) + 0.35 * np.sin(2 * np.pi * 110.4 * t)
    x += 0.5 * bp(noise(dur), 200, 900) * (0.5 + 0.5 * np.sin(2 * np.pi * 0.7 * t))
    tick = np.zeros_like(t)  # clock-like pulse that speeds up
    tt = 0.0; k = 0
    while tt < dur - 0.05:
        s = keytick(); i = int(tt * SR); tick[i:i + len(s)] += s * 0.9
        tt += max(0.12, 0.5 - k * 0.018); k += 1
    e = (t / dur) ** 1.6
    return fade(norm(x, 0.5) * e + tick * (0.3 + 0.7 * e), 0.05, 0.25)


def riser(dur=0.9):
    t = t_(dur)
    x = sweep_bp(noise(dur), 300, 8000, q=1.4)
    x += 0.4 * np.sin(2 * np.pi * np.cumsum(200 * (1 + 4 * (t / dur) ** 2)) / SR)
    return fade(norm(x * (t / dur) ** 2.2, 0.75), 0.01, 0.004)


def impact(dur=1.6):
    t = t_(dur)
    x = np.sin(2 * np.pi * 48 * t * (1 + 0.6 * np.exp(-t * 18))) * np.exp(-t * 3.2)
    x += 0.5 * lp(noise(dur), 1500) * np.exp(-t * 9)
    return fade(norm(x, 0.85), 0.001, 0.2)


def shimmer(dur=1.4):
    out = np.zeros(int(dur * SR))
    for f, d in [(2093, 0.0), (2637, 0.05), (3136, 0.11), (4186, 0.17), (3520, 0.24)]:
        s = mallet(f, dur - d) * 0.5; o = int(d * SR); out[o:o + len(s)] += s
    return norm(out, 0.35)


def scratch(dur=0.38):  # marker strike-through
    t = t_(dur)
    x = bp(noise(dur), 1800, 5200) * (0.6 + 0.4 * np.sin(2 * np.pi * 38 * t)) * np.sin(np.pi * t / dur) ** 0.7
    return fade(norm(x, 0.5))


def logo(dur=2.2):  # soft bell chord for the logo build
    out = np.zeros(int(dur * SR))
    for i, f in enumerate([523.25, 783.99, 1046.5, 1567.98]):
        t = t_(dur - i * 0.07)
        s = (np.sin(2 * np.pi * f * t) + 0.25 * np.sin(2 * np.pi * f * 3.01 * t) * np.exp(-t * 8)) * np.exp(-t * 2.2)
        o = int(i * 0.07 * SR); out[o:o + len(s)] += s
    return fade(norm(out, 0.55), 0.003, 0.3)


def clocktick(dur=0.04):
    t = t_(dur)
    return fade(norm(bp(noise(dur), 3000, 7000) * np.exp(-t * 350) + 0.4 * np.sin(2 * np.pi * 4200 * t) * np.exp(-t * 250), 0.3))


SOUNDS = {k: v for k, v in globals().items() if callable(v) and k in (
    'pop', 'thock', 'click', 'alert', 'whoosh', 'land', 'mic_on', 'keytick', 'success', 'notify', 'buzz',
    'drone', 'riser', 'impact', 'shimmer', 'scratch', 'logo', 'clocktick')}


# ---------------------------------------------------------------- mixing
class Bus:
    def __init__(self, dur):
        self.n = int(dur * SR); self.L = np.zeros(self.n); self.R = np.zeros(self.n)

    def put(self, t, x, gain=1.0, pan=0.0):
        """pan: -1 left … +1 right (constant power)."""
        i = int(t * SR)
        if i >= self.n: return
        x = x[: self.n - i] * gain
        a = (pan + 1) * np.pi / 4
        self.L[i:i + len(x)] += x * np.cos(a); self.R[i:i + len(x)] += x * np.sin(a)

    def snd(self, t, name, gain=1.0, pan=0.0, **kw):
        self.put(t, SOUNDS[name](**kw), gain, pan)

    def finish(self, path):
        # small room: shared exponential-noise reverb send
        ir_t = t_(0.9); ir = rng.standard_normal(len(ir_t)) * np.exp(-ir_t * 6.5)
        irL, irR = lp(ir, 6000), lp(np.roll(ir, 211), 6000)
        L = self.L + 0.12 * signal.fftconvolve(self.L, irL)[: self.n] / np.sqrt(np.sum(irL ** 2))
        R = self.R + 0.12 * signal.fftconvolve(self.R, irR)[: self.n] / np.sqrt(np.sum(irR ** 2))
        st = np.stack([L, R], 1)
        st = st / max(1e-9, np.max(np.abs(st))) * 0.89  # -1 dBFS peak; loudness is set in the final mix
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with wave.open(path, 'wb') as w:
            w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
            w.writeframes((st * 32767).astype('<i2').tobytes())
        print('wrote', path)


# ---------------------------------------------------------------- cue sheets (timings mirror the HTML)
def concept1():
    b = Bus(30)
    b.snd(0.0, 'drone', 0.55)
    for i, a in enumerate([0.25, 1.25, 1.75, 2.15, 2.45, 2.7, 2.9, 3.05, 3.2, 3.35]):
        b.snd(a, 'thock', 0.5 + 0.04 * i, pan=[-.5, .1, .6, .7, .2, -.3, -.7, -.1, .4, .8][i])
    for i, a in enumerate([3.9, 4.25, 4.55, 4.8, 5.0, 5.2, 5.35, 5.5, 5.62, 5.75]):
        b.snd(a, 'alert', 0.35, pan=[-.5, .1, .6, .7, .2, -.3, -.7, -.1, .4, .8][i])
    for a, x in [(3.7, 960), (4.1, 1440), (4.5, 330), (4.9, 1650), (5.3, 600), (5.7, 880), (6.1, 1340), (6.5, 260)]:
        b.snd(a, 'click', 0.55, pan=(x - 960) / 960 * 0.8)
    b.snd(6.45, 'riser', 0.7)
    b.snd(7.33, 'impact', 0.8); b.snd(7.4, 'shimmer', 0.5)
    b.snd(9.2, 'whoosh', 0.35, pan=-0.5, dur=0.45, f0=250, f1=2500)
    for s0 in [9.8, 11.85, 13.65]:
        b.snd(s0, 'mic_on', 0.45, pan=-0.55)
        for k in range(14): b.snd(s0 + 0.08 + k * 0.065 + 0.01 * np.sin(k * 3), 'keytick', 0.22, pan=-0.55)
        b.snd(s0 + 1.02, 'pop', 0.5, pan=-0.55, f=1100)
        b.snd(s0 + 1.25, 'whoosh', 0.45, pan=-0.1, dur=0.55)
        b.snd(s0 + 1.8, 'land', 0.45, pan=0.05)
    b.snd(14.35, 'pop', 0.55, pan=0.4, f=420, dur=0.2, drop=0.8)
    for p in [15.2, 16.65, 18.1]:
        b.snd(p, 'whoosh', 0.35, pan=0.25, dur=0.45, f0=500, f1=3000)
        b.snd(p + 1.12, 'success', 0.55, pan=0.4)
        b.snd(p + 1.15, 'whoosh', 0.3, pan=0.6, dur=0.45, f0=600, f1=3500)
        b.snd(p + 1.62, 'land', 0.35, pan=0.75)
    b.snd(19.95, 'whoosh', 0.3, dur=0.6, f0=200, f1=1500)
    b.snd(20.15, 'notify', 0.6, pan=-0.3); b.snd(20.2, 'buzz', 0.4, pan=-0.3)
    b.snd(20.9, 'notify', 0.45, pan=-0.3); b.snd(21.6, 'notify', 0.4, pan=-0.3)
    b.snd(22.95, 'whoosh', 0.3, dur=0.6, f0=1500, f1=300)
    b.snd(24.5, 'scratch', 0.55)
    b.snd(25.05, 'impact', 0.45)
    b.snd(26.2, 'logo', 0.6); b.snd(26.25, 'shimmer', 0.3)
    b.finish(os.path.join(HERE, 'sfx', 'concept-1-ten-terminals.wav'))


def concept2():
    b = Bus(28.5)
    b.snd(0.2, 'pop', 0.5, f=700, dur=0.25, drop=0.6); b.snd(0.25, 'shimmer', 0.4)
    b.snd(2.55, 'whoosh', 0.45, dur=0.85, f0=300, f1=3500)
    b.snd(3.4, 'mic_on', 0.5)
    for k in range(26): b.snd(3.62 + k * 0.068 + 0.01 * np.sin(k * 5), 'keytick', 0.2)
    b.snd(5.5, 'pop', 0.5, f=1100)
    b.snd(6.4, 'whoosh', 0.45, dur=0.8)
    b.snd(7.15, 'land', 0.5)
    b.snd(9.6, 'whoosh', 0.4, dur=0.8, f0=400, f1=2500)
    b.snd(10.35, 'land', 0.45)
    for k in range(9): b.snd(10.7 + k * 0.33, 'clocktick', 0.25)
    b.snd(13.45, 'success', 0.6)
    b.snd(14.0, 'whoosh', 0.4, dur=0.75)
    b.snd(14.65, 'notify', 0.6); b.snd(14.7, 'buzz', 0.35)
    b.snd(17.25, 'whoosh', 0.5, dur=1.3, f0=2500, f1=250, peak_at=0.4)
    for i in range(22):
        a = 18.7 + i * 0.1 + 1.9
        b.snd(a, 'pop', 0.22 + 0.01 * i, pan=0.6, f=700 * 2 ** (min(i, 14) / 14), dur=0.12)
    b.snd(22.7, 'whoosh', 0.3, dur=0.6, f0=1500, f1=300)
    b.snd(23.2, 'impact', 0.45)
    b.snd(25.2, 'logo', 0.6); b.snd(25.25, 'shimmer', 0.3)
    b.finish(os.path.join(HERE, 'sfx', 'concept-2-you-think-it-ships.wav'))


def concept3():
    b = Bus(23.5)
    b.snd(2.25, 'whoosh', 0.5, dur=0.75, f0=250, f1=2500)
    for i in range(10): b.snd(3.0 + i * 0.06, 'thock', 0.3, pan=-0.6)
    # the clock: one soft tick every 0.5s through the "day"
    for k in range(26): b.snd(3.0 + k * 0.5, 'clocktick', 0.18)
    # left: approvals pile up, cursor never stops
    k = 0
    while 3.6 + k * 0.42 < 16.0:
        b.snd(3.6 + k * 0.42 + 0.06, 'click', 0.35, pan=-0.75)
        if k % 3 == 1: b.snd(3.6 + k * 0.42 + 0.2, 'alert', 0.18, pan=-0.75)
        k += 1
    for s in [8.2, 12.6, 15.6]: b.snd(s, 'success', 0.4, pan=-0.7)
    # right: voice notes, tickets, ships
    life = [3.2, 5.8, 8.4, 11.0, 13.6]
    voice = [x for a in life for x in (a + 0.4, a + 1.5)]
    for v in voice:
        b.snd(v, 'mic_on', 0.3, pan=0.6)
        b.snd(v + 0.55, 'whoosh', 0.25, pan=0.7, dur=0.45, f0=600, f1=3000)
        b.snd(v + 1.9, 'success', 0.42, pan=0.75)
    b.snd(16.0, 'notify', 0.5)
    b.snd(17.55, 'whoosh', 0.45, dur=0.9, f0=2000, f1=250)
    b.snd(18.3, 'impact', 0.5)
    b.snd(19.8, 'logo', 0.6); b.snd(19.85, 'shimmer', 0.3)
    b.finish(os.path.join(HERE, 'sfx', 'concept-3-junkie-vs-orchestrator.wav'))


ALL = {'concept-1-ten-terminals': concept1, 'concept-2-you-think-it-ships': concept2, 'concept-3-junkie-vs-orchestrator': concept3}

if __name__ == '__main__':
    for name in (sys.argv[1:] or ALL):
        ALL[name]()
