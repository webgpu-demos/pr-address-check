# PR Address Check

A working prototype of an LLM-first address check for Puerto Rico. The model reads the address as typed, a gate verifies every part against the input, then the address is geocoded and the point is checked against Census boundaries.

Live: https://webgpu-demos.github.io/pr-address-check/

**Public data only.** This page is public. Do not paste applicant data into it.

## What it does

1. **Read.** In *AI first* mode the model returns the address parts as JSON (structured output), each with the exact text it came from. A rule parser reads the same input independently.
2. **Verify.** The gate drops any part whose source text is not in the input, any invented value, and any value that is not a reading of its own text. If too much fails, the result falls back to rules only and says so.
3. **Locate.** The raw string goes to the Census geocoder while the model reads. Census is tried first with the raw string and parse-built queries; Esri answers when Census does not match the typed number on the typed street.
4. **Check.** Municipio, barrio and ZIP area come from the point, using TIGERweb polygons loaded once per session. Never from the geocoder's city text.
5. **Report.** Two statuses: *compliance as typed* (Compliant, Compliant with warnings, Not compliant, Needs review, Postal only) and *location* (Address point, Street range, Street only, Area only, Ambiguous, Not located). Every field shows where it came from: typed, map, model or form.

Three modes, recorded on every result:

| Mode | What runs |
|---|---|
| Rules only | Rule parser, Census then Esri, point checks |
| AI after rules | Rules only, then the model reviews the parse and adds notes. It never changes the record |
| AI first | Model parse, gate, geocoding, tie-break against the rule parser, point checks |

When the model and the rule parser disagree on a field, the value the geocoded address or the point confirms wins. Otherwise the result is flagged `PARSE_DISAGREEMENT`.

## Models

Settings take a provider, model and key. Keys are kept in this tab's session storage only and are sent only to the provider.

| Provider | Status | Notes |
|---|---|---|
| Anthropic | Ready | Default `claude-haiku-5-5`. Structured outputs, effort low, thinking off, cached system prompt |
| OpenAI | Ready | Default `gpt-6-luna`. Strict JSON Schema |
| Claude on Foundry | Experimental | Works from the browser only if the resource allows this origin |
| Amazon Bedrock | Backend only | Needs signed requests |
| In-browser (WebGPU) | Not in round one | |

Use a key with a spend limit. Prices are editable in Settings and are used for the cost columns.

## Batch and scoring

Upload a CSV with an address column. If it has `expected_*` columns, each run is scored per arm (mode + model): where the point lands (≤50 m, ≤500 m, wrong area, not located), field accuracy, compliance accuracy, flag recall and precision, confident-wrong rate, Census first-hit rate, fallback and disagreement rates, invented-part rate, cost per 1,000 rows and latency p50/p95. Rates carry 95% Wilson intervals.

Make a labeled suite from ground truth:

```sh
node tools/make-cases.mjs ground-truth.csv --pairs 2 --seed 1 --holdout 0.2 > cases.csv
```

Ground-truth columns: `id, structure_number, street_type, street_name, unit, urbanization, barrio, municipio, zip, lat, lon, postal_city`. Each case records its mutations (reorder, drops, noise, KM, route styles, abbreviations, postal city, block-lot numbers, accents and case, postal-only forms), so results break down by type. `--holdout` splits by a stable hash of the id.

Samples (Batch → "Or load a sample"):

| File | What it is | Truth |
|---|---|---|
| `samples/real-facilities-cases.csv` | 60 public facilities (post offices, courthouses, hospitals, campuses, banks) in 45 municipios, addresses copied as their sources write them | Municipio for all; source coordinates for 26; hand labels for number and street (`samples/real-facilities-labels.csv`). Sources in `samples/real-facilities.csv`, caveats in `samples/real-facilities-notes.md` |
| `samples/real-messy-cases.csv` | 30 of those facilities retyped the way applicants write (lowercase, no commas, English order, abbreviations) | Same facility, so same municipio and point |
| `samples/invented-cases.csv` | Invented addresses with controlled mutations | Labels by construction; no coordinates |

The rule parser was improved using the real and messy sets, so those sets flatter it. A holdout of different facilities is the fair comparison. Generated cases flatter the rules too, since generator and parser share assumptions. Source coordinates are not survey-grade: some bank and health-center points sit kilometers from the street address.

`tools/make-facility-cases.mjs` rebuilds the real set from its sources and labels.

The review queue keeps decisions in this browser and exports them in the same columns, so reviewed rows join the suite.

## How locations are judged

A geocoder answer is only as good as its agreement with what was typed. Each candidate is checked against the typed number, street (token by token; routes by route number), ZIP, urbanización and municipio.

- **Address point / Street range**: number and street match. The point is trusted, so the municipio, barrio and ZIP-area checks run against it.
- **Street only**: the street matches, the house number does not, or there is none. Common for block-lot numbers like `C-12`.
- **Area only**: only the ZIP, barrio or town matched. Drawn as a dashed ring, never a solid point.
- **Conflicting match**: the best match names a different urbanización, ZIP or municipio. Location fields stay blank and the candidate is kept for review.
- When the best trusted answer is coarse but a precise match exists elsewhere (a KM marker in the next municipio, say), the result says so. Usually the typed municipio or ZIP is wrong.

Esri resolves Puerto Rico KM markers (`Carr 2 KM 47.7`) as `DistanceMarker` matches; those are scored on the kilometer.

## Run locally

```sh
npm test          # node --test, offline, invented addresses only
npm run serve     # http://localhost:8080
```

No build step. The page loads the ArcGIS Maps SDK 5.1 and Calcite from the Esri CDN.

## Deploy

GitHub Pages from `main`, root folder. An Esri key is optional: without one, geocoding runs anonymously (results are not stored) and the basemap is OpenStreetMap. A key, if used, must be referrer-limited to the Pages URL and is entered per session in Settings.

## Data sources

- Census Geocoder, `Public_AR_Current` benchmark, called with JSONP because it sends no CORS headers
- ArcGIS World Geocoding Service, `findAddressCandidates`, limited to Puerto Rico, `forStorage=false`
- Census TIGERweb `tigerWMS_Current`: Counties (municipios), County Subdivisions (barrios), 2020 ZCTAs. Simplified to about 10 m for in-browser point-in-polygon; falls back to per-point server queries if a bulk load fails
- USNG from the SDK's coordinate formatter

## Known gaps in round one

- Batch maps columns by header name. No per-column mapping screen yet
- WebGPU models are not enabled
- KM markers and parcels are not loaded; production swaps in the client's layers
- Ground truth for the full suite is still an open question (CRIM parcels or an authoritative address-point layer)

MIT licensed.
