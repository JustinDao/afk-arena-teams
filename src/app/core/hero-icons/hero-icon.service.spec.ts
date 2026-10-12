import { TestBed } from '@angular/core/testing';
import { HeroIconService } from './hero-icon.service';
import { HEROES, SAMPLE_SUBMISSIONS } from '../../features/lineups/lineup-data';

describe('HeroIconService', () => {
  it('matches normal, awakened, and aliased heroes to the CDN unit ids', async () => {
    spyOn(globalThis, 'fetch').and.resolveTo(new Response(JSON.stringify({
      '52': { id: 52, names: { en: 'Rowan' }, isAwakened: false },
      '170': { id: 170, names: { en: 'Lyca' }, isAwakened: true },
      '16': { id: 16, names: { en: 'Lyca' }, isAwakened: false },
      '244': { id: 244, names: { en: 'Hybris' }, isAwakened: true },
      '6019': { id: 6019, names: { en: 'Pandy Dumpty' }, isAwakened: false },
      '214': { id: 214, names: { en: 'Envydiel' }, isAwakened: true },
      '177': { id: 177, names: { en: 'Gavus' }, isAwakened: true },
      '163': { id: 163, names: { en: 'Daemia' }, isAwakened: false },
      '126': { id: 126, names: { en: 'Astar' }, isAwakened: false },
      '140': { id: 140, names: { en: 'Joan of Arc' }, isAwakened: false },
      '61': { id: 61, names: { en: 'Rosaline' }, isAwakened: false },
    })));
    TestBed.configureTestingModule({});
    const service = TestBed.inject(HeroIconService);

    await service.initialize();

    expect(service.unitIdFor('Rowan')).toBe(52);
    expect(service.unitIdFor('Awakened Lyca')).toBe(170);
    expect(service.unitIdFor('Lyca')).toBe(16);
    expect(service.unitIdFor('Hybris')).toBe(244);
    expect(service.unitIdFor('Awakened Envydiel')).toBe(214);
    expect(service.unitIdFor('Envydiel')).toBe(214);
    expect(service.unitIdFor('Awakened Gavus')).toBe(177);
    expect(service.unitIdFor('Gavus')).toBe(177);
    expect(service.unitIdFor('Daemia')).toBe(163);
    expect(service.unitIdFor('Daemina')).toBe(163);
    expect(service.unitIdFor('Astarv')).toBe(126);
    expect(service.unitIdFor('Joan')).toBe(140);
    expect(service.unitIdFor('Rosa')).toBe(61);
    expect(service.unitIdFor('Pandy Dumpty')).toBe(6019);
    expect(service.unitIdFor('Unknown Hero')).toBeNull();
    expect(service.iconUrl(52)).toBe('https://raw.githubusercontent.com/afk-mine/cdn/main/unit_icon_by_id/52.webp');
  });

  it('keeps the hero catalog and sample teams free of the audited invalid names', () => {
    expect(HEROES.some(({ name }) => name === 'Bert' || name === 'Daemina')).toBeFalse();
    expect(HEROES.some(({ name }) => name === 'Daemia')).toBeTrue();
    const treasureHeroes = SAMPLE_SUBMISSIONS
      .filter(({ mode }) => mode === 'treasure-scramble')
      .flatMap(({ forms }) => forms.flatMap(({ heroes }) => heroes));
    expect(treasureHeroes.some(({ hid }) => HEROES.find(({ id }) => id === hid)?.name === 'Bert')).toBeFalse();
  });
});
