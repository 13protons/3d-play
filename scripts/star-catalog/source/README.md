# Vendored star catalogue source

These two files are the minified source data for the real starfield, vendored from:

**BSC5P-JSON-XYZ** — https://github.com/frostoven/BSC5P-JSON-XYZ

- `bsc5p_radec_min.json` — star positions (right ascension / declination, radians) + blackbody colour `K`
- `bsc5p_spectral_extra_min.json` — apparent (visual) magnitude `b`

They are based on the Bright Star Catalog 5th ed. (BSC5P) and SIMBAD data. The generated
catalogue data is licensed **CC BY 4.0** (see `LICENSE`); attribution is required for any
distribution of the data or derivatives (such as our baked `public/data/stars/bsc5p.bin`).

This research has made use of the SIMBAD database and the VizieR catalogue access tool, CDS,
Strasbourg, France.

## Regenerating the asset

```
npm run build:stars
```

`../buildStarCatalog.mjs` joins these two files on the BSC5P line ID `i`, converts RA/Dec to
unit direction vectors, drops stars fainter than magnitude 6.5 (invisible to the naked eye),
and writes the compact binary `public/data/stars/bsc5p.bin` consumed by `src/render/sky`.
