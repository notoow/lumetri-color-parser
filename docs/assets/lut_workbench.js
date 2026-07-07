(function () {
  const DEMO_CUBE_FILENAME = "[오즈모액션6] DJI OSMO Action 6 D-LogM to Rec.709 LUT-11.17.cube";
  const DEMO_CUBE_URL = `.cube/${encodeURIComponent(DEMO_CUBE_FILENAME)}`;
  const DEMO_IMAGE_URL = "docs/assets/representative_photo_input.png";
  const MAX_PREVIEW_WIDTH = 720;
  const DIFF_GAIN = 4.0;

  const state = {
    cube: null,
    cubeName: "",
    image: null,
    imageName: "",
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
      const [cubeResponse, image] = await Promise.all([
        fetch(DEMO_CUBE_URL),
        loadImageFromUrl(DEMO_IMAGE_URL),
      ]);
      if (!cubeResponse.ok) {
        throw new Error(`데모 LUT를 불러오지 못했습니다. HTTP ${cubeResponse.status}`);
      }
      state.cube = parseCube(await cubeResponse.text());
      state.cubeName = "DJI Action 6 D-LogM → Rec.709";
      state.image = image;
      state.imageName = "Representative photo";
      renderPreview();
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
    if (!lutInput || !imageInput || !demoButton || !renderButton) {
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
    loadDemo();
  }

  window.addEventListener("DOMContentLoaded", initWorkbench);
})();
