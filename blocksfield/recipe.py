"""How every image request is rendered, server-side, so callers (the harness's agents) just say what they want.

Learned on Qwen-Image-2.1 for Roblox art (A/B'd in the Cybus project, Sep 2026):
- render at the model's native ~2K sizes; ~1K is off its distribution (mushy scenes, blob gems);
- a Roblox world must be pinned as Roblox (chunky parts, plastic, Future lighting) or the model paints photoreal
  concept art; a Roblox avatar needs the blocky-R15 anatomy clause or it draws anime dolls;
- transparent art uses Qwen-Image-2.1's RGBA prompt template.
"""
from __future__ import annotations

import re

NATIVE = {"1:1": (2048, 2048), "4:3": (2400, 1792), "3:4": (1792, 2400), "16:9": (2752, 1536),
          "9:16": (1536, 2752)}
KIND_RATIO = {"background": "16:9", "banner": "16:9", "button": "16:9", "logo": "16:9", "concept": "16:9",
              "thumbnail": "16:9", "character": "3:4", "skybox": "1:1"}
OPAQUE = {"background", "concept", "thumbnail", "texture", "pattern", "skybox"}
RGBA_HEAD = "This is an RGBA image with transparency. "
RGBA_TAIL = " The image has alpha channel and the background is transparent."

ROBLOX_AVATAR = ("The character is a classic Roblox avatar: a blocky R15 body built from simple cuboid parts "
                 "(boxy torso, rectangular arms and legs, block hands) in smooth, slightly glossy plastic; a "
                 "rounded-square head with a flat printed decal face -- simple drawn eyes and mouth, no nose, no "
                 "sculpted facial features, no visible ears; hair and clothing are separate accessory pieces with "
                 "simple chunky shapes. Rendered like an official Roblox avatar thumbnail, clean studio lighting.")
ROBLOX_WORLD = ("The place is built in Roblox Studio: chunky, clean geometry from parts and simple meshes, smooth "
                "plastic, slate, wood and glowing neon materials, stylised Roblox terrain, Roblox Future lighting "
                "with atmosphere and soft bloom. It reads as an in-game screenshot of a popular Roblox "
                "experience -- bold, readable and slightly toy-like, not photoreal concept art. Every colour named "
                "above is the scene's palette and stays exactly as stated.")
PROP = ("A single game prop, the whole object visible, three-quarter view from slightly above, centred on a plain "
        "pure white background, even soft studio lighting, no cast shadow, clean stylised game-asset look with "
        "chunky readable shapes and flat-ish colours")
TEXTURE = ("A seamless tileable top-down surface texture filling the entire frame edge to edge, flat even "
           "lighting, no perspective, no objects, no text")


def _avatar(p: str) -> bool:
    p = p.lower()
    return any(w in p for w in ("avatar", "r15", "roblox character", "player character"))


def plan(prompt: str, kind: str, transparent: bool | None = None) -> dict:
    """-> {prompt, width, height, transparent} for one image request."""
    kind = (kind or "icon").lower()
    transparent = (kind not in OPAQUE) if transparent is None else transparent
    text = prompt.strip().rstrip(".")
    if kind in ("background", "concept", "thumbnail") and not re.search(r"\bui\b|menu|screen", text, re.I):
        text += ". " + ROBLOX_WORLD
    elif kind == "texture":
        text += ". " + TEXTURE
    elif kind == "prop":
        text += ". " + PROP
        transparent = False                 # props feed image-to-3D, which wants a clean white background
    if _avatar(prompt) and kind not in ("background", "concept", "thumbnail"):
        text += " " + ROBLOX_AVATAR
    if transparent:
        text = RGBA_HEAD + text + "." + RGBA_TAIL
    w, h = NATIVE[KIND_RATIO.get(kind, "1:1")]
    return {"prompt": text, "width": w, "height": h, "transparent": transparent}
