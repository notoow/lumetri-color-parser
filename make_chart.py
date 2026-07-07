from __future__ import annotations

import argparse
from pathlib import Path

import matplotlib.font_manager as fm
import matplotlib.pyplot as plt
import numpy as np


def configure_korean_font() -> None:
    candidates = [
        font
        for font in fm.findSystemFonts()
        if any(name in font for name in ("Nanum", "CJK", "NotoSansCJK", "Malgun", "AppleGothic"))
    ]
    if candidates:
        font_path = candidates[0]
        fm.fontManager.addfont(font_path)
        plt.rcParams["font.family"] = fm.FontProperties(fname=font_path).get_name()
    plt.rcParams["axes.unicode_minus"] = False


def make_chart(results_path: Path, output_path: Path) -> None:
    configure_korean_font()

    data = np.load(results_path)
    gray_ramp = data["gray_ramp"]
    target_gray = data["target_gray"]
    pred_gray = data["pred_gray"]
    chroma_dist = data["chroma_dist"]
    per_point_err = data["per_point_err"]

    fig, axes = plt.subplots(1, 2, figsize=(12, 5))

    ax = axes[0]
    ax.plot([0, 1], [0, 1], "--", color="#bbbbbb", label="입력=출력 (기준선)")
    ax.plot(gray_ramp, target_gray[:, 1], color="#2563eb", lw=2.5, label="실제 LUT")
    ax.plot(gray_ramp, pred_gray[:, 1], color="#dc2626", lw=2.5, ls="-.", label="피팅된 Lumetri 근사 모델")
    ax.set_xlabel("입력 (그레이 램프 코드값)")
    ax.set_ylabel("출력")
    ax.set_title("톤 커브: 실제 LUT vs 근사 모델")
    ax.legend(fontsize=9, loc="upper left")
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)

    ax2 = axes[1]
    ax2.scatter(chroma_dist, per_point_err * 255, s=14, alpha=0.5, c=chroma_dist, cmap="viridis")
    ax2.set_xlabel("입력의 채도 (회색축과의 거리)")
    ax2.set_ylabel("피팅 오차 (RMSE, 8bit 코드값)")
    ax2.set_title("채도별 근사 오차")
    z = np.polyfit(chroma_dist, per_point_err * 255, 1)
    xs = np.linspace(chroma_dist.min(), chroma_dist.max(), 50)
    ax2.plot(xs, np.polyval(z, xs), color="#dc2626", lw=2, label="추세선")
    ax2.legend(fontsize=9)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    plt.tight_layout()
    plt.savefig(output_path, dpi=150)
    print(f"saved {output_path}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Create a fit diagnostic chart from fit_results.npz.")
    parser.add_argument(
        "results",
        nargs="?",
        type=Path,
        default=Path("outputs") / "fit_results.npz",
        help="Path to fit_results.npz.",
    )
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=Path("outputs") / "fit_chart.png",
        help="Path for the generated chart PNG.",
    )
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    make_chart(args.results, args.output)
