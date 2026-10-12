import { TestBed } from '@angular/core/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { LineupCardComponent } from '../components/lineup-card/lineup-card.component';
import { EvaluatedSubmission } from '../models';
import { SAMPLE_SUBMISSIONS } from '../lineup-data';
import { LineupCardHarness } from './lineup-card.harness';

describe('LineupCardComponent', () => {
  it('exposes the lineup and sends vote actions through its output', async () => {
    await TestBed.configureTestingModule({ imports: [LineupCardComponent] }).compileComponents();
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
    const loader = TestbedHarnessEnvironment.loader(fixture);
    const card = await loader.getHarness(LineupCardHarness);

    expect(await card.title()).toBe(submission.target);
    expect(fixture.nativeElement.querySelector('.tag')).toBeNull();
    expect(fixture.nativeElement.querySelector('.hero')?.style.getPropertyValue('--hero-faction-color')).toBe('#83cfff');
    await card.clickVote();
    expect(votedId).toBe(submission.id);
  });
});
