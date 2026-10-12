export type HeroAttribute = 'agility' | 'strength' | 'intelligence';

export function heroAttributeFromValue(value: string | null | undefined): HeroAttribute | null {
  switch (value?.toLocaleLowerCase()) {
    case 'agility':
      return 'agility';
    case 'strength':
      return 'strength';
    case 'intelligence':
      return 'intelligence';
    default:
      return null;
  }
}
