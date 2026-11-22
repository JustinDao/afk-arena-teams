import { displayHeroName, Hero, Formation, Investment, Pet, Submission } from './models';
import { defaultAscensionForInvestment, parseInvestment } from './investment';
import { petIconUrl } from './pet-icon-url';

const heroNames = (
  'Rowan,Raine,Lyca,Lorsan,Ezizh,Liberta,Palmer,Odysseus,Orthros,Talimar,Tavriel,Gorok,Lavatune,Elthara,Dracula,Hybris,Lysander,Leviathan,Serenmira,Melion,Sion,Laios,Marcille,Velufira,Aurelia,Knox,Lan,Jerome,Misfortis,Awakened Envydiel,Kaelon,Gorren,Haelia,Alvida,Misha,Severin,Awakened Gavus,Albedo,Yennefer,Shuna,Atheus,Veithael,Rimuru,Saitama,Cha Hae-in,Sung Jinwoo,Randle,Brutus,Elijah & Lailah,Skylan,Terrible Tornado,Daemia,Begris,Lucilla,Selene,Adrian & Elyse,Judy Punch,Harvey,Thoran,Skriath,Pippa,Fawkes,Estrilda,Eluard,Safiya,Eironn,Kyno,Trix,Saurus,Mishka,Lucretia,Daimon,Silas,Belinda,Shemira,Thane,Baden,Scarlet,Mehira,Lucius,Rosaline,Arthur,Gwyneth,Gwyneth (Highborn),Ferael,Tasi,Nara,Alna,Hodgkin,Oden,Mortas,Framton,Merlin,Haelus,Desira,Treznor,Mezoth,Astarv,Joan,Rosa,Anasta,Talene,Tamrus,Thalassa,Vaelis,Lyla,Trishea,Naroko,Crassio,Rem,Emilia,Villanelle,Bronn,Ivan,Lady Simona,Zohra,Kalthin,Hildwin,Eugene,Maetria,Athalia,Solise,Antandra,Eorin,Grezhul,Nevanthi,Khasos,Kaz,Skreg,Warek,Vurk,Ginneas,Flora,Prince of Persia,Kafka Hibino,Mira,Athena,Nyla'
).split(',');
const heroesByDisplayName = new Map<string, Omit<Hero, 'id'>>();
for (const catalogName of heroNames) {
  const isAwakened = catalogName.startsWith('Awakened ');
  const name = catalogName.replace(/^Awakened\s+/, '');
  heroesByDisplayName.set(displayHeroName({ name, isAwakened }), { name, isAwakened });
}
for (const name of ['Lyca', 'Pippa', 'Fawkes', 'Estrilda', 'Thoran', 'Skriath', 'Eluard', 'Safiya', 'Eironn', 'Baden', 'Talene', 'Belinda', 'Thane', 'Merlin', 'Shemira', 'Brutus', 'Solise', 'Athalia', 'Lucius', 'Antandra']) {
  const key = displayHeroName({ name, isAwakened: true });
  if (!heroesByDisplayName.has(key)) {
    heroesByDisplayName.set(key, { name, isAwakened: true });
  }
}

export const HEROES: readonly Hero[] = [...heroesByDisplayName.values()]
  .map((hero, id) => ({ ...hero, id }))
  .sort((a, b) => displayHeroName(a).localeCompare(displayHeroName(b)));

export const HERO_BY_NAME: ReadonlyMap<string, Hero> = new Map(HEROES.map((hero) => [displayHeroName(hero), hero]));
export const HERO_BY_ID: ReadonlyMap<number, Hero> = new Map(HEROES.map((hero) => [hero.id, hero]));

const PET_CATALOG: readonly Pet[] = [
  { id: 6001, name: 'Dreary Ball', kind: 'basic' },
  { id: 6002, name: 'Tufty Ears', kind: 'basic' },
  { id: 6003, name: 'Grassy Orb', kind: 'basic' },
  { id: 6004, name: 'Polar Beast', kind: 'standard' },
  { id: 6005, name: 'Fire Breather', kind: 'standard' },
  { id: 6006, name: 'Blade Ridge', kind: 'standard' },
  { id: 6007, name: 'Winged Lion', kind: 'standard' },
  { id: 6008, name: 'Rock Crown Lizard', kind: 'standard' },
  { id: 6009, name: 'Feline Vesperio', kind: 'standard' },
  { id: 6010, name: 'Bellbellow', kind: 'standard' },
  { id: 6011, name: 'Flutterplume Owl', kind: 'standard' },
  { id: 6012, name: 'Talismane', kind: 'standard' },
  { id: 6013, name: 'Phantasmoth', kind: 'standard' },
  { id: 6014, name: 'Savage Soufflé', kind: 'standard' },
  { id: 6015, name: 'Slumber Seal', kind: 'standard' },
  { id: 6016, name: 'Fox Fatale', kind: 'standard' },
  { id: 6017, name: 'Shroom Spooder', kind: 'standard' },
  { id: 6018, name: 'Radish Rotunda', kind: 'standard' },
  { id: 6019, name: 'Pandy Dumpty', kind: 'standard' },
  { id: 6020, name: 'Ice Crown', kind: 'standard' },
  { id: 6021, name: 'Aureus', kind: 'standard' },
  { id: 6022, name: 'Pearlcrest Ibis', kind: 'standard' },
  { id: 6023, name: 'Treatspector', kind: 'standard' },
  { id: 6024, name: 'Joyous Roamer', kind: 'standard' },
  { id: 6025, name: 'Trickery Chest', kind: 'standard' },
  { id: 6026, name: 'Thistlekin', kind: 'standard' },
  { id: 6027, name: 'Nightfall Pegasus', kind: 'awakened' },
  { id: 6028, name: 'Count Snickerfang', kind: 'awakened' },
  { id: 6029, name: 'Twinlum Spirit', kind: 'awakened' },
  { id: 6030, name: 'Blazefang', kind: 'awakened' },
];

export const PETS: readonly Pet[] = PET_CATALOG.map((pet) => ({
  ...pet,
  iconUrl: petIconUrl(pet.id),
}));

function formation(key: string, label: string, spec: string, petName = '', timeSeconds: number | null = null): Formation {
  const heroes = spec.split(';').map((entry, pos) => {
    const [name, investment, mercenary] = entry.split('|');
    const hero = HERO_BY_NAME.get(name.trim().replace(/^Awakened\s+(.+)$/, '$1 (Awakened)'));
    if (!hero) throw new Error(`Sample data references unknown hero "${name.trim()}".`);
    const inv = parseInvestment(investment);
    return { pos, hid: hero.id, inv, ascension: defaultAscensionForInvestment(inv) ?? 'ascended', merc: mercenary === 'm', collection: null };
  });
  const pet = PETS.find(({ name }) => name === petName);
  if (petName && !pet) throw new Error(`Sample data references unknown pet "${petName}".`);
  return {
    key,
    label,
    beast: petName,
    petId: pet?.id ?? null,
    petIconUrl: pet ? petIconUrl(pet.id) : null,
    petLevel: pet ? 18 : null,
    timeSeconds,
    heroes,
  };
}

let nextId = 0;
const submissions: Submission[] = [];
function add(mode: string, target: string, up: number, days: number, result: Submission['result'], forms: Formation[], notes = '', heroLevel: number | null = null): void {
  submissions.push({ id: ++nextId, mode, target, up, days, result, forms, notes, by: 'sample', heroLevel });
}

add('nightmare-corridor', 'Netherspinner', 58, 2, {}, [
  formation('soulweaver', 'Soulweaver', 'Saurus|309e60;Mishka|309e30;Scarlet|209e30;Oden|309e30;Mortas|209', 'Polar Beast', 196),
  formation('the-devourer', 'The Devourer', 'Rowan|309e60;Lyca|309e30;Lorsan|309e30;Ezizh|309e60;Raine|309e30', 'Fire Breather', 178),
  formation('astral-devourer', 'Astral Devourer', 'Hybris|309e30;Dracula|309e60;Estrilda (Awakened)|309e60;Lyca|309e30;Rowan|309e60', 'Dreary Ball', 142),
  formation('dual-mantle', 'Dual-Mantle', 'Odysseus|309e60;Orthros|309e30;Liberta|309e30;Palmer|209e30;Talimar|309e60|m', 'Pandy Dumpty', 171),
  formation('cursed-caprihornus', 'Cursed Caprihornus', 'Elthara|309e60;Alvida|309e30;Rowan|309e60;Misha|209e30;Severin|309e30', 'Tufty Ears', 205),
  formation('netherspinner', 'Netherspinner', 'Tavriel|309e60;Gorok|309e60;Lavatune|309e30;Talimar|309e60;Lan|209e30', 'Grassy Orb', 189),
], 'Sample Nightmare Corridor cycle, identified by its sixth boss.');

const cursedForms = (guards: readonly string[], boss: string): Formation[] => [
  ...guards.map((spec, index) => formation(`sg${index + 1}`, `SG${index + 1}`, spec, PETS[index].name)),
  formation('boss', 'Boss', boss, PETS[5].name),
];
add('cursed-realm', 'Ice Shemira', 120, 2, { damage: 5.6e9 }, cursedForms([
  'Rowan;Lyca;Lorsan;Ezizh;Raine',
  'Talimar;Tavriel;Gorok;Lavatune;Elthara',
  'Dracula;Hybris;Lysander;Leviathan;Serenmira',
  'Melion;Sion;Laios;Marcille;Velufira',
  'Aurelia;Knox;Lan;Jerome;Misfortis',
], 'Belinda|309e60;Shemira|309e60|m;Silas|309e30;Lucretia|309e60;Daimon|309e30'), 'Boss team is the one to copy; the Shadow Guard teams are flexible.');
add('cursed-realm', 'Burning Brute', 64, 8, { damage: 3.9e9 }, cursedForms([
  'Saurus;Mishka;Scarlet;Oden;Mortas',
  'Hodgkin;Alna;Nara;Ferael;Tasi',
  'Gwyneth;Rosaline;Arthur;Lucius;Brutus',
  'Randle;Albedo;Yennefer;Shuna;Atheus',
  'Veithael;Rimuru;Saitama;Cha Hae-in;Sung Jinwoo',
], 'Belinda (Awakened);Raine;Rowan;Kyno;Trix'));

const treasureFormations = (...teams: string[]): Formation[] =>
  teams.map((team, index) => formation(`t${index + 1}`, `Team ${index + 1}`, team, PETS[(index + 10) % PETS.length].name));
add('treasure-scramble', 'Fire', 77, 4, { placementType: 'percent', placement: 1 }, treasureFormations(
  'Mehira;Brutus;Lucilla;Thoran;Raine',
  'Albedo;Merlin;Scarlet;Oden;Mishka',
  'Silas;Mortas;Haelus;Desira;Framton',
), 'Team 1 holds the front line, put it on the longest route.');
add('treasure-scramble', 'Frost', 39, 7, { placementType: 'rank', placement: 37 }, treasureFormations(
  'Kaelon;Envydiel (Awakened);Gorren;Haelia;Skylan',
  'Elijah & Lailah;Brutus;Randle;Aurelia;Saitama',
));

add('heroes-of-esperia', 'Current Season', 84, 2, {}, treasureFormations(
  'Lucius (Awakened);Gavus (Awakened);Aurelia;Misha;Jerome',
  'Envydiel (Awakened);Lan;Knox;Alvida;Palmer',
  'Shemira (Awakened);Lucilla;Liberta;Daemia;Ivan',
  'Sung Jinwoo;Skylan;Lyca (Awakened);Lysander;Lavatune',
  'Hybris;Fawkes (Awakened);Pippa (Awakened);Begris;Shuna',
), '5-team HoE meta setup. Use Sung Jinwoo/Skylan against stall comps and avoid putting your main carry in pos 4 vs Lysander.');

add('temporal-rift', 'S16', 112, 3, { floor: 300 }, [
  formation('t1', 'Team 1', 'Adrian & Elyse|409e36;Misfortis|303e61;Belinda (Awakened)|409e60;Lavatune|4012e62;Shuna|309e36', 'Trickery Chest'),
  formation('t2', 'Team 2', 'Alvida|409e36;Gavus (Awakened)|309e60;Aurelia|409e62;Mira|209e30;Melion|409e61', 'Nightfall Pegasus'),
  formation('t3', 'Team 3', 'Shemira (Awakened)|309e66;Athena|3012e33;Elthara|409e60;Tamrus|209e30;Rimuru|209e30', 'Flutterplume Owl'),
  formation('t4', 'Team 4', 'Saitama|309e30;Daemia|309e60;Skriath (Awakened)|303e63;Selene|203e30;Talimar|309e61', 'Twinlum Spirit'),
  formation('t5', 'Team 5', 'Hybris|409e68;Desira|009e60;Dracula|309e62;Velufira|009e60;Liberta|409e60', 'Treatspector'),
], 'Full 5-team import from Reddit S16 guide (u/Mugen_Tsukuyomi / ManuelAlcayaga & Rakudayyy, trift-s16-mugen-2026.png). Pets: T1 Trickery Chest / Twinlum Spirit, T2 Nightfall Pegasus / Shroom Spooder, T3 Flutterplume Owl / Count Snickerfang, T4 Twinlum Spirit / Talismane, T5 Treatspector.');

add('temporal-rift', 'S16', 68, 6, { floor: 300 }, treasureFormations(
  'Shemira (Awakened);Daemia;Liberta;Ivan;Palmer',
  'Belinda (Awakened);Rowan;Raine;Rosaline;Jerome',
  'Rem;Albedo;Merlin;Shuna;Emilia',
  'Antandra (Awakened);Naroko;Misha;Silas;Mortas',
  'Athalia (Awakened);Lyca (Awakened);Knox;Randle;Aurelia',
), 'Comfortably clears Floor 300 on auto with Indomitable Shield.');

add('hunting-fields-contract', 'Wrizz — No Earrings', 95, 2, { damage: 7.15e10 }, [
  formation('team-1', 'Team 1', 'Envydiel (Awakened);Knox;Aurelia;Misha;Randle'),
  formation('team-2', 'Team 2', 'Pippa (Awakened);Gorok;Skriath (Awakened);Daemia;Tavriel', 'Twinlum Spirit'),
], 'Verified from r/afkarena [HFC] Wrizz + No earrings buff Guide (u/Rakudayyy & SickMyDuck). Alt Comp 3: Lucilla, Gorok, Liberta, Daemia, Tavriel (Treatspector).');

add('hunting-fields-contract', 'Adrax — Ranger Buff', 71, 5, { damage: 7.18e10 }, [
  formation('team-1', 'Team 1', 'Envydiel (Awakened)|309e60;Skylan|309e60;Gorren|309e30;Lyca (Awakened)|309e60;Jerome|209e30', 'Twinlum Spirit'),
  formation('team-2', 'Team 2', 'Hybris|309e60;Liberta|309e60;Palmer|209e30;Lavatune|309e60;Aurelia|309e60', 'Count Snickerfang'),
], 'Ranger Buff contract: ~36B Ranger team + ~35.8B Hybris secondary team.');

add('abyssal-expedition', 'S18 — Final Boss', 103, 3, { damage: 3.66e11 }, [
  formation('t1', 'Sion (62B)', 'Velufira;Sion;Lucilla;Leviathan;Trishea', 'Flutterplume Owl'),
  formation('t2', 'Envy (62B)', 'Envydiel (Awakened);Lyca (Awakened);Knox;Laios;Daemia', 'Count Snickerfang'),
  formation('t3', 'Solo Leveling (61B)', 'Tavriel;Cha Hae-in;Sung Jinwoo;Skriath (Awakened);Pippa (Awakened)', 'Aureus'),
  formation('t4', 'AFawkes (60B)', 'Fawkes (Awakened);Lysander;Begris;Saitama;Talimar', 'Pearlcrest Ibis'),
  formation('t5', 'Elthara (60B)', 'Aurelia;Elthara;Lorsan;Gorok;Serenmira', 'Nightfall Pegasus'),
  formation('t6', 'Hybris (60B)', 'Lan;Hybris;Thoran (Awakened);Dracula;Gorren', 'Twinlum Spirit'),
], 'Recognized from r/afkarena S17 ABEX Boss Comps (u/Xionslash007 / TheAFKGuys). Bonus 70B Severin comp: Lavatune, Adrian & Elyse, Tavriel, Aurelia, Severin (Twinlum Spirit).');

export const SAMPLE_SUBMISSIONS: readonly Submission[] = submissions;
