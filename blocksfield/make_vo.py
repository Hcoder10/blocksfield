"""Kokoro TTS voiceover for promo_final.mp4: each line placed at its section start; reports overruns."""
import sys

import numpy as np
import soundfile as sf
from kokoro import KPipeline

SR = 24000
VOICE = sys.argv[1] if len(sys.argv) > 1 else "af_heart"
SPEED = 1.08
# (start s, end limit s, text): starts follow promo_timing.md for the creator cut
LINES = [
    (20.7, 29.7, "Those tools charge credits: nineteen to a hundred and twenty-nine dollars a month. "
                 "Blocksfield costs zero dollars per generation."),
    (30.1, 38.7, "Blocksfield is the open-source version for Roblox. It doesn't make a trailer for your game. "
                 "It makes the game, from one prompt."),
    (39.1, 51.9, "ComfyUI paints a concept board: the target the build is judged against. "
                 "It all runs on one R T X fifty-ninety. The language model sleeps while ComfyUI takes the card."),
    (52.3, 62.2, "Then the model builds the world inside Roblox Studio, looks at it from four cameras, "
                 "and fixes what's wrong. The art is generated in the game's style."),
    (62.5, 68.8, "Props go from an image, to a Gaussian splat with Idol, to editable Roblox parts."),
    (69.1, 81.3, "How does a twenty-seven billion parameter model make something that looks good? Kits. "
                 "One call sets the look, sculpts a level, or builds an animated HUD. The model composes and customizes."),
    (81.6, 88.3, "Every model is open weight. No partner nodes, no closed APIs."),
    (88.8, 109.9, "This is Starbloom Peaks. One paragraph in, a real Roblox place out, built in Studio, "
                  "and it opens and plays. No credits, no cloud, no closed models. "
                  "Every step you saw ran on one rented GPU, at sixty-eight cents an hour."),
    (110.6, 118.0, "Blocksfield. Open-source Higgsfield, for Roblox. The code is on GitHub."),
]

pipe = KPipeline(lang_code="a", device="cpu")
total = int(118.3 * SR)
track = np.zeros(total, dtype=np.float32)
ok = True
for start, limit, text in LINES:
    audio = np.concatenate([np.asarray(a, dtype=np.float32) for _, _, a in pipe(text, voice=VOICE, speed=SPEED)])
    dur = len(audio) / SR
    over = start + dur - limit
    flag = "  OVER by %.2f s" % over if over > 0 else ""
    ok &= over <= 0
    print(f"{start:6.1f}  {dur:5.2f} s  (room {limit - start:5.2f}){flag}  {text[:50]}")
    i = int(start * SR)
    seg = audio[: total - i]
    track[i:i + len(seg)] += seg
sf.write(sys.argv[2] if len(sys.argv) > 2 else "vo.wav", track, SR)
print("ALL FIT" if ok else "SOME LINES OVERRUN")
