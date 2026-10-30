"""3D Gaussian splat (or textured mesh) -> a procedural Roblox prop: a few hundred primitive Parts as Luau data.

No asset uploads: the prop is a ModuleScript that Kit.PropKit turns into Parts at run time.

Both styles start from the same closed, coloured voxel solid: large Gaussians are splatted over their footprint (not
just their centre), small holes are closed before the inside is flood-filled, and colours come only from what a viewer
sees (multi-view composited visibility), quantised in OKLab and voted per voxel, so the dark interior never shows.

    voxel  the solid's visible cells greedily merged with same-colour neighbours into boxes (interior voxels take any
           colour, so boxes go deep)
    blob   ellipsoids (Part + SpecialMesh Sphere): k-means patches of each same-colour surface region, plus a few
           hidden core blobs behind them

Asset coordinates are Roblox's: Y up, the longest side is 1, the origin is the bottom centre of the bounding box,
and the side the source image showed faces -Z (the model's LookVector) when the camera is known.

    python -m blocksfield.splat_to_parts in.ply --name Mushroom --style voxel --detail 24 --out Mushroom.luau
"""
from __future__ import annotations

import argparse
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
    if {"rot_0", "rot_1", "rot_2", "rot_3"} <= names:     # 3DGS stores the quaternion as (w, x, y, z)
        q = np.stack([v["rot_0"], v["rot_1"], v["rot_2"], v["rot_3"]], 1).astype(np.float64)
        rot = _quat_to_mat(q / np.maximum(np.linalg.norm(q, axis=1, keepdims=True), 1e-12))
    else:
        rot = np.broadcast_to(np.eye(3), (count, 3, 3))
    return {"xyz": xyz, "rgb": np.clip(rgb, 0, 1).astype(np.float32), "opacity": opacity.astype(np.float32),
            "scale": scale.astype(np.float32),
            # axes[:, i] = the i-th principal semi-axis (one standard deviation) as a world vector
            "axes": (rot * scale[:, None, :]).transpose(0, 2, 1).astype(np.float32)}


def _quat_to_mat(q: np.ndarray) -> np.ndarray:
    w, x, y, z = q.T
    return np.stack([1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y),
                     2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
                     2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)], 1).reshape(-1, 3, 3)


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
    axes = g.get("axes")
    axes = np.zeros((len(g["xyz"]), 3, 3)) if axes is None else axes
    keep = g["opacity"] >= min_opacity
    xyz, rgb, op, axes = g["xyz"][keep], g["rgb"][keep], g["opacity"][keep], axes[keep]
    if len(xyz) < 50:
        raise ValueError(f"only {len(xyz)} Gaussians above opacity {min_opacity}: nothing to convert")
    lo, hi = np.percentile(xyz, 0.5, axis=0), np.percentile(xyz, 99.5, axis=0)
    pad = 0.02 * (hi - lo).max()
    inside = np.all((xyz >= lo - pad) & (xyz <= hi + pad), axis=1)
    xyz, rgb, op, axes = xyz[inside], rgb[inside], op[inside], axes[inside]
    lo, hi = xyz.min(0), xyz.max(0)
    ext = float((hi - lo).max())
    centre = np.array([(lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2])
    xyz = (xyz - centre) / ext
    return {"xyz": xyz.astype(np.float64), "rgb": rgb.astype(np.float64), "opacity": op.astype(np.float64),
            "axes": axes.astype(np.float64) / ext, "size": (hi - lo) / ext}


def _transform_axes(g: dict, fn) -> None:
    """Apply a linear point map (to_roblox, face_camera) to the Gaussians' principal axes too."""
    if g.get("axes") is not None:
        a = np.asarray(g["axes"])
        g["axes"] = fn(a.reshape(-1, 3)).reshape(a.shape)


def splat_points(g: dict, step: float, seed: int = 0, cap: int = 256) -> dict:
    """Gaussian centres -> surface samples. A Gaussian wider than half a voxel covers a patch, not a point (Idol paints
    smooth areas such as a chest lid or a mushroom cap with a few large flat Gaussians): sample its 1.5-sigma ellipsoid
    every ~step/2, each sample with the Gaussian's opacity times its falloff. -> {xyz, rgb, alpha}."""
    xyz, rgb, op, axes = g["xyz"], g["rgb"], g["opacity"], g.get("axes")
    if axes is None or not len(axes):
        return {"xyz": xyz, "rgb": rgb, "alpha": op}
    h = step / 2
    sig = np.linalg.norm(axes, axis=2)                      # [n, 3] semi-axis lengths
    big = sig.max(1) > h
    a = np.maximum(1.5 * sig[big], h / 2)
    m = np.clip(np.ceil(4.19 * a.prod(1) / h ** 3), 1, cap).astype(int)
    src = np.repeat(np.nonzero(big)[0], m)
    rng = np.random.default_rng(seed)
    d = rng.normal(size=(len(src), 3))
    d *= (rng.random(len(src)) ** (1 / 3) / np.maximum(np.linalg.norm(d, axis=1), 1e-12))[:, None]
    off = 1.5 * np.einsum("ni,nij->nj", d, axes[src])
    r2 = (1.5 ** 2) * (d * d).sum(1)
    small = np.nonzero(~big)[0]
    return {"xyz": np.concatenate([xyz[small], xyz[src] + off]),
            "rgb": np.concatenate([rgb[small], rgb[src]]),
            "alpha": np.concatenate([op[small], op[src] * np.exp(-0.5 * r2)])}


def visibility(xyz: np.ndarray, alpha: np.ndarray, pixel: float) -> np.ndarray:
    """How much each sample shows in an alpha-composited orthographic render from 26 directions (the faces, edges and
    corners of a cube): sum over views of alpha * transmittance in front of it. Interior samples score ~0, so they
    stop muddying the colours (Idol fills the inside of a prop with dark Gaussians)."""
    dirs = np.array([(x, y, z) for x in (-1, 0, 1) for y in (-1, 0, 1) for z in (-1, 0, 1) if (x, y, z) != (0, 0, 0)],
                    float)
    dirs /= np.linalg.norm(dirs, axis=1, keepdims=True)
    la = np.log1p(-np.clip(alpha, 0, 0.995))
    vis = np.zeros(len(xyz))
    for f in dirs:
        r = np.cross(f, [0, 1, 0] if abs(f[1]) < 0.9 else [1, 0, 0])
        r /= np.linalg.norm(r)
        u = np.cross(f, r)
        pu, pv = np.floor(xyz @ r / pixel).astype(np.int64), np.floor(xyz @ u / pixel).astype(np.int64)
        pix = (pu - pu.min()) * (pv.max() - pv.min() + 1) + (pv - pv.min())
        order = np.lexsort((xyz @ f, pix))                  # per pixel, nearest first
        ps, ls = pix[order], la[order]
        cs = np.cumsum(ls)
        start = np.r_[True, ps[1:] != ps[:-1]]
        base = np.maximum.accumulate(np.where(start, np.arange(len(ps)), 0))
        before = cs - ls - (cs[base] - ls[base])           # log transmittance in front of each sample
        vis[order] += alpha[order] * np.exp(before)
    return vis


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
    """Quantise colours to k in OKLab (perceptual: a red cap and its white spots stay apart instead of averaging to
    tan), merging near-duplicates, with a small chroma boost for a clean stylised look.
    -> (palette [m, 3] 0..1, index per colour)."""
    pal, idx = kmeans(oklab(colors), k, weights, iters=25, seed=seed)
    # merge palette entries that are barely distinguishable so the merge pass is not split by invisible differences
    order = np.argsort(-np.bincount(idx, weights, minlength=len(pal)))
    remap, kept = {}, []
    for i in order:
        hit = next((j for j, q in enumerate(kept) if np.linalg.norm(pal[q] - pal[i]) < 0.03), None)
        if hit is None:
            kept.append(i)
            remap[i] = len(kept) - 1
        else:
            remap[i] = hit
    pal = pal[kept] * np.array([1.0, 1.15, 1.15])          # chroma (a, b) up 15%
    # the splat bakes the picture's shading in and Roblox lights the parts again: lift the darks a little
    pal[:, 0] = np.clip(pal[:, 0], 0, 1) ** 0.85
    return np.clip(from_oklab(pal), 0, 1), np.array([remap[i] for i in idx])


def oklab(rgb: np.ndarray) -> np.ndarray:
    c = np.clip(rgb, 0, 1)
    lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    lms = lin @ np.array([[0.4122214708, 0.5363325363, 0.0514459929], [0.2119034982, 0.6806995451, 0.1073969566],
                          [0.0883024619, 0.2817188376, 0.6299787005]]).T
    return np.cbrt(lms) @ np.array([[0.2104542553, 0.7936177850, -0.0040720468],
                                    [1.9779984951, -2.4285922050, 0.4505937099],
                                    [0.0259040371, 0.7827717662, -0.8086757660]]).T


def from_oklab(lab: np.ndarray) -> np.ndarray:
    lms = (lab @ np.array([[1, 0.3963377774, 0.2158037573], [1, -0.1055613458, -0.0638541728],
                           [1, -0.0894841775, -1.2914855480]]).T) ** 3
    lin = lms @ np.array([[4.0767416621, -3.3077115913, 0.2309699292], [-1.2684380046, 2.6097574011, -0.3413193965],
                          [-0.0041960863, -0.7034186147, 1.7076147010]]).T
    lin = np.clip(lin, 0, 1)
    return np.where(lin <= 0.0031308, 12.92 * lin, 1.055 * lin ** (1 / 2.4) - 0.055)


# --------------------------------------------------------------------------------------------- voxel style
def _neighbours_all(occ: np.ndarray) -> np.ndarray:
    """True where all six face neighbours are occupied (the voxel cannot be seen)."""
    p = np.pad(occ, 1)
    return (p[2:, 1:-1, 1:-1] & p[:-2, 1:-1, 1:-1] & p[1:-1, 2:, 1:-1] & p[1:-1, :-2, 1:-1]
            & p[1:-1, 1:-1, 2:] & p[1:-1, 1:-1, :-2])


def _grow(occ: np.ndarray) -> np.ndarray:
    p = np.pad(occ, 1)
    return (occ | p[2:, 1:-1, 1:-1] | p[:-2, 1:-1, 1:-1] | p[1:-1, 2:, 1:-1] | p[1:-1, :-2, 1:-1]
            | p[1:-1, 1:-1, 2:] | p[1:-1, 1:-1, :-2])


def _fill_interior(occ: np.ndarray) -> np.ndarray:
    """Occupied + every empty cell the outside cannot reach (flood fill from the border, 6-connected)."""
    outside = np.zeros_like(occ)
    outside[0], outside[-1], outside[:, 0], outside[:, -1], outside[:, :, 0], outside[:, :, -1] = (True,) * 6
    outside &= ~occ
    while True:
        new = _grow(outside) & ~occ
        if new.sum() == outside.sum():
            return ~outside
        outside = new


def _solidify(occ: np.ndarray) -> np.ndarray:
    """A splat is a shell, and a shell with one missing voxel floods hollow. Close it first: grow by one voxel, fill
    what the outside cannot reach, shrink back by one (holes up to ~2 voxels wide get sealed), keep the original."""
    grown = _fill_interior(np.pad(_grow(np.pad(occ, 1)), 1))
    shrunk = ~_grow(~grown)
    return shrunk[2:-2, 2:-2, 2:-2] | occ


def _spread_labels(color: np.ndarray, solid: np.ndarray) -> np.ndarray:
    """Unlabelled solid cells (-1) take a labelled 6-neighbour's label, repeated until every solid cell has one."""
    color = color.copy()
    while True:
        todo = solid & (color < 0)
        if not todo.any():
            return color
        p = np.pad(color, 1, constant_values=-1)
        got = False
        for sl in ((slice(2, None), slice(1, -1), slice(1, -1)), (slice(None, -2), slice(1, -1), slice(1, -1)),
                   (slice(1, -1), slice(2, None), slice(1, -1)), (slice(1, -1), slice(None, -2), slice(1, -1)),
                   (slice(1, -1), slice(1, -1), slice(2, None)), (slice(1, -1), slice(1, -1), slice(None, -2))):
            nb = p[sl]
            take = todo & (color < 0) & (nb >= 0)
            color[take] = nb[take]
            got |= bool(take.any())
        if not got:                                         # a solid island with no colour at all
            color[todo] = 0
            return color


def _despeckle(color: np.ndarray, lab: np.ndarray, near: float = 0.15, passes: int = 2) -> np.ndarray:
    """A surface voxel that at most one of its 26 neighbours shares a colour with takes its neighbourhood's majority
    colour, but only when the two are similar shades (OKLab distance < near): baked-in shading noise goes, and with it
    hundreds of one-voxel boxes, while real detail (a white spot on a red cap, a brass lock on wood) stays."""
    k = len(lab)
    close = np.linalg.norm(lab[:, None] - lab[None], axis=2) < near
    offs = [(dx, dy, dz) for dx in (-1, 0, 1) for dy in (-1, 0, 1) for dz in (-1, 0, 1) if (dx, dy, dz) != (0, 0, 0)]
    for _ in range(passes):
        onehot = (color[..., None] == np.arange(k)).astype(np.int16)
        p = np.pad(onehot, ((1, 1), (1, 1), (1, 1), (0, 0)))
        X, Y, Z = color.shape
        counts = sum(p[1 + dx:1 + dx + X, 1 + dy:1 + dy + Y, 1 + dz:1 + dz + Z] for dx, dy, dz in offs)
        own = np.take_along_axis(counts, np.maximum(color, 0)[..., None], 3)[..., 0]
        maj = counts.argmax(3)
        flip = (color >= 0) & (own <= 1) & (counts.max(3) >= 2) & close[np.maximum(color, 0), maj]
        if not flip.any():
            break
        color = np.where(flip, maj, color)
    return color


def voxelize(g: dict, n: int, colors: int = 8, seed: int = 0) -> dict:
    """Normalised Gaussians -> a closed solid voxel grid with a palette index on every solid cell.

    Occupancy comes from the opacity of the splatted samples; colour only from what a viewer would see (multi-view
    composited visibility), voted per voxel on palette indices rather than averaged, so a voxel straddling a red cap
    and a white spot is red or white, not pink, and the dark interior never leaks out."""
    size = g["size"]
    vs = 1.0 / n
    dims = np.maximum(1, np.ceil(size / vs - 1e-6).astype(int))
    lo = np.array([-size[0] / 2, 0.0, -size[2] / 2])
    total = int(np.prod(dims))
    pts = splat_points(g, vs, seed)
    flat = np.ravel_multi_index(np.clip(((pts["xyz"] - lo) / vs).astype(int), 0, dims - 1).T, dims)
    mass = np.bincount(flat, pts["alpha"], minlength=total)
    nz = mass[mass > 0]
    # occupied: enough opacity that it is surface, not a stray floater (relative to a typical surface voxel)
    occ = (mass > max(0.5, 0.04 * np.percentile(nz, 60)) if len(nz) else mass > 0).reshape(dims)
    solid = _solidify(occ)
    hidden = _neighbours_all(solid) & solid
    vis = visibility(pts["xyz"], pts["alpha"], vs / 2)
    seen = vis > 1e-3 * vis.max()
    pal, lab = palette_of(pts["rgb"][seen], vis[seen], colors, seed)
    votes = np.bincount(flat[seen] * len(pal) + lab, vis[seen], minlength=total * len(pal)).reshape(total, len(pal))
    color = np.where(votes.sum(1) > 0, votes.argmax(1), -1)
    color[~solid.ravel()] = -1
    color[hidden.ravel()] = -1                              # the inside takes the nearest surface colour
    color = _despeckle(color.reshape(dims), oklab(pal))
    color = _spread_labels(color, solid)
    return {"palette": pal, "color": color, "solid": solid, "hidden": hidden, "lo": lo, "vs": vs, "dims": dims,
            "samples": len(flat)}


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
    size = g["size"]
    # slender props (a lamp post) get a finer grid so their thin side is not one voxel; squat ones keep `detail`
    n = int(np.clip(round(detail / np.clip(math.sqrt(sorted(size)[1]), 0.55, 1.0)), 8, 48))
    v = voxelize(g, n, colors, seed)
    lo, vs, solid, hidden = v["lo"], v["vs"], v["solid"], v["hidden"]
    boxes = _greedy_boxes(v["color"], hidden)
    parts = []
    for x0, y0, z0, x1, y1, z1, c in boxes:
        a = lo + np.array([x0, y0, z0]) * vs
        b = lo + np.array([x1, y1, z1]) * vs
        parts.append({"p": (a + b) / 2, "s": b - a, "c": c})
    return {"palette": v["palette"], "parts": parts, "size": v["dims"] * vs, "stats": {"grid": v["dims"].tolist(),
            "voxels": int(solid.sum()), "visible": int((solid & ~hidden).sum()), "boxes": len(boxes),
            "samples": v["samples"]}}


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


def _components(cells: np.ndarray, lab: np.ndarray) -> np.ndarray:
    """Connected regions (26-neighbour) of same-label cells. cells [n, 3] int, lab [n] -> region id per cell, 0.."""
    key = {tuple(c): i for i, c in enumerate(cells.tolist())}
    a, b = [], []
    for off in [(dx, dy, dz) for dx in (-1, 0, 1) for dy in (-1, 0, 1) for dz in (-1, 0, 1) if (dx, dy, dz) > (0, 0, 0)]:
        for i, c in enumerate(cells.tolist()):
            j = key.get((c[0] + off[0], c[1] + off[1], c[2] + off[2]))
            if j is not None and lab[j] == lab[i]:
                a.append(i)
                b.append(j)
    root = np.arange(len(cells))
    a, b = np.array(a, int), np.array(b, int)
    while len(a):
        lo = np.minimum(root[a], root[b])
        new = root.copy()
        np.minimum.at(new, a, lo)
        np.minimum.at(new, b, lo)
        new = new[new]                                      # pointer jumping
        if np.array_equal(new, root):
            break
        root = new
    return np.unique(root, return_inverse=True)[1]


def blob_parts(g: dict, detail: int = 24, colors: int = 8, seed: int = 0) -> dict:
    """Ellipsoids over the closed voxel solid instead of k-means of raw Gaussians (which put discs on the skin with
    holes between them and averaged a red cap with its white spots to tan): the visible shell is clustered per colour
    into surface patches, so a blob never straddles a colour boundary and a white spot keeps its own small blob; a few
    core blobs, inset two voxels so they stay hidden, make it solid behind the skin."""
    v = voxelize(g, int(np.clip(round(detail * 1.25), 12, 40)), colors, seed)
    vs, solid, hidden, color = v["vs"], v["solid"], v["hidden"], v["color"]
    core = _neighbours_all(hidden) & hidden
    k = int(np.clip(detail * 8, 40, 240))
    k_core = int(round(0.2 * k)) if core.any() else 0
    groups = []
    shell = np.argwhere(solid & ~hidden)
    lab = color[tuple(shell.T)]
    comp = _components(shell, lab)
    sizes = np.bincount(comp)
    budget = k - k_core
    # largest regions first; a region gets blobs in proportion to its area, specks beyond the budget are left to
    # the patches around them
    for r in np.argsort(-sizes):
        if budget <= 0:
            break
        m = np.nonzero(comp == r)[0]
        n_r = int(np.clip(round((k - k_core) * len(m) / len(shell)), 1, budget))
        _, cl = kmeans(shell[m].astype(float), n_r, iters=20, seed=seed)
        groups += [(int(lab[m[0]]), shell[m[cl == j]], True) for j in np.unique(cl)]
        budget -= n_r
    if k_core:
        cells = np.argwhere(core)
        _, cl = kmeans(cells.astype(float), k_core, iters=20, seed=seed)
        clab = color[tuple(cells.T)]
        groups += [(int(np.bincount(clab[cl == j]).argmax()), cells[cl == j], False) for j in np.unique(cl)]
    parts = []
    for c, cells, skin in groups:
        pts = v["lo"] + (cells + 0.5) * vs
        mu = pts.mean(0)
        d = pts - mu
        cov = d.T @ d / len(pts) + np.eye(3) * vs * vs / 12        # each cell is a cube, not a point
        ev, vec = np.linalg.eigh(cov)
        ev, vec = ev[::-1], vec[:, ::-1]
        if np.linalg.det(vec) < 0:
            vec[:, 2] *= -1
        ext = 2 * math.sqrt(5) * np.sqrt(np.maximum(ev, 0))      # a solid ellipsoid of semi-axis a has sd a/sqrt(5)
        # skin patches overlap their neighbours a little and are at least two voxels thick so they reach the core
        ext = np.maximum(ext * 1.15, [vs, vs, 2 * vs]) if skin else ext
        parts.append({"shape": "Ellipsoid", "p": mu, "s": ext, "r": _euler_xyz(vec), "c": c})
    return {"palette": v["palette"], "parts": parts, "size": g["size"],
            "stats": {"clusters": len(parts), "voxels": int(solid.sum())}}


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
    _transform_axes(g, lambda v: face_camera(to_roblox(v, up), camera))
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
