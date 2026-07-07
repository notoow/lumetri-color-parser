"""
Lumetri 'Basic Correction' 근사 모델.
주의: Adobe의 실제 내부 공식이 아니라, 컬러리스트 커뮤니티가 파형 스코프로
역추적해 정리한 슬라이더 동작 특성(비대칭성, 처리 순서 등)을 반영해 만든
'최선의 근사(best-effort approximation)' 함수입니다.

파라미터:
  exposure     -5.0 ~ +5.0   (스톱 단위)
  contrast     -100 ~ +100
  highlights   -100 ~ +100
  shadows      -100 ~ +100
  whites       -100 ~ +100
  blacks       -100 ~ +100
  temperature  -100 ~ +100
  tint         -100 ~ +100
  saturation      0 ~ +200   (100 = 무변화)

처리 순서 (연구 결과 반영): Exposure -> Contrast -> Highlights -> Shadows
-> Whites -> Blacks -> Saturation -> White Balance(가장 마지막 처리, UI상으론 맨 위)
"""
import numpy as np

PARAM_NAMES = ['exposure', 'contrast', 'highlights', 'shadows',
               'whites', 'blacks', 'temperature', 'tint', 'saturation']

BOUNDS_LOW = np.array([-5.0, -100, -100, -100, -100, -100, -100, -100, 0])
BOUNDS_HIGH = np.array([5.0, 100, 100, 100, 100, 100, 100, 100, 200])
X0 = np.array([0.0, 0, 0, 0, 0, 0, 0, 0, 100.0])


def _exposure(x, e):
    # 올릴 때: 하이라이트 쪽 압축을 유지하는 감마형 리프트
    # 내릴 때: 순수 게인(Gain) — 리서치에서 확인된 비대칭 동작
    x = np.clip(x, 0.0, None)
    if e >= 0:
        gain = 2.0 ** e
        return 1 - (1 - np.minimum(x, 1.0)) ** gain
    else:
        gain = 2.0 ** e
        return x * gain


def _contrast(x, c):
    amt = c / 100.0
    k = amt * 4.0
    if abs(k) < 1e-6:
        return x
    def sig(v):
        return 1.0 / (1.0 + np.exp(-k * (v - 0.5) * 2))
    y0, y1 = sig(0.0), sig(1.0)
    return (sig(x) - y0) / (y1 - y0)


def _highlights(x, h):
    amt = h / 100.0
    w = 1.0 / (1.0 + np.exp(-8 * (x - 0.6)))  # 넓게 퍼진 가중치(상단 중심, 하단까지 침범)
    return x + amt * 0.4 * w * (1 - x)


def _shadows(x, s):
    amt = s / 100.0
    w = 1.0 / (1.0 + np.exp(8 * (x - 0.4)))   # 넓게 퍼진 가중치(하단 중심, 상단까지 침범)
    return x + amt * 0.4 * w * x


def _whites(x, wv):
    amt = wv / 100.0
    return x * (1 + amt * 0.5)


def _blacks(x, b):
    amt = b / 100.0
    if amt >= 0:
        return x + amt * 0.25 * np.exp(-8 * x)   # 리프트: 검정 근처에만 집중
    else:
        return x * (1 + amt * 0.5)               # 크러시: 더 넓게 퍼진 선형에 가까운 효과


def _saturation(rgb, sat):
    factor = sat / 100.0
    luma = (0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2])[..., None]
    return luma + (rgb - luma) * factor


def _white_balance(rgb, temp, tint):
    t = temp / 100.0
    ti = tint / 100.0
    r = rgb[..., 0] * (1 + t * 0.25) + ti * 0.12
    g = rgb[..., 1] - ti * 0.15
    b = rgb[..., 2] * (1 - t * 0.25) + ti * 0.12
    return np.stack([r, g, b], axis=-1)


def apply_lumetri(rgb, params):
    """params: dict with PARAM_NAMES keys, or array in PARAM_NAMES order"""
    if not isinstance(params, dict):
        params = dict(zip(PARAM_NAMES, params))
    x = np.asarray(rgb, dtype=np.float64).copy()

    x = _exposure(x, params['exposure'])
    x = _contrast(x, params['contrast'])
    x = _highlights(x, params['highlights'])
    x = _shadows(x, params['shadows'])
    x = _whites(x, params['whites'])
    x = _blacks(x, params['blacks'])
    x = np.clip(x, 0.0, None)
    x = _saturation(x, params['saturation'])
    x = _white_balance(x, params['temperature'], params['tint'])
    return x
