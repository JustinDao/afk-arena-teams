import { Injectable, inject, signal } from '@angular/core';
import { UserDataService } from '../../../../core/data/user-data.service';
import { CollectionRecommendation, HeroRecommendation, PetRecommendation } from '../../models';

@Injectable({ providedIn: 'root' })
export class RecommendationsState {
  private readonly data = inject(UserDataService);

  readonly selectedModes = signal<readonly string[]>([]);
  readonly heroes = signal<readonly HeroRecommendation[]>([]);
  readonly collections = signal<readonly CollectionRecommendation[]>([]);
  readonly pets = signal<readonly PetRecommendation[]>([]);
  readonly refreshedAt = signal<string | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  private loadId = 0;
  private settingsUserId: string | null = null;

  modeSelected(slug: string): boolean {
    return this.selectedModes().includes(slug);
  }

  async initialize(userId: string): Promise<void> {
    if (this.settingsUserId !== userId) {
      try {
        const settings = await this.data.loadRecommendationSettings();
        this.selectedModes.set(settings.modes);
        this.refreshedAt.set(settings.refreshedAt);
        this.settingsUserId = userId;
      } catch (error) {
        this.error.set(error instanceof Error ? error.message : 'Could not load your settings.');
      }
    }
    await this.refresh();
  }

  async toggleMode(slug: string | null): Promise<void> {
    const current = this.selectedModes();
    const next = slug === null
      ? []
      : current.includes(slug) ? current.filter((value) => value !== slug) : [...current, slug];
    this.selectedModes.set(next);
    try {
      await this.data.saveRecommendationModes(next);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Could not save your modes.');
    }
    await this.refresh();
  }

  private async refresh(): Promise<void> {
    const loadId = ++this.loadId;
    this.loading.set(true);
    this.error.set(null);
    try {
      const modes = this.selectedModes();
      const [heroes, collections, pets] = await Promise.all([
        this.data.loadRecommendations(modes),
        this.data.loadCollectionRecommendations(modes),
        this.data.loadPetRecommendations(modes),
      ]);
      if (loadId === this.loadId) {
        this.heroes.set(heroes);
        this.collections.set(collections);
        this.pets.set(pets);
      }
    } catch (error) {
      if (loadId === this.loadId) this.error.set(error instanceof Error ? error.message : 'Could not load recommendations.');
    } finally {
      if (loadId === this.loadId) this.loading.set(false);
    }
  }
}
