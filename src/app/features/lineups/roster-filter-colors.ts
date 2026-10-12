type RosterFilterKind = 'faction' | 'class' | 'type';

const ROSTER_FILTER_COLORS: Readonly<Record<RosterFilterKind, Readonly<Record<string, string>>>> = {
  faction: {
    lightbearer: '#83cfff',
    mauler: '#f2a72e',
    wilder: '#56b866',
    graveborn: '#24613b',
    celestial: '#f4f0df',
    hypogean: '#572875',
    dimensional: '#4c91e8',
    draconis: '#e96536',
  },
  class: {
    warrior: '#e86a4a',
    tank: '#e7bd48',
    ranger: '#5bbd78',
    mage: '#6b9ee8',
    support: '#54ad9a',
  },
  type: {
    strength: '#e86a4a',
    agility: '#5bbd78',
    intelligence: '#6b9ee8',
  },
};

export function rosterFilterColor(kind: RosterFilterKind, value: string): string {
  return ROSTER_FILTER_COLORS[kind][value.toLocaleLowerCase()] ?? '#a8b4ca';
}

export function rosterClassFilterColor(value: string): string {
  return rosterFilterColor('class', value);
}
