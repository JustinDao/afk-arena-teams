import { PETS } from './lineup-data';
import { petIconUrl } from './pet-icon-url';

describe('petIconUrl', () => {
  it('uses the square, level-neutral AFK Mine framed icon for every catalog pet', () => {
    expect(petIconUrl(6030))
      .toBe('https://raw.githubusercontent.com/afk-mine/cdn/main/framed_unit_icon/6030.webp');
    expect(PETS.every((pet) => pet.iconUrl === petIconUrl(pet.id))).toBeTrue();
  });
});
