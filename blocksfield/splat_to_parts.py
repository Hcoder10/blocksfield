"""3D Gaussian splat (or textured mesh) -> a procedural Roblox prop: a few hundred primitive Parts as Luau data.

No asset uploads: the prop is a ModuleScript that Kit.PropKit turns into Parts at run time.

    voxel  opacity-weighted N^3 voxel grid, colours quantised to a small palette, the hidden interior filled and then
           greedily merged with same-colour neighbours into boxes (interior voxels take any colour, so boxes go deep)
    blob   k-means clusters of the Gaussians, each one an ellipsoid (Part + SpecialMesh Sphere) on its principal axes

Asset coordinates are Roblox's: Y up, the longest side is 1, the origin is the bottom centre of the bounding box,
and the side the source image showed faces -Z (the model's LookVector) when the camera is known.

    python -m blocksfield.splat_to_parts in.ply --name Mushroom --style voxel --detail 24 --out Mushroom.luau
"""
from __future__ import annotations

import argparse
import colorsys
import json
import math
import time
from pathlib import Path

import numpy as np
from PIL import Image

SH_C0 = 0.28209479177387814
PLY_TYPES = {"float": "f4", "float32": "f4", "double": "f8", "float64": "f8", "uchar": "u1", "uint8": "u1",
             "char": "i1", "int8": "i1", "short": "i2", "int16": "i2", "ushort": "u2", "uint16": "u2",
             "int": "i4", "int32": "i4", "uint": "u4", "uint32": "u4"}


# --------------------------------------------------------------------------------------------- input
def read_ply(path: str | Path) -> dict:
    """A binary little-endian 3DGS PLY -> {xyz, rgb (0..1), opacity, scale (world units)} as float32 arrays."""
    raw = Path(path).read_bytes()
    end = raw.index(b"end_header") + len(b"end_header")
    end += 2 if raw[end:end + 2] == b"\r\n" else 1
    header = raw[:end].decode("ascii", "replace").splitlines()
    if not any(h.startswith("format binary_little_endian") for h in header):
        raise ValueError("only binary_little_endian PLY files are supported")
    count, props, in_vertex = 0, [], False
    for h in header:
        t = h.split()
        if t[:1] == ["element"]:
            in_vertex = t[1] == "vertex"
            if in_vertex:
                count = int(t[2])
        elif t[:1] == ["property"] and in_vertex:
            if t[1] == "list":
                raise ValueError("list properties in the vertex element are not supported")
            props.append((t[2], "<" + PLY_TYPES[t[1]]))
    v = np.frombuffer(raw, dtype=np.dtype(props), count=count, offset=end)
    names = set(v.dtype.names)
    xyz = np.stack([v["x"], v["y"], v["z"]], 1).astype(np.float32)
    if {"f_dc_0", "f_dc_1", "f_dc_2"} <= names:
        rgb = 0.5 + SH_C0 * np.stack([v["f_dc_0"], v["f_dc_1"], v["f_dc_2"]], 1)
    elif {"red", "green", "blue"} <= names:
        rgb = np.stack([v["red"], v["green"], v["blue"]], 1) / 255.0
    else:
        rgb = np.full((count, 3), 0.7)
    opacity = 1 / (1 + np.exp(-v["opacity"].astype(np.float64))) if "opacity" in names else np.ones(count)
    if {"scale_0", "scale_1", "scale_2"} <= names:
        scale = np.exp(np.stack([v["scale_0"], v["scale_1"], v["scale_2"]], 1).astype(np.float64))
    else:
        scale = np.zeros((count, 3))
    return {"xyz": xyz, "rgb": np.clip(rgb, 0, 1).astype(np.float32), "opacity": opacity.astype(np.float32),
            "scale": scale.astype(np.float32)}


def sample_mesh(path: str | Path, count: int = 200_000, seed: int = 0) -> dict:
    """A GLB / OBJ (TRELLIS's prop3d output) -> surface samples with texture colours, in the same dict as read_ply."""
    import trimesh
    scene = trimesh.load(str(path), force="scene")
    mesh = scene.to_mesh() if hasattr(scene, "to_mesh") else scene.dump(concatenate=True)
    pts, face = trimesh.sample.sample_surface(mesh, count, seed=seed)
    rgb = _surface_colors(mesh, np.asarray(pts), np.asarray(face))
    n = len(pts)
    return {"xyz": np.asarray(pts, np.float32), "rgb": rgb.astype(np.float32), "opacity": np.ones(n, np.float32),
            "scale": np.zeros((n, 3), np.float32)}


def _surface_colors(mesh, pts: np.ndarray, face: np.ndarray) -> np.ndarray:
    """Base colour at each sample: the PBR baseColorTexture (or a plain texture) looked up by barycentric UV, times
    baseColorFactor; vertex colours; else grey. trimesh's own sample_color cannot read PBRMaterial textures."""
    import trimesh
    vis = mesh.visual
    mat = getattr(vis, "material", None)
    uv = getattr(vis, "uv", None)
    tex = getattr(mat, "baseColorTexture", None) or getattr(mat, "image", None)
    factor = np.asarray(getattr(mat, "baseColorFactor", None) if getattr(mat, "baseColorFactor", None) is not None
                        else [255, 255, 255, 255], float)[:3]
    factor = factor / 255.0 if factor.max() > 1 else factor
    if uv is not None and tex is not None:
        tri = mesh.triangles[face]
        bary = trimesh.triangles.points_to_barycentric(tri, pts)
        st = (np.asarray(uv)[mesh.faces[face]] * bary[:, :, None]).sum(1)
        img = np.asarray(tex.convert("RGB"), float) / 255.0
        h, w = img.shape[:2]
        x = np.clip((st[:, 0] % 1.0) * (w - 1), 0, w - 1).round().astype(int)
        y = np.clip((1 - st[:, 1] % 1.0) * (h - 1), 0, h - 1).round().astype(int)
        return np.clip(img[y, x] * factor, 0, 1)
    vc = getattr(vis, "vertex_colors", None)
    if vc is not None and len(vc) == len(mesh.vertices):
        return np.asarray(vc, float)[mesh.faces[face]].mean(1)[:, :3] / 255.0
    if mat is not None and getattr(mat, "baseColorFactor", None) is not None:
        return np.tile(factor, (len(pts), 1))
    return np.full((len(pts), 3), 0.7)


# --------------------------------------------------------------------------------------------- orientation
def to_roblox(xyz: np.ndarray, up: str) -> np.ndarray:
    """Turn source axes into Roblox axes (Y up, right-handed).

    idol: Idol writes its z-up object as (x, -z, y) ("+90 about x"), so up is -Y in the file: rotate 180 about X.
    gltf: Y up with the front facing +Z (glTF, TRELLIS's GLB): turn 180 about Y so the front faces -Z.
    y:    already Roblox axes.        z: Z up (Blender, Idol's internal frame)."""
    x, y, z = xyz[:, 0], xyz[:, 1], xyz[:, 2]
    if up == "idol":
        return np.stack([x, -y, -z], 1)
    if up == "z":
        return np.stack([x, z, -y], 1)
    if up == "gltf":
        return np.stack([-x, y, -z], 1)
    if up == "y":
        return xyz.copy()
    raise ValueError(f"up must be idol, gltf, y or z, not {up!r}")


def face_camera(xyz: np.ndarray, camera: dict | None) -> np.ndarray:
    """Spin about Y so the side Idol's predicted input camera saw faces -Z. Idol's camera: yaw = atan2(dx, dy) of the
    camera direction in its z-up frame, which is (sin yaw, -cos yaw) in Roblox's XZ plane."""
    if not camera or "yaw" not in camera:
        return xyz
    vx, vz = math.sin(camera["yaw"]), -math.cos(camera["yaw"])
    d = -math.pi / 2 - math.atan2(vz, vx)
    c, s = math.cos(d), math.sin(d)
    out = xyz.copy()
    out[:, 0], out[:, 2] = c * xyz[:, 0] - s * xyz[:, 2], s * xyz[:, 0] + c * xyz[:, 2]
    return out


def normalize(g: dict, min_opacity: float = 0.15) -> dict:
    """Drop faint and tiny-or-stray Gaussians, then scale so the longest side is 1 with the bottom centre at 0."""
    keep = g["opacity"] >= min_opacity
    xyz, rgb, op = g["xyz"][keep], g["rgb"][keep], g["opacity"][keep]
    if len(xyz) < 50:
        raise ValueError(f"only {len(xyz)} Gaussians above opacity {min_opacity}: nothing to convert")
    lo, hi = np.percentile(xyz, 0.5, axis=0), np.percentile(xyz, 99.5, axis=0)
    pad = 0.02 * (hi - lo).max()
    inside = np.all((xyz >= lo - pad) & (xyz <= hi + pad), axis=1)
    xyz, rgb, op = xyz[inside], rgb[inside], op[inside]
    lo, hi = xyz.min(0), xyz.max(0)
    ext = float((hi - lo).max())
    centre = np.array([(lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2])
    xyz = (xyz - centre) / ext
    return {"xyz": xyz.astype(np.float64), "rgb": rgb.astype(np.float64), "opacity": op.astype(np.float64),
            "size": (hi - lo) / ext}


# --------------------------------------------------------------------------------------------- k-means
def kmeans(x: np.ndarray, k: int, w: np.ndarray | None = None, iters: int = 20, seed: int = 0) -> tuple:
    """Weighted Lloyd with k-means++ seeding; deterministic for a seed. -> (centres [k, d], labels [n])."""
    rng = np.random.default_rng(seed)
    n = len(x)
    k = max(1, min(k, n))
    w = np.ones(n) if w is None else np.asarray(w, np.float64)
    centres = [x[rng.choice(n, p=w / w.sum())]]
    d2 = ((x - centres[0]) ** 2).sum(1)
    for _ in range(1, k):
        p = d2 * w
        if p.sum() <= 0:
            break
        centres.append(x[rng.choice(n, p=p / p.sum())])
        d2 = np.minimum(d2, ((x - centres[-1]) ** 2).sum(1))
    c = np.array(centres)
    labels = np.zeros(n, int)
    for _ in range(iters):
        dist = (x * x).sum(1)[:, None] - 2 * x @ c.T + (c * c).sum(1)[None, :]
        new = dist.argmin(1)
        if np.array_equal(new, labels) and _ > 0:
            break
        labels = new
        sw = np.bincount(labels, w, minlength=len(c))
        for j in range(x.shape[1]):
            s = np.bincount(labels, w * x[:, j], minlength=len(c))
            c[:, j] = np.where(sw > 0, s / np.maximum(sw, 1e-12), c[:, j])
    return c, labels


def palette_of(colors: np.ndarray, weights: np.ndarray, k: int, seed: int = 0) -> tuple[np.ndarray, np.ndarray]:
    """Quantise colours to k (merging near-duplicates), boosting saturation a little for a clean stylised look.
    -> (palette [m, 3] 0..1, index per colour)."""
    pal, idx = kmeans(colors, k, weights, iters=25, seed=seed)
    # merge palette entries closer than ~6/255 so the merge pass is not split by invisible differences
    order = np.argsort(-np.bincount(idx, weights, minlength=len(pal)))
    remap, kept = {}, []
    for i in order:
        hit = next((j for j, q in enumerate(kept) if np.abs(pal[q] - pal[i]).max() < 0.025), None)
        if hit is None:
            kept.append(i)
            remap[i] = len(kept) - 1
        else:
            remap[i] = hit
    pal = np.array([_vivid(pal[i]) for i in kept])
    return pal, np.array([remap[i] for i in idx])


def _vivid(rgb: np.ndarray, sat: float = 1.12) -> np.ndarray:
    h, l, s = colorsys.rgb_to_hls(*np.clip(rgb, 0, 1))
    return np.array(colorsys.hls_to_rgb(h, l, min(1.0, s * sat)))


# --------------------------------------------------------------------------------------------- voxel style
def _neighbours_all(occ: np.ndarray) -> np.ndarray:
    """True where all six face neighbours are occupied (the voxel cannot be seen)."""
    p = np.pad(occ, 1)
    return (p[2:, 1:-1, 1:-1] & p[:-2, 1:-1, 1:-1] & p[1:-1, 2:, 1:-1] & p[1:-1, :-2, 1:-1]
            & p[1:-1, 1:-1, 2:] & p[1:-1, 1:-1, :-2])


def _fill_interior(occ: np.ndarray) -> np.ndarray:
    """Occupied + every empty cell the outside cannot reach (flood fill from the border, 6-connected)."""
    outside = np.zeros_like(occ)
    outside[0], outside[-1], outside[:, 0], outside[:, -1], outside[:, :, 0], outside[:, :, -1] = (True,) * 6
    outside &= ~occ
    while True:
        p = np.pad(outside, 1)
        grow = (p[2:, 1:-1, 1:-1] | p[:-2, 1:-1, 1:-1] | p[1:-1, 2:, 1:-1] | p[1:-1, :-2, 1:-1]
                | p[1:-1, 1:-1, 2:] | p[1:-1, 1:-1, :-2]) & ~occ
        new = outside | grow
        if new.sum() == outside.sum():
            return ~outside
        outside = new


def _greedy_boxes(color: np.ndarray, hidden: np.ndarray) -> list[tuple]:
    """color: [X, Y, Z] palette index (-1 empty). Grow boxes along x, then z, then y; a hidden voxel joins a box of
    any colour. -> [(x0, y0, z0, x1, y1, z1, colour)] with exclusive upper bounds. Visible voxels seed first."""
    X, Y, Z = color.shape
    done = color < 0
    boxes = []
    seeds = list(zip(*np.nonzero(~done & ~hidden))) + list(zip(*np.nonzero(~done & hidden)))
    for (x, y, z) in seeds:
        if done[x, y, z]:
            continue
        c = color[x, y, z]

        def ok(sl) -> bool:
            return bool(np.all(~done[sl]) and np.all((color[sl] == c) | hidden[sl]))
        x1 = x + 1
        while x1 < X and ok((slice(x1, x1 + 1), slice(y, y + 1), slice(z, z + 1))):
            x1 += 1
        z1 = z + 1
        while z1 < Z and ok((slice(x, x1), slice(y, y + 1), slice(z1, z1 + 1))):
            z1 += 1
        y1 = y + 1
        while y1 < Y and ok((slice(x, x1), slice(y1, y1 + 1), slice(z, z1))):
            y1 += 1
        done[x:x1, y:y1, z:z1] = True
        if hidden[x, y, z]:              # a box seeded inside: give it the colour most of its visible cells have
            vis = color[x:x1, y:y1, z:z1][~hidden[x:x1, y:y1, z:z1]]
            c = np.bincount(vis).argmax() if len(vis) else c
        boxes.append((x, y, z, x1, y1, z1, int(c)))
    return boxes


def voxel_parts(g: dict, detail: int = 24, colors: int = 8, seed: int = 0) -> dict:
    n = int(np.clip(detail, 8, 48))
    vs = 1.0 / n
    size = g["size"]
    dims = np.maximum(1, np.ceil(size / vs - 1e-6).astype(int))
    lo = np.array([-size[0] / 2, 0.0, -size[2] / 2])
    ijk = np.clip(((g["xyz"] - lo) / vs).astype(int), 0, dims - 1)
    flat = np.ravel_multi_index(ijk.T, dims)
    total = int(np.prod(dims))
    w = g["opacity"]
    wsum = np.bincount(flat, w, minlength=total)
    nz = wsum[wsum > 0]
    # occupied: enough opacity mass that it is surface, not a stray floater (relative to a typical surface voxel)
    occ_flat = wsum > max(0.05, 0.08 * np.percentile(nz, 60)) if len(nz) else wsum > 0
    rgb = np.stack([np.bincount(flat, w * g["rgb"][:, j], minlength=total) for j in range(3)], 1)
    rgb = rgb / np.maximum(wsum, 1e-12)[:, None]
    occ = occ_flat.reshape(dims)
    solid = _fill_interior(occ)
    hidden = _neighbours_all(solid) & solid
    # colour the visible shell; interior cells borrow the nearest surface colour index later (any colour merges)
    vis_idx = np.nonzero((solid & ~hidden).ravel())[0]
    vis_occ = vis_idx[occ_flat[vis_idx]]
    pal, lab = palette_of(rgb[vis_occ], wsum[vis_occ], colors, seed)
    color = np.full(total, -1, int)
    color[vis_occ] = lab
    # visible cells the fill added (rare: concavities sealed by the fill) take their nearest coloured neighbour
    missing = vis_idx[~occ_flat[vis_idx]]
    if len(missing):
        src = np.array(np.unravel_index(vis_occ, dims)).T
        dst = np.array(np.unravel_index(missing, dims)).T
        near = ((dst[:, None, :] - src[None, :, :]) ** 2).sum(-1).argmin(1) if len(src) * len(dst) < 4e7 else 0
        color[missing] = lab[near]
    hid = hidden.ravel()
    color[hid] = 0 if len(pal) else -1
    color = color.reshape(dims)
    boxes = _greedy_boxes(color, hidden)
    parts = []
    for x0, y0, z0, x1, y1, z1, c in boxes:
        a = lo + np.array([x0, y0, z0]) * vs
        b = lo + np.array([x1, y1, z1]) * vs
        parts.append({"p": (a + b) / 2, "s": b - a, "c": c})
    return {"palette": pal, "parts": parts, "size": dims * vs, "stats": {"grid": dims.tolist(),
            "voxels": int(solid.sum()), "visible": int((solid & ~hidden).sum()), "boxes": len(boxes)}}


# --------------------------------------------------------------------------------------------- blob style
def _euler_xyz(r: np.ndarray) -> tuple[float, float, float]:
    """Rotation matrix = Rx(a) Ry(b) Rz(c) (Roblox CFrame.fromEulerAnglesXYZ) -> (a, b, c) in degrees."""
    b = math.asin(float(np.clip(r[0, 2], -1, 1)))
    if abs(r[0, 2]) < 0.99999:
        a = math.atan2(-r[1, 2], r[2, 2])
        c = math.atan2(-r[0, 1], r[0, 0])
    else:                               # gimbal lock: put it all in a
        a = math.atan2(r[2, 1], r[1, 1])
        c = 0.0
    return math.degrees(a), math.degrees(b), math.degrees(c)


def _rot_xyz(a: float, b: float, c: float) -> np.ndarray:
    a, b, c = map(math.radians, (a, b, c))
    rx = np.array([[1, 0, 0], [0, math.cos(a), -math.sin(a)], [0, math.sin(a), math.cos(a)]])
    ry = np.array([[math.cos(b), 0, math.sin(b)], [0, 1, 0], [-math.sin(b), 0, math.cos(b)]])
    rz = np.array([[math.cos(c), -math.sin(c), 0], [math.sin(c), math.cos(c), 0], [0, 0, 1]])
    return rx @ ry @ rz


def blob_parts(g: dict, detail: int = 24, colors: int = 8, seed: int = 0, max_points: int = 40_000) -> dict:
    k = int(np.clip(detail * 6, 40, 320))
    rng = np.random.default_rng(seed)
    xyz, rgb, w = g["xyz"], g["rgb"], g["opacity"]
    if len(xyz) > max_points:
        pick = rng.choice(len(xyz), max_points, replace=False, p=w / w.sum())
        xyz, rgb, w = xyz[pick], rgb[pick], np.ones(max_points)
    centres, lab = kmeans(xyz, k, w, iters=15, seed=seed)
    sw = np.bincount(lab, w, minlength=len(centres))
    col = np.stack([np.bincount(lab, w * rgb[:, j], minlength=len(centres)) for j in range(3)], 1)
    col = col / np.maximum(sw, 1e-12)[:, None]
    live = np.nonzero(sw > 0)[0]
    pal, cidx = palette_of(col[live], sw[live], colors, seed)
    floor = 0.6 / max(8, detail)            # no blob thinner than ~half a voxel at this detail
    parts = []
    for li, j in enumerate(live):
        m = lab == j
        pts, ww = xyz[m], w[m]
        mu = (pts * ww[:, None]).sum(0) / ww.sum()
        if len(pts) < 4:
            parts.append({"shape": "Ball", "p": mu, "s": np.full(3, floor * 2), "c": int(cidx[li])})
            continue
        d = pts - mu
        cov = (d * ww[:, None]).T @ d / ww.sum()
        ev, vec = np.linalg.eigh(cov)
        ev, vec = ev[::-1], vec[:, ::-1]
        if np.linalg.det(vec) < 0:
            vec[:, 2] *= -1
        ext = 2 * math.sqrt(3) * np.sqrt(np.maximum(ev, 0))      # a uniform patch of half-width a has sd a/sqrt(3)
        ext = np.maximum(ext * 1.15, [floor, floor, max(floor, 0.45 * ext[1])])   # overlap a little; fatten flat ones
        parts.append({"shape": "Ellipsoid", "p": mu, "s": ext, "r": _euler_xyz(vec), "c": int(cidx[li])})
    return {"palette": pal, "parts": parts, "size": g["size"], "stats": {"clusters": len(parts)}}


# --------------------------------------------------------------------------------------------- output
def _f(v: float) -> str:
    s = f"{float(v):.3f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def to_luau(name: str, style: str, res: dict) -> str:
    pal = res["palette"]
    lines = [f"-- Generated by blocksfield.splat_to_parts: spawn with Kit.PropKit.spawn(require(this), opts).",
             "return {", f'\tname = "{name}",', f'\tstyle = "{style}",',
             f"\tsize = Vector3.new({', '.join(_f(v) for v in res['size'])}),",
             "\tpalette = { " + ", ".join(
                 "Color3.fromRGB(%d, %d, %d)" % tuple(int(round(255 * float(c))) for c in np.clip(p, 0, 1))
                 for p in pal) + " },",
             "\tparts = {"]
    for p in res["parts"]:
        f = []
        if p.get("shape", "Block") != "Block":
            f.append(f'shape="{p["shape"]}"')
        f.append("p={" + ",".join(_f(v) for v in p["p"]) + "}")
        f.append("s={" + ",".join(_f(v) for v in p["s"]) + "}")
        if p.get("r") is not None and any(abs(a) > 0.05 for a in p["r"]):
            f.append("r={" + ",".join(_f(round(a, 1)) for a in p["r"]) + "}")
        f.append(f"c={p['c'] + 1}")
        lines.append("\t\t{" + ",".join(f) + "},")
    lines += ["\t},", "}", ""]
    return "\n".join(lines)


def convert(src: str | Path, name: str, style: str = "voxel", detail: int = 24, colors: int = 8,
            up: str | None = None, camera: dict | None = None, seed: int = 0) -> dict:
    """-> {luau, palette, parts, size, stats, seconds}. src is a 3DGS .ply or a mesh (.glb/.gltf/.obj)."""
    t0 = time.time()
    src = Path(src)
    if src.suffix.lower() == ".ply":
        g = read_ply(src)
        up = up or "idol"
    else:
        g = sample_mesh(src, seed=seed)
        up = up or "gltf"
    g["xyz"] = face_camera(to_roblox(g["xyz"], up), camera)
    return convert_gaussians(g, name, style, detail, colors, seed, t0)


def convert_gaussians(g: dict, name: str, style: str = "voxel", detail: int = 24, colors: int = 8, seed: int = 0,
                      t0: float | None = None) -> dict:
    t0 = time.time() if t0 is None else t0
    n = normalize(g)
    if style == "voxel":
        res = voxel_parts(n, detail, colors, seed)
    elif style == "blob":
        res = blob_parts(n, detail, colors, seed)
    else:
        raise ValueError("style must be voxel or blob")
    res["luau"] = to_luau(name, style, res)
    res["stats"].update(parts=len(res["parts"]), colors=len(res["palette"]), gaussians=int(len(n["xyz"])),
                        luau_bytes=len(res["luau"]))
    res["seconds"] = round(time.time() - t0, 2)
    return res


# --------------------------------------------------------------------------------------------- preview
def _part_samples(p: dict, spacing: float) -> tuple[np.ndarray, np.ndarray]:
    """Surface points and normals of one part, in asset space."""
    s = np.asarray(p["s"], float)
    shape = p.get("shape", "Block")
    rot = _rot_xyz(*p["r"]) if p.get("r") is not None else np.eye(3)
    if shape in ("Ball", "Ellipsoid"):
        if shape == "Ball":
            s = np.full(3, s.max())
        area = 4 * math.pi * ((s[0] * s[1] + s[1] * s[2] + s[0] * s[2]) / 12)
        m = int(np.clip(area / spacing ** 2, 24, 40000))
        i = np.arange(m) + 0.5
        phi, th = np.arccos(1 - 2 * i / m), math.pi * (1 + 5 ** 0.5) * i
        u = np.stack([np.cos(th) * np.sin(phi), np.cos(phi), np.sin(th) * np.sin(phi)], 1)
        pts = u * s / 2
        nrm = u / np.maximum(s / 2, 1e-6)
    else:
        pts, nrm = [], []
        for ax in range(3):
            a, b = [d for d in range(3) if d != ax]
            na, nb = max(2, int(math.ceil(s[a] / spacing))), max(2, int(math.ceil(s[b] / spacing)))
            ga, gb = np.meshgrid(np.linspace(-0.5, 0.5, na), np.linspace(-0.5, 0.5, nb))
            for sign in (-1, 1):
                q = np.zeros((ga.size, 3))
                q[:, a], q[:, b], q[:, ax] = ga.ravel() * s[a], gb.ravel() * s[b], sign * s[ax] / 2
                nn = np.zeros_like(q)
                nn[:, ax] = sign
                pts.append(q)
                nrm.append(nn)
        pts, nrm = np.concatenate(pts), np.concatenate(nrm)
    nrm = nrm / np.linalg.norm(nrm, axis=1, keepdims=True)
    return pts @ rot.T + np.asarray(p["p"], float), nrm @ rot.T


def render(res: dict, size: int = 384, yaws: tuple = (-35.0, 145.0), pitch: float = 22.0,
           bg=(236, 238, 242)) -> Image.Image:
    """Orthographic z-buffered point splat of the part set from 3/4 front and 3/4 back. Front = the -Z side."""
    spacing = 1.1 / (size * 0.78)          # ~1 px between samples at the projection scale
    pts, nrm, col = [], [], []
    pal = np.asarray(res["palette"], float)
    for p in res["parts"]:
        q, n = _part_samples(p, spacing)
        pts.append(q)
        nrm.append(n)
        col.append(np.repeat(pal[p["c"]][None], len(q), 0))
    pts, nrm, col = np.concatenate(pts), np.concatenate(nrm), np.concatenate(col)
    pts = pts - np.array([0, float(res["size"][1]) / 2, 0])
    light = np.array([-0.45, 0.8, -0.4])
    light /= np.linalg.norm(light)
    views = []
    for yaw in yaws:
        y, pt = math.radians(yaw), math.radians(pitch)
        # camera at azimuth yaw from -Z, looking at the origin; right/up/forward basis
        fwd = -np.array([math.sin(y) * math.cos(pt), math.sin(pt), -math.cos(y) * math.cos(pt)])
        right = np.cross(fwd, [0, 1, 0])
        right /= np.linalg.norm(right)
        upv = np.cross(right, fwd)
        u, v, dpt = pts @ right, pts @ upv, pts @ fwd
        facing = (nrm @ -fwd) > -0.05
        scale = size * 0.78
        px = np.clip((u * scale + size / 2).astype(int), 0, size - 2)
        py = np.clip((size / 2 - v * scale).astype(int), 0, size - 2)
        shade = 0.42 + 0.58 * np.clip(nrm @ light, 0, 1)
        c = np.clip(col * shade[:, None] * 1.05, 0, 1)
        order = np.argsort(-dpt[facing])
        img = np.ones((size, size, 3)) * np.array(bg) / 255
        fx, fy, fc = px[facing][order], py[facing][order], c[facing][order]
        for dx in (0, 1):
            for dy in (0, 1):
                img[fy + dy, fx + dx] = fc
        views.append((img * 255).astype(np.uint8))
    return Image.fromarray(np.concatenate(views, 1))


def preview(res: dict, source: Image.Image | None = None, size: int = 384) -> Image.Image:
    """[source image |] 3/4 front | 3/4 back, with a one-line caption."""
    from PIL import ImageDraw
    panels = []
    if source is not None:
        s = source.convert("RGB").copy()
        s.thumbnail((size, size))
        pad = Image.new("RGB", (size, size), (236, 238, 242))
        pad.paste(s, ((size - s.width) // 2, (size - s.height) // 2))
        panels.append(np.asarray(pad))
    panels.append(np.asarray(render(res, size)))
    img = Image.fromarray(np.concatenate(panels, 1))
    st = res["stats"]
    ImageDraw.Draw(img).text((8, 6), f"{st['parts']} parts, {st['colors']} colours", fill=(40, 40, 48))
    return img


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("--name", default="Prop")
    ap.add_argument("--style", default="voxel", choices=["voxel", "blob"])
    ap.add_argument("--detail", type=int, default=24)
    ap.add_argument("--colors", type=int, default=8)
    ap.add_argument("--up", choices=["idol", "gltf", "y", "z"])
    ap.add_argument("--camera", help="Idol's <name>_camera.json")
    ap.add_argument("--out", help="output .luau (a .png preview is written beside it)")
    a = ap.parse_args()
    cam = json.loads(Path(a.camera).read_text()) if a.camera else None
    res = convert(a.src, a.name, a.style, a.detail, a.colors, a.up, cam)
    print(json.dumps({**res["stats"], "seconds": res["seconds"]}))
    if a.out:
        Path(a.out).write_text(res["luau"], encoding="utf-8", newline="\n")
        preview(res).save(Path(a.out).with_suffix(".png"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
