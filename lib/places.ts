import { dayNum, tripEnd } from "./logic";
import type { CountryMark, MarkKind, Trip } from "./types";
import { COUNTRIES } from "./countries";

/**
 * Working out which country a trip is in, from what was typed in its Where box.
 *
 * Nothing in the database says "Italy": a trip has a free-text `place` and a title, and that is
 * all the map has to go on. So this is a gazetteer — every country's name, the names people
 * actually use for them, and the cities worth knowing — matched against the words of a trip.
 *
 * It is deliberately pure and deliberately boring. A miss is cheap: the Map tab lists the trips it
 * could not place, so the fix is to write the country into the trip's Where box. A false hit is
 * the thing to avoid, which is why ordinary English words that happen to be place names only
 * count in the Where box and never in a trip's title.
 */

// ---------- The gazetteer ----------

/** What people call countries, beyond the official name each outline already carries. */
const ALIASES: Record<string, string> = {
  GBR: "uk, britain, great britain, england, scotland, wales, northern ireland",
  USA: "usa, u s a, america, united states of america, the states",
  ARE: "uae, emirates, the emirates",
  CZE: "czechia, czech",
  NLD: "holland, the netherlands",
  TUR: "turkey, turkiye",
  VNM: "viet nam",
  KOR: "korea, republic of korea, south korea",
  PRK: "north korea",
  MMR: "burma",
  CIV: "ivory coast",
  CPV: "cape verde",
  SWZ: "swaziland",
  MKD: "macedonia",
  BIH: "bosnia, herzegovina",
  RUS: "russian federation",
  LAO: "lao, lao pdr",
  IRL: "eire, republic of ireland",
  HKG: "hk",
  MAC: "macao",
  COD: "drc, congo kinshasa, democratic republic of the congo",
  COG: "congo brazzaville, republic of the congo",
  TLS: "east timor",
  PHL: "the philippines",
  LKA: "ceylon",
  NZL: "nz, aotearoa",
  SAU: "saudi",
  GMB: "gambia",
  MDV: "the maldives",
  BHS: "the bahamas",
  CHE: "swiss",
  DEU: "deutschland",
  ESP: "espana",
  ITA: "italia",
  GRC: "hellas",
  MAR: "morroco",
};

/**
 * Cities, islands and regions, by the country they are in. Europe and south-east Asia are covered
 * closely because that is where this app's trips go; the rest of the world is covered well enough
 * that a map of someone else's travels still fills in.
 */
const CITIES: Record<string, string> = {
  // ---- Europe ----
  ITA: "rome, roma, florence, firenze, milan, milano, venice, venezia, naples, napoli, turin, torino, bologna, pisa, siena, verona, genoa, genova, palermo, catania, bari, perugia, lucca, rimini, trieste, padua, padova, parma, cinque terre, amalfi, amalfi coast, sorrento, positano, capri, sardinia, sardegna, sicily, sicilia, tuscany, toscana, lake como, bergamo, brescia, modena, ravenna, assisi, portofino, matera, cagliari, dolomites, bolzano, cortina, courmayeur, lake garda, ischia, taormina, viareggio, livorno, orvieto, san gimignano, chianti",
  FRA: "paris, nice, cote d azur, french riviera, lyon, lyons, marseille, bordeaux, toulouse, nantes, lille, strasbourg, montpellier, cannes, avignon, annecy, chamonix, biarritz, corsica, corse, normandy, normandie, provence, versailles, grenoble, rennes, dijon, reims, aix en provence, saint tropez, st tropez, la rochelle, carcassonne, colmar, mont saint michel, loire valley, val d isere, courchevel, tignes, meribel, antibes, menton, toulon, brittany, bretagne, bayonne, perpignan",
  ESP: "madrid, barcelona, seville, sevilla, valencia, malaga, granada, bilbao, san sebastian, mallorca, majorca, ibiza, palma, tenerife, gran canaria, canary islands, canaries, cordoba, zaragoza, alicante, marbella, santiago de compostela, girona, toledo, segovia, menorca, lanzarote, fuerteventura, costa brava, costa del sol, salamanca, valladolid, santander, oviedo, pamplona, murcia, cadiz, ronda, formentera, sitges, tarragona, benidorm",
  PRT: "lisbon, lisboa, porto, oporto, algarve, faro, madeira, azores, sintra, coimbra, braga, funchal, cascais, evora, nazare, aveiro, albufeira, douro valley",
  GBR: "london, bath, manchester, edinburgh, glasgow, liverpool, birmingham, bristol, oxford, cambridge, leeds, newcastle, brighton, york, cardiff, belfast, inverness, cornwall, lake district, nottingham, sheffield, aberdeen, dundee, st andrews, bournemouth, southampton, leicester, norwich, exeter, durham, canterbury, windsor, cotswolds, isle of skye, skye, snowdonia, stirling, swansea, derry, londonderry, gatwick, heathrow, stansted, luton",
  IRL: "dublin, galway, cork, killarney, limerick, kilkenny, dingle, shannon, waterford, ring of kerry, cliffs of moher, howth",
  DEU: "berlin, munich, munchen, muenchen, hamburg, frankfurt, cologne, koln, koeln, dusseldorf, duesseldorf, stuttgart, dresden, leipzig, nuremberg, nurnberg, nuernberg, heidelberg, bremen, hannover, hanover, black forest, bavaria, bayern, garmisch, freiburg, wurzburg, rothenburg, potsdam, aachen, mainz, bonn, essen, dortmund, kiel, lubeck, regensburg, augsburg, berchtesgaden",
  NLD: "amsterdam, rotterdam, utrecht, the hague, den haag, eindhoven, haarlem, maastricht, delft, groningen, leiden, keukenhof, zaanse schans, texel",
  BEL: "brussels, bruxelles, brussel, bruges, brugge, antwerp, antwerpen, ghent, gent, leuven, liege, ostend, mechelen, namur",
  CHE: "zurich, zuerich, geneva, geneve, bern, berne, basel, lucerne, luzern, lausanne, interlaken, zermatt, lugano, st moritz, grindelwald, montreux, lauterbrunnen, davos, verbier, gstaad, appenzell, jungfraujoch",
  AUT: "vienna, wien, salzburg, innsbruck, graz, hallstatt, linz, kitzbuhel, st anton, zell am see, bregenz, wachau",
  CZE: "prague, praha, brno, cesky krumlov, karlovy vary, olomouc, ostrava, plzen, pilsen",
  POL: "warsaw, warszawa, krakow, cracow, gdansk, wroclaw, poznan, zakopane, auschwitz, lodz, katowice, torun, sopot, malbork",
  HUN: "budapest, debrecen, szeged, lake balaton, eger, pecs",
  HRV: "zagreb, split, dubrovnik, hvar, zadar, rovinj, pula, istria, plitvice, sibenik, korcula, makarska, trogir, brac",
  SVN: "ljubljana, bled, lake bled, piran, bohinj, maribor, postojna",
  GRC: "athens, athina, thessaloniki, santorini, mykonos, crete, kreta, heraklion, rhodes, rodos, corfu, kerkyra, naxos, paros, zakynthos, zante, milos, meteora, kos, chania, ios, syros, lefkada, kefalonia, nafplio, delphi, peloponnese, skiathos, samos, antiparos",
  TUR: "istanbul, ankara, izmir, antalya, cappadocia, kapadokya, bodrum, fethiye, pamukkale, goreme, marmaris, kas, ephesus, trabzon, bursa, konya, dalaman",
  DNK: "copenhagen, kobenhavn, kopenhagen, aarhus, odense, aalborg, skagen, billund, roskilde",
  SWE: "stockholm, gothenburg, goteborg, malmo, kiruna, abisko, uppsala, visby, gotland, lapland, lund",
  NOR: "oslo, svalbard, longyearbyen, bergen, tromso, trondheim, stavanger, lofoten, alesund, geiranger, flam, kirkenes, bodo, narvik, trolltunga, preikestolen",
  FIN: "helsinki, rovaniemi, tampere, turku, oulu, lapland finland, levi, porvoo",
  ISL: "reykjavik, akureyri, vik, blue lagoon, golden circle, jokulsarlon, keflavik, husavik",
  EST: "tallinn, tartu, parnu, saaremaa",
  LVA: "riga, jurmala, sigulda",
  LTU: "vilnius, kaunas, klaipeda, trakai, nida",
  ROU: "bucharest, bucuresti, brasov, cluj, sibiu, transylvania, timisoara, sighisoara, constanta, bran",
  BGR: "sofia, plovdiv, varna, burgas, bansko, veliko tarnovo, sunny beach",
  SRB: "belgrade, beograd, novi sad, nis",
  MNE: "kotor, budva, podgorica, tivat, durmitor, perast",
  ALB: "tirana, tirane, saranda, berat, gjirokaster, ksamil, durres",
  BIH: "sarajevo, mostar, banja luka",
  MKD: "skopje, ohrid, bitola",
  SVK: "bratislava, kosice, high tatras, tatras, zilina",
  UKR: "kyiv, kiev, lviv, odesa, odessa, kharkiv, dnipro, chernivtsi",
  BLR: "minsk, brest",
  RUS: "moscow, moskva, st petersburg, saint petersburg, petersburg, sochi, kazan, novosibirsk, yekaterinburg, vladivostok, irkutsk, lake baikal, murmansk",
  MLT: "valletta, gozo, sliema, mdina, st julians, comino",
  CYP: "nicosia, limassol, paphos, ayia napa, larnaca, protaras",
  MCO: "monte carlo, montecarlo",
  AND: "andorra la vella",
  LIE: "vaduz",
  MDA: "chisinau",
  GEO: "tbilisi, batumi, kazbegi, kutaisi, mestia, svaneti",
  ARM: "yerevan, gyumri, dilijan",
  AZE: "baku, ganja, sheki",
  LUX: "luxembourg city",
  SMR: "san marino city",
  VAT: "vatican, the vatican, st peters, holy see",
  FRO: "torshavn, faroe, faroes",
  JEY: "st helier",
  IMN: "douglas isle of man",

  // ---- South-east Asia and the rest of Asia ----
  THA: "bangkok, chiang mai, chiang rai, phuket, krabi, koh samui, samui, koh phangan, koh tao, pai, ayutthaya, pattaya, hua hin, railay, koh lanta, koh phi phi, phi phi, ao nang, kanchanaburi, sukhothai, koh chang, khao sok, koh yao, surat thani, udon thani, isaan",
  VNM: "hanoi, ho chi minh city, ho chi minh, saigon, hoi an, da nang, danang, hue, nha trang, ha long, halong, halong bay, sapa, phu quoc, ninh binh, dalat, da lat, mui ne, can tho, mekong delta, cat ba, ha giang, phong nha",
  KHM: "phnom penh, siem reap, angkor, angkor wat, sihanoukville, kampot, battambang, kep, koh rong",
  LAO: "vientiane, luang prabang, vang vieng, pakse, don det, si phan don, luang namtha",
  MMR: "yangon, rangoon, bagan, mandalay, inle lake, naypyidaw, ngapali",
  MYS: "kuala lumpur, penang, george town, langkawi, malacca, melaka, kota kinabalu, johor bahru, ipoh, cameron highlands, perhentian, tioman, kuching, sarawak, sabah, putrajaya",
  IDN: "bali, java, jakarta, ubud, canggu, seminyak, yogyakarta, jogja, lombok, gili islands, gili trawangan, komodo, labuan bajo, surabaya, bandung, raja ampat, nusa penida, sumatra, uluwatu, kuta, sanur, medan, lake toba, bromo, sulawesi, makassar",
  PHL: "manila, cebu, palawan, el nido, boracay, coron, siargao, bohol, davao, makati, bacolod, iloilo, vigan, banaue",
  BRN: "bandar seri begawan",
  TLS: "dili",
  CHN: "beijing, peking, shanghai, guangzhou, shenzhen, chengdu, xian, xi an, guilin, hangzhou, suzhou, zhangjiajie, chongqing, harbin, lhasa, tibet, yangshuo, kunming, qingdao, tianjin, dali, lijiang, great wall, zhuhai, xiamen",
  HKG: "kowloon, lantau, tsim sha tsui",
  TWN: "taipei, kaohsiung, taichung, tainan, hualien, taroko, jiufen, kenting",
  JPN: "tokyo, kyoto, osaka, hiroshima, nara, sapporo, fukuoka, okinawa, hakone, nagoya, kanazawa, takayama, nikko, mount fuji, fuji, niseko, yokohama, kobe, sendai, shibuya, shinjuku, miyajima, kamakura, beppu, matsumoto, hakuba, naoshima, ishigaki",
  KOR: "seoul, busan, jeju, incheon, gyeongju, daegu, sokcho, jeonju",
  IND: "delhi, new delhi, mumbai, bombay, bangalore, bengaluru, goa, jaipur, agra, taj mahal, varanasi, kerala, kolkata, calcutta, chennai, madras, udaipur, rishikesh, ladakh, leh, hyderabad, pune, amritsar, jodhpur, kochi, cochin, darjeeling, mysore, jaisalmer, hampi, shimla, manali, pushkar, alleppey, munnar",
  NPL: "kathmandu, pokhara, everest base camp, annapurna, chitwan, lukla, nagarkot",
  LKA: "colombo, kandy, galle, ella, sigiriya, negombo, mirissa, unawatuna, nuwara eliya, arugam bay, yala",
  BGD: "dhaka, chittagong, coxs bazar",
  PAK: "lahore, karachi, islamabad, hunza, skardu, peshawar",
  BTN: "thimphu, paro, punakha",
  ARE: "dubai, abu dhabi, sharjah, ajman, ras al khaimah, fujairah",
  QAT: "doha",
  OMN: "muscat, salalah, nizwa, wahiba",
  SAU: "riyadh, jeddah, mecca, makkah, medina, alula, dammam",
  BHR: "manama",
  KWT: "kuwait city",
  ISR: "tel aviv, jerusalem, haifa, eilat, nazareth, dead sea",
  JOR: "amman, petra, wadi rum, aqaba, jerash, madaba",
  LBN: "beirut, byblos, baalbek",
  IRN: "tehran, isfahan, esfahan, shiraz, yazd, persepolis, kashan",
  UZB: "tashkent, samarkand, bukhara, khiva",
  KAZ: "almaty, astana, nur sultan, shymkent",
  KGZ: "bishkek, osh, karakol, issyk kul",
  MNG: "ulaanbaatar, ulan bator, gobi",
  MDV: "maafushi, addu, ari atoll",

  // ---- Australia, New Zealand and the Pacific ----
  AUS: "sydney, melbourne, brisbane, perth, adelaide, cairns, gold coast, darwin, hobart, canberra, byron bay, uluru, ayers rock, airlie beach, whitsundays, great barrier reef, tasmania, alice springs, noosa, fraser island, margaret river, port douglas, great ocean road, blue mountains, sunshine coast, broome, geelong, townsville, wollongong, kangaroo island, bondi, daintree, coober pedy, esperance",
  NZL: "auckland, wellington, christchurch, queenstown, rotorua, dunedin, nelson, taupo, wanaka, milford sound, hobbiton, tauranga, napier, franz josef, te anau, kaikoura, bay of islands, tongariro, abel tasman",
  FJI: "nadi, suva, denarau, mamanuca, yasawa",
  PNG: "port moresby",
  NCL: "noumea",
  PYF: "tahiti, bora bora, moorea, papeete",
  WSM: "apia",
  VUT: "port vila",
  COK: "rarotonga",

  // ---- The Americas ----
  USA: "new york, nyc, new york city, los angeles, san francisco, chicago, boston, washington dc, washington, seattle, miami, las vegas, new orleans, austin, denver, portland, san diego, philadelphia, atlanta, houston, dallas, phoenix, nashville, honolulu, hawaii, alaska, yosemite, grand canyon, yellowstone, orlando, salt lake city, minneapolis, detroit, st louis, san antonio, charleston, savannah, palo alto, berkeley, brooklyn, manhattan, aspen, maui, key west, new jersey, california, texas, florida, colorado, utah, arizona, nevada, oregon, vermont, maine, memphis, pittsburgh, baltimore, milwaukee, sacramento, santa barbara, santa fe, jackson hole, park city, big sur, napa, lake tahoe, martha s vineyard, cape cod, zion, moab, sedona",
  CAN: "toronto, vancouver, montreal, calgary, ottawa, quebec, quebec city, banff, whistler, halifax, edmonton, winnipeg, niagara falls, jasper, kelowna, mont tremblant, yukon, whitehorse, st johns",
  MEX: "mexico city, cdmx, cancun, tulum, playa del carmen, oaxaca, guadalajara, puerto vallarta, merida, san miguel de allende, cabo san lucas, los cabos, monterrey, tijuana, cozumel, chichen itza, puebla, holbox, sayulita, mazatlan, isla mujeres",
  BRA: "rio de janeiro, rio, sao paulo, salvador, brasilia, florianopolis, manaus, iguazu, iguacu, fortaleza, recife, curitiba, belo horizonte, paraty, buzios, jericoacoara, lencois maranhenses",
  ARG: "buenos aires, mendoza, bariloche, ushuaia, salta, el calafate, el chalten, iguazu falls, rosario, puerto madryn",
  CHL: "santiago, valparaiso, atacama, san pedro de atacama, torres del paine, punta arenas, puerto varas, easter island, rapa nui, pucon",
  PER: "lima, cusco, cuzco, machu picchu, arequipa, iquitos, huacachina, puno, lake titicaca, huaraz, sacred valley",
  COL: "bogota, medellin, cartagena, cali, santa marta, tayrona, salento, guatape, san andres",
  ECU: "quito, guayaquil, galapagos, cuenca, banos, montanita",
  BOL: "la paz, sucre, uyuni, salar de uyuni, santa cruz de la sierra, copacabana bolivia",
  URY: "montevideo, punta del este, colonia del sacramento",
  PRY: "asuncion",
  VEN: "caracas, margarita island",
  GUY: "georgetown guyana",
  SUR: "paramaribo",
  CRI: "san jose costa rica, manuel antonio, tamarindo, la fortuna, monteverde, jaco, puerto viejo, nosara, arenal",
  PAN: "panama city, bocas del toro, san blas, boquete",
  GTM: "guatemala city, antigua guatemala, lake atitlan, semuc champey, tikal",
  BLZ: "belize city, caye caulker, san pedro belize, placencia",
  NIC: "managua, san juan del sur, ometepe, leon nicaragua",
  HND: "roatan, tegucigalpa, utila, copan",
  SLV: "san salvador, el tunco",
  CUB: "havana, habana, varadero, vinales, trinidad cuba, cienfuegos",
  JAM: "kingston, montego bay, negril, ocho rios",
  DOM: "punta cana, santo domingo, puerto plata, samana, las terrenas",
  BHS: "nassau, exuma, paradise island",
  BRB: "bridgetown",
  PRI: "san juan, old san juan, rincon",
  ABW: "oranjestad",
  TTO: "port of spain, trinidad, tobago",

  // ---- Africa and the Middle East ----
  MAR: "marrakech, marrakesh, casablanca, fes, fez, chefchaouen, tangier, essaouira, rabat, agadir, merzouga, ouarzazate, atlas mountains, taghazout",
  EGY: "cairo, luxor, aswan, hurghada, sharm el sheikh, sharm, alexandria, giza, dahab, marsa alam, nile",
  ZAF: "cape town, johannesburg, joburg, durban, kruger, stellenbosch, pretoria, port elizabeth, garden route, hermanus, franschhoek, drakensberg, soweto",
  TZA: "zanzibar, dar es salaam, arusha, serengeti, kilimanjaro, stone town, ngorongoro, nungwi",
  KEN: "nairobi, mombasa, masai mara, maasai mara, diani, lamu, naivasha, amboseli",
  NAM: "windhoek, swakopmund, sossusvlei, etosha, walvis bay",
  BWA: "gaborone, okavango, maun, chobe",
  ZWE: "victoria falls, harare, bulawayo, hwange",
  ZMB: "lusaka, livingstone",
  UGA: "kampala, entebbe, bwindi, jinja",
  RWA: "kigali, volcanoes national park",
  ETH: "addis ababa, lalibela, gondar, bahir dar",
  GHA: "accra, kumasi, cape coast",
  NGA: "lagos, abuja, port harcourt",
  SEN: "dakar, saint louis senegal, goree",
  TUN: "tunis, djerba, sousse, hammamet, carthage, sidi bou said",
  DZA: "algiers, oran",
  MUS: "port louis, grand baie, flic en flac",
  SYC: "mahe, praslin, la digue, victoria seychelles",
  MDG: "antananarivo, nosy be",
  MOZ: "maputo, tofo, bazaruto",
  MWI: "lilongwe, lake malawi",
  CPV: "sal, boa vista, praia",
};

/**
 * Names that are ordinary English words, or that belong to somewhere far better known under
 * another country. They count in a trip's Where box, where someone has clearly written a place,
 * and never in a title, where "a nice weekend" would otherwise put Alex on the Côte d'Azur.
 */
const ONLY_IN_WHERE = new Set(["nice", "split", "bath", "java"]);

// ---------- Matching ----------

/** Down to plain lowercase words: no accents, no punctuation, no runs of spaces. */
export function normalize(text: string) {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Every name the gazetteer knows, longest first so "new jersey" beats "jersey". */
const INDEX: Map<string, string> = (() => {
  const index = new Map<string, string>();
  // Countries first and cities after, so that a country's own name always wins a collision.
  const add = (name: string, code: string) => {
    const key = normalize(name);
    if (key && !index.has(key)) index.set(key, code);
  };
  for (const [code, list] of Object.entries(ALIASES)) for (const name of list.split(",")) add(name, code);
  for (const shape of COUNTRIES) add(shape.name, shape.code);
  for (const [code, list] of Object.entries(CITIES)) for (const name of list.split(",")) add(name, code);
  return index;
})();

/** The longest place name in the gazetteer, in words — how far ahead a match has to look. */
const LONGEST = Math.max(...[...INDEX.keys()].map((k) => k.split(" ").length));

/**
 * The country each name in the gazetteer belongs to. Exported for the test that checks every one
 * of them has an outline to colour in — Gibraltar and Réunion are real places with no country of
 * their own on a 1:50m map, and a name here that the map cannot draw is a trip quietly lost.
 */
export const knownPlaces = () => INDEX;

/**
 * Every country named in a piece of text, in the order they appear and without repeats.
 * `where` says the text came from a Where box, which lets the riskier names count.
 */
export function countriesIn(text: string, where = false): string[] {
  const words = normalize(text ?? "").split(" ").filter(Boolean);
  const found: string[] = [];
  for (let i = 0; i < words.length; ) {
    let matched = 0;
    // Longest phrase first: "new york" is not York, and "equatorial guinea" is not Guinea.
    for (let n = Math.min(LONGEST, words.length - i); n >= 1 && !matched; n--) {
      const phrase = words.slice(i, i + n).join(" ");
      const code = INDEX.get(phrase);
      if (!code || (!where && ONLY_IN_WHERE.has(phrase))) continue;
      if (!found.includes(code)) found.push(code);
      matched = n;
    }
    i += matched || 1;
  }
  return found;
}

/**
 * Where a trip is. The Where box is the answer when it has one; a title is only read when it
 * doesn't, because "Lisbon with Mum" is a place and "Nice flights booked" is not.
 */
export function countriesOfTrip(trip: Pick<Trip, "place" | "title">): string[] {
  const fromPlace = countriesIn(trip.place ?? "", true);
  return fromPlace.length ? fromPlace : countriesIn(trip.title ?? "");
}

// ---------- What the map draws ----------

/** How a country reads on the map, strongest first: somewhere you are, were, are going, or might. */
export type VisitStatus = "now" | "been" | "booked" | "idea";
const STATUS_ORDER: Record<VisitStatus, number> = { now: 0, been: 1, booked: 2, idea: 3 };

export const VISIT_LABELS: Record<VisitStatus, string> = {
  now: "Here now",
  been: "Been",
  booked: "Booked",
  idea: "Idea",
};

/**
 * A mark earns a country the same colour a trip would, so the map reads the same either way.
 * It is only the words that differ: nothing is "Booked" when there's no booking behind it.
 */
const MARK_STATUS: Record<MarkKind, VisitStatus> = { been: "been", planned: "booked", wish: "idea" };
export const MARK_LABELS: Record<MarkKind, string> = { been: "Been", planned: "Planned", wish: "Wish list" };
export const MARKS: [MarkKind, string][] = [
  ["been", "Been"],
  ["planned", "Planned"],
  ["wish", "Wish list"],
];

/** One trip's standing today: on now, finished, still to come, or never more than an idea. */
export function tripStatus(trip: Pick<Trip, "start_date" | "end_date" | "status">, today: string): VisitStatus {
  if (!trip.start_date) return "idea";
  const end = tripEnd(trip as Pick<Trip, "start_date" | "end_date">)!;
  if (trip.start_date <= today && end >= today) return "now";
  if (end < today) return trip.status === "idea" ? "idea" : "been";
  return trip.status === "idea" ? "idea" : "booked";
}

const NAMES = new Map(COUNTRIES.map((c) => [c.code, c.name] as const));

/** A country's name from its ISO code, for the countries with no trip on them to fall back on. */
export const countryName = (code: string) => NAMES.get(code) ?? code;

/**
 * What a country's pill reads. A mark with no trip behind it says what it is — nothing is
 * "Booked" on the strength of someone tapping Planned.
 */
export const visitLabel = (v: Pick<CountryVisit, "status" | "mark" | "trips">) =>
  v.trips.length === 0 && v.mark ? MARK_LABELS[v.mark] : VISIT_LABELS[v.status];

/**
 * How far along a countries goal someone is. The map's bar used to be a share of all 195
 * countries in the world, which is a denominator nobody is actually aiming at; this is theirs.
 * Null when no goal is set, which is the map's cue to offer one rather than invent a number.
 */
export function goalProgress(been: number, goal: number | null | undefined) {
  if (!goal || goal < 1) return null;
  return {
    goal,
    been,
    left: Math.max(0, goal - been),
    // Past the goal the bar stays full rather than overflowing, but `been` still reads honestly.
    pct: Math.min(100, Math.round((been / goal) * 100)),
    met: been >= goal,
  };
}

export type CountryVisit = {
  code: string;
  name: string;
  status: VisitStatus;
  /** Set by hand (0012), whether or not there are also trips here. */
  mark: MarkKind | null;
  trips: Trip[];
  /** Days spent in the country, counting a day shared by two trips once. */
  days: number;
  first: string | null;
  last: string | null;
};

/**
 * The map's whole model: a country for every trip that could be placed, every country marked by
 * hand, and the trips that couldn't be placed, which the tab lists so they can be given a Where.
 */
export function countryVisits(trips: Trip[], today: string, marks: CountryMark[] = []): { visits: CountryVisit[]; unplaced: Trip[] } {
  const byCode = new Map<string, { visit: CountryVisit; days: Set<number> }>();
  const unplaced: Trip[] = [];

  const blank = (code: string, status: VisitStatus) => {
    const entry = byCode.get(code) ?? {
      visit: { code, name: countryName(code), status, mark: null, trips: [], days: 0, first: null, last: null },
      days: new Set<number>(),
    };
    byCode.set(code, entry);
    return entry;
  };

  for (const trip of trips) {
    const codes = countriesOfTrip(trip).filter((code) => NAMES.has(code));
    if (!codes.length) {
      unplaced.push(trip);
      continue;
    }
    const status = tripStatus(trip, today);
    for (const code of codes) {
      const entry = blank(code, status);
      entry.visit.trips.push(trip);
      if (STATUS_ORDER[status] < STATUS_ORDER[entry.visit.status]) entry.visit.status = status;
      if (trip.start_date) {
        const end = tripEnd(trip)!;
        for (let d = dayNum(trip.start_date); d <= dayNum(end); d++) entry.days.add(d);
        if (!entry.visit.first || trip.start_date < entry.visit.first) entry.visit.first = trip.start_date;
        if (!entry.visit.last || end > entry.visit.last) entry.visit.last = end;
      }
    }
  }

  // A mark brings a country onto the map on its own, and where there are trips too the stronger
  // of the two wins — somewhere you've been and are going back to still reads as been.
  for (const m of marks) {
    if (!NAMES.has(m.code) || !MARK_STATUS[m.mark]) continue;
    const status = MARK_STATUS[m.mark];
    const entry = blank(m.code, status);
    entry.visit.mark = m.mark;
    if (STATUS_ORDER[status] < STATUS_ORDER[entry.visit.status]) entry.visit.status = status;
  }

  const visits = [...byCode.values()].map(({ visit, days }) => ({ ...visit, days: days.size }));
  // Somewhere you are now, then somewhere you've been, then by name — the same order the list reads in.
  visits.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.name.localeCompare(b.name));
  return { visits, unplaced };
}
