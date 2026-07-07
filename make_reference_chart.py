from __future__ import annotations

import argparse
import json
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np

from lut_parser import parse_cube, sample_lut


REFERENCE_PATCHES = [
    ("Black", (0.0, 0.0, 0.0)),
    ("Gray 18%", (0.18, 0.18, 0.18)),
    ("Gray 25%", (0.25, 0.25, 0.25)),
    ("Gray 50%", (0.5, 0.5, 0.5)),
    ("Gray 75%", (0.75, 0.75, 0.75)),
    ("White", (1.0, 1.0, 1.0)),
    ("75% White", (0.75, 0.75, 0.75)),
    ("75% Yellow", (0.75, 0.75, 0.0)),
    ("75% Cyan", (0.0, 0.75, 0.75)),
    ("75% Green", (0.0, 0.75, 0.0)),
    ("75% Magenta", (0.75, 0.0, 0.75)),
    ("75% Red", (0.75, 0.0, 0.0)),
    ("75% Blue", (0.0, 0.0, 0.75)),
    ("Red", (1.0, 0.0, 0.0)),
    ("Green", (0.0, 1.0, 0.0)),
    ("Blue", (0.0, 0.0, 1.0)),
    ("Cyan", (0.0, 1.0, 1.0)),
    ("Magenta", (1.0, 0.0, 1.0)),
    ("Yellow", (1.0, 1.0, 0.0)),
    ("Mid Warm", (0.72, 0.48, 0.36)),
    ("Sky-ish", (0.26, 0.48, 0.8)),
    ("Foliage-ish", (0.18, 0.38, 0.16)),
    ("Shadow Cool", (0.08, 0.1, 0.16)),
    ("Highlight Warm", (0.9, 0.82, 0.68)),
]


def clipped(rgb: np.ndarray) -> np.ndarray:
    return np.clip(rgb, 0.0, 1.0)


def rgb_to_hex(rgb: np.ndarray) -> str:
    values = np.round(clipped(rgb) * 255).astype(int)
    return f"#{values[0]:02x}{values[1]:02x}{values[2]:02x}"


def make_reference_chart(cube_path: Path, output_path: Path, summary_path: Path) -> None:
    cube = parse_cube(cube_path)
    names = [name for name, _rgb in REFERENCE_PATCHES]
    inputs = np.array([rgb for _name, rgb in REFERENCE_PATCHES], dtype=np.float64)
    outputs = sample_lut(cube, inputs)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    summary_path.parent.mkdir(parents=True, exist_ok=True)

    ncols = 6
    nrows = int(np.ceil(len(names) / ncols))
    fig, axes = plt.subplots(nrows, ncols, figsize=(14, 8.4))
    fig.patch.set_facecolor("#151515")
    fig.suptitle("Reference RGB Patches Through LUT", color="#f2f2f2", fontsize=18, fontweight="bold", y=0.98)
    fig.text(
        0.5,
        0.94,
        "Top swatch: input normalized RGB. Bottom swatch: LUT output. These are LUT-domain test patches, not camera-calibrated chart measurements.",
        color="#b8b8b8",
        ha="center",
        fontsize=10,
    )

    summary = {
        "cube_path": str(cube_path),
        "lut_size": int(cube["size"]),
        "note": "Patch values are normalized LUT-domain RGB samples. Gray 18% here means code value 0.18, not a camera-log middle-gray calibration.",
        "patches": [],
    }

    for index, ax in enumerate(axes.flat):
        ax.set_facecolor("#151515")
        ax.set_xlim(0, 1)
        ax.set_ylim(0, 1)
        ax.axis("off")

        if index >= len(names):
            continue

        name = names[index]
        input_rgb = inputs[index]
        output_rgb = outputs[index]
        delta_8bit = float(np.linalg.norm((output_rgb - input_rgb) * 255))

        ax.add_patch(plt.Rectangle((0.08, 0.52), 0.84, 0.34, color=rgb_to_hex(input_rgb), ec="#333333", lw=0.8))
        ax.add_patch(plt.Rectangle((0.08, 0.16), 0.84, 0.34, color=rgb_to_hex(output_rgb), ec="#333333", lw=0.8))
        ax.text(0.08, 0.89, name, color="#f2f2f2", fontsize=9, fontweight="bold", ha="left", va="bottom")
        ax.text(0.08, 0.49, "Input", color="#9a9a9a", fontsize=7, ha="left", va="top")
        ax.text(0.08, 0.13, "LUT Output", color="#9a9a9a", fontsize=7, ha="left", va="top")
        ax.text(0.92, 0.13, f"dRGB {delta_8bit:.0f}", color="#b8b8b8", fontsize=7, ha="right", va="top")

        summary["patches"].append(
            {
                "name": name,
                "input_rgb": [float(value) for value in input_rgb],
                "output_rgb": [float(value) for value in output_rgb],
                "input_8bit": [int(value) for value in np.round(clipped(input_rgb) * 255)],
                "output_8bit": [int(value) for value in np.round(clipped(output_rgb) * 255)],
                "delta_rgb_8bit": delta_8bit,
            }
        )

    plt.subplots_adjust(left=0.04, right=0.98, top=0.89, bottom=0.04, hspace=0.32, wspace=0.18)
    fig.savefig(output_path, dpi=160, facecolor=fig.get_facecolor())
    plt.close(fig)

    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"saved {output_path}")
    print(f"saved {summary_path}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Render before/after reference RGB patches through a .cube LUT.")
    parser.add_argument("cube", type=Path, help="Path to a 3D .cube LUT file.")
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=Path("docs") / "assets" / "reference_transform.png",
        help="Path for the generated PNG chart.",
    )
    parser.add_argument(
        "--summary",
        type=Path,
        default=Path("docs") / "assets" / "reference_transform.json",
        help="Path for the generated JSON summary.",
    )
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    make_reference_chart(args.cube, args.output, args.summary)
