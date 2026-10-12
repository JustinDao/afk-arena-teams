import { Hero, Formation, Investment, Pet, Submission } from './models';
import { parseInvestment } from './investment';

const heroNames = (
  'Rowan,Raine,Lyca,Lorsan,Ezizh,Liberta,Palmer,Odysseus,Orthros,Talimar,Tavriel,Gorok,Lavatune,Elthara,Dracula,Hybris,Lysander,Leviathan,Serenmira,Melion,Sion,Laios,Marcille,Velufira,Aurelia,Knox,Lan,Jerome,Misfortis,Awakened Envydiel,Kaelon,Gorren,Haelia,Alvida,Misha,Severin,Awakened Gavus,Albedo,Yennefer,Shuna,Atheus,Veithael,Rimuru,Saitama,Cha Hae-in,Sung Jinwoo,Randle,Brutus,Elijah & Lailah,Skylan,Terrible Tornado,Daemia,Begris,Lucilla,Selene,Adrian & Elyse,Judy Punch,Harvey,Thoran,Skriath,Pippa,Fawkes,Estrilda,Eluard,Safiya,Eironn,Kyno,Trix,Saurus,Mishka,Lucretia,Daimon,Silas,Belinda,Shemira,Thane,Baden,Scarlet,Mehira,Lucius,Rosaline,Arthur,Gwyneth,Ferael,Tasi,Nara,Alna,Hodgkin,Oden,Mortas,Framton,Merlin,Haelus,Desira,Treznor,Mezoth,Astarv,Joan,Rosa,Anasta,Talene'
).split(',');
function displayHeroName(name: string): string {
  return name.replace(/^Awakened\s+(.+)$/, '$1 (Awakened)');
}

const normalizedHeroNames = heroNames.map(displayHeroName);
const awakenedNames = ['Lyca', 'Pippa', 'Fawkes', 'Estrilda', 'Thoran', 'Skriath', 'Eluard', 'Safiya', 'Eironn', 'Baden', 'Talene', 'Belinda', 'Thane']
  .map((name) => `${name} (Awakened)`);

export const HEROES: readonly Hero[] = [...new Set([...normalizedHeroNames, ...awakenedNames])]
  .map((name, id) => ({ id, name }))
  .sort((a, b) => a.name.localeCompare(b.name));

export const HERO_BY_NAME: ReadonlyMap<string, Hero> = new Map(HEROES.map((hero) => [hero.name, hero]));
export const HERO_BY_ID: ReadonlyMap<number, Hero> = new Map(HEROES.map((hero) => [hero.id, hero]));

export const PETS: readonly Pet[] = [
  { id: 6001, name: 'Dreary Ball', isAwakened: false },
  { id: 6002, name: 'Tufty Ears', isAwakened: false },
  { id: 6003, name: 'Grassy Orb', isAwakened: false },
  { id: 6004, name: 'Polar Beast', isAwakened: false },
  { id: 6005, name: 'Fire Breather', isAwakened: false },
  { id: 6006, name: 'Blade Ridge', isAwakened: false },
  { id: 6007, name: 'Winged Lion', isAwakened: false },
  { id: 6008, name: 'Rock Crown Lizard', isAwakened: false },
  { id: 6009, name: 'Feline Vesperio', isAwakened: false },
  { id: 6010, name: 'Bellbellow', isAwakened: false },
  { id: 6011, name: 'Flutterplume Owl', isAwakened: false },
  { id: 6012, name: 'Talismane', isAwakened: false },
  { id: 6013, name: 'Phantasmoth', isAwakened: false },
  { id: 6014, name: 'Savage Soufflé', isAwakened: false },
  { id: 6015, name: 'Slumber Seal', isAwakened: false },
  { id: 6016, name: 'Fox Fatale', isAwakened: false },
  { id: 6017, name: 'Shroom Spooder', isAwakened: false },
  { id: 6018, name: 'Radish Rotunda', isAwakened: false },
  { id: 6019, name: 'Pandy Dumpty', isAwakened: false },
  { id: 6020, name: 'Ice Crown', isAwakened: false },
  { id: 6021, name: 'Aureus', isAwakened: false },
  { id: 6022, name: 'Pearlcrest Ibis', isAwakened: false },
  { id: 6023, name: 'Treatspector', isAwakened: false },
  { id: 6024, name: 'Joyous Roamer', isAwakened: false },
  { id: 6025, name: 'Trickery Chest', isAwakened: false },
  { id: 6026, name: 'Thistlekin', isAwakened: false },
  { id: 6027, name: 'Nightfall Pegasus', isAwakened: true },
  { id: 6028, name: 'Count Snickerfang', isAwakened: true },
  { id: 6029, name: 'Twinlum Spirit', isAwakened: true },
  { id: 6030, name: 'Blazefang', isAwakened: true },
];

function formation(key: string, label: string, spec: string, petName = '', timeSeconds: number | null = null): Formation {
  const heroes = spec.split(';').map((entry, pos) => {
    const [name, investment, mercenary] = entry.split('|');
    const hero = HERO_BY_NAME.get(displayHeroName(name.trim()));
    if (!hero) throw new Error(`Sample data references unknown hero "${name.trim()}".`);
    return { pos, hid: hero.id, inv: parseInvestment(investment), merc: mercenary === 'm', collection: null };
  });
  const pet = PETS.find(({ name }) => name === petName);
  if (petName && !pet) throw new Error(`Sample data references unknown pet "${petName}".`);
  return { key, label, beast: petName, petId: pet?.id ?? null, petLevel: pet ? 18 : null, timeSeconds, heroes };
}

let nextId = 0;
const submissions: Submission[] = [];
function add(mode: string, target: string, up: number, days: number, result: Submission['result'], forms: Formation[], notes = '', heroLevel: number | null = null): void {
  submissions.push({ id: ++nextId, mode, target, up, days, result, forms, notes, by: 'sample', heroLevel });
}

add('twisted-realm', 'Ice Shemira', 92, 3, { damage: 1.84e9 }, [
  formation('team', 'Team', 'Shemira|309e60;Lucretia|309e60;Silas|309e30;Daimon|209e30;Ezizh|309e60', 'Dreary Ball'),
], 'Ezizh ultimates first, then Silas.', 450);
add('twisted-realm', 'Ice Shemira', 47, 9, { damage: 6.1e8 }, [
  formation('team', 'Team', 'Thane (Awakened);Lucretia|209;Silas;Daimon;Ezizh|209e30', 'Pandy Dumpty'),
], 'Budget version. Expect a lot of variance.', 450);
add('twisted-realm', 'Burning Brute', 66, 5, { damage: 2.3e9 }, [
  formation('team', 'Team', 'Belinda|309e60;Rosaline|309e30;Rowan|309e60;Raine|209e30;Lucius|309e30', 'Winged Lion'),
], '', 450);
add('twisted-realm', 'Kane', 31, 14, { damage: 1.1e9 }, [
  formation('team', 'Team', 'Saurus|309e60;Mishka|309e30;Scarlet|209e30;Oden|309e30;Mortas|209', 'Flutterplume Owl'),
], '', 450);

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

export const SAMPLE_SUBMISSIONS: readonly Submission[] = submissions;
