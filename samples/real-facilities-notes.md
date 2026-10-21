# real-facilities.csv: notes and doubts

60 rows, 45 municipios, 27 rows with coordinates. All coordinates come from the source page itself. None were geocoded.

## Conventions
- Where the source splits an address over several lines, the lines are joined with ", ". Otherwise the text is unchanged: abbreviations, typos and the source's own casing and punctuation are kept.
- USPS rows (f05-f20) come from USPS FOIA property CSVs (leased or owned). Each address is built from the columns `Property Address, City, PR ZIP Code`. These are USPS internal property records. The public locator may show the same office differently, for example without the "STE"/"FRNT" suffix. A ZIP+4 ending in -9998, -9997 or -9800 is the post office's own ZIP+4.
- FDIC rows (f50-f55) come from the FDIC BankFind API. Each address is built from `ADDRESS, CITY, PR ZIP`. The lat/lon are the FDIC's values.
- Walgreens rows take their lat/lon from the `daddr=` parameter in the store page's "Get directions" link.
- salud.pr.gov doc 3044 labels its columns "Longitud Latitud", but the values are printed latitude first. They are recorded here as lat and lon.
- Pages were read with a fetch tool that turns them into text, so repeated spaces may have been collapsed. The key sources (USPS CSV, Poder Judicial PDF, salud.pr.gov 3044, FDIC) were each fetched twice, and both reads matched.

## Rows with doubts
- f01 Barranquitas Casa Alcaldía: the page labels it only "Calle Muñoz Rivera No. 25", with no town or ZIP, so zip is blank. The same page also shows "Calle Antonio Vázquez #5 Barranquitas PR 00794" with no label.
- f02/f04 Casa Alcaldía Vieques and Arecibo, f03 Maunabo, f56-f58: these come from Wikipedia/NRHP, in English or descriptive form ("Junction of...", "Town square &..."), with no ZIP.
- f16 Caparra Heights Station: USPS gives the city as GUAYNABO, ZIP 00968, so the municipio is recorded as Guaynabo. Caparra Heights is a San Juan neighborhood and Ave. Roosevelt crosses the line between the two, so the municipio is not certain.
- f13 Mercedita (Ponce), f14 Ángeles (Utuado), f17 Boquerón (Cabo Rojo), f18 Palmer (Río Grande): the postal city is not the municipio.
- f15 Toa Alta PO: the source address is malformed ("CARRETERA 165. K.10.H 5 BARRIO CONTORNO"). It is kept as is on purpose.
- f21-f28 Poder Judicial: the source gives no ZIP. f27 Lajas has no town in the address at all. f22 and f21 include landmarks in parentheses.
- f23 vs f07: the same avenue is spelled two ways. USPS has "AVE FERNANDO L RIBAS", the court list has "Ave. Fernando L. Rivas Dominicci".
- f08 vs f50: the same street is spelled two ways. USPS has "ZUZUARREGUI", the FDIC has "Zuzuaregui".
- f37 Hospital General Castañer: the municipio is Lares and the postal city is Castañer. The two salud.pr.gov directories give different km: doc 3044 says "Carr. 135, Km. 64.2", the 2018 doc 277 says "PR-135, Km 4.5".
- f38 Aibonito: the source spells "Urb. Vila Rosales" (probably Villa Rosales). Kept as is.
- f43 Guánica: the ZIP 00647 belongs to Ensenada (Guánica's own ZIP is 00653). Kept as listed.
- f44 Manatí CDT: comes from the 2018 DOH directory (doc 277) and may be out of date.
- f36 Culebra and f42 Adjuntas: these are community health centers (330s), not CDTs run by the DOH.
- f45 Walgreens Juana Díaz: the source text reads "STATED RD." and is cut off at "EST DE". Kept as listed.
- f50 Banco Popular Maricao: the FDIC point is about 4 km east of the town center where the street address is, so it is probably imprecise.
- f54 FirstBank Río Hondo: the FDIC gives the city as "Toa Baja" but the county as Bayamón, with ZIP 00957 (Bayamón). The municipio is recorded as Bayamón.
- f56/f57 Fire stations Ceiba and Yabucoa: these are historic NRHP station buildings. Whether they still operate as stations was not checked.
- f60 Salinas: this is a Dept. of Education school library, not a municipal public library. The source is libraries.org (librarytechnology.org), which is a third-party directory. Bo. Coquí is in the Aguirre area of Salinas.
- f58 Ponce library: the Wikipedia infobox repeats "Puerto Rico, Puerto Rico". Kept as is.

## Sources that could not be used
- tools.usps.com locator pages render with JavaScript, so the fetch got no address.
- walmart.com store directory returned no listings to the fetch tool.
- Most municipio `*.pr.gov` sites block automated fetching (robots).
- Command-line egress from this environment is blocked, so everything was fetched with WebFetch.
