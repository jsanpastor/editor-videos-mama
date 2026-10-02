"""Genera la biblioteca de efectos de sonido (sin derechos de autor: todo sintetizado).

Uso:  py herramientas/generar_sonidos.py   ->  public/sonidos/*.wav
"""
import os
import wave
import numpy as np

SR = 44100
SALIDA = os.path.join(os.path.dirname(__file__), "..", "public", "sonidos")
rng = np.random.default_rng(7)


def t(seg):
    return np.arange(int(SR * seg)) / SR


def env(n, ataque=0.005, caida=0.2, forma=4.0):
    x = np.arange(n) / SR
    a = np.clip(x / max(ataque, 1e-4), 0, 1)
    d = np.exp(-np.maximum(x - ataque, 0) / max(caida, 1e-4) * forma / 4)
    return a * d


def pasa_banda(ruido, centros, q=6.0):
    """Filtro resonante simple (biquad) con frecuencia central variable."""
    y = np.zeros_like(ruido)
    x1 = x2 = y1 = y2 = 0.0
    for i, (s, f) in enumerate(zip(ruido, centros)):
        w0 = 2 * np.pi * f / SR
        alpha = np.sin(w0) / (2 * q)
        b0, b2 = alpha, -alpha
        a0, a1, a2 = 1 + alpha, -2 * np.cos(w0), 1 - alpha
        out = (b0 * s + b2 * x2 - a1 * y1 - a2 * y2) / a0
        x2, x1 = x1, s
        y2, y1 = y1, out
        y[i] = out
    return y


def barrido(seg, f0, f1, curva="exp"):
    n = int(SR * seg)
    if curva == "exp":
        return f0 * (f1 / f0) ** (np.arange(n) / n)
    return np.linspace(f0, f1, n)


def tono(freqs, seg):
    fase = 2 * np.pi * np.cumsum(freqs) / SR
    return np.sin(fase)


def norm(x, pico=0.9):
    m = np.max(np.abs(x)) or 1
    return x / m * pico


def fades(x, ms=4):
    n = int(SR * ms / 1000)
    x = x.copy()
    x[:n] *= np.linspace(0, 1, n)
    x[-n:] *= np.linspace(1, 0, n)
    return x


def guardar(nombre, x):
    x = fades(norm(x))
    estereo = np.stack([x, x], axis=1)
    datos = (estereo * 32767).astype(np.int16)
    with wave.open(os.path.join(SALIDA, f"{nombre}.wav"), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(datos.tobytes())


def whoosh(seg=0.55, f0=300, f1=4000, q=3.0):
    n = int(SR * seg)
    ruido = rng.standard_normal(n)
    centros = np.concatenate([barrido(seg / 2, f0, f1), barrido(seg - seg / 2, f1, f0 * 1.5)])[:n]
    y = pasa_banda(ruido, centros, q)
    forma = np.sin(np.pi * np.arange(n) / n) ** 1.6
    return y * forma


def main():
    os.makedirs(SALIDA, exist_ok=True)

    # Transiciones
    guardar("whoosh", whoosh())
    guardar("swoosh_rapido", whoosh(0.28, 600, 7000, 2.5))
    n = int(SR * 1.6)
    sub = tono(barrido(1.6, 55, 32), 1.6) * env(n, 0.003, 0.9)
    golpe = rng.standard_normal(n) * env(n, 0.001, 0.05)
    guardar("boom", np.tanh(2.5 * sub) + 0.25 * pasa_banda(golpe, np.full(n, 180.0), 1.2))
    n = int(SR * 2.0)
    riser = pasa_banda(rng.standard_normal(n), barrido(2.0, 400, 9000), 4) * np.linspace(0.05, 1, n) ** 2
    riser += 0.35 * tono(barrido(2.0, 200, 1600), 2.0) * np.linspace(0, 1, n) ** 2
    guardar("subida", riser)
    n = int(SR * 0.35)
    g = np.sign(np.sin(2 * np.pi * 90 * t(0.35))) * rng.standard_normal(n) * 0.6
    g = np.round(g * 6) / 6  # efecto "bit crush"
    g *= (np.sin(2 * np.pi * 23 * t(0.35)) > -0.2)
    guardar("glitch", g * env(n, 0.002, 0.3))

    # Textos y detalles
    n = int(SR * 0.12)
    guardar("pop", tono(barrido(0.12, 900, 260), 0.12) * env(n, 0.001, 0.05))
    n = int(SR * 0.09)
    burbuja = tono(barrido(0.09, 400, 1400), 0.09) * env(n, 0.002, 0.04)
    guardar("burbuja", burbuja)
    n = int(SR * 1.4)
    campana = sum(a * np.sin(2 * np.pi * f * t(1.4)) for f, a in [(1318, 1), (2637, 0.4), (3950, 0.2), (1975, 0.25)])
    guardar("ding", campana * env(n, 0.002, 0.45))
    n = int(SR * 0.9)
    a = sum(np.sin(2 * np.pi * f * t(0.9)) * w for f, w in [(880, 1), (1760, 0.3)]) * env(n, 0.002, 0.25)
    b = sum(np.sin(2 * np.pi * f * t(0.9)) * w for f, w in [(1318, 1), (2637, 0.3)]) * env(n, 0.002, 0.3)
    notif = np.zeros(int(SR * 1.05))
    notif[: len(a)] += a
    notif[int(SR * 0.13): int(SR * 0.13) + len(b)] += b
    guardar("notificacion", notif)
    n = int(SR * 0.05)
    guardar("click", pasa_banda(rng.standard_normal(n), np.full(n, 3500.0), 2) * env(n, 0.0005, 0.012))
    n = int(SR * 0.35)
    obt = np.zeros(n)
    for ini in (0.0, 0.12):
        m = int(SR * 0.06)
        k = int(SR * ini)
        obt[k:k + m] += pasa_banda(rng.standard_normal(m), np.full(m, 2500.0), 1.5) * env(m, 0.0005, 0.02)
    guardar("camara", obt)
    n = int(SR * 0.6)
    tecla = np.zeros(n)
    for k in range(5):
        m = int(SR * 0.03)
        ini = int(SR * (0.02 + k * 0.11 + rng.uniform(0, 0.02)))
        tecla[ini:ini + m] += pasa_banda(rng.standard_normal(m), np.full(m, 4200.0), 3) * env(m, 0.0003, 0.008)
    guardar("teclas", tecla)
    n = int(SR * 0.8)
    rasca = pasa_banda(rng.standard_normal(n), 1200 + 900 * np.sin(2 * np.pi * 3.5 * t(0.8)), 5)
    guardar("disco_rayado", rasca * env(n, 0.005, 0.5))
    n = int(SR * 1.2)
    brillo = sum(np.sin(2 * np.pi * f * t(1.2)) * env(n, 0.002 + i * 0.07, 0.3) for i, f in enumerate([2093, 2637, 3136, 4186]))
    guardar("brillo", brillo)
    n = int(SR * 0.7)
    caja = tono(np.full(n, 2000.0), 0.7) * env(n, 0.001, 0.25) + 0.5 * tono(np.full(n, 3000.0), 0.7) * env(n, 0.001, 0.15)
    caja[: int(SR * 0.08)] += pasa_banda(rng.standard_normal(int(SR * 0.08)), np.full(int(SR * 0.08), 3000.0), 2) * 0.5
    guardar("caja_registradora", caja)
    n = int(SR * 0.6)
    guardar("boing", tono(220 + 160 * np.sin(2 * np.pi * 9 * t(0.6)) * np.exp(-t(0.6) * 4), 0.6) * env(n, 0.002, 0.35))
    print("Sonidos generados en", os.path.abspath(SALIDA))


if __name__ == "__main__":
    main()
