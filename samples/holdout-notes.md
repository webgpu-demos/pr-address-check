# holdout-facilities.csv: notes and doubts

60 rows, 42 municipios, 39 rows with coordinates. Every coordinate was printed by the source itself (FDIC API, salud.pr.gov doc 3044, Walgreens `daddr=`, Wikipedia infobox). Nothing was geocoded.

None of these facilities or addresses appear in `samples/real-facilities.csv`. Checked by exact address and facility name, and by a normalized address-prefix match: no hits. The holdout covers all 33 municipios missing from that file. Together the two files cover all 78. (Lajas was on the requested list, but it is already in the existing file as f27. Caguas was not on the list but was missing from the file, so it is covered here.)

## Sources and conventions
| Source | Rows | Coords |
|---|---|---|
| USPS FOIA leased/owned CSVs | h01-h12 | none |
| FDIC BankFind API (one CITY filter per row; the URL is in source_url) | h13-h30 | FDIC values |
| salud.pr.gov doc 3044 "Directorio de Facilidades de Servicios de Salud" | h31-h47 | as printed |
| Poder Judicial "Locales de la Rama Judicial y Dirección Física" (Anejo 1) | h48-h53 | none, no ZIP |
| Walgreens store pages | h54-h56 | from the `daddr=` parameter in the directions link |
| Home Depot store page | h57 | none on page |
| va.gov clinic pages | h58-h59 | none on page |
| Wikipedia (NRHP article) | h60 | infobox |

- Addresses are copied as the source gives them. Where the source splits street, city and ZIP into separate fields (USPS, FDIC, Walgreens, VA, Home Depot), they are joined with ", " in the form `street, CITY, PR ZIP`. Abbreviations, typos, casing and missing accents are kept.
- USPS address = `Property Address, City, PR ZIP Code`.
- FDIC address = `ADDRESS, CITY, PR ZIP`.
- salud.pr.gov labels its columns "Longitud Latitud", but the values are printed latitude first. They are recorded here as lat, lon.
- Everything was read with a fetch tool that turns pages into text, because shell egress is blocked. Every row was fetched twice and both reads matched: USPS full pull plus a targeted re-quote, FDIC full-PR pull plus a single-city query, salud two targeted quotes, Poder Judicial two quotes. Repeated spaces may have been collapsed.

## Style coverage
- Carretera with KM/HM: h15-h18, h21-h23, h31, h33, h35, h36, h41, h43, h49, h59 (h18 and h21 have both Km and Hm).
- Urbanización block-lot: h04 `H1 CALLE 5`, h29 `B-5 Tabonuco Street, Urb Caparra Hills`, h30 `Gp12 Ave...`, h37 `Calle H, N-9`, h39 `Calle 16 V-1, Villa Los Santos`, h47 `Urb. Bella Vista, Marginal 167, AD-10`. h19 and h44 name an Urb. without a block-lot.
- Barrio, ward or sector: h17, h18, h20 (Guatemala Ward), h22 (Higuillar), h23 (Quebrada), h31, h41, h49, h59 (Hato Abajo Ward), h37 (Sector Nueva Vida).
- Suite or floor: h02 `STE 1`, h07 `Suites 37 - 39`, h14 `2nd Floor`, h58 `1st Floor, Suite 1`.
- Corner or intersection: h14 `Esq.`, h52 `Esq. Barriada`, h16 `Int Carr 542`, h20 `Int. 446`, h42 `Int. 187`, h51 `Int. #189`, h59 `Int. PR 660`.
- Postal city is not the municipio: h08 Aguirre is in Salinas, h09 Río Blanco in Naguabo, h10 Punta Santiago in Humacao, h11 San Antonio in Aguadilla, h12 La Plata in Aibonito, h15 Coto Laurel in Ponce (FDIC COUNTY=Ponce). h29 includes the sector "San Patricio" before the city.
- No town or ZIP in the address (Poder Judicial landmark style): h48-h53.

## Rows with doubts
- h07 Yauco PO: the leased CSV has two Yauco main-office rows, `603 YAUCO PLAZA II` and `Yauco Plaza I Shopping Center, Suites 37 - 39`. The second was used. It is mixed case and its PO Name field has a trailing space. Which location is the current retail office was not checked.
- h02 (00610-2947) and h11 (00690-1216) have ZIP+4 values that are not the usual -9998/-9997/-9800 post-office ZIP+4.
- h11 San Antonio and h12 La Plata: the municipio comes from the ZIP and place name (00690 is San Antonio in Aguadilla, 00786 is La Plata in Aibonito). USPS gives no municipio. Confidence is high but not verified against a second source.
- h13 `Piqero` and h14 `Muqoz` are the FDIC's mis-encoded ñ (Piñero, Muñoz). They are kept on purpose. h53 (court) spells the same Las Piedras street correctly: `Calle Jesús T. Piñero Núm. 77 interior`. The USPS Las Piedras PO, not used here, is at `77 CALLE JT PINERO STE 1`, so the court and the PO probably share a government building.
- h14 coords (18.2106387, -66.0280443) are almost the same as the FDIC's generic Caguas point (18.210621, -66.028075), which the FDIC reuses for at least 7 Caguas branches. They are probably a placeholder about 2.5 km south of downtown, not the branch's real location.
- h23 `33 Km 44.7 Quebrada`: the road number is ambiguous. Fajardo Shopping Center sits on PR-3, and "33" may be a garbled "3". Kept as is.
- h25 `State Roud #2` is an FDIC typo, kept.
- h26 `Plz Del Oeste Sc Casto Perez Ave St 2` is heavily abbreviated (Sc = shopping center, St 2 = State Road 2?). Kept as is.
- h22 `Rd693` has no space, kept.
- h16 BPPR Santa Isabel is on PR-153, about 100 m from a Walgreens (250 CARR 153), which was dropped to avoid near-duplicates.
- h34 CDT Guayanilla: the source ZIP 00731 is a Ponce ZIP (Guayanilla is 00656). This is a source error, kept.
- h38 Costa Salud Rincón: the source ZIP 00678 is Quebradillas's (Rincón is 00677). This is a source error, kept.
- h45 Menonita Guayama ZIP 00785 and h33 Cataño ZIP 00963 are PO-box ZIPs (the street ZIPs are 00784 and 00962). h47 Bayamón ZIP 00955 is also not one of Bayamón's usual street ZIPs. All kept.
- h57 Home Depot Caguas ZIP 00726 is not Caguas's usual street ZIP (00725/00727). Lowercase `pr52 Exp` is kept.
- h35 Moca has `PR, 00676`, with an extra comma. Kept.
- h31, h33 and h36 have coordinates with only 3 decimal places in the source, so they are imprecise.
- h36 Naguabo Medical Mall (`Carr. 31, Km. 4`) and h09 Río Blanco PO (`100 CARR 31`) are on the same road in Naguabo but are different facilities.
- salud.pr.gov doc 3044 is undated, so whether each facility still operates was not checked. h37 and h47 are in Ponce and Bayamón, which the existing file already covers. They were added for their block-lot addresses and are new facilities.
- h48-h53 courts: no ZIP, landmark text in parentheses. h51 puts "PR" before a parenthetical. The Guayama court was skipped because the PDF line wraps ambiguously ("Centro Judicial de / Desvío José Torres...").
- h59 VA Arecibo, `Hato Abajo Ward`: an English barrio label on a federal site.
- h60 Padre Nazario School: from a Wikipedia NRHP article. Whether it still operates as a school is unconfirmed (the article says only "historic public school"). The infobox reads as `4 Concepción Street Guayanilla, Puerto Rico` with no comma, so a line break was probably collapsed. It is the only school row.

## Not usable / rejected
- NCES school search blocks robots. No de.pr.gov school directory could be fetched.
- Brumbaugh Graded School (Santa Isabel) closed in 2018. Biblioteca Carnegie (Puerta de Tierra) is not operating as a library. Both rejected.
- The NRHP lists for eastern, western and southern PR had no city hall or library in the target municipios. Municipal `*.pr.gov` sites block fetching, so there are no Casa Alcaldía or municipal library rows.
- FDIC Sabana Grande BPPR coords (18.311, -65.965) are about 110 km off, more evidence that FDIC coordinates are not uniformly reliable.
- BPPR Loíza `64 Calle San Patricio` has the same address as the USPS Loíza PO. BPPR Canóvanas `18400 Carr 3` matches the USPS `18400 CARR 3 STE 136`. Neither pair was used.
- The FDIC OR-filter with parentheses returned all PR records rather than the filtered subset, so each source_url uses a single-CITY filter.
