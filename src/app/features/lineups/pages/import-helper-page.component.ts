import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, OnDestroy, signal, viewChild } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { HeroIconService } from '../../../core/hero-icons/hero-icon.service';
import { CollectionCatalogItem, displayHeroName, Hero, petMaxLevel, Pet } from '../models';
import { COLLECTION_CATALOG, COLLECTION_NODE_STATS, collectionIconUrl, collectionNodeIconUrl } from '../collection-catalog';
import { HEROES, PETS } from '../lineup-data';
import { LineupsStore } from '../lineups.store';

interface CropBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface HeroCrop {
  readonly id: number;
  readonly box: CropBox;
  readonly suggestions: readonly string[];
  readonly collectionSuggestions: readonly number[];
  readonly nodeStatSuggestions: readonly string[];
  readonly heroName: string;
  readonly collectionId: number | null;
  readonly collectionStats: string;
  readonly levelNodes: number;
  readonly investmentText: string;
  readonly si: number | null;
  readonly furniture: number | null;
  readonly engraving: number | null;
  readonly slug: string;
}

interface ImportTeam {
  readonly key: string;
  readonly label: string;
  readonly pet: string;
  readonly petLevel: number | null;
  readonly petSuggestions: readonly string[];
  readonly heroes: readonly HeroCrop[];
}

interface SubstituteHeroCandidate {
  readonly box: CropBox;
  readonly heroName: string;
  readonly suggestions: readonly string[];
}

interface SubstituteTeamCandidate {
  readonly label: string;
  readonly pet: string;
  readonly petSuggestions: readonly string[];
  readonly heroes: readonly SubstituteHeroCandidate[];
}

interface HeroMatch {
  readonly name: string;
  readonly distance: Float32Array;
}

interface CollectionMatch {
  readonly id: number;
  readonly distance: Float32Array;
}

interface NodeStatMatch {
  readonly stat: string;
  readonly distance: Float32Array;
}

interface PetMatch {
  readonly name: string;
  readonly distance: Float32Array;
  readonly views: readonly Float32Array[];
}

interface RecognizedLine {
  readonly text: string;
  readonly box: CropBox;
  readonly centerX: number;
  readonly centerY: number;
}

interface HeroTextHit {
  readonly hero: Hero;
  readonly line: RecognizedLine;
  readonly suggestions?: readonly string[];
}

interface VisualImageHit {
  readonly label: string;
  readonly box: CropBox;
  readonly suggestions: readonly string[];
  readonly distance: number;
  readonly teamIndex?: number;
  readonly slotIndex?: number;
}

type CropPurpose = 'hero' | 'pet' | 'collection' | 'collection-node' | 'investment';

const FEATURE_SIZE = 8;
const PET_FEATURE_SIZE = 16;
const PET_REFERENCE_VIEWS = [0, 0.128] as const;
const PET_REFERENCE_SIZE = 93 / 125;
const PET_ALIGNMENT_OFFSETS = [-0.05, 0, 0.05] as const;
const NIGHTMARE_HERO_COLUMN_CENTERS = [0.39, 0.447, 0.533, 0.6, 0.652] as const;
const NIGHTMARE_HERO_COLUMN_Y_OFFSETS = [0.02335, 0.01335, 0.02585, 0.02585, 0.01335] as const;
const NIGHTMARE_HERO_COLUMN_SCALES = [0.065, 0.045, 0.055, 0.055, 0.065] as const;
const NIGHTMARE_HERO_COLUMN_INSETS = [0.15, 0.15, 0.15, 0.15, 0.15] as const;
const NIGHTMARE_COLLECTION_COLUMN_CENTERS = [0.405, 0.475, 0.54, 0.61, 0.68] as const;
const NIGHTMARE_COLLECTION_X_OFFSETS = [-0.012, -0.009, -0.006, -0.003, 0, 0.003, 0.006, 0.009, 0.012] as const;
const NIGHTMARE_COLLECTION_Y_OFFSETS = [-0.006, -0.004, -0.002, 0, 0.002, 0.004, 0.006] as const;
const NIGHTMARE_COLLECTION_ICON_SCALES = [0.03, 0.034, 0.038] as const;
const NIGHTMARE_COLLECTION_AUTO_MATCH_DISTANCE = 0.035;
const NIGHTMARE_SUBSTITUTE_HERO_COLUMN_CENTERS = [0.07, 0.11, 0.15, 0.19, 0.23] as const;
const NIGHTMARE_SUBSTITUTE_PET_CENTER_X = 0.27;
const NIGHTMARE_SUBSTITUTE_ICON_SIZE = 0.022;
const NIGHTMARE_SUBSTITUTE_ROWS_PER_ROUND = 10;

@Component({
  selector: 'app-import-helper-page',
  standalone: true,
  imports: [MatButtonModule, RouterLink],
  template: `
    <main class="import-page">
      <header class="page-header">
        <div>
          <h2>Image import helper</h2>
          <p>Analyze the whole guide to suggest teams, heroes, pets, collections, and investments. Review every suggestion before exporting; processing stays in this browser.</p>
        </div>
        <a mat-button class="btn" routerLink="/">Back to lineups</a>
      </header>

      <section class="panel setup">
        <label class="field">Guide image
          <input type="file" accept="image/*" (change)="loadImage($event)">
        </label>
        <button mat-flat-button type="button" class="btn primary" [disabled]="!imageReady() || analyzing()" (click)="analyzeImage()">
          {{ analyzing() ? 'Analyzing image…' : 'Analyze entire image' }}
        </button>
        <label class="field">Mode
          <select [value]="mode()" (change)="mode.set(inputValue($event))">
            <option value="nightmare-corridor">Nightmare Corridor</option>
            <option value="cursed-realm">Cursed Realm</option>
            <option value="treasure-scramble">Treasure Scramble</option>
            <option value="twisted-realm">Twisted Realm</option>
          </select>
        </label>
        <label class="field">Seed key
          <input [value]="seedKey()" (input)="seedKey.set(inputValue($event))" placeholder="my-guide-key">
        </label>
        <label class="field">Target slug
          <input [value]="target()" (input)="target.set(inputValue($event))" placeholder="infernal-overlord">
        </label>
        <label class="field">Notes
          <input [value]="notes()" (input)="notes.set(inputValue($event))" placeholder="Guide source or notes">
        </label>
        <div class="team-tabs">
          @for (team of teams(); track team.key; let index = $index) {
            <button mat-button type="button" class="btn" [attr.aria-pressed]="index === selectedTeam()" (click)="selectedTeam.set(index)">
              {{ team.label }} · {{ team.heroes.length }}/5
            </button>
          }
          <button mat-stroked-button type="button" class="btn" (click)="addTeam()">Add team</button>
        </div>
      </section>

      <div class="workspace">
        <section class="panel image-panel">
          <h3>Source guide</h3>
          <p class="hint">The whole image is analyzed at once. Team boundaries are inferred; move heroes between candidates or add teams during review.</p>
          @if (imageUrl(); as url) {
            <div class="image-stage">
              <img #sourceImage [src]="url" alt="Uploaded guide, processed locally" draggable="false" (load)="imageReady.set(true)" (error)="imageLoadError()">
            </div>
          } @else {
            <div class="image-empty">Choose an image, then analyze the whole guide. Nothing is uploaded.</div>
          }
          @if (ocrText()) {
            <details class="ocr-details">
              <summary>Show text recognized from image</summary>
              <pre>{{ ocrText() }}</pre>
            </details>
          }
          @if (status()) { <p class="hint" role="status">{{ status() }}</p> }
        </section>

        <section class="panel team-panel">
          @if (activeTeam(); as team) {
            <div class="team-heading">
              <h3>{{ team.label }}</h3>
              <button mat-stroked-button type="button" class="btn" (click)="addHeroToTeam()">Add hero</button>
            </div>
            <div class="team-meta">
              <label class="field">Team / boss label
                <input [value]="team.label" (input)="updateTeam('label', inputValue($event))">
              </label>
              <label class="field">Pet
                <select [value]="team.pet" (change)="updateTeam('pet', inputValue($event))">
                  <option value="">Not identified</option>
                  @for (pet of pets(); track pet.id) { <option [value]="pet.name">{{ pet.name }}</option> }
                </select>
              </label>
              @if (team.pet) {
                <label class="field">Pet level
                  <input type="number" min="1" [attr.max]="petMax(team.pet)" [value]="team.petLevel ?? 18" (input)="updateTeam('petLevel', inputValue($event))">
                </label>
              }
            </div>
            @if (team.petSuggestions.length) {
              <div class="suggestions">
                <span class="hint">Pet icon suggestions</span>
                @for (suggestion of team.petSuggestions; track suggestion) {
                  <button mat-button type="button" class="btn suggestion" (click)="updateTeam('pet', suggestion)">{{ suggestion }}</button>
                }
              </div>
            }
            @for (hero of team.heroes; track hero.id; let index = $index) {
              <article class="hero-review">
                <div class="hero-fields">
                  <label class="field">Hero {{ index + 1 }}
                    <select [value]="hero.heroName" (change)="updateHero(hero.id, 'heroName', inputValue($event))">
                      <option value="">Choose a hero</option>
                      @for (entry of heroes(); track entry.id) { <option [value]="heroName(entry)">{{ heroName(entry) }}</option> }
                    </select>
                  </label>
                  @if (hero.suggestions.length) {
                    <div class="suggestions">
                      <span class="hint">Visual suggestions (not confidence scores)</span>
                      @for (suggestion of hero.suggestions; track suggestion) {
                        <button mat-button type="button" class="btn suggestion" (click)="updateHero(hero.id, 'heroName', suggestion)">{{ suggestion }}</button>
                      }
                    </div>
                  }
                  <label class="field">Seed slug
                    <input [value]="hero.slug" (input)="updateHero(hero.id, 'slug', inputValue($event))">
                  </label>
                  @if (teams().length > 1) {
                    <label class="field">Team
                      <select [value]="selectedTeam()" (change)="moveHeroToTeam(hero.id, numberValue($event))">
                        @for (candidate of teams(); track candidate.key; let teamIndex = $index) {
                          <option [value]="teamIndex">{{ candidate.label }}</option>
                        }
                      </select>
                    </label>
                  }
                  <label class="field">Collection
                    <select [value]="hero.collectionId ?? ''" (change)="updateHero(hero.id, 'collectionId', inputValue($event))">
                      <option value="">Not identified</option>
                      @for (collection of collections; track collection.id) {
                        @if (isCollectionValid(hero, collection)) { <option [value]="collection.id">{{ collection.name }} ({{ collection.class }})</option> }
                      }
                    </select>
                  </label>
                  @if (hero.collectionId) {
                    <p class="recognized">Collection suggestion (review): {{ collectionName(hero.collectionId) }}</p>
                    <label class="field">Mythic node stats
                      <input [value]="hero.collectionStats" (input)="updateHero(hero.id, 'collectionStats', inputValue($event))" placeholder="full_atk, mp">
                    </label>
                    <label class="field">Level nodes (0–2)
                      <input type="number" min="0" max="2" step="1" [value]="hero.levelNodes" (input)="updateHero(hero.id, 'levelNodes', inputValue($event))">
                    </label>
                  }
                  <label class="field">Investment short code
                    <input [value]="hero.investmentText" (input)="updateHero(hero.id, 'investmentText', inputValue($event))" placeholder="309e60">
                  </label>
                  @if (hero.investmentText) {
                    <p class="recognized">OCR: {{ hero.investmentText }} · parsed SI {{ hero.si ?? '—' }}, furniture {{ hero.furniture ?? '—' }}, engraving {{ hero.engraving ?? '—' }}</p>
                  }
                  <div class="investment-fields">
                    <label class="field">SI <input type="number" min="0" max="50" [value]="hero.si ?? ''" (input)="updateHero(hero.id, 'si', inputValue($event))"></label>
                    <label class="field">Furniture <input type="number" min="0" max="36" [value]="hero.furniture ?? ''" (input)="updateHero(hero.id, 'furniture', inputValue($event))"></label>
                    <label class="field">Engraving <input type="number" min="0" max="100" [value]="hero.engraving ?? ''" (input)="updateHero(hero.id, 'engraving', inputValue($event))"></label>
                  </div>
                  @if (hero.collectionSuggestions.length) {
                    <div class="suggestions">
                      <span class="hint">Collection icon suggestions</span>
                      @for (collectionId of hero.collectionSuggestions; track collectionId) {
                        <button mat-button type="button" class="btn suggestion" (click)="updateHero(hero.id, 'collectionId', collectionId.toString())">{{ collectionName(collectionId) }}</button>
                      }
                    </div>
                  }
                  @if (hero.nodeStatSuggestions.length) {
                    <div class="suggestions">
                      <span class="hint">Collection node stat suggestions</span>
                      @for (stat of hero.nodeStatSuggestions; track stat) {
                        <button mat-button type="button" class="btn suggestion" (click)="addNodeStat(hero.id, stat)">{{ stat }}</button>
                      }
                    </div>
                  }
                </div>
                <button mat-button type="button" class="btn remove" (click)="removeHero(hero.id)">Remove</button>
              </article>
            } @empty {
              <p class="image-empty">No hero candidates found for this team yet. Add heroes to review manually, or analyze the guide.</p>
            }
          }
        </section>
      </div>

      @if (substituteSets().length) {
        <section class="panel substitutes-panel">
          <div class="team-heading">
            <div>
              <h3>Substitute teams and pets</h3>
              <p class="hint">Experimental suggestions from the guide’s left-side list. Review all five hero matches and the pet; these candidates are not exported unless you add one as a team.</p>
            </div>
            <label class="field">Candidate set
              <select [value]="selectedSubstituteSet()" (change)="selectedSubstituteSet.set(numberValue($event))">
                @for (candidate of substituteSets(); track $index; let index = $index) {
                  <option [value]="index">{{ candidate.label }}</option>
                }
              </select>
            </label>
          </div>
          @if (activeSubstituteSet(); as candidate) {
            <div class="substitute-slots">
              @for (slot of candidate.heroes; track $index; let index = $index) {
                <label class="field">Hero {{ index + 1 }}
                  <select [value]="slot.heroName" (change)="updateSubstituteHero(index, inputValue($event))">
                    <option value="">Choose from suggestions</option>
                    @for (suggestion of slot.suggestions; track suggestion) {
                      <option [value]="suggestion">{{ suggestion }}</option>
                    }
                  </select>
                </label>
              }
              <label class="field">Pet in substitute row
                <select [value]="candidate.pet" (change)="updateSubstitutePet(inputValue($event))">
                  <option value="">Not identified</option>
                  @for (pet of pets(); track pet.id) { <option [value]="pet.name">{{ pet.name }}</option> }
                </select>
              </label>
            </div>
            <p class="hint">Choose five distinct heroes before adding this candidate to the export.</p>
            @if (candidate.petSuggestions.length) {
              <div class="suggestions">
                <span class="hint">Pet icon suggestions (review)</span>
                @for (suggestion of candidate.petSuggestions; track suggestion) {
                  <button mat-button type="button" class="btn suggestion" (click)="updateSubstitutePet(suggestion)">{{ suggestion }}</button>
                }
              </div>
            }
            <button mat-flat-button type="button" class="btn primary" [disabled]="!canAddSubstituteSet(candidate)" (click)="addSubstituteSet()">
              Add this five-hero set as a team
            </button>
          }
        </section>
      }

      <section class="panel export-panel">
        <div class="export-header">
          <div>
            <h3>Seed-compatible team JSON</h3>
            <p class="hint">Review hero names, pets, collections and OCR-derived investments. Correct uncertain matches and collection node stats before using the output.</p>
          </div>
          <div class="export-actions">
            <button mat-stroked-button type="button" class="btn" (click)="copyJson()">Copy JSON</button>
            <button mat-flat-button type="button" class="btn primary" (click)="downloadJson()">Download JSON</button>
          </div>
        </div>
        <textarea readonly rows="18" [value]="jsonOutput()" aria-label="Generated seed JSON"></textarea>
      </section>
    </main>
  `,
  styles: `
    .import-page { max-width: 1440px; margin: 0 auto; padding: var(--app-space-3); }
    .page-header, .export-header { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--app-space-3); }
    .page-header h2, .export-header h3, .team-panel h3, .image-panel h3 { margin-top: 0; }
    .page-header p, .hint { color: var(--app-muted); font-size: .9rem; }
    .panel { padding: var(--app-space-3); margin-bottom: var(--app-space-3); border: 1px solid var(--app-line); border-radius: var(--app-radius); background: var(--app-panel); }
    .setup { display: grid; grid-template-columns: minmax(200px, 2fr) repeat(2, minmax(160px, 1fr)); gap: var(--app-space-2); align-items: end; }
    .field { display: flex; min-width: 0; flex-direction: column; gap: 4px; margin: 0 0 var(--app-space-2); font-size: .85rem; }
    .team-tabs { display: flex; flex-wrap: wrap; grid-column: 1 / -1; gap: var(--app-space-1); }
    .workspace { display: grid; grid-template-columns: minmax(280px, 1.15fr) minmax(360px, 1fr); align-items: start; gap: var(--app-space-3); }
    .image-panel { position: sticky; top: var(--app-space-2); }
    .image-stage { display: inline-block; max-width: 100%; max-height: 75vh; overflow: hidden; }
    .image-stage > img { display: block; max-width: 100%; max-height: 75vh; object-fit: contain; user-select: none; }
    .image-empty { display: grid; min-height: 220px; place-items: center; padding: var(--app-space-3); border: 1px dashed var(--app-line); color: var(--app-muted); text-align: center; }
    .team-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--app-space-2); }
    .team-heading h3 { margin-top: 0; }
    .team-meta { display: grid; grid-template-columns: 1fr 1fr; gap: var(--app-space-2); }
    .hero-review { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: start; gap: var(--app-space-2); padding-block: var(--app-space-2); border-top: 1px solid var(--app-line); }
    .hero-fields { min-width: 0; }
    .investment-fields { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--app-space-1); }
    .substitutes-panel { display: grid; gap: var(--app-space-3); }
    .substitute-slots { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: var(--app-space-2); }
    .recognized { margin: 0 0 var(--app-space-2); color: var(--app-muted); font-size: .82rem; }
    .suggestions { display: flex; flex-wrap: wrap; align-items: center; gap: 2px; margin: 0 0 var(--app-space-2); }
    .suggestions .hint { width: 100%; }
    .suggestion { min-height: 30px; }
    .remove { color: var(--app-muted); }
    .ocr-details { margin-top: var(--app-space-2); }
    .ocr-details pre { max-height: 220px; overflow: auto; white-space: pre-wrap; color: var(--app-muted); font: .8rem/1.4 ui-monospace, monospace; }
    .export-actions { display: flex; flex-wrap: wrap; gap: var(--app-space-1); }
    .export-panel textarea { width: 100%; min-height: 280px; margin-top: var(--app-space-2); padding: var(--app-space-2); border: 1px solid var(--app-line); border-radius: var(--app-radius-sm); background: var(--app-bg); color: var(--app-ink); font-family: ui-monospace, monospace; font-size: .82rem; }
    @media (max-width: 850px) { .workspace { grid-template-columns: 1fr; } .image-panel { position: static; } .setup { grid-template-columns: 1fr; } .team-tabs { grid-column: auto; } }
    @media (max-width: 520px) { .page-header, .export-header { flex-direction: column; } .team-meta { grid-template-columns: 1fr; } }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ImportHelperPageComponent implements OnDestroy {
  private readonly store = inject(LineupsStore);
  private readonly icons = inject(HeroIconService);
  private readonly sourceImage = viewChild<ElementRef<HTMLImageElement>>('sourceImage');
  readonly imageUrl = signal<string | null>(null);
  readonly mode = signal('nightmare-corridor');
  readonly seedKey = signal('new-guide');
  readonly target = signal('');
  readonly notes = signal('');
  readonly selectedTeam = signal(0);
  readonly draftBox = signal<CropBox | null>(null);
  readonly status = signal('');
  readonly ocrText = signal('');
  readonly analyzing = signal(false);
  readonly imageReady = signal(false);
  readonly collections: readonly CollectionCatalogItem[] = COLLECTION_CATALOG;
  readonly heroes = computed(() => this.store.heroes().length ? this.store.heroes() : HEROES);
  readonly pets = computed(() => this.store.pets().length ? this.store.pets() : PETS);
  readonly teams = signal<readonly ImportTeam[]>([{ key: 'team-1', label: 'Team 1', pet: '', petLevel: null, petSuggestions: [], heroes: [] }]);
  readonly activeTeam = computed(() => this.teams()[this.selectedTeam()] ?? null);
  readonly substituteSets = signal<readonly SubstituteTeamCandidate[]>([]);
  readonly selectedSubstituteSet = signal(0);
  readonly activeSubstituteSet = computed(() => this.substituteSets()[this.selectedSubstituteSet()] ?? null);
  readonly cropPurpose = signal<CropPurpose>('hero');
  readonly associatedHeroId = signal(-1);
  readonly jsonOutput = computed(() => JSON.stringify({
    seed_key: this.seedKey().trim() || 'new-guide',
    mode: this.mode(),
    target: this.target().trim() || 'REPLACE_WITH_TARGET_SLUG',
    result: {},
    hero_level: null,
    notes: this.notes(),
    formations: this.teams().map((team) => ({
      key: team.key,
      label: team.label,
      ...(team.pet ? { pet: this.petSlug(team.pet), pet_level: team.petLevel ?? 18 } : {}),
      heroes: team.heroes.filter((hero) => hero.slug.trim()).map((hero) => {
        const nodes = this.collectionNodes(hero);
        return {
          slug: hero.slug.trim(),
          ...(hero.si !== null ? { si: hero.si } : {}),
          ...(hero.furniture !== null ? { furniture: hero.furniture } : {}),
          ...(hero.engraving !== null ? { engraving: hero.engraving } : {}),
          ...(hero.collectionId ? { collection: { catalog: hero.collectionId, nodes } } : {}),
        };
      }),
    })),
  }, null, 2));
  private imageObjectUrl: string | null = null;
  private dragStart: { x: number; y: number } | null = null;
  private nextHeroId = 0;
  private nextTeamId = 2;
  private templateFeatures: Promise<readonly HeroMatch[]> | null = null;
  private petFeatures: Promise<readonly PetMatch[]> | null = null;

  ngOnDestroy(): void {
    if (this.imageObjectUrl) URL.revokeObjectURL(this.imageObjectUrl);
  }

  loadImage(event: Event): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    const file = input.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      this.status.set('Choose a valid image file.');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      this.status.set('Choose an image smaller than 20 MB.');
      return;
    }
    if (this.imageObjectUrl) URL.revokeObjectURL(this.imageObjectUrl);
    this.imageObjectUrl = URL.createObjectURL(file);
    this.imageUrl.set(this.imageObjectUrl);
    this.imageReady.set(false);
    this.ocrText.set('');
    this.teams.set([{ key: 'team-1', label: 'Team 1', pet: '', petLevel: null, petSuggestions: [], heroes: [] }]);
    this.substituteSets.set([]);
    this.selectedSubstituteSet.set(0);
    this.selectedTeam.set(0);
    this.status.set('Image loaded locally. Analyze the entire image to generate candidate teams.');
  }

  imageLoadError(): void {
    this.imageReady.set(false);
    this.status.set('The selected image could not be decoded by this browser.');
  }

  async analyzeImage(): Promise<void> {
    const image = this.sourceImage()?.nativeElement;
    if (!image || !this.imageReady() || this.analyzing()) return;
    this.analyzing.set(true);
    this.status.set('Reading the whole image locally. The OCR worker and language data may download on first use…');
    try {
      const maxDimension = 2600;
      const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas is unavailable.');
      context.drawImage(image, 0, 0, canvas.width, canvas.height);

      const { createWorker, PSM } = await import('tesseract.js');
      const worker = await createWorker('eng');
      let text: string;
      let lines: readonly RecognizedLine[];
      let sectionCount = 0;
      try {
        await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
        const result = await worker.recognize(canvas, {}, { blocks: true });
        text = result.data.text.trim();
        lines = this.recognizedLines(result.data.blocks ?? [], canvas.width, canvas.height);
        sectionCount = Math.max(
          (text.match(/round\s*[1-6]/gi) ?? []).length,
          (text.match(/collections?\s*\+\s*investments/gi) ?? []).length,
        );
      } finally {
        await worker.terminate();
      }

      this.ocrText.set(text);
      this.status.set('Matching hero, pet, and collection icons across the whole image…');
      const scanWarnings: string[] = [];
      const scan = <T>(name: string, operation: Promise<T>): Promise<T | null> => operation.catch((error: unknown) => {
        scanWarnings.push(`${name}: ${error instanceof Error ? error.message : 'icon matching failed'}`);
        return null;
      });
      const [heroHits, petHits, collectionHits] = await Promise.all([
        scan('Heroes', this.scanHeroes(image, lines)),
        this.mode() === 'nightmare-corridor' ? Promise.resolve([]) : scan('Pets', this.scanPets(image)),
        scan('Collections', this.scanCollections(image, lines)),
      ]);
      const substituteSets = this.mode() === 'nightmare-corridor'
        ? await scan('Substitutes', this.scanNightmareSubstituteSets(image, lines))
        : [];
      this.buildCandidates(lines, heroHits ?? [], petHits ?? [], collectionHits ?? [], sectionCount, substituteSets ?? []);
      const detectedCount = this.teams().reduce((sum, team) => sum + team.heroes.length, 0);
      const summary = detectedCount
        ? `Found ${this.teams().length} main team candidate${this.teams().length === 1 ? '' : 's'} with ${detectedCount} hero slots and ${this.substituteSets().length} substitute sets to review. Confirm the matches, collections, and pets.`
        : 'No hero candidates were matched. Add heroes manually; image layouts and overlays can prevent icon matching.';
      this.status.set(scanWarnings.length ? `${summary} Icon matching warnings: ${scanWarnings.join('; ')}` : summary);
    } catch (error) {
      this.status.set(`Could not analyze the image: ${error instanceof Error ? error.message : 'unknown OCR error'}. Check network access for OCR assets and try again.`);
    } finally {
      this.analyzing.set(false);
    }
  }

  private recognizedLines(
    blocks: readonly {
      readonly paragraphs: readonly {
        readonly lines: readonly {
          readonly text: string;
          readonly bbox: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number };
        }[];
      }[];
    }[],
    width: number,
    height: number,
  ): readonly RecognizedLine[] {
    return blocks.flatMap((block) => block.paragraphs.flatMap((paragraph) => paragraph.lines
      .filter((line) => line.text.trim().length > 0)
      .map((line) => {
        const x = line.bbox.x0 / width;
        const y = line.bbox.y0 / height;
        const boxWidth = (line.bbox.x1 - line.bbox.x0) / width;
        const boxHeight = (line.bbox.y1 - line.bbox.y0) / height;
        return {
          text: line.text.trim(),
          box: { x, y, width: boxWidth, height: boxHeight },
          centerX: x + boxWidth / 2,
          centerY: y + boxHeight / 2,
        };
      })));
  }

  private buildCandidates(
    lines: readonly RecognizedLine[],
    visualHeroHits: readonly VisualImageHit[],
    visualPetHits: readonly VisualImageHit[],
    visualCollectionHits: readonly VisualImageHit[],
    sectionCount: number,
    substituteSets: readonly SubstituteTeamCandidate[],
  ): void {
    const heroEntries = [...this.heroes()].sort((a, b) => displayHeroName(b).length - displayHeroName(a).length);
    const hits: HeroTextHit[] = [];
    for (const line of lines) {
      if (this.mode() === 'nightmare-corridor' && line.centerX > 0.75) continue;
      const normalizedLine = this.normalizeForMatch(line.text);
      for (const hero of heroEntries) {
        if (this.heroTextAliases(hero).some((alias) => alias && normalizedLine.includes(alias))) {
          hits.push({ hero, line });
        }
      }
    }
    const visualNames = new Set(visualHeroHits.map((hit) => hit.label));
    const textHits = hits.filter((entry) => !visualNames.has(displayHeroName(entry.hero)));
    hits.length = 0;
    hits.push(...textHits);
    for (const visualHit of visualHeroHits) {
      const hero = heroEntries.find((entry) => displayHeroName(entry) === visualHit.label);
      if (!hero) continue;
      const duplicate = hits.find((entry) => entry.hero.id === hero.id
        && Math.hypot(entry.line.centerX - (visualHit.box.x + visualHit.box.width / 2), entry.line.centerY - (visualHit.box.y + visualHit.box.height / 2)) < 0.08);
      if (duplicate && this.mode() !== 'nightmare-corridor') continue;
      hits.push({
        hero,
        suggestions: visualHit.suggestions,
        line: {
          text: '',
          box: visualHit.box,
          centerX: visualHit.box.x + visualHit.box.width / 2,
          centerY: visualHit.box.y + visualHit.box.height / 2,
        },
      });
    }

    const groups: { hits: HeroTextHit[]; centerX: number; centerY: number }[] = [];
    for (const hit of hits) {
      const group = groups.find((candidate) => Math.hypot(candidate.centerX - hit.line.centerX, candidate.centerY - hit.line.centerY) < 0.34);
      if (group) {
        group.hits.push(hit);
        group.centerX = group.hits.reduce((sum, entry) => sum + entry.line.centerX, 0) / group.hits.length;
        group.centerY = group.hits.reduce((sum, entry) => sum + entry.line.centerY, 0) / group.hits.length;
      } else {
        groups.push({ hits: [hit], centerX: hit.line.centerX, centerY: hit.line.centerY });
      }
    }

    let teamGroups = groups.length ? groups : [{ hits: [], centerX: 0.5, centerY: 0.5 }];
    if (sectionCount > 1 && hits.length) {
      const top = Math.min(...hits.map((hit) => hit.line.centerY));
      const bottom = Math.max(...hits.map((hit) => hit.line.centerY));
      teamGroups = Array.from({ length: sectionCount }, () => ({ hits: [], centerX: 0, centerY: 0 }));
      for (const hit of hits) {
        const ratio = bottom === top ? 0 : (hit.line.centerY - top) / (bottom - top);
        const index = Math.min(sectionCount - 1, Math.floor(ratio * sectionCount));
        teamGroups[index].hits.push(hit);
      }
      teamGroups = teamGroups.filter(({ hits: groupHits }) => groupHits.length > 0);
    }
    const teams: ImportTeam[] = teamGroups.map((group, index) => {
      const heroes = group.hits.reduce<HeroCrop[]>((entries, hit) => {
        const lineText = hit.line.text;
        const investment = this.parseInvestment(lineText);
        const suggestions = hit.suggestions ?? [displayHeroName(hit.hero)];
        entries.push({
          id: ++this.nextHeroId,
          box: hit.line.box,
          suggestions,
          collectionSuggestions: [],
          nodeStatSuggestions: [],
          heroName: displayHeroName(hit.hero),
          collectionId: null,
          collectionStats: '',
          levelNodes: 0,
          investmentText: investment ? lineText : '',
          si: investment?.si ?? null,
          furniture: investment?.furniture ?? null,
          engraving: investment?.engraving ?? null,
          slug: this.slugify(displayHeroName(hit.hero)),
        });
        return entries;
      }, []);
      const nearbyLines = lines.filter((line) => Math.hypot(group.centerX - line.centerX, group.centerY - line.centerY) < 0.28);
      const petSuggestions = this.mode() === 'nightmare-corridor'
        ? []
        : [
          ...visualPetHits
            .filter((hit) => Math.hypot(group.centerX - (hit.box.x + hit.box.width / 2), group.centerY - (hit.box.y + hit.box.height / 2)) < 0.3)
            .sort((a, b) => a.distance - b.distance)
            .map((hit) => hit.label),
          ...this.pets()
            .filter((pet) => nearbyLines.some((line) => this.normalizeForMatch(line.text).includes(this.normalizeForMatch(pet.name))))
            .map((pet) => pet.name),
        ].filter((pet, index, entries) => entries.indexOf(pet) === index);
      const teamHeroes = heroes.map((hero, heroIndex) => {
        const heroHit = group.hits.find((hit) => displayHeroName(hit.hero) === hero.heroName);
        const matchingVisualHits = this.mode() === 'nightmare-corridor'
          ? visualCollectionHits.filter((hit) => hit.teamIndex === index && hit.slotIndex === heroIndex)
          : visualCollectionHits
            .filter((hit) => Math.hypot(
              (heroHit?.line.centerX ?? group.centerX) - (hit.box.x + hit.box.width / 2),
              (heroHit?.line.centerY ?? group.centerY) - (hit.box.y + hit.box.height / 2),
            ) < 0.15)
            .sort((a, b) => a.distance - b.distance);
        const visualCollection = matchingVisualHits
          .filter((hit) => this.mode() !== 'nightmare-corridor' || hit.distance <= NIGHTMARE_COLLECTION_AUTO_MATCH_DISTANCE)
          .map((hit) => this.collections.find((collection) => String(collection.id) === hit.label))
          .find((collection): collection is CollectionCatalogItem => !!collection && this.isCollectionValid(hero, collection));
        const nearestCollection = visualCollection ?? this.collections.find((collection) => nearbyLines.some((line) =>
          this.normalizeForMatch(line.text).includes(this.normalizeForMatch(collection.name))
          && (!heroHit || Math.hypot(heroHit.line.centerX - line.centerX, heroHit.line.centerY - line.centerY) < 0.16))
          && this.isCollectionValid(hero, collection));
        const visualCollectionSuggestions = matchingVisualHits
          .flatMap((hit) => this.mode() === 'nightmare-corridor' ? [hit.label, ...hit.suggestions] : [hit.label])
          .map((label) => this.collections.find((collection) => String(collection.id) === label))
          .filter((collection): collection is CollectionCatalogItem => !!collection && this.isCollectionValid(hero, collection))
          .map(({ id }) => id);
        const collectionSuggestions = [...new Set([
          ...(nearestCollection ? [nearestCollection.id] : []),
          ...visualCollectionSuggestions,
        ])];
        return collectionSuggestions.length
          ? { ...hero, collectionId: nearestCollection?.id ?? null, collectionSuggestions }
          : hero;
      });
      return {
        key: `team-${index + 1}`,
        label: `Team ${index + 1}`,
        pet: petSuggestions[0] ?? '',
        petLevel: petSuggestions.length ? 18 : null,
        petSuggestions,
        heroes: teamHeroes,
      };
    });
    const teamsWithPreferredPets = teams.map((team, index) => {
      const topSubstitute = substituteSets.find((candidate) => candidate.label === `Round ${index + 1} · substitute 1`);
      if (!topSubstitute?.petSuggestions.length) return team;
      return {
        ...team,
        pet: topSubstitute.petSuggestions[0],
        petLevel: 18,
        petSuggestions: topSubstitute.petSuggestions,
      };
    });
    this.nextTeamId = teams.length + 1;
    this.teams.set(teamsWithPreferredPets);
    this.substituteSets.set(substituteSets);
    this.selectedSubstituteSet.set(0);
    this.selectedTeam.set(0);
  }

  private async scanHeroes(image: HTMLImageElement, lines: readonly RecognizedLine[]): Promise<readonly VisualImageHit[]> {
    const templates = await this.loadTemplateFeatures();
    const sectionHeadings = lines.filter((line) => {
      const text = this.normalizeForMatch(line.text);
      return text.includes('collection') && text.includes('investment');
    }).sort((a, b) => a.centerY - b.centerY);
    if (this.mode() === 'nightmare-corridor' && sectionHeadings.length > 1) {
      return this.scanNightmareHeroRows(image, templates, sectionHeadings);
    }
    return this.scanImageFeatures(
      image,
      templates.map(({ name, distance }) => ({ label: name, distance })),
      [0.07, 0.095, 0.12, 0.15],
      0.05,
      32,
    );
  }

  private scanNightmareHeroRows(
    image: HTMLImageElement,
    templates: readonly HeroMatch[],
    sectionHeadings: readonly RecognizedLine[],
  ): readonly VisualImageHit[] {
    const hits: VisualImageHit[] = [];
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    for (const heading of sectionHeadings) {
      for (let index = 0; index < NIGHTMARE_HERO_COLUMN_CENTERS.length; index++) {
        const size = width * NIGHTMARE_HERO_COLUMN_SCALES[index];
        const box = {
          x: NIGHTMARE_HERO_COLUMN_CENTERS[index] - size / (2 * width),
          y: heading.centerY + NIGHTMARE_HERO_COLUMN_Y_OFFSETS[index] - size / (2 * height),
          width: size / width,
          height: size / height,
        };
        if (box.x < 0 || box.y < 0 || box.x + box.width > 1 || box.y + box.height > 1) continue;
        const feature = this.imageFeature(image, box, NIGHTMARE_HERO_COLUMN_INSETS[index]);
        const ranked = templates
          .map((template) => ({ label: template.name, distance: this.featureDistance(feature, template.distance) }))
          .sort((a, b) => a.distance - b.distance);
        const match = ranked[0];
        if (match) {
          hits.push({
            label: match.label,
            box,
            distance: match.distance,
            suggestions: ranked.slice(0, 5).map((entry) => entry.label),
          });
        }
      }
    }
    return hits;
  }

  private async scanNightmareSubstituteSets(
    image: HTMLImageElement,
    lines: readonly RecognizedLine[],
  ): Promise<readonly SubstituteTeamCandidate[]> {
    const sectionHeadings = lines
      .filter((line) => {
        const text = this.normalizeForMatch(line.text);
        return text.includes('collection') && text.includes('investment');
      })
      .sort((a, b) => a.centerY - b.centerY);
    if (sectionHeadings.length < 2) return [];

    const [heroTemplates, petTemplates] = await Promise.all([
      this.loadTemplateFeatures(),
      this.loadPetFeatures(),
    ]);
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    const sets: SubstituteTeamCandidate[] = [];
    for (let roundIndex = 0; roundIndex < sectionHeadings.length; roundIndex++) {
      const heading = sectionHeadings[roundIndex];
      const nextHeading = sectionHeadings[roundIndex + 1];
      const firstRowY = heading.centerY + 0.006;
      const lastRowY = nextHeading
        ? nextHeading.centerY - 0.016
        : Math.min(0.98, heading.centerY + 0.13);
      for (let rowIndex = 0; rowIndex < NIGHTMARE_SUBSTITUTE_ROWS_PER_ROUND; rowIndex++) {
        const ratio = rowIndex / (NIGHTMARE_SUBSTITUTE_ROWS_PER_ROUND - 1);
        const centerY = firstRowY + (lastRowY - firstRowY) * ratio;
        const heroes = NIGHTMARE_SUBSTITUTE_HERO_COLUMN_CENTERS.map((centerX) => {
          const box = this.nightmareSmallIconBox(centerX, centerY, width, height);
          const feature = this.imageFeature(image, box, 0.1);
          const suggestions = heroTemplates
            .map((template) => ({ name: template.name, distance: this.featureDistance(feature, template.distance) }))
            .sort((a, b) => a.distance - b.distance)
            .slice(0, 5)
            .map((entry) => entry.name);
          return { box, heroName: '', suggestions };
        });
        const petBox = this.nightmareSmallIconBox(NIGHTMARE_SUBSTITUTE_PET_CENTER_X, centerY, width, height);
        const petFeatures = this.petImageFeatures(image, petBox);
        const petSuggestions = this.rankPetMatches(petFeatures, petTemplates)
          .slice(0, 5)
          .map((entry) => entry.name);
        sets.push({
          label: `Round ${roundIndex + 1} · substitute ${rowIndex + 1}`,
          pet: '',
          petSuggestions,
          heroes,
        });
      }
    }
    return sets;
  }

  private nightmareSmallIconBox(
    centerX: number,
    centerY: number,
    width: number,
    height: number,
    size = NIGHTMARE_SUBSTITUTE_ICON_SIZE,
  ): CropBox {
    return {
      x: centerX - size / 2,
      y: centerY - size * width / (2 * height),
      width: size,
      height: size * width / height,
    };
  }

  private async scanPets(image: HTMLImageElement): Promise<readonly VisualImageHit[]> {
    const templates = await this.loadPetFeatures();
    return this.scanImageFeatures(
      image,
      templates.map(({ name, distance }) => ({ label: name, distance })),
      [0.035, 0.05, 0.07, 0.09],
      0.05,
      12,
    );
  }

  private async loadPetFeatures(): Promise<readonly PetMatch[]> {
    return this.petFeatures ??= (async () => {
      const templates = await Promise.all(this.pets().map(async (pet): Promise<PetMatch | null> => {
        try {
          const icon = await this.loadCrossOriginImage(pet.iconUrl ?? this.icons.iconUrl(pet.id));
          return {
            name: pet.name,
            distance: this.imageFeature(icon),
            views: PET_REFERENCE_VIEWS.map((y) => this.imageFeatureAtSize(
              icon,
              { x: 0, y, width: 1, height: PET_REFERENCE_SIZE },
              0,
              PET_FEATURE_SIZE,
            )),
          };
        } catch {
          return null;
        }
      }));
      const usable = templates.filter((entry): entry is PetMatch => entry !== null);
      if (!usable.length) throw new Error('No pet reference icons could be loaded.');
      return usable;
    })();
  }

  private rankPetMatches(features: readonly Float32Array[], templates: readonly PetMatch[]): readonly { name: string; distance: number }[] {
    return templates
      .map((template) => ({
        name: template.name,
        distance: features.reduce((total, feature) => total
          + template.views.reduce((viewTotal, view) => viewTotal + this.featureDistance(feature, view), 0), 0)
          / (features.length * template.views.length),
      }))
      .sort((a, b) => a.distance - b.distance);
  }

  private petImageFeatures(image: HTMLImageElement, box: CropBox): readonly Float32Array[] {
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    const boxWidth = box.width * width;
    const boxHeight = box.height * height;
    const cropSize = Math.min(boxWidth, boxHeight) * 0.78;
    const centerX = box.x * width + boxWidth / 2 + boxWidth * 0.07;
    const centerY = box.y * height + boxHeight / 2;
    // Average a bounded crop neighborhood to tolerate small selection/alignment differences.
    return PET_ALIGNMENT_OFFSETS.flatMap((offsetY) => PET_ALIGNMENT_OFFSETS.map((offsetX) => {
      const sampleCenterX = centerX + boxWidth * offsetX;
      const sampleCenterY = centerY + boxHeight * offsetY;
      return this.imageFeatureAtSize(image, {
        x: (sampleCenterX - cropSize / 2) / width,
        y: (sampleCenterY - cropSize / 2) / height,
        width: cropSize / width,
        height: cropSize / height,
      }, 0, PET_FEATURE_SIZE);
    }));
  }

  private async scanCollections(
    image: HTMLImageElement,
    lines: readonly RecognizedLine[],
  ): Promise<readonly VisualImageHit[]> {
    const templates = await (this.collectionFeatures ??= this.loadCollectionFeatures());
    const sectionHeadings = lines.filter((line) => {
      const text = this.normalizeForMatch(line.text);
      return text.includes('collection') && text.includes('investment');
    }).sort((a, b) => a.centerY - b.centerY);
    if (this.mode() === 'nightmare-corridor' && sectionHeadings.length > 1) {
      return this.scanNightmareCollectionRows(image, templates, sectionHeadings);
    }
    return this.scanImageFeatures(
      image,
      templates.map(({ id, distance }) => ({ label: String(id), distance })),
      [0.035, 0.05, 0.07, 0.09],
      0.05,
      12,
    );
  }

  private scanNightmareCollectionRows(
    image: HTMLImageElement,
    templates: readonly CollectionMatch[],
    sectionHeadings: readonly RecognizedLine[],
  ): readonly VisualImageHit[] {
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    const hits: VisualImageHit[] = [];
    for (let teamIndex = 0; teamIndex < sectionHeadings.length; teamIndex++) {
      const centerY = sectionHeadings[teamIndex].centerY + 0.06;
      for (let slotIndex = 0; slotIndex < NIGHTMARE_COLLECTION_COLUMN_CENTERS.length; slotIndex++) {
        const bestMatches = new Map<number, { distance: number; box: CropBox }>();
        for (const xOffset of NIGHTMARE_COLLECTION_X_OFFSETS) {
          for (const yOffset of NIGHTMARE_COLLECTION_Y_OFFSETS) {
            for (const size of NIGHTMARE_COLLECTION_ICON_SCALES) {
              const box = this.nightmareSmallIconBox(
                NIGHTMARE_COLLECTION_COLUMN_CENTERS[slotIndex] + xOffset,
                centerY + yOffset,
                width,
                height,
                size,
              );
              const feature = this.imageFeature(image, box);
              for (const template of templates) {
                const distance = this.featureDistance(feature, template.distance);
                const current = bestMatches.get(template.id);
                if (!current || distance < current.distance) bestMatches.set(template.id, { distance, box });
              }
            }
          }
        }
        const ranked = [...bestMatches]
          .map(([id, match]) => ({ id, ...match }))
          .sort((left, right) => left.distance - right.distance);
        const match = ranked[0];
        if (!match || match.distance > 0.05) continue;
        hits.push({
          label: String(match.id),
          box: match.box,
          distance: match.distance,
          suggestions: ranked.slice(0, 5).map(({ id }) => String(id)),
          teamIndex,
          slotIndex,
        });
      }
    }
    return hits;
  }

  private scanImageFeatures(
    image: HTMLImageElement,
    templates: readonly { label: string; distance: Float32Array }[],
    sizeScales: readonly number[],
    maxDistance: number,
    maxHits: number,
    region: CropBox = { x: 0, y: 0, width: 1, height: 1 },
  ): readonly VisualImageHit[] {
    if (!templates.length) return [];
    const minDimension = Math.min(image.naturalWidth, image.naturalHeight);
    const candidates: VisualImageHit[] = [];
    for (const sizeScale of sizeScales) {
      const size = Math.max(FEATURE_SIZE, Math.round(minDimension * sizeScale));
      const stride = Math.max(4, Math.round(size * 0.45));
      const startX = Math.floor(region.x * image.naturalWidth);
      const startY = Math.floor(region.y * image.naturalHeight);
      const endX = Math.ceil((region.x + region.width) * image.naturalWidth);
      const endY = Math.ceil((region.y + region.height) * image.naturalHeight);
      for (let y = startY; y + size <= endY; y += stride) {
        for (let x = startX; x + size <= endX; x += stride) {
          const box = {
            x: x / image.naturalWidth,
            y: y / image.naturalHeight,
            width: size / image.naturalWidth,
            height: size / image.naturalHeight,
          };
          const feature = this.imageFeature(image, box);
          const ranked = templates
            .map((template) => ({ label: template.label, distance: this.featureDistance(feature, template.distance) }))
            .sort((a, b) => a.distance - b.distance);
          const best = ranked[0];
          if (best && best.distance <= maxDistance) {
            candidates.push({
              label: best.label,
              box,
              distance: best.distance,
              suggestions: ranked.slice(0, 5).map((entry) => entry.label),
            });
          }
        }
      }
    }
    const selected: VisualImageHit[] = [];
    for (const candidate of candidates.sort((a, b) => a.distance - b.distance)) {
      const overlaps = selected.some((entry) => this.boxOverlap(entry.box, candidate.box) > 0.15);
      if (!overlaps) selected.push(candidate);
      if (selected.length >= maxHits) break;
    }
    return selected;
  }

  private boxOverlap(first: CropBox, second: CropBox): number {
    const left = Math.max(first.x, second.x);
    const top = Math.max(first.y, second.y);
    const right = Math.min(first.x + first.width, second.x + second.width);
    const bottom = Math.min(first.y + first.height, second.y + second.height);
    const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
    const combined = first.width * first.height + second.width * second.height - intersection;
    return combined > 0 ? intersection / combined : 0;
  }

  private heroTextAliases(hero: Hero): readonly string[] {
    const name = displayHeroName(hero);
    const normalized = this.normalizeForMatch(name);
    const aliases = [normalized];
    const awakened = name.match(/^(.*?)\s*\(Awakened\)$/i);
    const highborn = name.match(/^(.*?)\s*\(Highborn\)$/i);
    if (awakened) aliases.push(this.normalizeForMatch(`Awakened ${awakened[1]}`));
    if (highborn) aliases.push(this.normalizeForMatch(`Highborn ${highborn[1]}`));
    return aliases;
  }

  private normalizeForMatch(value: string): string {
    return value.toLocaleLowerCase().replace(/[^a-z0-9]/g, '');
  }

  addHeroToTeam(): void {
    const emptyBox = { x: 0, y: 0, width: 1, height: 1 };
    const hero: HeroCrop = {
      id: ++this.nextHeroId,
      box: emptyBox,
      suggestions: [],
      collectionSuggestions: [],
      nodeStatSuggestions: [],
      heroName: '',
      collectionId: null,
      collectionStats: '',
      levelNodes: 0,
      investmentText: '',
      si: null,
      furniture: null,
      engraving: null,
      slug: '',
    };
    const index = this.selectedTeam();
    this.teams.update((teams) => teams.map((team, teamIndex) => teamIndex === index
      ? { ...team, heroes: [...team.heroes, hero] }
      : team));
  }

  startCrop(event: PointerEvent): void {
    if (!(event.currentTarget instanceof HTMLImageElement)) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    this.dragStart = {
      x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    this.draftBox.set({ x: this.dragStart.x, y: this.dragStart.y, width: 0, height: 0 });
  }

  moveCrop(event: PointerEvent): void {
    if (!this.dragStart || !(event.currentTarget instanceof HTMLImageElement)) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    const y = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
    this.draftBox.set({
      x: Math.min(this.dragStart.x, x),
      y: Math.min(this.dragStart.y, y),
      width: Math.abs(x - this.dragStart.x),
      height: Math.abs(y - this.dragStart.y),
    });
  }

  finishCrop(event: PointerEvent): void {
    if (!this.dragStart || !(event.currentTarget instanceof HTMLImageElement)) return;
    this.moveCrop(event);
    const box = this.draftBox();
    this.dragStart = null;
    if (!box || box.width < 0.015 || box.height < 0.015) {
      this.draftBox.set(null);
      this.status.set('That crop was too small. Drag around the whole hero portrait.');
      return;
    }
    this.draftBox.set(null);
    void this.processCrop(box);
  }

  setCropPurpose(event: Event): void {
    const value = this.inputValue(event);
    if (value === 'hero' || value === 'pet' || value === 'collection' || value === 'collection-node' || value === 'investment') this.cropPurpose.set(value);
  }

  setAssociatedHero(event: Event): void {
    const value = Number(this.inputValue(event));
    this.associatedHeroId.set(Number.isInteger(value) ? value : -1);
  }

  private async processCrop(box: CropBox): Promise<void> {
    switch (this.cropPurpose()) {
      case 'hero': await this.addHeroCrop(box); return;
      case 'pet': await this.identifyPet(box); return;
      case 'collection': await this.identifyCollection(box); return;
      case 'collection-node': await this.identifyNodeStat(box); return;
      case 'investment': await this.readInvestment(box); return;
    }
  }

  private async addHeroCrop(box: CropBox): Promise<void> {
    const id = ++this.nextHeroId;
    const image = this.sourceImage()?.nativeElement;
    if (!image || !this.activeTeam()) return;
    this.status.set('Comparing crop against available hero portraits in this browser…');
    let suggestions: readonly string[] = [];
    try {
      const cropFeature = this.imageFeature(image, box);
      const templates = await (this.templateFeatures ??= this.loadTemplateFeatures());
      suggestions = templates
        .map((template) => ({ name: template.name, distance: this.featureDistance(cropFeature, template.distance) }))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 5)
        .map(({ name }) => name);
    } catch {
      this.status.set('Could not compare image icons. You can still select the hero manually.');
    }
    const teamIndex = this.selectedTeam();
    this.teams.update((teams) => teams.map((team, index) => index === teamIndex
      ? { ...team, heroes: [...team.heroes, { id, box, suggestions, collectionSuggestions: [], nodeStatSuggestions: [], heroName: '', collectionId: null, collectionStats: '', levelNodes: 0, investmentText: '', si: null, furniture: null, engraving: null, slug: '' }] }
      : team));
    this.status.set('Crop added. Confirm the hero and edit its seed slug if needed.');
  }

  private async loadTemplateFeatures(): Promise<readonly HeroMatch[]> {
    await this.icons.initialize();
    const heroes = this.heroes();
    const features: HeroMatch[] = [];
    for (let index = 0; index < heroes.length; index += 8) {
      const batch = await Promise.all(heroes.slice(index, index + 8).map(async (hero) => {
        const unitId = this.icons.unitIdFor(displayHeroName(hero));
        if (unitId === null) return null;
        try {
          const image = await this.loadCrossOriginImage(this.icons.iconUrl(unitId));
          return { name: displayHeroName(hero), distance: this.imageFeature(image) };
        } catch {
          return null;
        }
      }));
      features.push(...batch.filter((item): item is HeroMatch => item !== null));
    }
    if (!features.length) throw new Error('No hero image templates are available.');
    return features;
  }

  private collectionFeatures: Promise<readonly CollectionMatch[]> | null = null;

  private async loadCollectionFeatures(): Promise<readonly CollectionMatch[]> {
    const features = await Promise.all(this.collections.map(async (collection) => {
      try {
        const image = await this.loadCrossOriginImage(this.collectionIconUrl(collection.id));
        return { id: collection.id, distance: this.imageFeature(image) };
      } catch {
        return null;
      }
    }));
    const usable = features.filter((item): item is CollectionMatch => item !== null);
    if (!usable.length) throw new Error('No collection icon templates are available.');
    return usable;
  }

  private async identifyCollection(box: CropBox): Promise<void> {
    const heroId = this.associatedHeroId();
    if (heroId < 0) {
      this.status.set('Choose the hero that uses this collection, then crop the icon.');
      return;
    }
    const image = this.sourceImage()?.nativeElement;
    if (!image) return;
    this.status.set('Comparing collection crop against catalog icons…');
    try {
      const feature = this.imageFeature(image, box);
      const templates = await (this.collectionFeatures ??= this.loadCollectionFeatures());
      const associatedHero = this.activeTeam()?.heroes.find((hero) => hero.id === heroId);
      const suggestions = templates
        .map((template) => ({ id: template.id, distance: this.featureDistance(feature, template.distance) }))
        .filter(({ id }) => {
          const collection = this.collections.find((entry) => entry.id === id);
          return !!collection && (!associatedHero || this.isCollectionValid(associatedHero, collection));
        })
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 5)
        .map(({ id }) => id);
      this.teams.update((teams) => teams.map((team, teamIndex) => teamIndex === this.selectedTeam()
        ? { ...team, heroes: team.heroes.map((hero) => hero.id === heroId
          ? { ...hero, collectionSuggestions: suggestions, collectionId: suggestions[0] ?? null }
          : hero) }
        : team));
      this.status.set('Collection candidates added. Confirm the icon and enter its node stats.');
    } catch {
      this.status.set('Could not compare collection icons. Select the collection manually.');
    }
  }

  private async identifyPet(box: CropBox): Promise<void> {
    const image = this.sourceImage()?.nativeElement;
    if (!image) return;
    const pets = this.pets();
    if (!pets.length) {
      this.status.set('Pet reference icons are unavailable. Choose the pet from the team selector.');
      return;
    }
    this.status.set('Comparing pet crop against available pet icons…');
    try {
      const features = this.petImageFeatures(image, box);
      const templates = await this.loadPetFeatures();
      const suggestions = this.rankPetMatches(features, templates)
        .slice(0, 5)
        .map(({ name }) => name);
      this.teams.update((teams) => teams.map((team, teamIndex) => teamIndex === this.selectedTeam()
        ? { ...team, pet: suggestions[0] ?? '', petSuggestions: suggestions }
        : team));
      this.status.set('Pet candidates added. Confirm the selected pet and level.');
    } catch {
      this.status.set('Could not compare pet icons. Choose the pet manually.');
    }
  }

  private nodeStatFeatures: Promise<readonly NodeStatMatch[]> | null = null;

  private async loadNodeStatFeatures(): Promise<readonly NodeStatMatch[]> {
    const features = await Promise.all(COLLECTION_NODE_STATS.map(async (stat) => {
      try {
        const image = await this.loadCrossOriginImage(collectionNodeIconUrl(stat, 'mythic'));
        return { stat, distance: this.imageFeature(image) };
      } catch {
        return null;
      }
    }));
    const usable = features.filter((item): item is NodeStatMatch => item !== null);
    if (!usable.length) throw new Error('No collection node icon templates are available.');
    return usable;
  }

  private async identifyNodeStat(box: CropBox): Promise<void> {
    const heroId = this.associatedHeroId();
    const image = this.sourceImage()?.nativeElement;
    if (heroId < 0 || !image) {
      this.status.set('Choose the hero that uses this collection, then crop the node stat icon.');
      return;
    }
    this.status.set('Comparing collection node crop against stat icons…');
    try {
      const feature = this.imageFeature(image, box);
      const templates = await (this.nodeStatFeatures ??= this.loadNodeStatFeatures());
      const suggestions = templates
        .map((template) => ({ stat: template.stat, distance: this.featureDistance(feature, template.distance) }))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 5)
        .map(({ stat }) => stat);
      this.teams.update((teams) => teams.map((team, teamIndex) => teamIndex === this.selectedTeam()
        ? { ...team, heroes: team.heroes.map((hero) => hero.id === heroId ? { ...hero, nodeStatSuggestions: suggestions } : hero) }
        : team));
      this.status.set('Node-stat candidates added. Confirm each suggested stat before exporting.');
    } catch {
      this.status.set('Could not compare collection node icons. Enter stat codes manually.');
    }
  }

  private async readInvestment(box: CropBox): Promise<void> {
    const heroId = this.associatedHeroId();
    if (heroId < 0) {
      this.status.set('Choose the hero these investment values belong to, then crop the text or badges.');
      return;
    }
    const image = this.sourceImage()?.nativeElement;
    if (!image) return;
    this.status.set('Reading investment crop locally…');
    try {
      const canvas = this.cropCanvas(image, box, 4);
      const { createWorker } = await import('tesseract.js');
      const worker = await createWorker('eng');
      try {
        await worker.setParameters({ tessedit_char_whitelist: '0123456789eESI.Furniture:+ ' });
        const result = await worker.recognize(canvas);
        const raw = result.data.text.trim();
        const parsed = this.parseInvestment(raw);
        this.teams.update((teams) => teams.map((team, teamIndex) => teamIndex === this.selectedTeam()
          ? { ...team, heroes: team.heroes.map((hero) => hero.id === heroId
            ? {
              ...hero,
              investmentText: raw,
              si: parsed?.si ?? hero.si,
              furniture: parsed?.furniture ?? hero.furniture,
              engraving: parsed?.engraving ?? hero.engraving,
            }
            : hero) }
          : team));
        this.status.set(parsed
          ? `OCR read "${raw}" and parsed SI ${parsed.si ?? '—'}, furniture ${parsed.furniture ?? '—'}, engraving ${parsed.engraving ?? '—'}. Review the values.`
          : `OCR text: "${raw || '(nothing recognized)'}". Enter the values manually.`);
      } finally {
        await worker.terminate();
      }
    } catch {
      this.status.set('OCR could not read this crop. Enter the investment values manually.');
    }
  }

  private parseInvestment(raw: string): { si: number | null; furniture: number | null; engraving: number | null } | null {
    const normalized = raw.toLocaleLowerCase();
    const siLabel = /(?:si|signature(?:\s+item)?)\D{0,3}(\d{1,2})/.exec(normalized);
    const furnitureLabel = /(?:furniture|furn|f)\D{0,3}(\d{1,2})/.exec(normalized);
    const engravingLabel = /(?:engraving|engrave|eng|e)\D{0,3}(\d{1,3})/.exec(normalized);
    if (siLabel || furnitureLabel || engravingLabel) {
      const si = siLabel ? Number(siLabel[1]) : null;
      const furniture = furnitureLabel ? Number(furnitureLabel[1]) : null;
      const engraving = engravingLabel ? Number(engravingLabel[1]) : null;
      if ((si === null || si <= 50) && (furniture === null || furniture <= 36) && (engraving === null || engraving <= 100)) {
        return { si, furniture, engraving };
      }
    }
    const text = normalized.replace(/[^0-9e]/g, '');
    const match = /^(\d{2})(\d{1,2})(?:e(\d{1,3}))?$/.exec(text);
    if (match) {
      const si = Number(match[1]);
      const furniture = Number(match[2]);
      const engraving = match[3] ? Number(match[3]) : null;
      if (si <= 50 && furniture <= 36 && (engraving === null || engraving <= 100)) return { si, furniture, engraving };
      return null;
    }

    const digits = text.replace(/e/g, '');
    if (digits.length < 3 || digits.length > 7) return null;
    const si = Number(digits.slice(0, 2));
    if (si > 50) return null;
    const candidates = [1, 2].flatMap((furnitureLength) => {
      const engravingText = digits.slice(2 + furnitureLength);
      const furniture = Number(digits.slice(2, 2 + furnitureLength));
      const engraving = engravingText ? Number(engravingText) : null;
      return furniture <= 36 && engravingText.length <= 3 && (engraving === null || engraving <= 100)
        ? [{ si, furniture, engraving }]
        : [];
    });
    return candidates.sort((a, b) => Number(b.engraving !== null) - Number(a.engraving !== null))[0] ?? null;
  }

  private cropCanvas(image: HTMLImageElement, box: CropBox, scale: number): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(box.width * image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(box.height * image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas is unavailable.');
    context.imageSmoothingEnabled = false;
    context.drawImage(
      image,
      box.x * image.naturalWidth,
      box.y * image.naturalHeight,
      box.width * image.naturalWidth,
      box.height * image.naturalHeight,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    return canvas;
  }

  private loadCrossOriginImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Could not load hero icon: ${url}`));
      image.src = url;
    });
  }

  private imageFeature(image: HTMLImageElement, box?: CropBox, inset = 0.08): Float32Array {
    return this.imageFeatureAtSize(image, box, inset, FEATURE_SIZE);
  }

  private imageFeatureAtSize(
    image: HTMLImageElement,
    box: CropBox | undefined,
    inset: number,
    size: number,
  ): Float32Array {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Canvas is unavailable.');
    if (box) {
      const sourceX = box.x * image.naturalWidth;
      const sourceY = box.y * image.naturalHeight;
      const sourceWidth = box.width * image.naturalWidth;
      const sourceHeight = box.height * image.naturalHeight;
      const insetX = sourceWidth * inset;
      const insetY = sourceHeight * inset;
      context.drawImage(image, sourceX + insetX, sourceY + insetY, sourceWidth - insetX * 2, sourceHeight - insetY * 2, 0, 0, size, size);
    } else {
      context.drawImage(image, 0, 0, size, size);
    }
    const data = context.getImageData(0, 0, size, size).data;
    const feature = new Float32Array(size * size * 3);
    for (let index = 0; index < size * size; index++) {
      feature[index * 3] = data[index * 4] / 255;
      feature[index * 3 + 1] = data[index * 4 + 1] / 255;
      feature[index * 3 + 2] = data[index * 4 + 2] / 255;
    }
    return feature;
  }

  private featureDistance(first: Float32Array, second: Float32Array): number {
    let total = 0;
    for (let index = 0; index < first.length; index++) {
      const difference = first[index] - second[index];
      total += difference * difference;
    }
    return total / first.length;
  }

  updateSubstituteHero(slotIndex: number, heroName: string): void {
    const setIndex = this.selectedSubstituteSet();
    this.substituteSets.update((sets) => sets.map((candidate, index) => index === setIndex
      ? {
        ...candidate,
        heroes: candidate.heroes.map((hero, index) => index === slotIndex ? { ...hero, heroName } : hero),
      }
      : candidate));
  }

  updateSubstitutePet(pet: string): void {
    const setIndex = this.selectedSubstituteSet();
    this.substituteSets.update((sets) => sets.map((candidate, index) => index === setIndex
      ? { ...candidate, pet }
      : candidate));
  }

  canAddSubstituteSet(candidate: SubstituteTeamCandidate): boolean {
    const heroNames = candidate.heroes.map((hero) => hero.heroName);
    return heroNames.length === 5 && heroNames.every(Boolean) && new Set(heroNames).size === 5;
  }

  addSubstituteSet(): void {
    const candidate = this.activeSubstituteSet();
    if (!candidate || !this.canAddSubstituteSet(candidate)) return;
    const team: ImportTeam = {
      key: `team-${this.nextTeamId++}`,
      label: candidate.label,
      pet: candidate.pet,
      petLevel: candidate.pet ? 18 : null,
      petSuggestions: [],
      heroes: candidate.heroes.map((hero) => ({
        id: ++this.nextHeroId,
        box: hero.box,
        suggestions: hero.suggestions,
        collectionSuggestions: [],
        nodeStatSuggestions: [],
        heroName: hero.heroName,
        collectionId: null,
        collectionStats: '',
        levelNodes: 0,
        investmentText: '',
        si: null,
        furniture: null,
        engraving: null,
        slug: this.slugify(hero.heroName),
      })),
    };
    this.teams.update((teams) => [...teams, team]);
    this.selectedTeam.set(this.teams().length - 1);
  }

  addTeam(): void {
    const index = this.teams().length + 1;
    this.teams.update((teams) => [...teams, { key: `team-${this.nextTeamId++}`, label: `Team ${index}`, pet: '', petLevel: null, petSuggestions: [], heroes: [] }]);
    this.selectedTeam.set(this.teams().length - 1);
  }

  updateTeam(field: 'label' | 'pet' | 'petLevel', value: string): void {
    const index = this.selectedTeam();
    this.teams.update((teams) => teams.map((team, teamIndex) => teamIndex === index
      ? {
        ...team,
        [field]: field === 'petLevel'
          ? Math.min(this.petMax(team.pet), Math.max(1, Number(value) || 18))
          : value,
        ...(field === 'pet' ? { petSuggestions: [] } : {}),
      }
      : team));
  }

  petMax(name: string): number {
    const pet = this.pets().find((entry) => entry.name === name);
    return petMaxLevel(pet?.kind);
  }

  updateHero(id: number, field: 'heroName' | 'slug' | 'collectionId' | 'collectionStats' | 'levelNodes' | 'investmentText' | 'si' | 'furniture' | 'engraving', value: string): void {
    const heroes = this.activeTeam()?.heroes ?? [];
    const current = heroes.find((hero) => hero.id === id);
    if (!current) return;
    const heroName = field === 'heroName' ? value : current.heroName;
    const slug = field === 'slug' ? value : field === 'heroName' ? this.slugify(value) : current.slug;
    let collectionId = field === 'collectionId' ? (value ? Number(value) : null) : current.collectionId;
    if (field === 'heroName' && collectionId !== null) {
      const currentCatalog = this.collections.find((collection) => collection.id === collectionId);
      if (!currentCatalog || !this.isCollectionValid({ ...current, heroName }, currentCatalog)) collectionId = null;
    }
    const parsedInvestment = field === 'investmentText' ? this.parseInvestment(value) : null;
    this.teams.update((teams) => teams.map((team, teamIndex) => teamIndex === this.selectedTeam()
      ? { ...team, heroes: team.heroes.map((hero) => hero.id === id
        ? {
          ...hero,
          heroName,
          slug,
          collectionId,
          collectionStats: field === 'collectionStats' ? value : hero.collectionStats,
          levelNodes: field === 'levelNodes' ? Math.min(2, Math.max(0, Number(value) || 0)) : hero.levelNodes,
          investmentText: field === 'investmentText' ? value : hero.investmentText,
          si: field === 'si' ? this.optionalNumber(value, 50) : parsedInvestment?.si ?? hero.si,
          furniture: field === 'furniture' ? this.optionalNumber(value, 36) : parsedInvestment?.furniture ?? hero.furniture,
          engraving: field === 'engraving' ? this.optionalNumber(value, 100) : parsedInvestment?.engraving ?? hero.engraving,
        }
        : hero) }
      : team));
  }

  removeHero(id: number): void {
    this.teams.update((teams) => teams.map((team, teamIndex) => teamIndex === this.selectedTeam()
      ? { ...team, heroes: team.heroes.filter((hero) => hero.id !== id) }
      : team));
  }

  moveHeroToTeam(heroId: number, destination: number): void {
    const source = this.selectedTeam();
    const teams = this.teams();
    if (!Number.isInteger(destination) || destination < 0 || destination >= teams.length || destination === source) return;
    const hero = teams[source]?.heroes.find((entry) => entry.id === heroId);
    if (!hero) return;
    this.teams.update((current) => current.map((team, index) => {
      if (index === source) return { ...team, heroes: team.heroes.filter((entry) => entry.id !== heroId) };
      if (index === destination) return { ...team, heroes: [...team.heroes, hero] };
      return team;
    }));
    this.selectedTeam.set(destination);
  }

  isCollectionValid(hero: HeroCrop, collection: CollectionCatalogItem): boolean {
    const name = this.heroes().find((entry) => displayHeroName(entry) === hero.heroName);
    return !name?.class || collection.class.toLowerCase() === name.class.toLowerCase();
  }

  collectionName(collectionId: number): string {
    return this.collections.find(({ id }) => id === collectionId)?.name ?? 'Unknown collection';
  }

  addNodeStat(heroId: number, stat: string): void {
    const hero = this.activeTeam()?.heroes.find((entry) => entry.id === heroId);
    if (!hero || !COLLECTION_NODE_STATS.includes(stat) || stat === 'skill_level') return;
    const stats = hero.collectionStats.split(',').map((entry) => entry.trim()).filter(Boolean);
    if (!stats.includes(stat) && stats.length < 6) stats.push(stat);
    this.updateHero(heroId, 'collectionStats', stats.join(', '));
  }

  private collectionIconUrl(id: number): string {
    return collectionIconUrl(id, 1, 0);
  }

  numberValue(event: Event): number {
    const value = Number(this.inputValue(event));
    return Number.isInteger(value) ? value : -1;
  }

  private optionalNumber(value: string, maximum: number): number | null {
    if (!value.trim()) return null;
    const number = Number(value);
    return Number.isInteger(number) ? Math.min(maximum, Math.max(0, number)) : null;
  }

  cropPreviewSize(box: CropBox): string {
    return `${100 / box.width}% ${100 / box.height}%`;
  }

  cropPreviewPosition(box: CropBox): string {
    const x = box.x / Math.max(0.001, 1 - box.width);
    const y = box.y / Math.max(0.001, 1 - box.height);
    return `${x * 100}% ${y * 100}%`;
  }

  heroName(hero: Hero): string {
    return displayHeroName(hero);
  }

  private petSlug(name: string): string {
    return this.slugify(name);
  }

  inputValue(event: Event): string {
    const target = event.target;
    return target instanceof HTMLInputElement || target instanceof HTMLSelectElement ? target.value : '';
  }

  async copyJson(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.jsonOutput());
      this.status.set('JSON copied to clipboard.');
    } catch {
      this.status.set('Clipboard access is unavailable. Select and copy the JSON below.');
    }
  }

  downloadJson(): void {
    const blob = new Blob([this.jsonOutput()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${this.seedKey().trim() || 'lineup-import'}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  private slugify(value: string): string {
    let name = value.trim();
    let prefix = '';
    if (/\s*\(Awakened\)\s*$/i.test(name) || /^Awakened\s+/i.test(name)) {
      prefix = 'awakened ';
      name = name.replace(/\s*\(Awakened\)\s*$/i, '').replace(/^Awakened\s+/i, '');
    } else if (/\s*\(Highborn\)\s*$/i.test(name) || /^Highborn\s+/i.test(name)) {
      prefix = 'highborn ';
      name = name.replace(/\s*\(Highborn\)\s*$/i, '').replace(/^Highborn\s+/i, '');
    }
    return `${prefix}${name}`
      .toLocaleLowerCase()
      .replace(/&/g, 'and')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  private collectionNodes(hero: HeroCrop): readonly { slotIndex: number; stat: string; tier: 'mythic' }[] {
    const mythic = hero.collectionStats.split(',').map((stat) => stat.trim().toLocaleLowerCase()).filter(Boolean);
    const nodes = mythic.slice(0, 6).map((stat, slotIndex) => ({ slotIndex, stat, tier: 'mythic' as const }));
    for (let index = 0; index < hero.levelNodes; index++) {
      nodes.push({ slotIndex: 6 + index, stat: 'skill_level', tier: 'mythic' });
    }
    return nodes;
  }
}
