// Puerto Rico barrios by municipio (county FIPS), from Census TIGERweb County Subdivisions (BASENAME), 2026.
// Used to tell a typed barrio from other place names (urbanizaciones, sectors, postal places).
// The barrio-pueblo carries the municipio's own name.

import { fold } from './text.js';
import { MUNICIPIOS } from './vocab.js';

const RAW = {
  '001': 'Adjuntas|Capáez|Garzas|Guayabo Dulce|Guayo|Guilarte|Juan González|Limaní|Pellejas|Portillo|Portugués|Saltillo|Tanamá|Vegas Abajo|Vegas Arriba|Yahuecas|Yayales',
  '003': 'Aguada|Asomante|Atalaya|Carrizal|Cerro Gordo|Cruces|Espinar|Guaniquilla|Guanábano|Guayabo|Jagüey|Lagunas|Mal Paso|Mamey|Marías|Naranjo|Piedras Blancas|Río Grande',
  '005': 'Aguacate|Aguadilla|Arenales|Borinquen|Caimital Alto|Caimital Bajo|Camaceyes|Ceiba Alta|Ceiba Baja|Corrales|Guerrero|Maleza Alta|Maleza Baja|Montaña|Palmar|Victoria',
  '007': 'Aguas Buenas|Bairoa|Bayamoncito|Cagüitas|Jagüeyes|Juan Asencio|Mula|Mulita|Sonadora|Sumidero',
  '009': 'Aibonito|Algarrobo|Asomante|Caonillas|Cuyón|Llanos|Pasto|Plata|Robles',
  '011': 'Añasco|Añasco Abajo|Añasco Arriba|Caguabo|Caracol|Carreras|Casey Abajo|Casey Arriba|Cerro Gordo|Cidra|Corcovada|Dagüey|Espino|Hatillo|Humatas|Marías|Miraflores|Ovejas|Piñales|Playa|Quebrada Larga|Río Arriba|Río Cañas',
  '013': 'Arecibo|Arenalejos|Arrozal|Cambalache|Carreras|Domingo Ruíz|Dominguito|Esperanza|Factor|Garrochales|Hato Abajo|Hato Arriba|Hato Viejo|Islote|Miraflores|Río Arriba|Sabana Hoyos|Santana|Tanamá',
  '015': 'Ancones|Arroyo|Guásimas|Palmas|Pitahaya|Yaurel',
  '017': 'Barceloneta|Florida Afuera|Garrochales|Palmas Altas',
  '019': 'Barrancas|Barranquitas|Cañabón|Helechal|Honduras|Palo Hincado|Quebrada Grande|Quebradillas',
  '021': 'Bayamón|Buena Vista|Cerro Gordo|Dajaos|Guaraguao Abajo|Guaraguao Arriba|Hato Tejas|Juan Sánchez|Minillas|Nuevo|Pájaros|Santa Olaya',
  '023': 'Bajura|Boquerón|Cabo Rojo|Guanajibo|Llanos Costa|Llanos Tuna|Miradero|Monte Grande|Pedernales',
  '025': 'Bairoa|Beatriz|Borinquen|Caguas|Cañaboncito|Cañabón|Río Cañas|San Antonio|San Salvador|Tomás de Castro|Turabo',
  '027': 'Abra Honda|Camuy|Camuy Arriba|Cibao|Ciénagas|Membrillo|Piedra Gorda|Puente|Puertos|Quebrada|Santiago|Yeguada|Zanja',
  '029': 'Canóvanas|Cubuy|Hato Puerco|Lomas|Torrecilla Alta',
  '031': 'Barrazas|Buena Vista|Cacao|Cangrejo Arriba|Canovanillas|Carolina|Carruzos|Cedro|Martín González|Sabana Abajo|San Antón|Santa Cruz|Trujillo Bajo',
  '033': 'Cataño|Palmas',
  '035': 'Beatriz|Cayey|Cedro|Cercadillo|Culebras Alto|Culebras Bajo|Farallón|Guavate|Jájome Alto|Jájome Bajo|Lapa|Matón Abajo|Matón Arriba|Monte Llano|Pasto Viejo|Pedro Avila|Piedras|Quebrada Arriba|Rincón|Sumido|Toíta|Vegas',
  '037': 'Ceiba|Chupacallos|Daguao|Guayacán|Machos|Quebrada Seca|Río Abajo|Saco',
  '039': 'Ciales|Cialitos|Cordillera|Frontón|Hato Viejo|Jaguas|Pesas|Pozas|Toro Negro',
  '041': 'Arenas|Bayamón|Beatriz|Ceiba|Certenejas|Cidra|Honduras|Monte Llano|Rabanal|Rincón|Río Abajo|Salto|Sud|Toíta',
  '043': 'Coamo|Coamo Arriba|Cuyón|Hayales|Los Llanos|Palmarejo|Pasto|Pedro García|Pulguillas|San Ildefonso|Santa Catalina',
  '045': 'Cedrito|Cejas|Comerío|Doña Elena|Naranjo|Palomas|Piñas|Río Hondo|Vega Redonda',
  '047': 'Abras|Cibuco|Corozal|Cuchillas|Dos Bocas|Magueyes|Maná|Negros|Padilla|Palmarejo|Palmarito|Palos Blancos|Pueblo',
  '049': 'Culebra|Flamenco|Fraile|Playa Sardinas I|Playa Sardinas II|San Isidro',
  '051': 'Dorado|Espinosa|Higuillar|Maguayo|Mameyal|Río Lajas',
  '053': 'Cabezas|Demajagua|Fajardo|Florencio|Naranjo|Quebrada Fajardo|Quebrada Vueltas|Río Arriba|Sardinera',
  '054': 'Florida Adentro',
  '055': 'Arena|Carenero|Caño|Ciénaga|Ensenada|Guánica|Montalva|Susúa Baja',
  '057': 'Algarrobo|Caimital|Carite|Carmen|Guamaní|Guayama|Jobos|Machete|Palmas|Pozo Hondo',
  '059': 'Barrero|Boca|Cedro|Consejo|Guayanilla|Indios|Jagua Pasto|Jaguas|Llano|Macaná|Magas|Pasto|Playa|Quebrada Honda|Quebradas|Rufina|Sierra Baja',
  '061': 'Camarones|Frailes|Guaraguao|Guaynabo|Hato Nuevo|Mamey|Pueblo Viejo|Río|Santa Rosa|Sonadora',
  '063': 'Celada|Gurabo|Hato Nuevo|Jaguar|Jaguas|Mamey|Masa|Navarro|Quebrada Infierno|Rincón',
  '065': 'Aibonito|Bayaney|Buena Vista|Campo Alegre|Capáez|Carrizales|Corcovado|Hatillo|Naranjito',
  '067': 'Benavente|Guanajibo|Hormigueros|Jaguitas|Lavadero',
  '069': 'Antón Ruíz|Buena Vista|Candelero Abajo|Candelero Arriba|Cataño|Collores|Humacao|Mabú|Mambiche|Mariana|Punta Santiago|Río Abajo|Tejas',
  '071': 'Arenales Altos|Arenales Bajos|Bajura|Bejucos|Coto|Galateo Alto|Galateo Bajo|Guayabos|Guerrero|Isabela|Jobos|Llanadas|Mora|Planas',
  '073': 'Coabey|Collores|Jauca|Jayuya|Jayuya Abajo|Mameyes Arriba|Pica|Río Grande|Saliente|Veguitas|Zamas',
  '075': 'Amuelas|Callabo|Capitanejo|Cintrona|Collores|Emajagual|Guayabal|Jacaguas|Juana Díaz|Lomas|Río Cañas Abajo|Río Cañas Arriba|Sabana Llana|Tijeras',
  '077': 'Caimito|Ceiba Norte|Ceiba Sur|Gurabo Abajo|Gurabo Arriba|Juncos|Lirios|Mamey|Valenciano Abajo|Valenciano Arriba',
  '079': 'Candelaria|Costa|Lajas|Lajas Arriba|Llanos|Palmarejo|Parguera|París|Plata|Sabana Yeguas|Santa Rosa',
  '081': 'Bartolo|Buenos Aires|Callejones|Espino|La Torre|Lares|Mirasol|Pezuela|Piletas|Pueblo|Río Prieto',
  '083': 'Alto Sano|Anones|Bucarabones|Buena Vista|Cerrote|Chamorro|Espino|Furnias|Las Marías|Maravilla Este|Maravilla Norte|Maravilla Sur|Naranjales|Palma Escrita|Purísima Concepción|Río Cañas',
  '085': 'Boquerón|Ceiba|Collores|El Río|Las Piedras|Montones|Quebrada Arenas|Tejas',
  '087': 'Canóvanas|Loíza|Medianía Alta|Medianía Baja|Torrecilla Alta|Torrecilla Baja',
  '089': 'Juan Martín|Luquillo|Mameyes I|Mata de Plátano|Pitahaya|Sabana',
  '091': 'Bajura Adentro|Bajura Afuera|Coto Norte|Coto Sur|Manatí|Río Arriba Poniente|Río Arriba Saliente|Tierras Nuevas Poniente|Tierras Nuevas Saliente',
  '093': 'Bucarabones|Indiera Alta|Indiera Baja|Indiera Fría|Maricao|Maricao Afuera|Montoso',
  '095': 'Calzada|Emajagua|Lizas|Matuyas Alto|Matuyas Bajo|Maunabo|Palo Seco|Quebrada Arenas|Talante|Tumbao',
  '097': 'Algarrobos|Bateyes|Guanajibo|Isla Desecheo|Isla de Mona e Islote Monito|Juan Alonso|Leguísamo|Limón|Malezas|Mayagüez|Mayagüez Arriba|Miradero|Montoso|Naranjales|Quebrada Grande|Quemado|Rosario|Río Cañas Abajo|Río Cañas Arriba|Río Hondo|Sábalos',
  '099': 'Aceitunas|Capá|Centro|Cerro Gordo|Cruz|Cuchillas|Marías|Naranjo|Plata|Pueblo|Rocha|Voladoras',
  '101': 'Barahona|Cuchillas|Fránquez|Monte Llano|Morovis|Morovis Norte|Morovis Sud|Pasto|Perchas|Río Grande|San Lorenzo|Torrecillas|Unibón|Vaga',
  '103': 'Daguao|Duque|Húcares|Maizales|Mariana|Naguabo|Peña Pobre|Río|Río Blanco|Santiago y Lima',
  '105': 'Achiote|Anones|Cedro Abajo|Cedro Arriba|Guadiana|Lomas|Naranjito|Nuevo',
  '107': 'Ala de la Piedra|Barros|Bauta Abajo|Bauta Arriba|Bermejales|Botijas|Cacaos|Collores|Damián Abajo|Damián Arriba|Gato|Mata de Cañas|Orocovis|Pellejas|Sabana|Saltos',
  '109': 'Apeadero|Bajo|Cacao Alto|Cacao Bajo|Egozcue|Guardarraya|Jacaboa|Jagual|Mamey|Marín|Mulas|Muñoz Rivera|Patillas|Pollos|Quebrada Arriba|Ríos',
  '111': 'Barreal|Coto|Cuebas|Encarnación|Jaguas|Macaná|Peñuelas|Quebrada Ceiba|Rucio|Santo Domingo|Tallaboa Alta|Tallaboa Poniente|Tallaboa Saliente',
  '113': 'Anón|Bucaná|Canas|Canas Urbano|Capitanejo|Cerrillos|Coto Laurel|Cuarto|Guaraguao|Machuelo Abajo|Machuelo Arriba|Magueyes|Magueyes Urbano|Maragüez|Marueño|Monte Llano|Playa|Portugués|Portugués Urbano|Primero|Quebrada Limón|Quinto|Real|Sabanetas|San Antón|San Patricio|Segundo|Sexto|Tercero|Tibes|Vayas',
  '115': 'Cacao|Charcas|Cocos|Guajataca|Quebradillas|San Antonio|San José|Terranova',
  '117': 'Atalaya|Barrero|Calvache|Cruces|Ensenada|Jagüey|Pueblo|Puntas|Rincón|Río Grande',
  '119': 'Ciénaga Alta|Ciénaga Baja|Guzmán Abajo|Guzmán Arriba|Herreras|Jiménez|Mameyes II|Río Grande|Zarzal',
  '121': 'Machuchal|Rayo|Rincón|Sabana Grande|Santana|Susúa|Tabonuco|Torre',
  '123': 'Aguirre|Lapa|Palmas|Quebrada Yeguas|Río Jueyes|Salinas',
  '125': 'Ancones|Caín Alto|Caín Bajo|Cotuí|Duey Alto|Duey Bajo|Guamá|Hoconuco Alto|Hoconuco Bajo|Maresúa|Minillas|Retiro|Rosario Alto|Rosario Bajo|Rosario Peñón|Sabana Eneas|Sabana Grande Abajo|San Germán|Tuna',
  '127': 'Caimito|Cupey|El Cinco|Gobernador Piñero|Hato Rey Central|Hato Rey Norte|Hato Rey Sur|Monacillo|Monacillo Urbano|Oriente|Pueblo|Quebrada Arenas|Sabana Llana Norte|Sabana Llana Sur|San Juan Antiguo|Santurce|Tortugo|Universidad',
  '129': 'Cayaguas|Cerro Gordo|Espino|Florida|Hato|Jagual|Quebrada|Quebrada Arenas|Quebrada Honda|Quemados|San Lorenzo',
  '131': 'Aibonito|Alto Sano|Bahomamey|Calabazas|Cibao|Cidral|Culebrinas|Eneas|Guacio|Guajataca|Guatemala|Hato Arriba|Hoya Mala|Juncal|Magos|Mirabales|Perchas 1|Perchas 2|Piedras Blancas|Pozas|Robles|Salto|San Sebastián|Sonador',
  '133': 'Boca Velázquez|Descalabrado|Felicia 1|Felicia 2|Jauca 1|Jauca 2|Playa|Santa Isabel',
  '135': 'Contorno|Galateo|Mucarabones|Ortiz|Piñas|Quebrada Arenas|Quebrada Cruz|Río Lajas|Toa Alta',
  '137': 'Candelaria|Media Luna|Palo Seco|Sabana Seca|Toa Baja',
  '139': 'Carraízo|Cuevas|Dos Bocas|La Gloria|Quebrada Grande|Quebrada Negrito|St. Just|Trujillo Alto',
  '141': 'Angeles|Arenas|Caguana|Caniaco|Caonillas Abajo|Caonillas Arriba|Consejo|Don Alonso|Guaonica|Las Palmas|Limón|Mameyes Abajo|Paso Palma|Roncador|Río Abajo|Sabana Grande|Salto Abajo|Salto Arriba|Santa Isabel|Santa Rosa|Tetuán|Utuado|Viví Abajo|Viví Arriba',
  '143': 'Bajura|Candelaria|Cienegueta|Espinosa|Maricao|Mavilla|Sabana|Vega Alta',
  '145': 'Algarrobo|Almirante Norte|Almirante Sur|Cabo Caribe|Ceiba|Cibuco|Puerto Nuevo|Pugnado Adentro|Pugnado Afuera|Quebrada Arenas|Río Abajo|Río Arriba|Vega Baja|Yeguada',
  '147': 'Florida|Isabel II|Llave|Mosquito|Puerto Diablo|Puerto Ferro|Puerto Real|Punta Arenas',
  '149': 'Caonillas Abajo|Caonillas Arriba|Hato Puerco Abajo|Hato Puerco Arriba|Vacas|Villalba|Villalba Abajo|Villalba Arriba',
  '151': 'Aguacate|Calabazas|Camino Nuevo|Guayabota|Juan Martín|Jácana|Limones|Playa|Tejas|Yabucoa',
  '153': 'Aguas Blancas|Algarrobo|Almácigo Alto|Almácigo Bajo|Barina|Caimito|Collores|Diego Hernández|Duey|Frailes|Jácanas|Naranjo|Quebradas|Ranchera|Rubias|Río Prieto|Sierra Alta|Susúa Alta|Susúa Baja|Vegas|Yauco',
};

export const BARRIOS = Object.entries(RAW).flatMap(([county, names]) => names.split('|')
  .map((name) => ({ name, county, key: fold(name) })));

const KEYS = new Set(BARRIOS.map((b) => b.key));

/** Is this a barrio name, allowing the usual shortenings ("Hato Rey" for Hato Rey Norte, "Mameyes" for Mameyes II, "Pueblo")? */
export function isKnownBarrio(name, county = '') {
  const k = fold(name).replace(/^(bo|barrio)\.?\s+/, '').replace(/[.,]/g, '').replace(/\s+/g, ' ').trim();
  if (!k) return false;
  if (k === 'pueblo') return true;
  const pool = county ? BARRIOS.filter((b) => b.county === county) : BARRIOS;
  const norm = (s) => s.replace(/\bsegunda\b/g, 'ii').replace(/\bprimera\b/g, 'i');
  const kk = norm(k);
  return pool.some((b) => b.key === kk || b.key.startsWith(`${kk} `)
    || (kk.length >= 6 && editDistance(kk, b.key) <= 1)) || (!county && KEYS.has(kk));
}

/** Barrios of one municipio, for messages. */
export function barriosOf(county) {
  return BARRIOS.filter((b) => b.county === county).map((b) => b.name);
}

function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}

export const MUNICIPIO_BY_COUNTY = Object.fromEntries(MUNICIPIOS.map((m) => [m.county, m]));
