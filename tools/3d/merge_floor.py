#!/usr/bin/env python3
"""Join one drawing per building into the 3D model of a floor both buildings share (gf, ug) and register it.

  python3 tools/3d/merge_floor.py --floor gf --part ewalk=data/3d/ewalk-GF.json --part pentacity=data/3d/pentacity-GF.json [--check out.png]

Each drawing is fitted onto the old 2D floor like register_floor.py does, from that building's tenant names only
(each building is too small on the old shared floor for the corridor alignment). The first part keeps its metres; the others are placed beside it by a rigid move (rotation + shift: every
drawing is already in metres) taken from the fits. The joined model data/3d/bsb-<FLOOR>.json has:
  - every unit and facility id prefixed with its building ("ewalk-GF-starbuck") and a "building" field;
  - one slab per building;
  - a new artboard around both buildings (the CMS plan's viewBox once the floor is rebased).
The registry entry gets the unit links and "parts": where each drawing sits and its own affine old floor -> joined
metres. The old shared drawings are not drawn to one scale (GF: e-Walk ~20 % off against Pentacity), so the rebase
moves each building's CMS points with that building's affine and blends them in between (tools/3d/rebase_floor.php
--floor gf). "toMetres" (least squares over both) only places the floor in the kiosk until it is rebased.

--place building=rot,dx,dy sets a part's placement instead of fitting it (degrees, metres in the first part's frame).
The buildings don't move between floors, so a floor whose old drawing is off (GF) can take the placement from one
that fits well (UG), carried through each building's LG drawing; docs/3D.md has the numbers used.

After re-converting one of the drawings, rejoin it the same way (placements and the CMS frame are kept) and refresh
the plan:
  python3 tools/3d/merge_floor.py --floor gf
  php tools/3d/rebase_floor.php --floor gf --plan-only --apply
"""
import argparse
import json
import math
import os
import sys
import time

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from register_floor import ROOT, check_image, closest_view, fit_model  # noqa: E402

MARGIN_M = 12.0     # floor around the buildings on the artboard
ARTBOARD_W = 2400.0  # artboard width of a new joined model (CMS plan units)


def rel(p):
    return os.path.relpath(p if os.path.isabs(p) else os.path.join(ROOT, p), ROOT)


def load(p):
    return json.load(open(p if os.path.isabs(p) else os.path.join(ROOT, p)))


def rigid(src, dst):
    """Rotation + shift (no scale) taking src points onto dst, and the scale a similarity fit would have needed."""
    a, b = src.mean(0), dst.mean(0)
    A, B = src - a, dst - b
    U, S, Vt = np.linalg.svd(A.T @ B)
    Rm = (U @ Vt).T
    if np.linalg.det(Rm) < 0:  # a mirror is never a placement
        Vt[-1] *= -1
        Rm = (U @ Vt).T
    scale = S.sum() / (A ** 2).sum()
    th = math.atan2(Rm[1, 0], Rm[0, 0])
    return th, b - Rm @ a, scale


def mover(th, t):
    Rm = np.array([[math.cos(th), -math.sin(th)], [math.sin(th), math.cos(th)]])
    return lambda P: (np.asarray(P, float) @ Rm.T + t)


def join(parts, floor_code, frame=None, keep=None):
    """parts: [(building, model, model_rel, th, shift)] -> joined model (frame = existing {m_per_unit, origin, artboard});
    keep: fields of the previous model carried over (the surroundings from kawasan.py)."""
    units, facs, slab, srcs, info = [], [], [], [], []
    for b, B, mrel, th, t in parts:
        f = mover(th, t)
        P = lambda pts: [[round(float(x), 2), round(float(y), 2)] for x, y in f(pts)]  # noqa: E731
        for u in B["units"]:
            v = dict(u, id=f"{b}-{u['id']}", building=b)
            if u.get("poly"):
                v["poly"] = P(u["poly"])
            if u.get("label"):
                (x, y), = f([[u["label"]["x"], u["label"]["y"]]])
                v["label"] = dict(u["label"], x=round(float(x), 2), y=round(float(y), 2), angle=round(u["label"]["angle"] + math.degrees(th), 1))
            units.append(v)
        for fc in B.get("facilities", []):
            (x, y), = f([[fc["x"], fc["y"]]])
            facs.append(dict(fc, id=f"{b}-{fc['id']}", building=b, x=round(float(x), 2), y=round(float(y), 2), poly=P(fc["poly"]) if fc.get("poly") else None))
        for sp in B["slab"]:
            slab.append({"outer": P(sp["outer"]), "holes": [P(h) for h in sp.get("holes", [])], "building": b})
        srcs.append(B.get("source_svg", ""))
        info.append({"building": b, "model": mrel, "rot": round(math.degrees(th), 4), "shift": [round(float(t[0]), 3), round(float(t[1]), 3)]})
    if floor_code == "ug":
        slab.append({
            "outer": [
                [-110.20, -1.50],
                [-90.10, 1.20],
                [-88.20, -19.50],
                [-105.50, -22.50]
            ],
            "holes": [],
            "building": "bridge"
        })
    pts = np.array([p for sp in slab for p in sp["outer"]])
    if frame:
        mpu, origin, artboard = frame["m_per_unit"], frame["origin"], frame["artboard"]
        a = (pts / mpu + origin)
        if a.min() < artboard[0] or a[:, 0].max() > artboard[0] + artboard[2] or a[:, 1].max() > artboard[1] + artboard[3]:
            print("WARNING: the joined drawing runs past the CMS artboard; check the plan after refreshing it")
    else:
        lo, hi = pts.min(0) - MARGIN_M, pts.max(0) + MARGIN_M
        mpu = round(float((hi[0] - lo[0]) / ARTBOARD_W), 5)
        origin = [round(float(-lo[0] / mpu), 2), round(float(-lo[1] / mpu), 2)]
        artboard = [0.0, 0.0, round(float((hi[0] - lo[0]) / mpu), 2), round(float((hi[1] - lo[1]) / mpu), 2)]
    first = parts[0][1]
    return {"version": 2, "mall": "bsb", "floor": floor_code, "floor_name": first.get("floor_name", floor_code), "level": first.get("level", 0),
            "source_svg": " + ".join(srcs), "m_per_unit": mpu, "origin": origin, "artboard": artboard,
            "rim": max(p[1].get("rim", 1.2) for p in parts), "slab": slab, "units": units, "facilities": facs, "parts": info, **(keep or {})}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--floor", required=True, help="shared floor id in data/directory.json (gf, ug)")
    ap.add_argument("--part", action="append", default=[], help="building=data/3d/<mall>-<FLOOR>.json, the first one keeps its metres")
    ap.add_argument("--directory", default=os.path.join(ROOT, "data", "directory.json"))
    ap.add_argument("--registry", default=os.path.join(ROOT, "data", "3d", "floors.json"))
    ap.add_argument("--place", action="append", default=[], help="building=rot,dx,dy: placement of that part instead of the fitted one")
    ap.add_argument("--chrome", default=None)
    ap.add_argument("--check", default=None, help="write an overlay image of the fit on the old floor")
    a = ap.parse_args()

    reg = json.load(open(a.registry)) if os.path.exists(a.registry) else {"version": 1, "floors": {}}
    entry = reg["floors"].get(a.floor) or {}
    out_rel = entry.get("model") or None

    if not a.part:  # rejoin from the registry (after a drawing was converted again)
        parts = entry.get("parts")
        if not parts:
            sys.exit(f"{a.floor} has no joined drawings yet: pass --part building=model for each building")
        prev = load(out_rel)
        frame = {k: prev[k] for k in ("m_per_unit", "origin", "artboard")}
        P = [(b, load(p["model"]), p["model"], math.radians(p["rot"]), np.array(p["shift"], float)) for b, p in parts.items()]
        model = join(P, prev.get("floor"), frame, {k: prev[k] for k in ("context", "context_source") if k in prev})  # same placements: surroundings still fit
        with open(os.path.join(ROOT, out_rel), "w") as f:
            json.dump(model, f, separators=(",", ":"), ensure_ascii=False)
        print(f"{a.floor}: rejoined {', '.join(parts)} -> {out_rel}")
        print(f"  refresh the CMS plan: CMS > Peta 3D > Perbarui denah, or  php tools/3d/rebase_floor.php --floor {a.floor} --plan-only --apply")
        return

    if entry.get("frame") == "plan":
        sys.exit(f"{a.floor} is already rebased onto its joined drawing; after re-converting a drawing run  python3 tools/3d/merge_floor.py --floor {a.floor}")
    D = json.load(open(a.directory))
    fl = next((f for f in D["floors"] if f["id"] == a.floor), None)
    if not fl:
        sys.exit(f"floor {a.floor} not in directory.json")
    fits = []
    for spec in a.part:
        b, path = spec.split("=", 1)
        B = load(path)
        r = fit_model(D, B, fl, building=b, chrome=a.chrome, refine=False)  # a building is small on the old shared floor: names only
        fits.append((b, B, rel(path), r))
        print(f"{b}: {len(r['links'])}/{len(r['tenants'])} tenants linked, {r['inside']}/{len(r['nodes'])} nearby graph nodes deep inside a unit")
        print("\n".join(r["report"]))

    # placements: part k -> first part's metres through the old floor, as a rigid move
    A0 = fits[0][3]["M"]
    to_old = lambda M, P: (np.linalg.inv(M[:, :2]) @ (np.asarray(P, float) - M[:, 2]).T).T  # noqa: E731
    to_m0 = lambda P: (A0[:, :2] @ np.asarray(P, float).T).T + A0[:, 2]  # noqa: E731
    parts, corr_old, corr_new, part_T = [], [], [], []
    for b, B, mrel, r in fits:
        S = np.array([p for sp in B["slab"] for p in sp["outer"]], float)
        given = next((v.split("=", 1)[1] for v in a.place if v.split("=", 1)[0] == b), None)
        if r is fits[0][3]:
            th, t, k = 0.0, np.zeros(2), 1.0
        elif given:
            rot, dx, dy = (float(v) for v in given.split(","))
            th, t = math.radians(rot), np.array([dx, dy])
            th_fit, t_fit, k = rigid(S, to_m0(to_old(r["M"], S)))
            print(f"{b}: placed as given, {rot:.2f} deg, shift ({dx:.1f}, {dy:.1f}) m (its fit on the old floor: {math.degrees(th_fit):.2f} deg, "
                  f"({t_fit[0]:.1f}, {t_fit[1]:.1f}) m, scale {k:.3f})")
        else:
            th, t, k = rigid(S, to_m0(to_old(r["M"], S)))
            print(f"{b}: placed beside {fits[0][0]} by {math.degrees(th):.2f} deg, shift ({t[0]:.1f}, {t[1]:.1f}) m; "
                  f"the old floor would have scaled it by {k:.3f}" + ("  <- check this drawing's scale" if abs(k - 1) > 0.06 else ""))
        parts.append((b, B, mrel, th, t))
        Rm = np.array([[math.cos(th), -math.sin(th)], [math.sin(th), math.cos(th)]])
        part_T.append(np.hstack([Rm @ r["M"][:, :2], (Rm @ r["M"][:, 2] + t)[:, None]]))  # old floor -> joined metres
        corr_old.append(to_old(r["M"], S))
        corr_new.append(mover(th, t)(S))
    # one affine old floor -> joined metres for the rebase, least squares over every building's outline
    Xo, Yn = np.vstack(corr_old), np.vstack(corr_new)
    Amat = np.linalg.lstsq(np.hstack([Xo, np.ones((len(Xo), 1))]), Yn, rcond=None)[0].T
    for (b, *_), Xb, Yb in zip(parts, corr_old, corr_new):
        e = np.linalg.norm((Amat[:, :2] @ Xb.T).T + Amat[:, 2] - Yb, axis=1)
        print(f"  one affine for the whole old floor would be off by mean {e.mean():.2f} m, max {e.max():.2f} m at {b} (the rebase uses each building's own)")

    floor_code = fits[0][1].get("floor", a.floor.upper())
    model = join(parts, floor_code)
    if out_rel and os.path.exists(os.path.join(ROOT, out_rel)) and "context" in load(out_rel):
        print(f"  the surroundings were dropped (new placement): run tools/3d/kawasan.py --floor {a.floor} again")
    out_rel = out_rel or f"data/3d/bsb-{floor_code}.json"
    with open(os.path.join(ROOT, out_rel), "w") as f:
        json.dump(model, f, separators=(",", ":"), ensure_ascii=False)
    links = {f"{b}-{uid}": tid for b, _, _, r in fits for uid, tid in r["links"].items()}
    views = [closest_view(T[:, :2]) for T in part_T]  # the camera of the old drawing, from the building fitted best
    view = min(views, key=lambda v: v["fit_error"])
    reg["floors"][a.floor] = {
        "model": out_rel,
        "edits": entry.get("edits") or f"data/3d/edits/{os.path.basename(out_rel)}",
        "toMetres": [[round(float(v), 6) for v in row] for row in Amat],
        "view": entry.get("view_locked") and entry.get("view") or {"azimuth": view["azimuth"], "polar": view["polar"]},
        "tenants": links,
        "parts": {p["building"]: {"model": p["model"], "rot": p["rot"], "shift": p["shift"], "toMetres": [[round(float(v), 6) for v in row] for row in T],
                                  "links": len(r["links"])} for p, (_, _, _, r), T in zip(model["parts"], fits, part_T)},
        "registered": time.strftime("%Y-%m-%d %H:%M"), "viewFit": view["fit_error"],
    }
    with open(a.registry, "w") as f:
        json.dump(reg, f, indent=1, ensure_ascii=False)
    print(f"{a.floor}: {len(model['units'])} units, {len(model['facilities'])} facilities, artboard {model['artboard']} -> {out_rel}; "
          f"{len(links)} tenants linked; view azimuth {view['azimuth']} polar {view['polar']}")
    print(f"-> {os.path.relpath(a.registry, ROOT)}   next:  php tools/3d/rebase_floor.php --floor {a.floor} --check /tmp/periksa.svg")
    if a.check:
        check_image(a.check, fits[0][3]["img"], [(B, r["M"], r["links"]) for _, B, _, r in fits], [n for n in D["graph"]["nodes"] if n["floor"] == a.floor])


if __name__ == "__main__":
    main()
