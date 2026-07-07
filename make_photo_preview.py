from __future__ import annotations

import argparse
import json
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
from PIL import Image

from lumetri_model import PARAM_NAMES, apply_lumetri
from lut_parser import parse_cube, sample_lut


def load_rgb(path: Path, max_width: int) -> np.ndarray:
    image = Image.open(path).convert("RGB")
    if max_width > 0 and image.width > max_width:
        height = round(image.height * max_width / image.width)
        image = image.resize((max_width, height), Image.Resampling.LANCZOS)
    return np.asarray(image, dtype=np.float64) / 255.0


def save_rgb(path: Path, rgb: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image = Image.fromarray(np.round(np.clip(rgb, 0.0, 1.0) * 255).astype(np.uint8), mode="RGB")
    image.save(path)


def load_fit_params(summary_path: Path) -> np.ndarray:
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    fitted = summary["fitted"]
    return np.array([fitted[name] for name in PARAM_NAMES], dtype=np.float64)


def make_comparison(
    source_path: Path,
    cube_path: Path,
    summary_path: Path,
    output_path: Path,
    output_json_path: Path,
    lut_output_path: Path,
    lumetri_output_path: Path,
    max_width: int,
) -> None:
    source_rgb = load_rgb(source_path, max_width=max_width)
    cube = parse_cube(cube_path)
    fit_params = load_fit_params(summary_path)

    lut_rgb = sample_lut(cube, source_rgb)
    lumetri_rgb = apply_lumetri(source_rgb, fit_params)

    save_rgb(lut_output_path, lut_rgb)
    save_rgb(lumetri_output_path, lumetri_rgb)

    lut_vs_input_rmse = float(np.sqrt(np.mean((lut_rgb - source_rgb) ** 2)))
    lumetri_vs_lut_rmse = float(np.sqrt(np.mean((lumetri_rgb - lut_rgb) ** 2)))
    mean_lut_delta = np.mean(lut_rgb - source_rgb, axis=(0, 1))
    mean_lumetri_delta = np.mean(lumetri_rgb - lut_rgb, axis=(0, 1))

    fig, axes = plt.subplots(1, 3, figsize=(16, 6), constrained_layout=True)
    fig.patch.set_facecolor("#151515")
    titles = [
        "Input Test Photo\n(normalized LUT-domain sample)",
        f"Actual LUT Output\nRMSE vs input {lut_vs_input_rmse * 255:.1f}/255",
        f"Lumetri Approximation\nRMSE vs LUT {lumetri_vs_lut_rmse * 255:.1f}/255",
    ]
    images = [source_rgb, lut_rgb, lumetri_rgb]

    for ax, title, image in zip(axes, titles, images):
        ax.imshow(np.clip(image, 0.0, 1.0))
        ax.set_title(title, color="#f2f2f2", fontsize=11, pad=10)
        ax.axis("off")
        ax.set_facecolor("#151515")

    fig.suptitle("Representative Photo Through DJI Action 6 LUT", color="#f2f2f2", fontsize=18, fontweight="bold")
    fig.text(
        0.5,
        0.02,
        "Synthetic reference photo generated for visual judgment. This preview applies the LUT to image RGB code values; it is not a camera-calibrated D-LogM capture.",
        color="#b8b8b8",
        ha="center",
        fontsize=9,
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(output_path, dpi=160, facecolor=fig.get_facecolor())
    plt.close(fig)

    output_json_path.write_text(
        json.dumps(
            {
                "source_path": str(source_path),
                "cube_path": str(cube_path),
                "fit_summary_path": str(summary_path),
                "preview_note": "Synthetic reference photo generated for visual judgment. RGB values are treated as LUT-domain code values, not as a camera-calibrated D-LogM capture.",
                "image_shape": list(source_rgb.shape),
                "lut_vs_input_rmse": lut_vs_input_rmse,
                "lut_vs_input_rmse_8bit": lut_vs_input_rmse * 255,
                "lumetri_vs_lut_rmse": lumetri_vs_lut_rmse,
                "lumetri_vs_lut_rmse_8bit": lumetri_vs_lut_rmse * 255,
                "mean_lut_delta_rgb": [float(value) for value in mean_lut_delta],
                "mean_lumetri_delta_rgb": [float(value) for value in mean_lumetri_delta],
                "outputs": {
                    "comparison": str(output_path),
                    "lut": str(lut_output_path),
                    "lumetri": str(lumetri_output_path),
                },
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    print(f"saved {output_path}")
    print(f"saved {lut_output_path}")
    print(f"saved {lumetri_output_path}")
    print(f"saved {output_json_path}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Create a representative photo before/after LUT comparison.")
    parser.add_argument("source", type=Path, help="Path to the source RGB image.")
    parser.add_argument("cube", type=Path, help="Path to a 3D .cube LUT file.")
    parser.add_argument(
        "--fit-summary",
        type=Path,
        default=Path("outputs") / "fit_summary.json",
        help="Path to fit_summary.json for the Lumetri approximation panel.",
    )
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=Path("docs") / "assets" / "representative_photo_comparison.png",
        help="Path for the side-by-side comparison PNG.",
    )
    parser.add_argument(
        "--output-json",
        type=Path,
        default=Path("docs") / "assets" / "representative_photo_comparison.json",
        help="Path for numeric preview metrics.",
    )
    parser.add_argument(
        "--lut-output",
        type=Path,
        default=Path("docs") / "assets" / "representative_photo_lut.png",
        help="Path for the LUT-rendered photo panel.",
    )
    parser.add_argument(
        "--lumetri-output",
        type=Path,
        default=Path("docs") / "assets" / "representative_photo_lumetri.png",
        help="Path for the Lumetri approximation photo panel.",
    )
    parser.add_argument("--max-width", type=int, default=1200, help="Resize the preview input to this max width.")
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    make_comparison(
        args.source,
        args.cube,
        args.fit_summary,
        args.output,
        args.output_json,
        args.lut_output,
        args.lumetri_output,
        args.max_width,
    )
