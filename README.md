# lumetri-color-parser

Experimental tooling for fitting a 3D `.cube` LUT to an approximate Adobe Premiere Pro Lumetri Color **Basic Correction** slider model.

Live prototype: https://notoow.github.io/lumetri-color-parser/

The current prototype parses 3D LUTs, samples a gray ramp plus RGB grid, fits nine Lumetri-like parameters with least squares, and generates a diagnostic chart showing tone-curve and chroma-related error.

## What It Does

- Parses Iridas/Adobe 3D `.cube` LUT files.
- Samples LUT output with trilinear interpolation.
- Fits these Lumetri Basic Correction controls:
  - Exposure
  - Contrast
  - Highlights
  - Shadows
  - Whites
  - Blacks
  - Temperature
  - Tint
  - Saturation
- Reports RMSE in normalized `0-1` and 8-bit `0-255` units.
- Generates chart output from the latest fit result.
- Includes a static HTML prototype that mirrors the Premiere Lumetri panel layout.

## Important Caveat

This is a best-effort approximation, not an Adobe-authored reverse-engineering of Premiere internals.

Complex camera transform LUTs such as Log to Rec.709 often exceed what Basic Correction sliders can express. In those cases, the output is useful as the nearest Basic Correction-style estimate, not as exact LUT reconstruction.

## Setup

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

## Run A Fit

```powershell
python fit_lut.py ".cube/[오즈모액션6] DJI OSMO Action 6 D-LogM to Rec.709 LUT-11.17.cube"
python make_chart.py
```

Generated files are written to `outputs/`:

- `fit_results.npz`
- `fit_summary.json`
- `fit_chart.png`

## Files

- `lut_parser.py` - `.cube` parser and trilinear sampler.
- `lumetri_model.py` - approximate Lumetri Basic Correction model.
- `fit_lut.py` - least-squares fitting CLI.
- `make_chart.py` - diagnostic chart generator.
- `lumetri_decoder_prototype.html` - static UI prototype.
- `.cube/` - sample LUTs used for experiments.
