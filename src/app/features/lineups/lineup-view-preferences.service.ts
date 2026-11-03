import { Injectable, signal } from '@angular/core';

export type FormationOrientation = 'front-top' | 'front-right';

const STORAGE_KEY = 'll.formationOrientation';

@Injectable({ providedIn: 'root' })
export class LineupViewPreferencesService {
  readonly orientation = signal<FormationOrientation>(this.readOrientation());

  toggleOrientation(): void {
    const next = this.orientation() === 'front-top' ? 'front-right' : 'front-top';
    this.orientation.set(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch (error) {
      console.warn('Could not save the selected lineup orientation.', error);
    }
  }

  private readOrientation(): FormationOrientation {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved === 'front-right' || saved === 'front-top' ? saved : 'front-top';
    } catch (error) {
      console.warn('Could not read the saved lineup orientation.', error);
      return 'front-top';
    }
  }
}
