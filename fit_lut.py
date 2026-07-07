from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from scipy.optimize import least_squares

from lut_parser import parse_cube, sample_lut
from lumetri_model import (
    BOUNDS_HIGH,
    BOUNDS_LOW,
    PARAM_NAMES,
    X0,
    apply_lumetri,
)


LABELS_KR = {
    "exposure": "Exposure (노출)",
    "contrast": "Contrast (대비)",
    "highlights": "Highlights (밝은 영역)",
    "shadows": "Shadows (어두운 영역)",
    "whites": "Whites (흰색 계열)",
    "blacks": "Blacks (검정 계열)",
    "temperature": "Temperature (색온도)",
    "tint": "Tint (색조)",
    "saturation": "Saturation (채도, 100=변화없음)",
}


def build_sample_points(gray_steps: int = 60, grid_steps: int = 9) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Build weighted fitting samples and return all points, gray ramp, and RGB grid."""
    gray_ramp = np.linspace(0, 1, gray_steps)
    gray_pts = np.stack([gray_ramp] * 3, axis=1)

    grid_axis = np.linspace(0, 1, grid_steps)
    grid = np.array(np.meshgrid(grid_axis, grid_axis, grid_axis)).T.reshape(-1, 3)

    input_pts = np.concatenate([gray_pts, gray_pts, grid], axis=0)
    return input_pts, gray_pts, grid


def fit_lut(cube_path: Path, output_dir: Path) -> dict[str, object]:
    cube = parse_cube(cube_path)
    print(f"LUT: {cube_path}")
    print(f"LUT size: {cube['size']}^3")

    input_pts, gray_pts, grid = build_sample_points()
    target_pts = sample_lut(cube, input_pts)
    print(f"총 피팅 샘플 수: {len(input_pts)}")

    def residuals(params: np.ndarray) -> np.ndarray:
        pred = apply_lumetri(input_pts, params)
        return (pred - target_pts).ravel()

    result = least_squares(
        residuals,
        X0,
        bounds=(BOUNDS_LOW, BOUNDS_HIGH),
        xtol=1e-12,
        ftol=1e-12,
        gtol=1e-12,
        max_nfev=20000,
    )

    fitted_x = result.x.copy()
    # The current contrast curve is sign-symmetric, so -51 and +51 are equivalent.
    # Normalize it to the Lumetri-style positive contrast value used in reports.
    fitted_x[PARAM_NAMES.index("contrast")] = abs(fitted_x[PARAM_NAMES.index("contrast")])
    fitted = dict(zip(PARAM_NAMES, fitted_x))

    print("\n=== 피팅된 Lumetri 슬라이더 값 (근사) ===")
    for key in PARAM_NAMES:
        print(f"  {LABELS_KR[key]:30s}: {fitted[key]:+8.2f}")

    pred_all = apply_lumetri(input_pts, fitted_x)
    target_gray = sample_lut(cube, gray_pts)
    pred_gray = apply_lumetri(gray_pts, fitted_x)
    target_grid = sample_lut(cube, grid)
    pred_grid = apply_lumetri(grid, fitted_x)

    err_all = float(np.sqrt(np.mean((pred_all - target_pts) ** 2)))
    err_gray = float(np.sqrt(np.mean((pred_gray - target_gray) ** 2)))
    err_grid = float(np.sqrt(np.mean((pred_grid - target_grid) ** 2)))

    luma_grid = 0.2126 * grid[:, 0] + 0.7152 * grid[:, 1] + 0.0722 * grid[:, 2]
    chroma_dist = np.sqrt(np.sum((grid - luma_grid[:, None]) ** 2, axis=1))
    per_point_err = np.sqrt(np.mean((pred_grid - target_grid) ** 2, axis=1))
    corr = float(np.corrcoef(chroma_dist, per_point_err)[0, 1])

    neutral_mask = chroma_dist < 0.05
    saturated_mask = chroma_dist > 0.4
    neutral_error_8bit = float(per_point_err[neutral_mask].mean() * 255)
    saturated_error_8bit = float(per_point_err[saturated_mask].mean() * 255)

    print("\n=== 오차(RMSE, 0-1 스케일 및 8bit 코드값 환산) ===")
    print(f"  전체 샘플                : {err_all:.4f}  (~{err_all * 255:.1f} / 255)")
    print(f"  회색 램프만(톤 커브)       : {err_gray:.4f}  (~{err_gray * 255:.1f} / 255)")
    print(f"  전체 RGB 그리드(색 포함)   : {err_grid:.4f}  (~{err_grid * 255:.1f} / 255)")
    print(f"\n  채도(회색축과의 거리) vs 오차 상관계수: {corr:.3f}")
    print(f"  무채색 근접 포인트(거리<0.05) 평균 오차: {neutral_error_8bit:.1f} / 255")
    print(f"  고채도 포인트(거리>0.4) 평균 오차      : {saturated_error_8bit:.1f} / 255")

    output_dir.mkdir(parents=True, exist_ok=True)
    npz_path = output_dir / "fit_results.npz"
    json_path = output_dir / "fit_summary.json"

    np.savez(
        npz_path,
        cube_path=str(cube_path),
        cube_title=cube.get("title") or "",
        fitted_x=fitted_x,
        gray_ramp=gray_pts[:, 0],
        target_gray=target_gray,
        pred_gray=pred_gray,
        grid=grid,
        target_grid=target_grid,
        pred_grid=pred_grid,
        chroma_dist=chroma_dist,
        per_point_err=per_point_err,
    )

    summary = {
        "cube_path": str(cube_path),
        "cube_title": cube.get("title"),
        "lut_size": cube["size"],
        "sample_count": int(len(input_pts)),
        "fitted": {key: float(value) for key, value in fitted.items()},
        "rmse": {
            "all": err_all,
            "all_8bit": err_all * 255,
            "gray": err_gray,
            "gray_8bit": err_gray * 255,
            "grid": err_grid,
            "grid_8bit": err_grid * 255,
        },
        "chroma_error_correlation": corr,
        "neutral_error_8bit": neutral_error_8bit,
        "saturated_error_8bit": saturated_error_8bit,
    }
    json_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"\n저장 완료: {npz_path}")
    print(f"요약 저장: {json_path}")
    return summary


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Fit a 3D .cube LUT to the approximate Premiere Lumetri Basic Correction model."
    )
    parser.add_argument("cube", type=Path, help="Path to a 3D .cube LUT file.")
    parser.add_argument(
        "-o",
        "--output-dir",
        type=Path,
        default=Path("outputs"),
        help="Directory for fit_results.npz and fit_summary.json.",
    )
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    fit_lut(args.cube, args.output_dir)
