#!/usr/bin/env python3
"""
проверка совместимости нашего lz-кодека с эталонным lz4.

  1) сжимаем нашим кодом (быстро и сильно) -> lz4.block.decompress
  2) сжимаем lz4.block.compress (обычный и high_compression) -> наш код

нужен pip install lz4 и компилятор cc. запуск из корня репозитория:
  python3 scripts/interop_lz4.py
"""
import ctypes
import os
import random
import subprocess
import sys
import tempfile

try:
    import lz4.block as ref
except ImportError:
    print("нет модуля lz4: pip install lz4")
    sys.exit(77)  # 77 = тест пропущен (как в automake/ctest)

kor = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
tmp = tempfile.mkdtemp()
so = os.path.join(tmp, "liblz.so")
subprocess.check_call(["cc", "-O2", "-shared", "-fPIC",
                       "-I" + os.path.join(kor, "include"),
                       "-I" + os.path.join(kor, "src"),
                       os.path.join(kor, "src", "lz.c"), "-o", so])
lib = ctypes.CDLL(so)
lib.ks_lz_bound.restype = ctypes.c_size_t
lib.ks_lz_bound.argtypes = [ctypes.c_size_t]
for f in (lib.ks_lz_compress, lib.ks_lz_decompress):
    f.restype = ctypes.c_int
    f.argtypes = [ctypes.c_char_p, ctypes.c_size_t, ctypes.c_char_p,
                  ctypes.c_size_t, ctypes.POINTER(ctypes.c_size_t)]


lib.ks_lz_compress_hc.restype = ctypes.c_int
lib.ks_lz_compress_hc.argtypes = [ctypes.c_char_p, ctypes.c_size_t,
                                  ctypes.c_char_p, ctypes.c_size_t,
                                  ctypes.POINTER(ctypes.c_size_t),
                                  ctypes.c_int]


def nash_hc(data, level):
    cap = lib.ks_lz_bound(len(data))
    out = ctypes.create_string_buffer(cap)
    n = ctypes.c_size_t()
    rc = lib.ks_lz_compress_hc(data, len(data), out, cap, ctypes.byref(n),
                               level)
    assert rc == 0, rc
    return out.raw[:n.value]


def nash_szhat(data):
    cap = lib.ks_lz_bound(len(data))
    out = ctypes.create_string_buffer(cap)
    n = ctypes.c_size_t()
    rc = lib.ks_lz_compress(data, len(data), out, cap, ctypes.byref(n))
    assert rc == 0, rc
    return out.raw[:n.value]


def nash_raspak(data, size):
    out = ctypes.create_string_buffer(max(size, 1))
    n = ctypes.c_size_t()
    rc = lib.ks_lz_decompress(data, len(data), out, size, ctypes.byref(n))
    assert rc == 0, rc
    return out.raw[:n.value]


def nabory():
    rnd = random.Random(2026)
    yield b""
    yield b"a"
    yield b"abcabcabcabcabcabc"
    yield b"\x00" * 100000
    yield bytes(rnd.getrandbits(8) for _ in range(70000))
    slova = [b"kusok ", b"pack ", b"offix ", b"chat ", b"goal ", b"\n"]
    yield b"".join(rnd.choice(slova) for _ in range(30000))
    with open(os.path.join(kor, "src", "store.c"), "rb") as f:
        yield f.read()
    for n in range(0, 40):
        yield bytes(rnd.choice(b"ab") for _ in range(n))
    # длинные повторы с маленьким смещением — проверка перекрытия
    yield b"xy" * 40000 + b"tail-literals"


kol = 0
for d in nabory():
    z = nash_szhat(d)
    assert ref.decompress(z, uncompressed_size=len(d)) == d, "ref не понял нас"
    for level in (2, 9, 12):
        z = nash_hc(d, level)
        assert ref.decompress(z, uncompressed_size=len(d)) == d, \
            "ref не понял наш hc"
    r = ref.compress(d, store_size=False)
    assert nash_raspak(r, len(d)) == d, "мы не поняли ref"
    r = ref.compress(d, mode="high_compression", compression=9,
                     store_size=False)
    assert nash_raspak(r, len(d)) == d, "мы не поняли ref hc"
    kol += 1
print(f"совместимость с lz4 {ref.__name__}: {kol} наборов ок")
