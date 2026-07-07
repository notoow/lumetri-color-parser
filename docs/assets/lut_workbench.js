(function () {
  const DEMO_CUBE_URL = ".cube/[osmoaction6] DJI OSMO Action 6 D-LogM to Rec.709 LUT-11.17.cube";
  const DEMO_IMAGE_URL = "docs/assets/representative_photo_input.png";
  const DEMO_FIT_URL = "docs/assets/action6_fit_summary.json";
  const MAX_PREVIEW_WIDTH = 720;
  const DIFF_GAIN = 4.0;
  const PARAM_ORDER = ["exposure", "contrast", "highlights", "shadows", "whites", "blacks", "temperature", "tint", "saturation"];
  const PARAM_LOW = [-5, -100, -100, -100, -100, -100, -100, -100, 0];
  const PARAM_HIGH = [5, 100, 100, 100, 100, 100, 100, 100, 200];
  const PARAM_START = [0, 0, 0, 0, 0, 0, 0, 0, 100];

  const state = {
    cube: null,
    cubeName: "",
    image: null,
    imageName: "",
    fitting: false,
  };

  function $(id) {
    return document.getElementById(id);
  }

  function setStatus(message, tone) {
    const status = $("preview-status");
    if (!status) {
      return;
    }
    status.textContent = message;
    status.dataset.tone = tone || "neutral";
  }

  function setFitStatus(message, tone) {
    const status = $("fit-status");
    if (!status) {
      return;
    }
    status.textContent = message;
    status.dataset.tone = tone || "neutral";
  }

  function clamp01(value) {
    return Math.min(1, Math.max(0, value));
  }

  function parseFloatTriplet(parts) {
    if (parts.length !== 3) {
      return null;
    }
    const values = parts.map(Number);
    return values.every(Number.isFinite) ? values : null;
  }

  function parseCube(text) {
    let size = null;
    let domainMin = [0, 0, 0];
    let domainMax = [1, 1, 1];
    const rows = [];

    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) {
        continue;
      }

      const parts = line.split(/\s+/);
      const keyword = parts[0].toUpperCase();

      if (keyword === "TITLE") {
        continue;
      }
      if (keyword === "LUT_3D_SIZE") {
        size = Number(parts[1]);
        continue;
      }
      if (keyword === "DOMAIN_MIN") {
        const parsed = parseFloatTriplet(parts.slice(1, 4));
        if (parsed) {
          domainMin = parsed;
        }
        continue;
      }
      if (keyword === "DOMAIN_MAX") {
        const parsed = parseFloatTriplet(parts.slice(1, 4));
        if (parsed) {
          domainMax = parsed;
        }
        continue;
      }
      if (keyword === "LUT_1D_SIZE") {
        throw new Error("1D LUT은 아직 지원하지 않습니다.");
      }

      const rgb = parseFloatTriplet(parts);
      if (rgb) {
        rows.push(rgb);
      }
    }

    if (!Number.isInteger(size) || size <= 1) {
      throw new Error("LUT_3D_SIZE를 찾지 못했습니다.");
    }

    const expected = size ** 3;
    if (rows.length !== expected) {
      throw new Error(`LUT 데이터 행 수가 맞지 않습니다. 예상 ${expected}, 실제 ${rows.length}`);
    }

    const lut = new Float32Array(expected * 3);
    let rowIndex = 0;
    for (let b = 0; b < size; b += 1) {
      for (let g = 0; g < size; g += 1) {
        for (let r = 0; r < size; r += 1) {
          const outIndex = ((r * size + g) * size + b) * 3;
          const row = rows[rowIndex];
          lut[outIndex] = row[0];
          lut[outIndex + 1] = row[1];
          lut[outIndex + 2] = row[2];
          rowIndex += 1;
        }
      }
    }

    return { size, domainMin, domainMax, lut };
  }

  function lutValue(cube, r, g, b, channel) {
    return cube.lut[((r * cube.size + g) * cube.size + b) * 3 + channel];
  }

  function sampleCube(cube, rgb) {
    const coords = [0, 1, 2].map((channel) => {
      const min = cube.domainMin[channel];
      const max = cube.domainMax[channel];
      const normalized = (rgb[channel] - min) / (max - min || 1);
      return clamp01(normalized) * (cube.size - 1);
    });

    const r0 = Math.floor(coords[0]);
    const g0 = Math.floor(coords[1]);
    const b0 = Math.floor(coords[2]);
    const r1 = Math.min(r0 + 1, cube.size - 1);
    const g1 = Math.min(g0 + 1, cube.size - 1);
    const b1 = Math.min(b0 + 1, cube.size - 1);
    const fr = coords[0] - r0;
    const fg = coords[1] - g0;
    const fb = coords[2] - b0;
    const out = [0, 0, 0];

    for (let channel = 0; channel < 3; channel += 1) {
      const c000 = lutValue(cube, r0, g0, b0, channel);
      const c100 = lutValue(cube, r1, g0, b0, channel);
      const c010 = lutValue(cube, r0, g1, b0, channel);
      const c110 = lutValue(cube, r1, g1, b0, channel);
      const c001 = lutValue(cube, r0, g0, b1, channel);
      const c101 = lutValue(cube, r1, g0, b1, channel);
      const c011 = lutValue(cube, r0, g1, b1, channel);
      const c111 = lutValue(cube, r1, g1, b1, channel);
      const c00 = c000 * (1 - fr) + c100 * fr;
      const c10 = c010 * (1 - fr) + c110 * fr;
      const c01 = c001 * (1 - fr) + c101 * fr;
      const c11 = c011 * (1 - fr) + c111 * fr;
      const c0 = c00 * (1 - fg) + c10 * fg;
      const c1 = c01 * (1 - fg) + c11 * fg;
      out[channel] = c0 * (1 - fb) + c1 * fb;
    }

    return out;
  }

  function buildFitSamples(graySteps = 60, gridSteps = 9) {
    const samples = [];
    for (let index = 0; index < graySteps; index += 1) {
      const value = index / (graySteps - 1);
      samples.push([value, value, value]);
      samples.push([value, value, value]);
    }

    for (let b = 0; b < gridSteps; b += 1) {
      for (let g = 0; g < gridSteps; g += 1) {
        for (let r = 0; r < gridSteps; r += 1) {
          samples.push([
            r / (gridSteps - 1),
            g / (gridSteps - 1),
            b / (gridSteps - 1),
          ]);
        }
      }
    }
    return samples;
  }

  function exposureValue(value, exposure) {
    const x = Math.max(0, value);
    const gain = 2 ** exposure;
    if (exposure >= 0) {
      return 1 - ((1 - Math.min(x, 1)) ** gain);
    }
    return x * gain;
  }

  function contrastValue(value, contrast) {
    const k = (contrast / 100) * 4;
    if (Math.abs(k) < 1e-6) {
      return value;
    }
    const sig = (input) => 1 / (1 + Math.exp(-k * (input - 0.5) * 2));
    const y0 = sig(0);
    const y1 = sig(1);
    return (sig(value) - y0) / (y1 - y0);
  }

  function applyLumetri(rgb, params) {
    let r = rgb[0];
    let g = rgb[1];
    let b = rgb[2];
    const exposure = params[0];
    const contrast = params[1];
    const highlights = params[2] / 100;
    const shadows = params[3] / 100;
    const whites = params[4] / 100;
    const blacks = params[5] / 100;
    const temperature = params[6] / 100;
    const tint = params[7] / 100;
    const saturation = params[8] / 100;

    r = exposureValue(r, exposure);
    g = exposureValue(g, exposure);
    b = exposureValue(b, exposure);

    r = contrastValue(r, contrast);
    g = contrastValue(g, contrast);
    b = contrastValue(b, contrast);

    let wr = 1 / (1 + Math.exp(-8 * (r - 0.6)));
    let wg = 1 / (1 + Math.exp(-8 * (g - 0.6)));
    let wb = 1 / (1 + Math.exp(-8 * (b - 0.6)));
    r += highlights * 0.4 * wr * (1 - r);
    g += highlights * 0.4 * wg * (1 - g);
    b += highlights * 0.4 * wb * (1 - b);

    wr = 1 / (1 + Math.exp(8 * (r - 0.4)));
    wg = 1 / (1 + Math.exp(8 * (g - 0.4)));
    wb = 1 / (1 + Math.exp(8 * (b - 0.4)));
    r += shadows * 0.4 * wr * r;
    g += shadows * 0.4 * wg * g;
    b += shadows * 0.4 * wb * b;

    r *= 1 + whites * 0.5;
    g *= 1 + whites * 0.5;
    b *= 1 + whites * 0.5;

    if (blacks >= 0) {
      r += blacks * 0.25 * Math.exp(-8 * r);
      g += blacks * 0.25 * Math.exp(-8 * g);
      b += blacks * 0.25 * Math.exp(-8 * b);
    } else {
      r *= 1 + blacks * 0.5;
      g *= 1 + blacks * 0.5;
      b *= 1 + blacks * 0.5;
    }

    r = Math.max(0, r);
    g = Math.max(0, g);
    b = Math.max(0, b);

    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    r = luma + (r - luma) * saturation;
    g = luma + (g - luma) * saturation;
    b = luma + (b - luma) * saturation;

    r = r * (1 + temperature * 0.25) + tint * 0.12;
    g = g - tint * 0.15;
    b = b * (1 - temperature * 0.25) + tint * 0.12;

    return [r, g, b];
  }

  function scoreParams(params, samples, targets) {
    let total = 0;
    for (let index = 0; index < samples.length; index += 1) {
      const pred = applyLumetri(samples[index], params);
      const target = targets[index];
      const dr = pred[0] - target[0];
      const dg = pred[1] - target[1];
      const db = pred[2] - target[2];
      total += dr * dr + dg * dg + db * db;
    }
    return total / (samples.length * 3);
  }

  function fitLumetriToCube(cube) {
    const samples = buildFitSamples();
    const targets = samples.map((sample) => sampleCube(cube, sample));
    const grayCount = 120;
    const starts = [
      PARAM_START,
      [0, 50, -40, -100, -5, 3, -2, -7, 110],
      [0, 50, -75, -100, 0, 0, 0, 0, 110],
      [0, 25, 0, -75, 0, 0, 0, 0, 100],
    ];

    let params = PARAM_START.slice();
    let bestScore = Number.POSITIVE_INFINITY;

    for (const start of starts) {
      const candidateParams = start.slice();
      const steps = [0.5, 25, 25, 25, 25, 25, 25, 25, 25];
      let candidateScore = scoreParams(candidateParams, samples, targets);

      for (let level = 0; level < 8; level += 1) {
        let changed = true;
        let loops = 0;
        while (changed && loops < 5) {
          changed = false;
          loops += 1;
          for (let i = 0; i < candidateParams.length; i += 1) {
            const trialValues = [candidateParams[i] + steps[i], candidateParams[i] - steps[i]];
            for (const trialValue of trialValues) {
              const nextValue = Math.max(PARAM_LOW[i], Math.min(PARAM_HIGH[i], trialValue));
              if (Math.abs(nextValue - candidateParams[i]) < 1e-9) {
                continue;
              }
              const trial = candidateParams.slice();
              trial[i] = nextValue;
              const trialScore = scoreParams(trial, samples, targets);
              if (trialScore + 1e-12 < candidateScore) {
                candidateParams[i] = nextValue;
                candidateScore = trialScore;
                changed = true;
              }
            }
          }
        }
        for (let i = 0; i < steps.length; i += 1) {
          steps[i] *= 0.5;
        }
      }

      if (candidateScore < bestScore) {
        params = candidateParams;
        bestScore = candidateScore;
      }
    }

    params[PARAM_ORDER.indexOf("contrast")] = Math.abs(params[PARAM_ORDER.indexOf("contrast")]);
    const allRmse = Math.sqrt(scoreParams(params, samples, targets));
    const grayRmse = Math.sqrt(scoreParams(params, samples.slice(0, grayCount), targets.slice(0, grayCount)));
    const fitted = {};
    const limited = [];
    PARAM_ORDER.forEach((name, index) => {
      fitted[name] = params[index];
      if (Math.abs(params[index] - PARAM_LOW[index]) < 0.1 || Math.abs(params[index] - PARAM_HIGH[index]) < 0.1) {
        limited.push(name);
      }
    });

    return {
      fitted,
      allRmse,
      grayRmse,
      sampleCount: samples.length,
      limited,
    };
  }

  function renderFitResult(result) {
    if (window.applyFittedLumetri) {
      window.applyFittedLumetri(result.fitted, { cubeName: state.cubeName });
    }
    setMetric("fit-metric-rmse", `${(result.allRmse * 255).toFixed(1)} / 255`);
    setMetric("fit-metric-gray-rmse", `${(result.grayRmse * 255).toFixed(1)} / 255`);
    setMetric("fit-metric-samples", `${result.sampleCount}`);
    setMetric("fit-metric-limits", result.limited.length ? result.limited.join(", ") : "없음");
    if (result.limited.length || result.allRmse * 255 > 6) {
      setFitStatus("Basic Correction만으로는 이 LUT를 대체하기 어렵습니다. 왼쪽 값은 진단용 근사입니다.", "warn");
    } else {
      setFitStatus("낮은 오차의 진단용 근사값을 왼쪽 패널에 반영했습니다.", "ok");
    }
  }

  function fitResultFromSummary(summary) {
    const fitted = summary.fitted || {};
    const limited = [];
    PARAM_ORDER.forEach((name, index) => {
      const value = Number(fitted[name]);
      if (Number.isFinite(value) && (Math.abs(value - PARAM_LOW[index]) < 0.1 || Math.abs(value - PARAM_HIGH[index]) < 0.1)) {
        limited.push(name);
      }
    });
    return {
      fitted,
      allRmse: (summary.rmse && Number(summary.rmse.all)) || 0,
      grayRmse: (summary.rmse && Number(summary.rmse.gray)) || 0,
      sampleCount: Number(summary.sample_count) || 0,
      limited,
    };
  }

  function analyzeCurrentCube() {
    if (!state.cube) {
      setFitStatus("먼저 .cube LUT를 불러와 주세요.", "warn");
      return;
    }
    if (state.fitting) {
      return;
    }
    state.fitting = true;
    setFitStatus("Basic Correction 대체 가능성 분석 중...");
    window.setTimeout(() => {
      try {
        renderFitResult(fitLumetriToCube(state.cube));
      } catch (error) {
        setFitStatus(error.message, "warn");
      } finally {
        state.fitting = false;
      }
    }, 20);
  }

  function loadImageFromUrl(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("이미지를 불러오지 못했습니다."));
      image.src = url;
    });
  }

  function loadImageFromFile(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("이미지 파일을 읽지 못했습니다."));
      };
      image.src = url;
    });
  }

  function setCanvasSize(canvas, width, height) {
    canvas.width = width;
    canvas.height = height;
  }

  function drawInputImage(image) {
    const width = Math.min(MAX_PREVIEW_WIDTH, image.naturalWidth || image.width);
    const height = Math.round((image.naturalHeight || image.height) * width / (image.naturalWidth || image.width));
    const inputCanvas = $("preview-input-canvas");
    const lutCanvas = $("preview-lut-canvas");
    const diffCanvas = $("preview-diff-canvas");
    [inputCanvas, lutCanvas, diffCanvas].forEach((canvas) => setCanvasSize(canvas, width, height));

    const inputContext = inputCanvas.getContext("2d", { willReadFrequently: true });
    inputContext.drawImage(image, 0, 0, width, height);
    return inputContext.getImageData(0, 0, width, height);
  }

  function setMetric(id, value) {
    const element = $(id);
    if (element) {
      element.textContent = value;
    }
  }

  function renderPreview() {
    if (!state.cube || !state.image) {
      setStatus("LUT와 이미지를 선택하면 미리보기가 렌더링됩니다.");
      return;
    }

    setStatus("렌더링 중...");
    window.requestAnimationFrame(() => {
      try {
        const input = drawInputImage(state.image);
        const lutCanvas = $("preview-lut-canvas");
        const diffCanvas = $("preview-diff-canvas");
        const lutContext = lutCanvas.getContext("2d");
        const diffContext = diffCanvas.getContext("2d");
        const lutImage = lutContext.createImageData(input.width, input.height);
        const diffImage = diffContext.createImageData(input.width, input.height);
        const data = input.data;
        let squaredError = 0;
        let meanR = 0;
        let meanG = 0;
        let meanB = 0;
        let maxDelta = 0;
        const pixels = input.width * input.height;

        for (let index = 0; index < data.length; index += 4) {
          const source = [data[index] / 255, data[index + 1] / 255, data[index + 2] / 255];
          const sampled = sampleCube(state.cube, source);
          const r = clamp01(sampled[0]);
          const g = clamp01(sampled[1]);
          const b = clamp01(sampled[2]);
          const dr = r - source[0];
          const dg = g - source[1];
          const db = b - source[2];
          const delta = Math.sqrt((dr * dr + dg * dg + db * db) / 3);

          lutImage.data[index] = Math.round(r * 255);
          lutImage.data[index + 1] = Math.round(g * 255);
          lutImage.data[index + 2] = Math.round(b * 255);
          lutImage.data[index + 3] = 255;

          diffImage.data[index] = Math.round(Math.min(1, Math.abs(dr) * DIFF_GAIN) * 255);
          diffImage.data[index + 1] = Math.round(Math.min(1, Math.abs(dg) * DIFF_GAIN) * 255);
          diffImage.data[index + 2] = Math.round(Math.min(1, Math.abs(db) * DIFF_GAIN) * 255);
          diffImage.data[index + 3] = 255;

          squaredError += delta * delta;
          meanR += dr;
          meanG += dg;
          meanB += db;
          maxDelta = Math.max(maxDelta, delta);
        }

        lutContext.putImageData(lutImage, 0, 0);
        diffContext.putImageData(diffImage, 0, 0);

        const rmse8 = Math.sqrt(squaredError / pixels) * 255;
        setMetric("preview-metric-rmse", `${rmse8.toFixed(1)} / 255`);
        setMetric("preview-metric-mean", `R ${((meanR / pixels) * 255).toFixed(1)} · G ${((meanG / pixels) * 255).toFixed(1)} · B ${((meanB / pixels) * 255).toFixed(1)}`);
        setMetric("preview-metric-max", `${(maxDelta * 255).toFixed(1)} / 255`);
        setMetric("preview-metric-size", `${input.width} × ${input.height}`);
        setStatus(`${state.cubeName} / ${state.imageName}`, "ok");
      } catch (error) {
        setStatus(error.message, "warn");
      }
    });
  }

  async function loadDemo() {
    try {
      setStatus("데모 로딩 중...");
      const [cubeResponse, image, fitResponse] = await Promise.all([
        fetch(DEMO_CUBE_URL),
        loadImageFromUrl(DEMO_IMAGE_URL),
        fetch(DEMO_FIT_URL),
      ]);
      if (!cubeResponse.ok) {
        throw new Error(`데모 LUT를 불러오지 못했습니다. HTTP ${cubeResponse.status}`);
      }
      state.cube = parseCube(await cubeResponse.text());
      state.cubeName = "DJI Action 6 D-LogM → Rec.709";
      state.image = image;
      state.imageName = "Representative photo";
      renderPreview();
      if (fitResponse.ok) {
        renderFitResult(fitResultFromSummary(await fitResponse.json()));
      } else {
        analyzeCurrentCube();
      }
    } catch (error) {
      setStatus(`${error.message} 직접 파일을 선택해 주세요.`, "warn");
    }
  }

  async function handleLutFile(file) {
    if (!file) {
      return;
    }
    setStatus("LUT 파싱 중...");
    state.cube = parseCube(await file.text());
    state.cubeName = file.name;
    renderPreview();
    analyzeCurrentCube();
  }

  async function handleImageFile(file) {
    if (!file) {
      return;
    }
    setStatus("이미지 로딩 중...");
    state.image = await loadImageFromFile(file);
    state.imageName = file.name;
    renderPreview();
  }

  function initWorkbench() {
    const lutInput = $("preview-lut-file");
    const imageInput = $("preview-image-file");
    const demoButton = $("preview-demo-button");
    const renderButton = $("preview-render-button");
    const fitButton = $("preview-fit-button");
    if (!lutInput || !imageInput || !demoButton || !renderButton || !fitButton) {
      return;
    }

    lutInput.addEventListener("change", (event) => {
      handleLutFile(event.target.files[0]).catch((error) => setStatus(error.message, "warn"));
    });
    imageInput.addEventListener("change", (event) => {
      handleImageFile(event.target.files[0]).catch((error) => setStatus(error.message, "warn"));
    });
    demoButton.addEventListener("click", () => loadDemo());
    renderButton.addEventListener("click", () => renderPreview());
    fitButton.addEventListener("click", () => analyzeCurrentCube());
    loadDemo();
  }

  window.addEventListener("DOMContentLoaded", initWorkbench);
})();
