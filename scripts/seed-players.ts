/**
 * Seed inicial: top 50 ATP + top 30 WTA
 * Run: npx tsx scripts/seed-players.ts
 *
 * Os ELOs são aproximações baseadas no tennis_elo_auto.py
 * Em produção, este script será substituído por:
 *   1. Importação Jeff Sackmann CSV (40k matches históricos)
 *   2. Cron diária Python que recalcula ELOs
 */
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const PHOTO_BASE = (file: string) =>
  `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=200`;

const players = [
  // ATP top 25
  { slug: 'jannik-sinner',         name: 'Jannik Sinner',         country: 'ITA', flag: '🇮🇹', tour: 'atp', atp_rank: 1,  hand: 'right', height_cm: 188, elo_overall: 2297, elo_hard: 2252, elo_clay: 2156, elo_grass: 2077, elo_indoor: 2245, elo_30d_ago: 2273, form_l5: 'VVVVD', titles: 14, slams: 2, photo: 'Jannik_Sinner_(2024_US_Open)_01.jpg' },
  { slug: 'carlos-alcaraz',        name: 'Carlos Alcaraz',        country: 'ESP', flag: '🇪🇸', tour: 'atp', atp_rank: 2,  hand: 'right', height_cm: 183, elo_overall: 2272, elo_hard: 2199, elo_clay: 2216, elo_grass: 2140, elo_indoor: 2160, elo_30d_ago: 2234, form_l5: 'VVVVV', titles: 16, slams: 4, photo: 'Carlos_Alcaraz_Argentina_Open_2024.jpg' },
  { slug: 'novak-djokovic',        name: 'Novak Djokovic',        country: 'SRB', flag: '🇷🇸', tour: 'atp', atp_rank: 3,  hand: 'right', height_cm: 188, elo_overall: 2100, elo_hard: 2052, elo_clay: 2002, elo_grass: 1955, elo_indoor: 2050, elo_30d_ago: 2112, form_l5: 'VDVDV', titles: 99, slams: 24, photo: 'Novak_Djokovic_-_Roland-Garros_-_28.05.2024_croped.jpg' },
  { slug: 'alexander-zverev',      name: 'Alexander Zverev',      country: 'GER', flag: '🇩🇪', tour: 'atp', atp_rank: 4,  hand: 'right', height_cm: 198, elo_overall: 2069, elo_hard: 2026, elo_clay: 2007, elo_grass: 1889, elo_indoor: 2010, elo_30d_ago: 2061, form_l5: 'VDVVV', titles: 23, slams: 0, photo: 'Paris-FR-75-open_de_tennis-2019-Roland_Garros-court_Chatrier-6_juin-Zverev-08.jpg' },
  { slug: 'daniil-medvedev',       name: 'Daniil Medvedev',       country: 'RUS', flag: '🇷🇺', tour: 'atp', atp_rank: 5,  hand: 'right', height_cm: 198, elo_overall: 2019, elo_hard: 1983, elo_clay: 1924, elo_grass: 1889, elo_indoor: 2050, elo_30d_ago: 2034, form_l5: 'DVDVV', titles: 20, slams: 1, photo: 'Danill_Medvedev_Miami_2019_(cropped).jpg' },
  { slug: 'alex-de-minaur',        name: 'Alex de Minaur',        country: 'AUS', flag: '🇦🇺', tour: 'atp', atp_rank: 6,  hand: 'right', height_cm: 183, elo_overall: 2009, elo_hard: 1960, elo_clay: 1902, elo_grass: 1841, elo_indoor: 1940, elo_30d_ago: 1991, form_l5: 'VVVVV', titles: 9,  slams: 0, photo: 'De_Minaur_Rosmalen.jpg' },
  { slug: 'felix-auger-aliassime', name: 'Felix Auger Aliassime', country: 'CAN', flag: '🇨🇦', tour: 'atp', atp_rank: 7,  hand: 'right', height_cm: 193, elo_overall: 1986, elo_hard: 1946, elo_clay: 1864, elo_grass: 1794, elo_indoor: 1980, elo_30d_ago: 1964, form_l5: 'VVDVV', titles: 5,  slams: 0, photo: 'Félix_Auger-Aliassime_ABN_AMRO_Open_2024.jpg' },
  { slug: 'taylor-fritz',          name: 'Taylor Fritz',          country: 'USA', flag: '🇺🇸', tour: 'atp', atp_rank: 8,  hand: 'right', height_cm: 196, elo_overall: 1980, elo_hard: 1924, elo_clay: 1873, elo_grass: 1914, elo_indoor: 1930, elo_30d_ago: 1986, form_l5: 'DVDDV', titles: 9,  slams: 0, photo: 'Taylor_Fritz_-_Delray_Beach_Open_Final_Round_(cropped).jpg' },
  { slug: 'lorenzo-musetti',       name: 'Lorenzo Musetti',       country: 'ITA', flag: '🇮🇹', tour: 'atp', atp_rank: 9,  hand: 'right', height_cm: 185, elo_overall: 1979, elo_hard: 1909, elo_clay: 1984, elo_grass: 1856, elo_indoor: 1880, elo_30d_ago: 1948, form_l5: 'VVVDV', titles: 2,  slams: 0, photo: 'Musetti_MCM23_(11)_(52883593753).jpg' },
  { slug: 'arthur-fils',           name: 'Arthur Fils',           country: 'FRA', flag: '🇫🇷', tour: 'atp', atp_rank: 10, hand: 'right', height_cm: 188, elo_overall: 1976, elo_hard: 1928, elo_clay: 1894, elo_grass: 1774, elo_indoor: 1900, elo_30d_ago: 1962, form_l5: 'VVDVV', titles: 4,  slams: 0, photo: 'Arthur_Fils_-_2024_Olympics_(still)_(cropped).jpg' },
  { slug: 'stefanos-tsitsipas',    name: 'Stefanos Tsitsipas',    country: 'GRE', flag: '🇬🇷', tour: 'atp', atp_rank: 11, hand: 'right', height_cm: 193, elo_overall: 1955, elo_hard: 1864, elo_clay: 2087, elo_grass: 1850, elo_indoor: 1880, elo_30d_ago: 1964, form_l5: 'DVDVV', titles: 11, slams: 0, photo: 'Tsitsipas_S._MCM22_(cropped).jpg' },
  { slug: 'casper-ruud',           name: 'Casper Ruud',           country: 'NOR', flag: '🇳🇴', tour: 'atp', atp_rank: 12, hand: 'right', height_cm: 183, elo_overall: 1942, elo_hard: 1871, elo_clay: 2018, elo_grass: 1830, elo_indoor: 1850, elo_30d_ago: 1946, form_l5: 'DVVDV', titles: 12, slams: 0, photo: 'Ruud_RG22_(58)_(52144535415).jpg' },
  { slug: 'sebastian-korda',       name: 'Sebastian Korda',       country: 'USA', flag: '🇺🇸', tour: 'atp', atp_rank: 13, hand: 'right', height_cm: 196, elo_overall: 1925, elo_hard: 1900, elo_clay: 1854, elo_grass: 1830, elo_indoor: 1860, elo_30d_ago: 1908, form_l5: 'VDVVD', titles: 1,  slams: 0, photo: 'Sebastian_Korda_(2023_DC_Open)_02.jpg' },
  { slug: 'hubert-hurkacz',        name: 'Hubert Hurkacz',        country: 'POL', flag: '🇵🇱', tour: 'atp', atp_rank: 14, hand: 'right', height_cm: 196, elo_overall: 1918, elo_hard: 1950, elo_clay: 1893, elo_grass: 1980, elo_indoor: 1960, elo_30d_ago: 1932, form_l5: 'DVDVV', titles: 8,  slams: 0, photo: 'Hubi_Hurkacz_(2023_DC_Open)_01.jpg' },
  { slug: 'holger-rune',           name: 'Holger Rune',           country: 'DEN', flag: '🇩🇰', tour: 'atp', atp_rank: 15, hand: 'right', height_cm: 188, elo_overall: 1905, elo_hard: 1885, elo_clay: 1920, elo_grass: 1820, elo_indoor: 1900, elo_30d_ago: 1882, form_l5: 'VVDVV', titles: 5,  slams: 0, photo: 'Rune_RG22_(4)_(52144534990).jpg' },
  { slug: 'jiri-lehecka',          name: 'Jiří Lehečka',          country: 'CZE', flag: '🇨🇿', tour: 'atp', atp_rank: 16, hand: 'right', height_cm: 188, elo_overall: 1895, elo_hard: 1880, elo_clay: 1850, elo_grass: 1850, elo_indoor: 1860, elo_30d_ago: 1854, form_l5: 'VVDVV', titles: 1,  slams: 0, photo: null },
  { slug: 'matteo-arnaldi',        name: 'Matteo Arnaldi',        country: 'ITA', flag: '🇮🇹', tour: 'atp', atp_rank: 17, hand: 'right', height_cm: 188, elo_overall: 1812, elo_hard: 1820, elo_clay: 1870, elo_grass: 1750, elo_indoor: 1810, elo_30d_ago: 1798, form_l5: 'VDDVV', titles: 0,  slams: 0, photo: 'Arnaldi_BLO22_(68)_(52157038811).jpg' },
  { slug: 'mariano-navone',        name: 'Mariano Navone',        country: 'ARG', flag: '🇦🇷', tour: 'atp', atp_rank: 18, hand: 'right', height_cm: 188, elo_overall: 1742, elo_hard: 1700, elo_clay: 1820, elo_grass: 1650, elo_indoor: 1700, elo_30d_ago: 1735, form_l5: 'DVDVD', titles: 0,  slams: 0, photo: 'Road_2_Australia_-_Navone_V_Burruchaga_Final_-_BugWarp_206_(cropped).jpg' },
  { slug: 'sebastian-ofner',       name: 'Sebastian Ofner',       country: 'AUT', flag: '🇦🇹', tour: 'atp', atp_rank: 84, hand: 'right', height_cm: 188, elo_overall: 1812, elo_hard: 1750, elo_clay: 1812, elo_grass: 1700, elo_indoor: 1730, elo_30d_ago: 1789, form_l5: 'DVDVV', titles: 0,  slams: 0, photo: 'Ofner_RGQ22_(17)_(52129787779).jpg' },
  { slug: 'luciano-darderi',       name: 'Luciano Darderi',       country: 'ITA', flag: '🇮🇹', tour: 'atp', atp_rank: 32, hand: 'right', height_cm: 183, elo_overall: 1867, elo_hard: 1820, elo_clay: 1900, elo_grass: 1700, elo_indoor: 1800, elo_30d_ago: 1850, form_l5: 'VDVDV', titles: 1,  slams: 0, photo: null },

  // WTA top 12
  { slug: 'aryna-sabalenka',  name: 'Aryna Sabalenka',  country: 'BLR', flag: '🇧🇾', tour: 'wta', atp_rank: 1,  hand: 'right', height_cm: 182, elo_overall: 2266, elo_hard: 2266, elo_clay: 2120, elo_grass: 2080, elo_indoor: 2200, elo_30d_ago: 2248, form_l5: 'VVVVV', titles: 16, slams: 3, photo: 'Aryna_Sabalenka_US_Open_2024.jpg' },
  { slug: 'iga-swiatek',      name: 'Iga Swiatek',      country: 'POL', flag: '🇵🇱', tour: 'wta', atp_rank: 2,  hand: 'right', height_cm: 176, elo_overall: 2150, elo_hard: 2050, elo_clay: 2150, elo_grass: 1980, elo_indoor: 2030, elo_30d_ago: 2158, form_l5: 'VDVVV', titles: 22, slams: 5, photo: 'Iga_Świątek_(2023_US_Open)_08.jpg' },
  { slug: 'coco-gauff',       name: 'Coco Gauff',       country: 'USA', flag: '🇺🇸', tour: 'wta', atp_rank: 3,  hand: 'right', height_cm: 175, elo_overall: 2058, elo_hard: 2061, elo_clay: 1985, elo_grass: 1980, elo_indoor: 1960, elo_30d_ago: 2036, form_l5: 'VVVVV', titles: 8,  slams: 1, photo: 'Coco_Gauff_Miami_Open.jpg' },
  { slug: 'jasmine-paolini',  name: 'Jasmine Paolini',  country: 'ITA', flag: '🇮🇹', tour: 'wta', atp_rank: 4,  hand: 'right', height_cm: 163, elo_overall: 1992, elo_hard: 1965, elo_clay: 2010, elo_grass: 1920, elo_indoor: 1900, elo_30d_ago: 1958, form_l5: 'VVVVD', titles: 2,  slams: 0, photo: 'Jasmine_Paolini_(2023_US_Open)_01_(cropped).jpg' },
  { slug: 'elena-rybakina',   name: 'Elena Rybakina',   country: 'KAZ', flag: '🇰🇿', tour: 'wta', atp_rank: 5,  hand: 'right', height_cm: 184, elo_overall: 1978, elo_hard: 1985, elo_clay: 1900, elo_grass: 2050, elo_indoor: 1960, elo_30d_ago: 1990, form_l5: 'VDVDV', titles: 7,  slams: 1, photo: 'Elena_Rybakina_(2025_DC_Open)_11_(cropped).jpg' },
  { slug: 'qinwen-zheng',     name: 'Qinwen Zheng',     country: 'CHN', flag: '🇨🇳', tour: 'wta', atp_rank: 6,  hand: 'right', height_cm: 178, elo_overall: 1956, elo_hard: 1980, elo_clay: 1880, elo_grass: 1850, elo_indoor: 1900, elo_30d_ago: 1941, form_l5: 'VVDVV', titles: 4,  slams: 0, photo: 'Zheng_Qinwen_(2024_US_Open)_01_(cropped).jpg' },
  { slug: 'jessica-pegula',   name: 'Jessica Pegula',   country: 'USA', flag: '🇺🇸', tour: 'wta', atp_rank: 7,  hand: 'right', height_cm: 170, elo_overall: 1924, elo_hard: 1940, elo_clay: 1850, elo_grass: 1900, elo_indoor: 1880, elo_30d_ago: 1929, form_l5: 'VDDVV', titles: 8,  slams: 0, photo: 'Jessica_Pegula_(2025_DC_Open)_05_(cropped).jpg' },
  { slug: 'emma-navarro',     name: 'Emma Navarro',     country: 'USA', flag: '🇺🇸', tour: 'wta', atp_rank: 8,  hand: 'right', height_cm: 168, elo_overall: 1898, elo_hard: 1920, elo_clay: 1820, elo_grass: 1860, elo_indoor: 1840, elo_30d_ago: 1870, form_l5: 'VVVVV', titles: 1,  slams: 0, photo: 'FP_Movement_Emma_Navarro_2026.jpg' },
  { slug: 'madison-keys',     name: 'Madison Keys',     country: 'USA', flag: '🇺🇸', tour: 'wta', atp_rank: 9,  hand: 'right', height_cm: 178, elo_overall: 1885, elo_hard: 1910, elo_clay: 1810, elo_grass: 1900, elo_indoor: 1860, elo_30d_ago: 1866, form_l5: 'VVVDV', titles: 9,  slams: 1, photo: 'Madison_Keys_(2023_DC_Open)_01a_(cropped2).jpg' },
  { slug: 'daria-kasatkina',  name: 'Daria Kasatkina',  country: 'RUS', flag: '🇷🇺', tour: 'wta', atp_rank: 10, hand: 'right', height_cm: 170, elo_overall: 1862, elo_hard: 1875, elo_clay: 1890, elo_grass: 1780, elo_indoor: 1810, elo_30d_ago: 1865, form_l5: 'DVVDV', titles: 8,  slams: 0, photo: 'Daria_Kasatkina_(2024_DC_Open)_07.jpg' },
  { slug: 'marta-kostyuk',    name: 'Marta Kostyuk',    country: 'UKR', flag: '🇺🇦', tour: 'wta', atp_rank: 11, hand: 'right', height_cm: 173, elo_overall: 1840, elo_hard: 1820, elo_clay: 1880, elo_grass: 1750, elo_indoor: 1800, elo_30d_ago: 1812, form_l5: 'VVVVD', titles: 3,  slams: 0, photo: null },
  { slug: 'sara-errani',      name: 'Sara Errani',      country: 'ITA', flag: '🇮🇹', tour: 'wta', atp_rank: 73, hand: 'right', height_cm: 164, elo_overall: 1689, elo_hard: 1640, elo_clay: 1750, elo_grass: 1600, elo_indoor: 1650, elo_30d_ago: 1685, form_l5: 'DVDVD', titles: 9,  slams: 0, photo: null },
  { slug: 'elina-avanesyan',  name: 'Elina Avanesyan',  country: 'ARM', flag: '🇦🇲', tour: 'wta', atp_rank: 65, hand: 'right', height_cm: 175, elo_overall: 1721, elo_hard: 1710, elo_clay: 1740, elo_grass: 1670, elo_indoor: 1700, elo_30d_ago: 1718, form_l5: 'VDVDD', titles: 0,  slams: 0, photo: 'Avanesyan_WMQ23_(53061717086).jpg' },
] as const;

(async () => {
  console.log(`Inserindo ${players.length} jogadores...`);
  const rows = players.map(p => ({
    slug: p.slug,
    name: p.name,
    country: p.country,
    flag: p.flag,
    tour: p.tour,
    atp_rank: p.atp_rank,
    hand: p.hand,
    height_cm: p.height_cm,
    elo_overall: p.elo_overall,
    elo_hard: p.elo_hard,
    elo_clay: p.elo_clay,
    elo_grass: p.elo_grass,
    elo_indoor: p.elo_indoor,
    elo_30d_ago: p.elo_30d_ago,
    form_l5: p.form_l5,
    titles: p.titles,
    slams: p.slams,
    photo_url: p.photo ? PHOTO_BASE(p.photo) : null,
    active: true,
  }));

  const { data, error } = await supabase
    .from('players')
    .upsert(rows, { onConflict: 'slug' })
    .select('id, name');

  if (error) {
    console.error('❌ Erro:', error);
    process.exit(1);
  }
  console.log(`✓ ${data.length} jogadores inseridos/atualizados`);
  console.log(`  ATP: ${rows.filter(r => r.tour === 'atp').length}`);
  console.log(`  WTA: ${rows.filter(r => r.tour === 'wta').length}`);
})();
