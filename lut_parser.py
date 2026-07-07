"""
.cube (Iridas/Adobe 3D LUT) 파서 + 삼중선형보간(trilinear interpolation) 룩업.
표준 스펙: R이 가장 빠르게 증가, 그다음 G, 그다음 B (행 인덱스 i -> r=i%N, g=(i//N)%N, b=i//(N*N))
"""
import numpy as np
import re

def parse_cube(path):
    size = None
    domain_min = np.array([0.0, 0.0, 0.0])
    domain_max = np.array([1.0, 1.0, 1.0])
    data = []
    title = None
    with open(path, 'r', encoding='utf-8', errors='ignore') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            if line.upper().startswith('TITLE'):
                title = line
                continue
            if line.upper().startswith('LUT_3D_SIZE'):
                size = int(line.split()[-1])
                continue
            if line.upper().startswith('DOMAIN_MIN'):
                domain_min = np.array([float(x) for x in line.split()[1:4]])
                continue
            if line.upper().startswith('DOMAIN_MAX'):
                domain_max = np.array([float(x) for x in line.split()[1:4]])
                continue
            if line.upper().startswith('LUT_1D_SIZE'):
                raise ValueError('This is a 1D LUT, not a 3D LUT.')
            # data line: three floats
            parts = line.split()
            if len(parts) == 3:
                try:
                    data.append([float(parts[0]), float(parts[1]), float(parts[2])])
                except ValueError:
                    continue

    if size is None:
        raise ValueError('LUT_3D_SIZE not found')
    data = np.array(data, dtype=np.float64)
    expected = size ** 3
    if data.shape[0] != expected:
        raise ValueError(f'Expected {expected} data rows, got {data.shape[0]}')

    # reshape: fastest axis R, then G, then B
    # data[i] corresponds to r=i%size, g=(i//size)%size, b=i//(size*size)
    lut = np.zeros((size, size, size, 3))
    idx = 0
    for b in range(size):
        for g in range(size):
            for r in range(size):
                lut[r, g, b] = data[idx]
                idx += 1

    return {
        'size': size,
        'domain_min': domain_min,
        'domain_max': domain_max,
        'lut': lut,   # shape (N,N,N,3) indexed [r,g,b] -> output RGB
        'title': title,
    }


def sample_lut(cube, rgb_in):
    """
    rgb_in: (...,3) array of input RGB in [domain_min, domain_max]
    returns: (...,3) array, trilinearly interpolated output RGB
    """
    lut = cube['lut']
    size = cube['size']
    dmin = cube['domain_min']
    dmax = cube['domain_max']

    rgb_in = np.asarray(rgb_in, dtype=np.float64)
    orig_shape = rgb_in.shape
    flat = rgb_in.reshape(-1, 3)

    # normalize to [0, size-1]
    norm = (flat - dmin) / (dmax - dmin)
    norm = np.clip(norm, 0.0, 1.0) * (size - 1)

    r0 = np.floor(norm[:, 0]).astype(int)
    g0 = np.floor(norm[:, 1]).astype(int)
    b0 = np.floor(norm[:, 2]).astype(int)
    r1 = np.clip(r0 + 1, 0, size - 1)
    g1 = np.clip(g0 + 1, 0, size - 1)
    b1 = np.clip(b0 + 1, 0, size - 1)
    r0 = np.clip(r0, 0, size - 1)
    g0 = np.clip(g0, 0, size - 1)
    b0 = np.clip(b0, 0, size - 1)

    fr = (norm[:, 0] - r0)[:, None]
    fg = (norm[:, 1] - g0)[:, None]
    fb = (norm[:, 2] - b0)[:, None]

    c000 = lut[r0, g0, b0]
    c100 = lut[r1, g0, b0]
    c010 = lut[r0, g1, b0]
    c110 = lut[r1, g1, b0]
    c001 = lut[r0, g0, b1]
    c101 = lut[r1, g0, b1]
    c011 = lut[r0, g1, b1]
    c111 = lut[r1, g1, b1]

    c00 = c000 * (1 - fr) + c100 * fr
    c10 = c010 * (1 - fr) + c110 * fr
    c01 = c001 * (1 - fr) + c101 * fr
    c11 = c011 * (1 - fr) + c111 * fr

    c0 = c00 * (1 - fg) + c10 * fg
    c1 = c01 * (1 - fg) + c11 * fg

    out = c0 * (1 - fb) + c1 * fb
    return out.reshape(orig_shape)


if __name__ == '__main__':
    import sys
    path = sys.argv[1]
    cube = parse_cube(path)
    print('size:', cube['size'])
    print('domain_min:', cube['domain_min'])
    print('domain_max:', cube['domain_max'])
    # quick sanity: gray ramp
    ramp = np.linspace(0, 1, 11)
    gray_in = np.stack([ramp, ramp, ramp], axis=1)
    gray_out = sample_lut(cube, gray_in)
    print('\n입력(gray) -> 출력(gray) 샘플:')
    for i, o in zip(gray_in, gray_out):
        print(f'{i[0]:.3f} -> R{o[0]:.4f} G{o[1]:.4f} B{o[2]:.4f}')
