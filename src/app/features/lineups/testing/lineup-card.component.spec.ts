import { TestBed } from '@angular/core/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { provideRouter } from '@angular/router';
import { LineupCardComponent } from '../components/lineup-card/lineup-card.component';
import { EvaluatedSubmission } from '../models';
import { SAMPLE_SUBMISSIONS } from '../lineup-data';
import { LineupCardHarness } from './lineup-card.harness';
import { LineupViewPreferencesService } from '../lineup-view-preferences.service';

describe('LineupCardComponent', () => {
  it('renders flexible collection recommendations without an exact Mythic count', async () => {
    await TestBed.configureTestingModule({
      imports: [LineupCardComponent],
      providers: [provideRouter([])],
    }).compileComponents();
    const fixture = TestBed.createComponent(LineupCardComponent);
    const sample = SAMPLE_SUBMISSIONS.find(({ mode }) => mode === 'twisted-realm')!;
    const submission = {
      ...sample,
      forms: sample.forms.map((formation) => ({
        ...formation,
        heroes: formation.heroes.map((hero, index) => index === 0
          ? {
              ...hero,
              inv: { si: 30, furn: 9, eng: 60 },
              ascension: 'ascended_1' as const,
              collection: {
                catalogId: 14,
                name: "Stormwrath's Lull",
                nodes: [],
                recommendation: { level: 1, attackStats: ['erosion', 'mp'], defenseStats: [] },
              },
            }
          : index === 1
            ? {
                ...hero,
                collection: {
                  catalogId: 1,
                  name: 'Temporal Cover',
                  nodes: [
                    { slotIndex: 0, stat: 'skill_level', tier: 'mythic' as const },
                    { slotIndex: 4, stat: 'skill_level', tier: 'mythic' as const },
                  ],
                },
              }
          : hero),
      })),
    };
    const row: EvaluatedSubmission = {
      submission,
      active: false,
      forms: submission.forms.map(() => ({ statuses: [], missing: 0, missingPet: false, underPetLevel: false })),
      missingCount: 0,
      bestSlotMissing: 0,
      missingHeroes: [],
      lowInvestmentHeroes: [],
      missingPetNames: [],
      underLevelPetNames: [],
      heroLevelMismatch: null,
      gap: 0,
    };
    fixture.componentRef.setInput('row', row);
    fixture.componentRef.setInput('scope', 'all');
    fixture.componentRef.setInput('voted', false);
    fixture.componentRef.setInput('voteCount', sample.up);
    fixture.detectChanges();

    const collectionIcon = fixture.nativeElement.querySelector('.collection-icon') as HTMLImageElement;
    expect(collectionIcon.src).toContain('/14_lvl1_cl.webp');
    expect(collectionIcon.src).not.toContain('_ms');
    const recommendation = fixture.nativeElement.querySelector('.collection-tag') as HTMLElement;
    expect(recommendation.title).toContain('Level 1');
    expect(recommendation.title).toContain('EROSION or MP');
    expect((fixture.nativeElement.querySelector('.hero') as HTMLElement).title).toContain('309e60');
    expect((fixture.nativeElement.querySelector('.hero') as HTMLElement).title).toContain('A1*');
    const exactCollection = fixture.nativeElement.querySelectorAll('.collection-tag')[1] as HTMLElement;
    expect(exactCollection.title).toContain('Level 3');
    expect(recommendation.querySelectorAll('.collection-node-icon').length).toBe(2);
    fixture.destroy();
  });

  it('uses the saved front-right formation orientation', async () => {
    await TestBed.configureTestingModule({
      imports: [LineupCardComponent],
      providers: [provideRouter([])],
    }).compileComponents();
    const preferences = TestBed.inject(LineupViewPreferencesService);
    const originalOrientation = preferences.orientation();
    if (preferences.orientation() !== 'front-right') preferences.toggleOrientation();
    const fixture = TestBed.createComponent(LineupCardComponent);
    const sample = SAMPLE_SUBMISSIONS.find(({ mode }) => mode === 'twisted-realm')!;
    const submission = {
      ...sample,
      forms: sample.forms.map((formation) => ({
        ...formation,
        heroes: formation.heroes.map((hero, index) => index === 0
          ? { ...hero, collection: { catalogId: 1, name: 'Test Collection', nodes: [] } }
          : hero),
      })),
    };
    const row: EvaluatedSubmission = {
      submission,
      active: false,
      forms: submission.forms.map(() => ({ statuses: [], missing: 0, missingPet: false, underPetLevel: false })),
      missingCount: 0,
      bestSlotMissing: 0,
      missingHeroes: [],
      lowInvestmentHeroes: [],
      missingPetNames: [],
      underLevelPetNames: [],
      heroLevelMismatch: null,
      gap: 0,
    };
    fixture.componentRef.setInput('row', row);
    fixture.componentRef.setInput('scope', 'all');
    fixture.componentRef.setInput('voted', false);
    fixture.componentRef.setInput('voteCount', sample.up);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.hero-formation.front-right')).not.toBeNull();
    const backRow = fixture.nativeElement.querySelector('.hero-row.back') as HTMLElement;
    expect(backRow.querySelectorAll('.hero').length).toBe(3);
    expect(getComputedStyle(backRow).borderRightStyle).toBe('dashed');
    expect(getComputedStyle(backRow).borderLeftStyle).toBe('none');
    const hero = fixture.nativeElement.querySelector('.hero-formation.front-right .hero') as HTMLElement;
    expect(getComputedStyle(hero).alignItems).toBe('start');
    const heroIcon = fixture.nativeElement.querySelector('.hero-formation.front-right app-hero-icon') as HTMLElement;
    expect(getComputedStyle(heroIcon).transform).toBe('matrix(1, 0, 0, 1, 0, -4)');
    const collectionIcon = fixture.nativeElement.querySelector('.collection-icon') as HTMLImageElement;
    expect(collectionIcon).not.toBeNull();
    const rightWidth = getComputedStyle(collectionIcon).width;
    const rightHeight = getComputedStyle(collectionIcon).height;
    expect(rightWidth).toBe('56px');
    expect(rightHeight).toBe('56px');

    preferences.toggleOrientation();
    fixture.detectChanges();
    const topOrientationIcon = fixture.nativeElement.querySelector('.collection-icon') as HTMLImageElement;
    expect(fixture.nativeElement.querySelector('.hero-formation.front-right')).toBeNull();
    expect(getComputedStyle(topOrientationIcon).width).toBe(rightWidth);
    expect(getComputedStyle(topOrientationIcon).height).toBe(rightHeight);
    fixture.destroy();
    if (preferences.orientation() !== originalOrientation) preferences.toggleOrientation();
  });

  it('exposes the lineup and sends vote actions through its output', async () => {
    await TestBed.configureTestingModule({
      imports: [LineupCardComponent],
      providers: [provideRouter([])],
    }).compileComponents();
    const fixture = TestBed.createComponent(LineupCardComponent);
    const sample = SAMPLE_SUBMISSIONS.find(({ mode }) => mode === 'twisted-realm')!;
    const submission = {
      ...sample,
      forms: sample.forms.map((formation) => ({
        ...formation,
        heroes: formation.heroes.map((hero, index) => index === 0
          ? { ...hero, merc: true, faction: 'Lightbearer' }
          : hero),
      })),
    };
    const row: EvaluatedSubmission = {
      submission,
      active: false,
      forms: submission.forms.map(() => ({ statuses: [], missing: 0, missingPet: false, underPetLevel: false })),
      missingCount: 0,
      bestSlotMissing: 0,
      missingHeroes: [],
      lowInvestmentHeroes: [],
      missingPetNames: [],
      underLevelPetNames: [],
      heroLevelMismatch: null,
      gap: 0,
    };
    fixture.componentRef.setInput('row', row);
    fixture.componentRef.setInput('scope', 'all');
    fixture.componentRef.setInput('voted', false);
    fixture.componentRef.setInput('voteCount', submission.up);
    fixture.detectChanges();

    let votedId: number | undefined;
    fixture.componentInstance.vote.subscribe((id) => { votedId = id; });
    let sharedId: number | undefined;
    fixture.componentInstance.share.subscribe((id) => { sharedId = id; });
    const loader = TestbedHarnessEnvironment.loader(fixture);
    const card = await loader.getHarness(LineupCardHarness);

    expect(await card.title()).toBe(submission.target);
    expect(fixture.nativeElement.querySelector('.tag')).toBeNull();
    expect(fixture.nativeElement.querySelector('.hero')?.style.getPropertyValue('--hero-faction-color')).toBe('#83cfff');
    expect(fixture.nativeElement.querySelector('app-pet-badge')).not.toBeNull();
    await card.clickVote();
    expect(votedId).toBe(submission.id);
    fixture.nativeElement.querySelector('button[aria-label="Share lineup link"]').click();
    expect(sharedId).toBe(submission.id);
    expect(fixture.nativeElement.querySelector('a[aria-label="Open lineup page"]')).not.toBeNull();
  });
});
