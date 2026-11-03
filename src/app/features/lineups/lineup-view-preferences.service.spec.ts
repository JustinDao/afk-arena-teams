import { TestBed } from '@angular/core/testing';
import { LineupViewPreferencesService } from './lineup-view-preferences.service';

describe('LineupViewPreferencesService', () => {
  beforeEach(() => {
    localStorage.removeItem('ll.formationOrientation');
    TestBed.configureTestingModule({});
  });

  afterEach(() => {
    localStorage.removeItem('ll.formationOrientation');
    TestBed.resetTestingModule();
  });

  it('defaults to front on top and persists the alternate orientation', () => {
    const preferences = TestBed.inject(LineupViewPreferencesService);

    expect(preferences.orientation()).toBe('front-top');
    preferences.toggleOrientation();

    expect(preferences.orientation()).toBe('front-right');
    expect(localStorage.getItem('ll.formationOrientation')).toBe('front-right');
  });

  it('restores a saved orientation', () => {
    localStorage.setItem('ll.formationOrientation', 'front-right');

    expect(TestBed.inject(LineupViewPreferencesService).orientation()).toBe('front-right');
  });
});
