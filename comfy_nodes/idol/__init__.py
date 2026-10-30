"""ComfyUI nodes for Idol (speridlabs/idol, Apache-2.0): one image -> a 3D Gaussian splat (.ply).

Install: pip install -e idol-sdk into ComfyUI's venv (with torch pinned), then put this folder (or a symlink) in
ComfyUI/custom_nodes/ and restart ComfyUI once. Idol needs two gated Hugging Face encoders
(facebook/dinov3-vith16plus-pretrain-lvd1689m, black-forest-labs/FLUX.2-dev's VAE) readable by the token in use.

VRAM: the pipeline (~7 GB while running) is loaded once and kept in host RAM between runs. Before a run the node asks
ComfyUI's model management to make room (free_memory), and after every run it moves Idol back to the CPU and empties
the CUDA cache, so between runs Idol holds no VRAM and ComfyUI's /free (and other tenants of the card) see a clean GPU.
`keep_in_ram=false` drops it entirely instead.
"""
from __future__ import annotations

import json
import os
import threading

import numpy as np

_LOCK = threading.Lock()
_PIPE = {"pipe": None, "optimize": None}
IDOL_VRAM = 9 * 1024 ** 3            # what to ask ComfyUI to free before a run (7.2 GB measured by Idol + headroom)


def _place(pipe, device) -> None:
    """Move every Idol module (and the device the pipeline allocates on) to `device`."""
    import torch
    device = torch.device(device)
    for name in ("denoiser", "decoder", "decoder_gs", "background_remover"):
        getattr(pipe, name).to(device)
    enc = pipe.image_encoder
    enc.dinov3.to(device)
    enc.flux2_vae.to(device)
    enc.device = device
    pipe.device = device


def _release(pipe, keep_in_ram: bool) -> None:
    import torch
    if keep_in_ram and pipe is not None:
        _place(pipe, "cpu")
    else:
        _PIPE["pipe"] = None
    if torch.cuda.is_available():
        torch.cuda.empty_cache()


def _pipeline(optimize: bool):
    import torch
    from idol import IdolPipeline
    device = "cuda" if torch.cuda.is_available() else "cpu"
    pipe = _PIPE["pipe"]
    if pipe is None or _PIPE["optimize"] != optimize:
        _PIPE["pipe"] = None
        pipe = IdolPipeline.from_pretrained(os.environ.get("IDOL_WEIGHTS", "speridlabs/idol"), device=device,
                                            optimize=optimize)
        _PIPE["pipe"], _PIPE["optimize"] = pipe, optimize
    elif str(pipe.device) != device:
        _place(pipe, device)
    return pipe


def _make_room() -> None:
    try:
        import comfy.model_management as mm
        dev = mm.get_torch_device()
        mm.free_memory(IDOL_VRAM, dev)
        mm.soft_empty_cache()
    except Exception:  # noqa: BLE001  -- outside ComfyUI (tests) there is nothing to free
        pass


def _to_pil(image):
    from PIL import Image
    a = image[0].detach().cpu().float().numpy() if hasattr(image, "detach") else np.asarray(image[0])
    return Image.fromarray(np.clip(a[..., :3] * 255, 0, 255).round().astype(np.uint8))


def _to_tensor(img):
    import torch
    return torch.from_numpy(np.asarray(img.convert("RGB"), dtype=np.float32) / 255.0)[None]


class IdolImageToSplat:
    """IMAGE -> a 3DGS .ply in ComfyUI's output folder (+ the predicted camera as JSON). Returns the .ply path and the
    cropped, background-removed image Idol actually saw."""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "image": ("IMAGE",),
            "seed": ("INT", {"default": 42, "min": 0, "max": 2 ** 31 - 1}),
            "num_gaussians": ("INT", {"default": 131072, "min": 32768, "max": 1048576, "step": 32}),
            "mode": (["synthetic", "real"], {"default": "synthetic"}),
            "steps": ("INT", {"default": 50, "min": 4, "max": 200}),
            "cfg_strength": ("FLOAT", {"default": 3.0, "min": 0.0, "max": 20.0, "step": 0.1}),
            "filename_prefix": ("STRING", {"default": "idol/splat"}),
        }, "optional": {
            "optimize": ("BOOLEAN", {"default": False, "tooltip": "torch.compile the denoiser (~1.7x faster after a "
                                                                   "slow first run)"}),
            "keep_in_ram": ("BOOLEAN", {"default": True, "tooltip": "keep Idol in host RAM between runs (no VRAM)"}),
        }}

    RETURN_TYPES = ("STRING", "IMAGE")
    RETURN_NAMES = ("ply_path", "input_preview")
    FUNCTION = "run"
    OUTPUT_NODE = True
    CATEGORY = "3d/idol"

    def run(self, image, seed, num_gaussians, mode, steps, cfg_strength, filename_prefix, optimize=False,
            keep_in_ram=True):
        import folder_paths
        out_dir = folder_paths.get_output_directory()
        folder, name, counter, subfolder, _ = folder_paths.get_save_image_path(filename_prefix, out_dir)
        stem = f"{name}_{counter:05}_"
        with _LOCK:
            _make_room()
            pipe = None
            try:
                pipe = _pipeline(bool(optimize))
                out = pipe(_to_pil(image), mode=mode, seed=int(seed), steps=int(steps),
                           cfg_strength=float(cfg_strength), num_gaussians=int(num_gaussians) // 32 * 32)
                ply = os.path.join(folder, stem + ".ply")
                out.gaussian.save_ply(ply)
                del out.gaussian
            finally:
                _release(pipe, bool(keep_in_ram))
        cam = os.path.join(folder, stem + "_camera.json")
        with open(cam, "w") as f:
            json.dump(out.camera, f, indent=1)
        crop = os.path.join(folder, stem + "_input.png")
        out.preprocessed_image.save(crop)
        files = [{"filename": os.path.basename(p), "subfolder": subfolder, "type": "output"} for p in (ply, cam)]
        return {"ui": {"3d": files, "images": [{"filename": os.path.basename(crop), "subfolder": subfolder,
                                                "type": "output"}]},
                "result": (ply, _to_tensor(out.preprocessed_image))}


NODE_CLASS_MAPPINGS = {"IdolImageToSplat": IdolImageToSplat}
NODE_DISPLAY_NAME_MAPPINGS = {"IdolImageToSplat": "Idol Image to Gaussian Splat"}
