PY ?= python3

.PHONY: all coefficients test render stills verify

all: coefficients test render verify

coefficients: ; $(PY) -m fourier_map.build
test: ; $(PY) -m unittest discover -s tests -v
render: ; node render.cjs
stills: ; node render.cjs --stills 0,90,140,300,430,560,690,839 --layout out/layout.json
verify: ; $(PY) verify.py
