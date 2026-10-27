#!/usr/bin/env python3
"""Put the surroundings of a joined floor (land, roads, ruko blocks, parking) from a combined drawing into its 3D model.

  python3 tools/3d/kawasan.py --floor gf --svg "maps mall gf dan ug/gf ewalk penta dan kawasan.svg" [--check out.png]

The combined drawing has both malls (groups "ewalk" / "penta", each with its own tenant layer) and the area around them:
  base (top level)       the land (largest shape), "jalan" (roads), "pembatas lajur" (medians); "traffic" is left out
  gedung / base*         ruko podiums          gedung / ruko   ruko and other buildings
  other (top level)      e.g. "parkiran masuk"
The malls stay as they are in the floor's model (CMS links, paths and pins untouched). Each mall of the drawing is
fitted onto the model's mall by its named units (rotation, scale, shift); a point of the surroundings is moved with
the fits of both malls, weighted by how far it is from each, so everything between them lines up with both.
The result is written into the model as "context" (the 3D map and the CMS plan draw it under the malls), and
merge_floor.py keeps it when the floor is rejoined. Run it again after the combined drawing changes, then refresh the
plan (CMS > Peta 3D > Perbarui denah, or php tools/3d/rebase_floor.php --floor gf --plan-only --apply).
"""
import argparse
import json
import math
import os
import re
import sys
import xml.etree.ElementTree as ET

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import svg_to_3d as C  # noqa: E402
from register_floor import ROOT  # noqa: E402

BUILDINGS = {"ewalk": "ewalk", "penta": "pentacity", "pentacity": "pentacity"}


def norm(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def shapes_of(svg):
    """Every shape with the ids of the groups it sits in (outermost first) and its transform applied."""
    root = ET.parse(svg).getroot()
    out = []

    def walk(el, m, path):
        m = C.mat_mul(m, C.parse_transform(el.get("transform")))
        tag = el.tag.replace(C.NS, "")
        if tag == "g":
            for ch in el:
                walk(ch, m, path + [re.sub(r"-\d+$", "", (el.get("id") or el.get("data-name") or "").lower())])
            return
        if tag in ("polygon", "polyline", "rect", "ellipse", "circle", "path", "line"):
            for sub in C.shape_points(el):
                out.append({"path": path, "el": el, "pts": C.clean(C.apply(m, sub)), "name": C.unit_name(el).lower()})

    for ch in root:
        if ch.tag.replace(C.NS, "") != "image":  # reference plan: never read
            walk(ch, (1, 0, 0, 1, 0, 0), [])
    return out


def similarity(src, dst):
    a, b = src.mean(0), dst.mean(0)
    A, B = src - a, dst - b
    U, S, Vt = np.linalg.svd(A.T @ B)
    R = (U @ Vt).T
    if np.linalg.det(R) < 0:
        Vt[-1] *= -1
        R = (U @ Vt).T
    k = S.sum() / (A ** 2).sum()
    return k * R, b - k * R @ a


def dist_poly(p, P):
    """Distance from p to polygon P (same units), 0 inside."""
    x, y = p
    inside = False
    best = math.inf
    n = len(P)
    for i in range(n):
        (x1, y1), (x2, y2) = P[i], P[(i + 1) % n]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / ((y2 - y1) or 1e-12) + x1:
            inside = not inside
        dx, dy = x2 - x1, y2 - y1
        t = max(0.0, min(1.0, ((x - x1) * dx + (y - y1) * dy) / ((dx * dx + dy * dy) or 1e-12)))
        best = min(best, math.hypot(x - x1 - t * dx, y - y1 - t * dy))
    return 0.0 if inside else best


def strip(pts, width):
    """A line (2+ points) as a thin closed band `width` wide."""
    P = np.asarray(pts, float)
    left, right = [], []
    for i in range(len(P)):
        a, b = P[max(0, i - 1)], P[min(len(P) - 1, i + 1)]
        d = b - a
        nrm = np.array([-d[1], d[0]]) / (np.hypot(*d) or 1)
        left.append(P[i] + nrm * width / 2)
        right.append(P[i] - nrm * width / 2)
    return left + right[::-1]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--floor", required=True, help="joined floor id (gf)")
    ap.add_argument("--svg", required=True, help="combined drawing with both malls and their surroundings")
    ap.add_argument("--registry", default=os.path.join(ROOT, "data", "3d", "floors.json"))
    ap.add_argument("--check", default=None, help="top-view image of the model with the surroundings")
    a = ap.parse_args()

    entry = json.load(open(a.registry))["floors"].get(a.floor) or {}
    if not entry.get("model"):
        sys.exit(f"{a.floor} has no 3D model")
    mpath = os.path.join(ROOT, entry["model"])
    model = json.load(open(mpath))
    shapes = shapes_of(a.svg)

    # 1. each mall of the drawing onto the model's mall, by named units
    fits, outlines = {}, {}
    for key, b in BUILDINGS.items():
        if b in fits:
            continue
        mine = [s for s in shapes if key in s["path"]]
        if not mine:
            continue
        by_name = {}
        for u in model["units"]:
            if u.get("building") == b and u.get("name"):
                by_name.setdefault(norm(u["name"]), []).append(u)
        src, dst = [], []
        for s in mine:
            n = norm(s["name"])
            if "tenant" in s["path"] and len(s["pts"]) >= 3 and n and len(by_name.get(n, [])) == 1:
                src.append(np.mean(s["pts"], 0))
                dst.append(np.mean(by_name[n][0]["poly"], 0))
        if len(src) < 3:
            sys.exit(f"{b}: only {len(src)} named units of the drawing match the model; need 3")
        src, dst = np.array(src), np.array(dst)
        L, t = similarity(src, dst)
        res = np.linalg.norm((L @ src.T).T + t - dst, axis=1)
        fits[b] = (L, t)
        base = [s["pts"] for s in mine if "base" in s["path"] and len(s["pts"]) >= 3]
        outlines[b] = max(base, key=lambda P: C.area(P)) if base else np.vstack([np.asarray(s["pts"]) for s in mine if "tenant" in s["path"]]).tolist()
        k = math.sqrt(abs(np.linalg.det(L)))
        print(f"{b}: {len(src)} named units, {k:.4f} m per drawing unit, turned {math.degrees(math.atan2(L[1, 0], L[0, 0])):.2f} deg, "
              f"off by mean {res.mean():.2f} m (max {res.max():.2f} m)")
    if len(fits) < 2:
        sys.exit("the drawing needs both malls (groups ewalk and penta)")
    scale = float(np.mean([math.sqrt(abs(np.linalg.det(L))) for L, _ in fits.values()]))

    def move(pts):
        out = []
        for p in pts:
            w, acc = 0.0, np.zeros(2)
            for b, (L, t) in fits.items():
                d = dist_poly(p, outlines[b]) * scale  # metres
                wi = 1 / (d + 1) ** 3
                w += wi
                acc += wi * (L @ np.asarray(p, float) + t)
            q = acc / w
            out.append([round(float(q[0]), 2), round(float(q[1]), 2)])
        return out

    # 2. the surroundings, by layer and name
    ctx = []
    top = [s for s in shapes if "mall" not in s["path"] and not any(k in s["path"] for k in BUILDINGS)]  # not the malls
    land = [s for s in top if s["path"][:1] == ["base"] and len(s["path"]) == 1 and len(s["pts"]) >= 3 and not s["name"]]
    land = max(land, key=lambda s: C.area(s["pts"])) if land else None
    for s in top:
        P, path, name = s["pts"], s["path"], s["name"]
        if "traffic" in path or len(P) < 2:
            continue
        if s is land:
            kind = "ground"
        elif "jalan" in name:
            kind = "road"
        elif "pembatas" in name or "median" in name:
            kind = "divider"
            if len(P) < 3 or C.area(P) * scale * scale < 2:
                P = strip(P, 0.6 / scale)
        elif "parkir" in name or "parking" in name:
            kind = "parking"
        elif "gedung" in path and any(x.startswith("base") for x in path[1:]):
            kind = "podium"
        elif "gedung" in path:
            kind = "building"
        else:
            continue
        if len(P) < 3:
            continue
        item = {"kind": kind, "poly": move(P)}
        if name and kind not in ("ground",):
            item["name"] = name
        ctx.append(item)
    order = {"ground": 0, "road": 1, "parking": 2, "divider": 3, "podium": 4, "building": 5}
    ctx.sort(key=lambda c: order[c["kind"]])
    model["context"] = ctx
    model["context_source"] = {"svg": os.path.basename(a.svg), "fits": {b: {"matrix": [[round(float(v), 6) for v in row] for row in np.hstack([L, t[:, None]])]} for b, (L, t) in fits.items()}}
    with open(mpath, "w") as f:
        json.dump(model, f, separators=(",", ":"), ensure_ascii=False)
    from collections import Counter
    print(f"{a.floor}: surroundings " + ", ".join(f"{n} {k}" for k, n in sorted(Counter(c["kind"] for c in ctx).items(), key=lambda x: order[x[0]])) + f" -> {entry['model']}")
    print(f"  refresh the CMS plan: php tools/3d/rebase_floor.php --floor {a.floor} --plan-only --apply  (or CMS > Peta 3D > Perbarui denah), then Publish")

    if a.check:
        import cv2
        allp = np.vstack([np.asarray(c["poly"]) for c in ctx] + [np.asarray(s["outer"]) for s in model["slab"]])
        lo, hi = allp.min(0) - 5, allp.max(0) + 5
        k = 1800 / (hi[0] - lo[0])
        img = np.full((int((hi[1] - lo[1]) * k) + 1, 1800, 3), 255, np.uint8)
        px = lambda P: np.round((np.asarray(P) - lo) * k).astype(np.int32)  # noqa: E731
        col = {"ground": (225, 228, 230), "road": (150, 150, 150), "parking": (120, 200, 120), "divider": (90, 160, 90), "podium": (200, 215, 235), "building": (255, 255, 255)}
        for c in ctx:
            cv2.fillPoly(img, [px(c["poly"])], col[c["kind"]])
            if c["kind"] in ("building", "podium"):
                cv2.polylines(img, [px(c["poly"])], True, (40, 120, 200), 1)
        for s in model["slab"]:
            cv2.fillPoly(img, [px(s["outer"])], (200, 230, 243))
        for u in model["units"]:
            if u.get("poly"):
                cv2.polylines(img, [px(u["poly"])], True, (120, 60, 160), 1)
        cv2.imwrite(a.check, img)
        print(f"check image: {a.check}")


if __name__ == "__main__":
    main()
