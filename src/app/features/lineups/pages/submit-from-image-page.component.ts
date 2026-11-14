import { CdkTrapFocus } from '@angular/cdk/a11y';
import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, OnDestroy, signal, viewChild, ViewEncapsulation } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { HeroIconComponent } from '../../../core/hero-icons/hero-icon.component';
import { HeroIconService } from '../../../core/hero-icons/hero-icon.service';
import {
  ATTACK_COLLECTION_NODE_STATS,
  COLLECTION_CATALOG,
  COLLECTION_NODE_STATS,
  DEFENSE_COLLECTION_NODE_STATS,
} from '../collection-catalog';
import { AddHeroModalComponent } from '../components/add-hero-modal/add-hero-modal.component';
import { AddPetModalComponent, DraftPetSelection } from '../components/add-pet-modal/add-pet-modal.component';
import { CollectionBuildEditorComponent } from '../components/collection-build-editor/collection-build-editor.component';
import { CollectionRecommendationEditorComponent } from '../components/collection-recommendation-editor/collection-recommendation-editor.component';
import { FormationBoardComponent, FormationBoardPet, FormationBoardSlot } from '../components/formation-board/formation-board.component';
import { HeroInvestmentEditorComponent } from '../components/hero-investment-editor/hero-investment-editor.component';
import { defaultAscensionForInvestment, formatInvestment, parseInvestment } from '../investment';
import { HEROES, PETS } from '../lineup-data';
import { LineupsStore } from '../lineups.store';
import {
  AscensionRank,
  CollectionCatalogItem,
  CollectionNode,
  CollectionNodeStat,
  CollectionNodeTier,
  CollectionSnapshot,
  DraftFormation,
  DraftSlot,
  displayHeroName,
  Hero,
  Investment,
  ModeConfig,
  Pet,
  petMaxLevel,
} from '../models';

export interface RecognizedModeCandidate {
  readonly mode_slug: string;
  readonly mode_name: string;
  readonly target_slug: string;
  readonly target_name: string;
  readonly confidence: number;
  readonly reasons?: readonly string[];
}

export interface RecognizedLineupCandidate {
  readonly id: string;
  readonly title: string;
  readonly mode_slug: string;
  readonly mode_name: string;
  readonly target_slug: string;
  readonly target_name: string;
  readonly similarity: number;
  readonly mean_round_similarity?: number;
  readonly round_alignments?: readonly {
    readonly image_round: number;
    readonly matched_formation_key: string;
    readonly matched_formation_label: string;
    readonly similarity: number;
    readonly hero_overlap_count: number;
    readonly pet_matched: boolean;
  }[];
}

export interface RecognizedReviewSuggestion {
  readonly round: number;
  readonly formation_label: string;
  readonly slot: number | 'pet';
  readonly field: 'hero' | 'pet' | 'collection' | 'collection_nodes';
  readonly type: string;
  readonly current_value: unknown;
  readonly reference_value: unknown;
  readonly suggested_alternatives: readonly unknown[];
  readonly reason: string;
}

export interface EditableHeroSlot {
  readonly slotIndex: number;
  readonly heroId: number | null;
  readonly heroName: string;
  readonly slug: string;
  readonly confidence: number;
  readonly needsReview: boolean;
  readonly guideAlternatives: readonly string[];
  readonly visualAlternatives: readonly { readonly name: string; readonly slug: string; readonly confidence: number }[];
  readonly collectionId: number | null;
  readonly collectionLevel: number;
  readonly collectionNodes: readonly string[];
  readonly collectionAlternatives: readonly { readonly id: number; readonly name: string; readonly level: number }[];
  readonly nodeAlternatives: readonly string[];
  readonly investmentCode: string;
  readonly merc: boolean;
  readonly ascension?: AscensionRank | null;
  readonly collectionSnapshot?: CollectionSnapshot | null;
}

export interface EditableSubstituteTeam {
  readonly subIndex: number;
  readonly label: string;
  readonly petName: string;
  readonly petOptions: readonly string[];
  readonly heroSlots: readonly {
    readonly primaryName: string;
    readonly options: readonly string[];
  }[];
}

export interface EditableImportFormation {
  readonly round: number;
  readonly key: string;
  readonly label: string;
  readonly petId: number | null;
  readonly petName: string;
  readonly petLevel: number | null;
  readonly petConfidence: number;
  readonly petGuideOptions: readonly string[];
  readonly petVisualAlternatives: readonly { readonly name: string; readonly slug: string; readonly confidence: number }[];
  readonly heroes: readonly EditableHeroSlot[];
  readonly substituteTeams: readonly EditableSubstituteTeam[];
}

interface SampleGuideOption {
  readonly id: string;
  readonly path: string;
  readonly label: string;
}

const SAMPLE_GUIDE_OPTIONS: readonly SampleGuideOption[] = [
  {
    id: 'app-export-6',
    path: 'afk-nightmare-corridor-infernal-overlord-9.png',
    label: 'App Export — 6-Round Nightmare Corridor (Infernal Overlord)',
  },
  {
    id: 'community-lyd',
    path: 'lydydxhxpyyh1.png',
    label: 'Dual-Panel Community Guide — 6 Rounds + 43 Substitute Teams',
  },
  {
    id: 'ts-7-teams',
    path: 'yxqjrbg71c1i1.png',
    label: 'Treasure Scramble — 7-Team Multi-Formation Guide (TS Fire / Frost)',
  },
  {
    id: 'f2p-staggered-3',
    path: 'f2p-1k-dias-retries-enjoyers-weekly-nc-v0-p843t9w3p7wh1.webp',
    label: 'F2P Staggered Guide — 3-Round Nightmare Corridor',
  },
  {
    id: 'crop-round-4',
    path: 'tools/pet-matcher-lab/pilot-images/pilot-nightmare-round-4.png',
    label: 'Single-Round Crop — Round 4 Ashen Prophet',
  },
  {
    id: 'crop-nc-round-3',
    path: 'tools/pet-matcher-lab/pilot-images/pilot-nc-round-3.png',
    label: 'Single-Round Staggered Crop — Round 3 Demonic Puppet',
  },
];

@Component({
  selector: 'app-submit-from-image-page',
  standalone: true,
  imports: [
    AddHeroModalComponent,
    AddPetModalComponent,
    CdkTrapFocus,
    CollectionBuildEditorComponent,
    CollectionRecommendationEditorComponent,
    FormationBoardComponent,
    HeroIconComponent,
    HeroInvestmentEditorComponent,
    MatButtonModule,
    RouterLink,
  ],
  styleUrls: ['./roster/roster-page.component.scss'],
  encapsulation: ViewEncapsulation.None,
  template: `
    <main class="import-submit-page">
      <header class="page-header panel">
        <div>
          <h2>Import lineup from image</h2>
          <p class="subtitle">
            Upload a lineup screenshot or guide to detect the best matching mode, boss cycle, formations, heroes, pets, and collections — plus suggested alternatives for every slot.
          </p>
        </div>
        <div class="header-actions">
          <a mat-button class="btn" routerLink="/submit">Back to submit form</a>
          <button
            mat-flat-button
            type="button"
            class="btn primary apply-draft-btn"
            [disabled]="!hasAnyHero()"
            (click)="applyToSubmitForm()">
            Use lineup in submit form
          </button>
        </div>
      </header>

      <section class="panel upload-bar">
        <label class="field file-field">
          <span>Upload screenshot or guide image</span>
          <input type="file" accept="image/*" (change)="onFileSelected($event)" />
        </label>
        <div class="sample-picker">
          <label class="field">
            <span>Or test with a sample guide image</span>
            <select [value]="selectedSamplePath()" (change)="selectedSamplePath.set(inputValue($event))">
              @for (sample of sampleOptions; track sample.id) {
                <option [value]="sample.path">{{ sample.label }}</option>
              }
            </select>
          </label>
          <button
            mat-stroked-button
            type="button"
            class="btn load-sample-btn"
            [disabled]="analyzing()"
            (click)="analyzeSampleGuide(selectedSamplePath())">
            {{ analyzing() ? 'Analyzing…' : 'Analyze sample guide' }}
          </button>
        </div>
        @if (imageUrl()) {
          <button
            mat-flat-button
            type="button"
            class="btn primary"
            [disabled]="analyzing()"
            (click)="analyzeUploadedImage()">
            {{ analyzing() ? 'Analyzing…' : 'Re-analyze image' }}
          </button>
        }
        @if (statusMessage()) {
          <p class="status-banner" role="status">{{ statusMessage() }}</p>
        }
      </section>

      <section class="panel match-summary-grid">
        <div class="summary-card">
          <div class="summary-head">
            <h3>1. Game mode &amp; target</h3>
            @if (bestMode(); as bm) {
              @if (bm.mode_slug === selectedModeSlug()) {
                <span class="conf-badge ok">Auto-matched ({{ (bm.confidence * 100).toFixed(1) }}%)</span>
              } @else {
                <span class="conf-badge warn">Manual override ({{ currentModeConfig().short }})</span>
              }
            }
          </div>
          <div class="seg mode-seg-bar" role="group" aria-label="Game mode">
            @for (m of store.modes(); track m.slug) {
              <button
                mat-button
                type="button"
                class="seg-btn"
                [attr.aria-pressed]="m.slug === selectedModeSlug()"
                (click)="onModeSelect(m.slug)">
                {{ m.short }} · {{ m.name }}
              </button>
            }
          </div>
          <p class="rules-text">{{ currentModeConfig().rules }}</p>
          <div class="mode-target-controls">
            <label class="field">
              <span>Game mode</span>
              <select [value]="selectedModeSlug()" (change)="onModeSelect(inputValue($event))">
                @for (m of store.modes(); track m.slug) {
                  <option [value]="m.slug" [selected]="m.slug === selectedModeSlug()">{{ m.name }}</option>
                }
              </select>
            </label>
            <label class="field">
              <span>{{ currentModeConfig().targetLabel }}</span>
              <select [value]="selectedTargetName()" (change)="onTargetSelect(inputValue($event))">
                @for (t of currentModeConfig().targets; track t) {
                  <option [value]="t" [selected]="t === selectedTargetName()">{{ t }}</option>
                }
              </select>
            </label>
            @if (currentModeConfig().variable; as variable) {
              <label class="field">
                <span>Number of teams ({{ variable.min }}–{{ variable.max }})</span>
                <select [value]="teamCount()" (change)="onTeamCountChange(numberValue($event))">
                  @for (cnt of variableTeamCounts(variable); track cnt) {
                    <option [value]="cnt" [selected]="cnt === teamCount()">{{ cnt }} teams</option>
                  }
                </select>
              </label>
            }
          </div>
          @if (bestMode(); as bm) {
            @if (bm.reasons?.length && bm.mode_slug === selectedModeSlug()) {
              <ul class="reason-list">
                @for (reason of bm.reasons; track reason) {
                  <li>{{ reason }}</li>
                }
              </ul>
            }
          }
          @if (modeAlternatives().length) {
            <div class="alt-group">
              <span class="alt-label">Detected mode / target candidates (click to switch):</span>
              <div class="chip-row">
                @if (bestMode(); as bm) {
                  <button
                    mat-button
                    type="button"
                    class="chip-btn"
                    [class.active-candidate]="isCandidateActive(bm.mode_slug, bm.target_name)"
                    (click)="applyModeCandidate(bm)">
                    [Auto] {{ bm.mode_name }}: {{ bm.target_name }} ({{ (bm.confidence * 100).toFixed(0) }}%)
                  </button>
                }
                @for (alt of modeAlternatives(); track alt.mode_slug + ':' + alt.target_slug) {
                  <button
                    mat-button
                    type="button"
                    class="chip-btn"
                    [class.active-candidate]="isCandidateActive(alt.mode_slug, alt.target_name)"
                    (click)="applyModeCandidate(alt)">
                    {{ alt.mode_name }}: {{ alt.target_name }} ({{ (alt.confidence * 100).toFixed(0) }}%)
                  </button>
                }
              </div>
            </div>
          }
        </div>

        <div class="summary-card">
          <div class="summary-head">
            <h3>{{ selectedModeSlug() === 'treasure-scramble' ? '2. Closest matching known lineup & team alignment' : '2. Closest matching known lineup & round alignment' }}</h3>
            @if (bestLineupMatch(); as bl) {
              <span class="conf-badge ok">{{ (bl.similarity * 100).toFixed(1) }}% similarity</span>
            }
          </div>
          @if (bestLineupMatch(); as bl) {
            <p class="lineup-title"><strong>{{ bl.title }}</strong> (<code>{{ bl.id }}</code>)</p>
            @if (bl.round_alignments?.length) {
              <div class="round-alignment-list">
                @for (ra of bl.round_alignments; track ra.image_round) {
                  <span class="alignment-pill">
                    {{ roundAlignmentPrefix(ra.image_round) }} → <strong>{{ ra.matched_formation_label }}</strong>
                    ({{ ra.hero_overlap_count }}/5 heroes{{ ra.pet_matched ? ', pet ✓' : '' }})
                  </span>
                }
              </div>
            }
          } @else {
            <p class="muted">Upload or analyze an image to compare against known database lineups.</p>
          }
          @if (lineupAlternatives().length) {
            <div class="alt-group">
              <span class="alt-label">Other closest database lineups:</span>
              <div class="chip-row">
                @for (lAlt of lineupAlternatives(); track lAlt.id) {
                  <button
                    mat-button
                    type="button"
                    class="chip-btn"
                    (click)="applyLineupCandidateMode(lAlt)">
                    {{ lAlt.title }} ({{ (lAlt.similarity * 100).toFixed(0) }}%)
                  </button>
                }
              </div>
            </div>
          }
          @if (reviewSuggestions().length) {
            <div class="review-box" role="region" aria-label="Suggested corrections">
              <h4>Suggested corrections / review flags ({{ reviewSuggestions().length }})</h4>
              <ul>
                @for (sug of reviewSuggestions(); track $index) {
                  <li>
                    <strong>{{ selectedModeSlug() === 'treasure-scramble' ? 'Team ' + sug.round : 'Round ' + sug.round }} ({{ sug.formation_label }}) {{ sug.field }}:</strong>
                    {{ sug.reason }}
                  </li>
                }
              </ul>
            </div>
          }
        </div>
      </section>

      <div class="workspace-grid">
        <section class="panel preview-panel">
          <h3>Uploaded image</h3>
          @if (imageUrl(); as url) {
            <div class="image-frame">
              <img
                #uploadedImg
                [src]="url"
                alt="Uploaded lineup guide"
                (load)="onImageElementLoaded()" />
            </div>
          } @else {
            <div class="empty-preview">
              Choose a screenshot above or click <strong>Analyze sample guide</strong> to inspect and customize the extracted teams.
            </div>
          }
          <label class="field notes-field">
            <span>Lineup notes (copied to submit form)</span>
            <textarea
              rows="3"
              [value]="notes()"
              (input)="notes.set(inputValue($event))"
              placeholder="Optional notes, kill times, or substitution tips…"></textarea>
          </label>
        </section>

        <section class="panel editor-panel">
          <div class="formation-tabs-bar">
            @for (form of formations(); track form.key; let fIdx = $index) {
              <button
                mat-button
                type="button"
                class="tab-btn"
                [attr.aria-pressed]="fIdx === activeFormationIndex()"
                (click)="selectFormationTab(fIdx)">
                {{ form.label }}
                <small>{{ countFilledHeroes(form) }}/5</small>
              </button>
            }
            @if (currentModeConfig().variable; as variable) {
              <label class="field inline-team-count">
                <span>Teams:</span>
                <select [value]="teamCount()" (change)="onTeamCountChange(numberValue($event))">
                  @for (cnt of variableTeamCounts(variable); track cnt) {
                    <option [value]="cnt" [selected]="cnt === teamCount()">{{ cnt }}</option>
                  }
                </select>
              </label>
            }
          </div>

          @if (activeFormation(); as form) {
            <div class="round-header">
              <label class="field round-label-field">
                <span>{{ selectedModeSlug() === 'treasure-scramble' ? 'Team label' : 'Formation / Boss label' }}</span>
                <input
                  [value]="form.label"
                  (input)="updateActiveFormationLabel(inputValue($event))" />
              </label>
            </div>

            <div>
              <p class="muted">Click a position to add a hero or edit its investment{{ currentModeConfig().collectionsEnabled ? ' and collection' : '' }}.{{ currentModeConfig().allowPartialFormations ? ' Rounds may be omitted or partially filled.' : '' }}</p>
            </div>

            <app-formation-board
              [slots]="activeBoardSlots()"
              [pet]="activeBoardPet()"
              [selectedSlotIndex]="editingSlot()?.index ?? null"
              (slotClick)="openSlot($event)"
              (slotRemove)="clearSlot($event)"
              (petClick)="openPetModal()"
              (petRemove)="clearPet()"
            />

            @if (form.petGuideOptions.length > 1 || form.petVisualAlternatives.length > 1) {
              <div class="alt-group pet-alt-group">
                <span class="alt-label">Suggested pet alternatives (click to swap):</span>
                <div class="chip-row">
                  @for (optName of form.petGuideOptions; track optName) {
                    <button
                      mat-button
                      type="button"
                      class="chip-btn guide-sub"
                      (click)="updateActivePetByName(optName)">
                      [Guide] {{ optName }}
                    </button>
                  }
                  @for (vAlt of form.petVisualAlternatives.slice(0, 4); track vAlt.slug) {
                    <button
                      mat-button
                      type="button"
                      class="chip-btn"
                      (click)="updateActivePetByName(vAlt.name)">
                      {{ vAlt.name }} ({{ (vAlt.confidence * 100).toFixed(0) }}%)
                    </button>
                  }
                </div>
              </div>
            }

            @if (form.substituteTeams.length && selectedModeSlug() === 'nightmare-corridor') {
              <section class="substitutes-box" aria-label="Substitute teams for this round">
                <div class="sub-head">
                  <div>
                    <h4>Substitute / alternative teams for {{ form.label }} ({{ form.substituteTeams.length }})</h4>
                    <p class="muted">Select any decoded substitute team from the guide to replace this round’s 5 heroes and pet.</p>
                  </div>
                  <div class="sub-controls">
                    <select
                      [value]="selectedSubstituteIndex()"
                      (change)="selectedSubstituteIndex.set(numberValue($event))">
                      @for (sub of form.substituteTeams; track sub.subIndex; let sIdx = $index) {
                        <option [value]="sIdx">
                          {{ substituteOptionLabel(sub) }}
                        </option>
                      }
                    </select>
                    <button
                      mat-stroked-button
                      type="button"
                      class="btn apply-sub-btn"
                      (click)="applySubstituteTeamToActiveRound(selectedSubstituteIndex())">
                      Use this substitute team
                    </button>
                  </div>
                </div>
              </section>
            }
          }

          <div class="footer-actions">
            <a mat-button class="btn" routerLink="/submit">Cancel</a>
            <button
              mat-flat-button
              type="button"
              class="btn primary"
              [disabled]="!hasAnyHero()"
              (click)="applyToSubmitForm()">
              Use lineup in submit form
            </button>
          </div>
        </section>
      </div>
    </main>

    @if (petModalOpen()) {
      @if (activeFormation(); as form) {
        <app-add-pet-modal
          [pets]="store.pets()"
          [petRoster]="store.petRoster()"
          [currentPetId]="form.petId"
          [currentLevel]="form.petLevel"
          (selectionChange)="updateActivePetSelection($event)"
          (closed)="closePetModal()"
        />
      }
    }

    @if (editingSlot(); as editing) {
      @if (activeFormation(); as form) {
        @let slot = form.heroes[editing.index];
        @if (slot) {
          @if (slot.heroId === null) {
            <app-add-hero-modal
              [heroes]="store.heroes()"
              [disabledIds]="disabledHeroIds()"
              (heroSelected)="pickHero($event, editing.index)"
              (closed)="closeSlot()"
            />
          } @else {
            <div class="overlay" role="presentation" (click)="closeSlot()">
              <section class="panel hero-modal slot-modal" role="dialog" aria-modal="true"
                [attr.aria-label]="'Edit ' + slot.heroName" cdkTrapFocus [cdkTrapFocusAutoCapture]="true"
                (click)="$event.stopPropagation()">
                <div class="slot-modal-head">
                  <h2 class="extra-hero">
                    <app-hero-icon [name]="slot.heroName" [imageUrl]="store.heroIconUrl(slot.heroId)" />
                    {{ slot.heroName }}
                  </h2>
                  @if (allowsMercenary()) {
                    <label class="check merc-check">
                      <input
                        type="checkbox"
                        [checked]="slot.merc"
                        (change)="updateSlotMerc(editing.index, checkboxValue($event))" />
                      Mercenary
                    </label>
                  }
                </div>

                @if (slot.guideAlternatives.length || slot.visualAlternatives.length) {
                  <div class="alt-group">
                    <span class="alt-label">Suggested hero alternatives (click to swap):</span>
                    <div class="chip-row">
                      @for (gAlt of slot.guideAlternatives; track gAlt) {
                        <button
                          mat-button
                          type="button"
                          class="chip-btn guide-sub"
                          (click)="updateSlotHeroByName(editing.index, gAlt)">
                          [Guide Sub] {{ gAlt }}
                        </button>
                      }
                      @for (vAlt of slot.visualAlternatives.slice(0, 5); track vAlt.slug) {
                        @if (vAlt.name !== slot.heroName) {
                          <button
                            mat-button
                            type="button"
                            class="chip-btn"
                            (click)="updateSlotHeroByName(editing.index, vAlt.name)">
                            {{ vAlt.name }} ({{ (vAlt.confidence * 100).toFixed(0) }}%)
                          </button>
                        }
                      }
                    </div>
                  </div>
                }

                <p class="rules">Investment short codes use SI, furniture, and engraving, for example 309e60.</p>
                <app-hero-investment-editor
                  [hero]="heroFor(slot.heroId)"
                  [investment]="slot.investmentCode"
                  [ascension]="ascensionOfSlot(slot)"
                  (investmentChange)="updateSlotInvestment(editing.index, $event)"
                  (ascensionChange)="updateSlotAscension(editing.index, $event)"
                />

                @if (currentModeConfig().collectionsEnabled) {
                  <section class="collection-assignment" [attr.aria-label]="'Collection for ' + slot.heroName">
                    <h4>Collection</h4>
                    @if (slot.collectionAlternatives.length > 1) {
                      <div class="alt-group">
                        <span class="alt-label">Suggested collection alternatives:</span>
                        <div class="chip-row">
                          @for (cAlt of slot.collectionAlternatives.slice(0, 4); track cAlt.id) {
                            @if (cAlt.id !== slot.collectionId) {
                              <button
                                mat-button
                                type="button"
                                class="chip-btn"
                                (click)="updateSlotCollection(editing.index, cAlt.id.toString(), cAlt.level)">
                                {{ cAlt.name }} (Lv.{{ cAlt.level }})
                              </button>
                            }
                          }
                        </div>
                      </div>
                    }
                    <div class="collection-assignment-controls">
                      <div class="seg" role="group" [attr.aria-label]="'Collection source for ' + slot.heroName">
                        <button
                          mat-button
                          type="button"
                          [attr.aria-pressed]="!slot.collectionId && !slot.collectionSnapshot"
                          (click)="clearSlotCollection(editing.index)">None</button>
                        @if (auth.user() && collectionsForHero(slot.heroId).length) {
                          <button
                            mat-button
                            type="button"
                            [attr.aria-pressed]="!!slot.collectionId"
                            (click)="useRosterCollection(editing.index)">From roster</button>
                        }
                        <button
                          mat-button
                          type="button"
                          [disabled]="!catalogForHero(slot.heroId).length"
                          [attr.aria-pressed]="!!slot.collectionSnapshot"
                          (click)="startCustomCollection(editing.index)">New build</button>
                      </div>
                      @if (slot.collectionSnapshot) {
                        <div class="seg" role="group" aria-label="Collection assignment type">
                          <button
                            mat-button
                            type="button"
                            [attr.aria-pressed]="!slot.collectionSnapshot.recommendation"
                            (click)="setSlotCollectionRecommendationMode(editing.index, false)">Exact build</button>
                          <button
                            mat-button
                            type="button"
                            [attr.aria-pressed]="!!slot.collectionSnapshot.recommendation"
                            (click)="setSlotCollectionRecommendationMode(editing.index, true)">Flexible recommendation</button>
                        </div>
                      }
                    </div>
                    @if (slot.collectionSnapshot; as snapshot) {
                      @if (snapshot.recommendation; as rec) {
                        <app-collection-recommendation-editor
                          [catalog]="catalogForHero(slot.heroId)"
                          [selectedCatalogId]="snapshot.catalogId ?? defaultCatalogIdForHero(slot.heroId)"
                          [nodeStats]="store.collectionNodeStats().length ? store.collectionNodeStats() : nodeStatsCatalog"
                          [recommendation]="rec"
                          (selectedCatalogIdChange)="updateSlotCollectionCatalogId(editing.index, $event)"
                          (recommendationChange)="updateSlotCollectionRecommendation(editing.index, $event)" />
                      } @else {
                        <app-collection-build-editor
                          [catalog]="catalogForHero(slot.heroId)"
                          [selectedCatalogId]="snapshot.catalogId ?? defaultCatalogIdForHero(slot.heroId)"
                          [nodeStats]="store.collectionNodeStats().length ? store.collectionNodeStats() : nodeStatsCatalog"
                          [nodes]="snapshot.nodes"
                          (selectedCatalogIdChange)="updateSlotCollectionCatalogId(editing.index, $event)"
                          (nodesChange)="updateSlotCollectionNodes(editing.index, $event)" />
                      }
                    }
                  </section>
                }

                <div class="row-wrap modal-actions">
                  <button mat-button type="button" class="btn" (click)="clearSlot(editing.index); closeSlot()">Remove hero</button>
                  <button mat-flat-button type="button" class="btn primary" (click)="closeSlot()">Done</button>
                </div>
              </section>
            </div>
          }
        }
      }
    }
  `,
  styles: `
    .import-submit-page { max-width: 1440px; margin: 0 auto; padding: var(--app-space-3, 16px); }
    .panel { padding: var(--app-space-3, 16px); margin-bottom: var(--app-space-3, 16px); border: 1px solid var(--app-line, #2a3241); border-radius: var(--app-radius, 12px); background: var(--app-panel, #151a23); }
    .page-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap; }
    .page-header h2 { margin: 0 0 4px; }
    .subtitle, .muted { color: var(--app-muted, #94a3b8); font-size: 0.9rem; margin: 0; }
    .header-actions, .footer-actions { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
    .footer-actions { justify-content: flex-end; margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--app-line, #2a3241); }
    .upload-bar { display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-end; }
    .sample-picker { display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-end; flex: 1; }
    .field { display: flex; flex-direction: column; gap: 4px; font-size: 0.85rem; }
    .status-banner { width: 100%; margin: 4px 0 0; color: var(--app-muted, #94a3b8); font-size: 0.88rem; }
    .match-summary-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .summary-card { padding: 12px; border: 1px solid var(--app-line, #2a3241); border-radius: 10px; background: rgba(255, 255, 255, 0.02); }
    .summary-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 10px; }
    .summary-head h3 { margin: 0; font-size: 1rem; }
    .mode-seg-bar { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
    .seg-btn {
      border: 1px solid var(--app-line, #2a3241);
      border-radius: 8px;
      font-size: 0.82rem;
      padding: 6px 12px;
      color: var(--app-ink, #f1f5f9) !important;
      background: var(--app-panel, #1e293b);
      cursor: pointer;
    }
    .seg-btn:hover {
      background: rgba(255, 255, 255, 0.08);
    }
    .seg-btn[aria-pressed="true"] {
      border-color: #facc15 !important;
      font-weight: 700;
      background: rgba(250, 204, 21, 0.16) !important;
      color: #fef08a !important;
    }
    .rules-text { margin: 0 0 10px; font-size: 0.82rem; color: var(--app-muted, #94a3b8); }
    .mode-target-controls {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 12px;
      margin-bottom: 10px;
    }
    .mode-target-controls .field select {
      min-width: 0;
      width: 100%;
    }
    .inline-team-count { flex-direction: row; align-items: center; gap: 6px; margin-left: auto; }
    .reason-list { margin: 0 0 10px; padding-left: 18px; font-size: 0.84rem; color: var(--app-muted, #94a3b8); }
    .lineup-title { margin: 0 0 8px; font-size: 0.95rem; }
    .round-alignment-list { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
    .alignment-pill {
      font-size: 0.8rem;
      padding: 4px 10px;
      border-radius: 6px;
      border: 1px solid var(--app-line, #2a3241);
      background: rgba(255, 255, 255, 0.03);
      color: var(--app-ink, #f1f5f9);
    }
    .alignment-pill strong { color: #93c5fd; }
    .review-box { margin-top: 10px; padding: 10px; border-radius: 8px; border: 1px solid #f97316; background: rgba(249, 115, 22, 0.08); font-size: 0.84rem; }
    .review-box h4 { margin: 0 0 6px; color: #fdba74; font-size: 0.88rem; }
    .review-box ul { margin: 0; padding-left: 18px; }
    .workspace-grid { display: grid; grid-template-columns: minmax(260px, 0.95fr) minmax(420px, 1.45fr); gap: 16px; align-items: start; }
    .preview-panel { position: sticky; top: 12px; }
    .preview-panel h3 { margin-top: 0; }
    .image-frame { max-height: 70vh; overflow: auto; border: 1px solid var(--app-line, #2a3241); border-radius: 8px; margin-bottom: 12px; }
    .image-frame img { display: block; max-width: 100%; height: auto; }
    .empty-preview { min-height: 200px; display: grid; place-items: center; padding: 16px; border: 1px dashed var(--app-line, #2a3241); border-radius: 8px; color: var(--app-muted, #94a3b8); text-align: center; margin-bottom: 12px; }
    .formation-tabs-bar { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 14px; }
    .tab-btn {
      border: 1px solid var(--app-line, #2a3241);
      border-bottom: none;
      border-radius: 8px 8px 0 0;
      padding: 6px 14px;
      font-size: 0.84rem;
      color: var(--app-ink, #f1f5f9) !important;
      background: var(--app-panel, #1e293b);
      cursor: pointer;
    }
    .tab-btn:hover {
      background: rgba(255, 255, 255, 0.08);
    }
    .tab-btn[aria-pressed="true"] {
      border-color: #facc15 !important;
      border-bottom: 2px solid #facc15 !important;
      font-weight: 700;
      background: rgba(250, 204, 21, 0.16) !important;
      color: #fef08a !important;
    }
    .tab-btn small { margin-left: 6px; opacity: 0.75; }
    .load-sample-btn {
      color: var(--app-ink, #f1f5f9) !important;
      border-color: var(--app-line, #2a3241) !important;
    }
    .round-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap; padding-bottom: 12px; border-bottom: 1px solid var(--app-line, #2a3241); margin-bottom: 12px; }
    .pet-editor-box { flex: 1; min-width: 260px; }
    .pet-row { display: flex; align-items: flex-end; gap: 10px; flex-wrap: wrap; }
    .pet-level-input input { width: 72px; }
    .substitutes-box { padding: 12px; border: 1px solid var(--app-line, #2a3241); border-radius: 10px; margin-bottom: 14px; background: rgba(234, 179, 8, 0.05); }
    .sub-head { display: flex; flex-direction: column; gap: 8px; }
    .sub-head h4 { margin: 0; font-size: 0.92rem; }
    .sub-controls { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .sub-controls select { flex: 1; min-width: 220px; }
    .slots-list { display: flex; flex-direction: column; gap: 12px; }
    .slot-card { padding: 12px; border: 1px solid var(--app-line, #2a3241); border-radius: 10px; background: rgba(255, 255, 255, 0.015); }
    .slot-card.needs-review { border-color: #f97316; }
    .slot-identity { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; }
    .slot-badge { font-size: 0.78rem; font-weight: 700; padding: 2px 8px; border-radius: 6px; border: 1px solid var(--app-line, #2a3241); }
    .hero-select-field { flex: 1; min-width: 180px; }
    .slot-Collection-row { display: flex; gap: 10px; align-items: flex-end; flex-wrap: wrap; margin-bottom: 8px; }
    .inv-input input { width: 96px; }
    .merc-check { display: flex; align-items: center; gap: 4px; font-size: 0.84rem; padding-bottom: 6px; }
    .node-editor-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
    .alternatives-drawer { display: flex; flex-direction: column; gap: 6px; padding-top: 6px; border-top: 1px dashed var(--app-line, #2a3241); }
    .alt-group { display: flex; flex-direction: column; gap: 4px; margin-top: 4px; }
    .alt-label { font-size: 0.78rem; color: var(--app-muted, #94a3b8); }
    .chip-row { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
    .chip-btn {
      min-height: 28px;
      padding: 3px 10px;
      font-size: 0.78rem;
      border: 1px solid var(--app-line, #2a3241);
      border-radius: 6px;
      color: var(--app-ink, #f1f5f9) !important;
      background: rgba(255, 255, 255, 0.04);
      cursor: pointer;
    }
    .chip-btn:hover {
      background: rgba(255, 255, 255, 0.1);
      border-color: rgba(255, 255, 255, 0.3);
    }
    .chip-btn.active-candidate {
      border-color: #facc15 !important;
      background: rgba(250, 204, 21, 0.18) !important;
      color: #fef08a !important;
      font-weight: 600;
    }
    .chip-btn.guide-sub {
      border-color: #eab308;
      color: #fef08a !important;
    }
    .chip-btn.active-node {
      border-color: #22c55e;
      background: rgba(34, 197, 94, 0.16) !important;
      color: #86efac !important;
    }
    .conf-badge { font-size: 0.76rem; font-weight: 600; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--app-line, #2a3241); }
    .conf-badge.ok { border-color: #22c55e; color: #86efac; }
    .conf-badge.warn { border-color: #f97316; color: #fdba74; }
    @media (max-width: 960px) {
      .match-summary-grid, .workspace-grid { grid-template-columns: 1fr; }
      .preview-panel { position: static; }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SubmitFromImagePageComponent implements OnDestroy {
  readonly store = inject(LineupsStore);
  private readonly heroIcons = inject(HeroIconService);
  private readonly router = inject(Router);
  private readonly uploadedImg = viewChild<ElementRef<HTMLImageElement>>('uploadedImg');

  readonly sampleOptions = SAMPLE_GUIDE_OPTIONS;
  readonly selectedSamplePath = signal<string>(SAMPLE_GUIDE_OPTIONS[0].path);
  readonly imageUrl = signal<string | null>(null);
  readonly analyzing = signal(false);
  readonly statusMessage = signal('Upload a screenshot or pick a sample guide image to detect the mode, lineup, and alternatives.');
  readonly notes = signal('');

  readonly selectedModeSlug = signal('nightmare-corridor');
  readonly selectedTargetName = signal('Infernal Overlord');
  readonly teamCount = signal(7);
  readonly bestMode = signal<RecognizedModeCandidate | null>(null);
  readonly modeAlternatives = signal<readonly RecognizedModeCandidate[]>([]);
  readonly bestLineupMatch = signal<RecognizedLineupCandidate | null>(null);
  readonly lineupAlternatives = signal<readonly RecognizedLineupCandidate[]>([]);
  readonly reviewSuggestions = signal<readonly RecognizedReviewSuggestion[]>([]);

  readonly formations = signal<readonly EditableImportFormation[]>([]);
  readonly activeFormationIndex = signal(0);
  readonly selectedSubstituteIndex = signal(0);

  readonly heroes = computed(() => (this.store.heroes().length ? this.store.heroes() : HEROES));
  readonly pets = computed(() => (this.store.pets().length ? this.store.pets() : PETS));
  readonly collections: readonly CollectionCatalogItem[] = COLLECTION_CATALOG;
  readonly nodeStatsCatalog: readonly string[] = COLLECTION_NODE_STATS;

  readonly currentModeConfig = computed((): ModeConfig => {
    const slug = this.selectedModeSlug();
    return this.store.modes().find((m) => m.slug === slug) ?? this.store.modes()[0];
  });

  readonly allowsMercenary = computed(() => {
    const mode = this.currentModeConfig();
    return mode.mercMax !== undefined && mode.mercMax > 0;
  });

  readonly activeFormation = computed(
    () => this.formations()[this.activeFormationIndex()] ?? null,
  );

  readonly hasAnyHero = computed(() =>
    this.formations().some((f) => f.heroes.some((h) => h.heroId !== null)),
  );

  readonly auth = inject(AuthService);
  readonly editingSlot = signal<{ readonly index: number } | null>(null);
  readonly petModalOpen = signal(false);

  readonly disabledHeroIds = computed(() => {
    const form = this.activeFormation();
    if (!form) return [];
    return form.heroes
      .filter((s) => s.heroId !== null)
      .map((s) => s.heroId!);
  });

  readonly activeBoardSlots = computed<readonly FormationBoardSlot[]>(() => {
    const form = this.activeFormation();
    if (!form) return [];
    return form.heroes.map((slot) => {
      const heroId = slot.heroId;
      const heroName = slot.heroName;
      const parsedInv = parseInvestment(slot.investmentCode);
      const ascension = this.ascensionOfSlot(slot);
      return {
        heroId,
        heroName,
        iconUrl: heroId !== null ? this.store.heroIconUrl(heroId) : null,
        hue: heroId !== null ? this.store.hue(heroName) : 200,
        ascension,
        investment: parsedInv,
        needsReview: slot.needsReview,
      };
    });
  });

  readonly activeBoardPet = computed<FormationBoardPet | null>(() => {
    const form = this.activeFormation();
    if (!form || form.petId === null) return null;
    return {
      id: form.petId,
      name: form.petName,
      iconUrl: this.store.petIconUrl(form.petId),
      level: form.petLevel,
    };
  });

  private objectUrl: string | null = null;
  private pendingAnalyzeAfterLoad = false;
  private currentFileName = '';
  private userManuallyOverrodeMode = false;
  private rawExtractedFormations: EditableImportFormation[] = [];

  constructor() {
    void this.store.loadCollections();
    const initialMode = this.store.draft()?.mode ?? this.store.mode() ?? 'nightmare-corridor';
    const modeCfg = this.store.modes().find((m) => m.slug === initialMode) ?? this.store.modes()[0];
    this.selectedModeSlug.set(modeCfg.slug);
    const draftTarget = this.store.draft()?.target;
    const defaultTarget =
      draftTarget && modeCfg.targets.includes(draftTarget)
        ? draftTarget
        : modeCfg.slug === 'nightmare-corridor'
          ? 'Infernal Overlord'
          : (modeCfg.targets[0] ?? '');
    this.selectedTargetName.set(defaultTarget);
    if (modeCfg.variable) {
      this.teamCount.set(modeCfg.variable.default ?? modeCfg.variable.max);
    }
    this.syncFormationsToModeAndTarget(false);
  }

  variableTeamCounts(variable: { readonly min: number; readonly max: number }): readonly number[] {
    return Array.from({ length: variable.max - variable.min + 1 }, (_, i) => variable.min + i);
  }

  ngOnDestroy(): void {
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
  }

  heroDisplayName(hero: Hero): string {
    return displayHeroName(hero);
  }

  countFilledHeroes(form: EditableImportFormation): number {
    return form.heroes.filter((h) => h.heroId !== null).length;
  }

  substituteOptionLabel(sub: EditableSubstituteTeam): string {
    const names = sub.heroSlots.map((s) => s.primaryName).join(', ');
    return `${sub.label}: ${names} (${sub.petName || 'No pet'})`;
  }

  maxPetLevel(petId: number | null): number {
    const pet = this.pets().find((p) => p.id === petId);
    return petMaxLevel(pet?.kind);
  }

  selectFormationTab(index: number): void {
    this.activeFormationIndex.set(index);
    this.selectedSubstituteIndex.set(0);
  }

  onFileSelected(event: Event): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    const file = input.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      this.statusMessage.set('Please select a valid image file.');
      return;
    }
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = URL.createObjectURL(file);
    this.currentFileName = file.name;
    this.pendingAnalyzeAfterLoad = true;
    this.imageUrl.set(this.objectUrl);
    this.statusMessage.set(`Loaded ${file.name}. Analyzing mode, lineup, and slot alternatives…`);
  }

  onImageElementLoaded(): void {
    if (this.pendingAnalyzeAfterLoad) {
      this.pendingAnalyzeAfterLoad = false;
      void this.analyzeUploadedImage();
    }
  }

  async analyzeSampleGuide(samplePath: string): Promise<void> {
    if (this.analyzing()) return;
    this.analyzing.set(true);
    this.currentFileName = samplePath;
    this.statusMessage.set(`Analyzing sample guide "${samplePath}"…`);
    try {
      const endpoints = ['/api/recognize-sample', 'http://127.0.0.1:8174/api/recognize-sample'];
      for (const url of endpoints) {
        try {
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: samplePath }),
          });
          if (res.ok) {
            const data = await res.json();
            if (data?.ok) {
              this.applyRecognitionResponse(data);
              return;
            }
          }
        } catch {
          // Try next endpoint or built-in sample profile
        }
      }
      this.applyBuiltInSampleRecognition(samplePath);
    } finally {
      this.analyzing.set(false);
    }
  }

  async analyzeUploadedImage(): Promise<void> {
    const imgEl = this.uploadedImg()?.nativeElement;
    if (!imgEl || this.analyzing()) return;
    this.analyzing.set(true);
    this.statusMessage.set('Running mode, lineup, and visual template recognition…');
    try {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, imgEl.naturalWidth || imgEl.width || 1200);
      canvas.height = Math.max(1, imgEl.naturalHeight || imgEl.height || 800);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(imgEl, 0, 0);
        const dataUrl = canvas.toDataURL('image/png');
        const endpoints = ['/api/recognize-lineup', 'http://127.0.0.1:8174/api/recognize-lineup'];
        for (const url of endpoints) {
          try {
            const res = await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ image_base64: dataUrl }),
            });
            if (res.ok) {
              const data = await res.json();
              if (data?.ok) {
                this.applyRecognitionResponse(data);
                return;
              }
            }
          } catch {
            // Try next endpoint or built-in fallback
          }
        }
      }
      this.applyBuiltInSampleRecognition(this.currentFileName, imgEl.naturalWidth, imgEl.naturalHeight);
    } finally {
      this.analyzing.set(false);
    }
  }

  onModeSelect(modeSlug: string): void {
    this.saveCurrentEditsToRaw();
    this.userManuallyOverrodeMode = true;
    this.selectedModeSlug.set(modeSlug);
    const mode = this.store.modes().find((m) => m.slug === modeSlug);
    if (mode) {
      if (mode.targets.length && !mode.targets.includes(this.selectedTargetName())) {
        const nextTarget =
          modeSlug === 'nightmare-corridor' && mode.targets.includes('Infernal Overlord')
            ? 'Infernal Overlord'
            : mode.targets[0];
        this.selectedTargetName.set(nextTarget);
      }
      if (mode.variable) {
        const detectedCount = this.rawExtractedFormations.filter((f) => this.countFilledHeroes(f) > 0).length;
        const defaultCount = mode.variable.default ?? mode.variable.max;
        this.teamCount.set(Math.min(mode.variable.max, Math.max(defaultCount, detectedCount)));
      }
    }
    this.syncFormationsToModeAndTarget(true);
  }

  onTargetSelect(targetName: string): void {
    this.saveCurrentEditsToRaw();
    this.userManuallyOverrodeMode = true;
    this.selectedTargetName.set(targetName);
    this.syncFormationsToModeAndTarget(true);
  }

  onTeamCountChange(count: number): void {
    const variable = this.currentModeConfig().variable;
    if (!variable) return;
    this.saveCurrentEditsToRaw();
    const clamped = Math.max(variable.min, Math.min(variable.max, Math.trunc(count) || variable.default || variable.max));
    this.teamCount.set(clamped);
    this.syncFormationsToModeAndTarget(true);
  }

  applyModeCandidate(candidate: RecognizedModeCandidate, isManual = true): void {
    if (isManual) {
      this.saveCurrentEditsToRaw();
      this.userManuallyOverrodeMode = false;
    }
    this.selectedModeSlug.set(candidate.mode_slug);
    const mode = this.store.modes().find((m) => m.slug === candidate.mode_slug);
    const matchedTarget =
      mode?.targets.find((t) => t.toLowerCase() === candidate.target_name.toLowerCase()) ??
      mode?.targets[0] ??
      candidate.target_name;
    this.selectedTargetName.set(matchedTarget);
    if (mode?.variable) {
      const detectedCount = this.rawExtractedFormations.filter((f) => this.countFilledHeroes(f) > 0).length;
      const defaultCount = mode.variable.default ?? mode.variable.max;
      this.teamCount.set(Math.min(mode.variable.max, Math.max(defaultCount, detectedCount)));
    }
    this.syncFormationsToModeAndTarget(isManual);
  }

  applyLineupCandidateMode(lineup: RecognizedLineupCandidate): void {
    this.applyModeCandidate({
      mode_slug: lineup.mode_slug,
      mode_name: lineup.mode_name,
      target_slug: lineup.target_slug,
      target_name: lineup.target_name,
      confidence: lineup.similarity,
    }, true);
  }

  private createEmptyHeroSlot(slotIndex: number): EditableHeroSlot {
    return {
      slotIndex,
      heroId: null,
      heroName: '',
      slug: '',
      confidence: 1,
      needsReview: false,
      guideAlternatives: [],
      visualAlternatives: [],
      collectionId: null,
      collectionLevel: 1,
      collectionNodes: [],
      collectionAlternatives: [],
      nodeAlternatives: [],
      investmentCode: '',
      merc: false,
    };
  }

  private createEmptyImportFormation(round: number, key: string, label: string): EditableImportFormation {
    return {
      round,
      key,
      label,
      petId: null,
      petName: '',
      petLevel: null,
      petConfidence: 1,
      petGuideOptions: [],
      petVisualAlternatives: [],
      heroes: Array.from({ length: 5 }, (_, sIdx) => this.createEmptyHeroSlot(sIdx)),
      substituteTeams: [],
    };
  }

  private expectedFormationsForMode(mode: ModeConfig, target: string): readonly { readonly key: string; readonly label: string }[] {
    if (mode.variable) {
      const count = Math.max(mode.variable.min, Math.min(mode.variable.max, this.teamCount()));
      return Array.from({ length: count }, (_, idx) => ({
        key: `t${idx + 1}`,
        label: `Team ${idx + 1}`,
      }));
    }
    return mode.targetFormations?.[target] ?? mode.formations ?? [{ key: 'team-1', label: 'Team 1' }];
  }

  private saveCurrentEditsToRaw(): void {
    const current = this.formations();
    if (!current.length) return;
    const nextRaw = [...this.rawExtractedFormations];
    for (let i = 0; i < current.length; i++) {
      nextRaw[i] = current[i];
    }
    this.rawExtractedFormations = nextRaw;
  }

  private syncFormationsToModeAndTarget(announceStatus = false): void {
    const mode = this.currentModeConfig();
    const target = this.selectedTargetName();
    const expected = this.expectedFormationsForMode(mode, target);
    const allowMerc = this.allowsMercenary();

    const nextFormations: EditableImportFormation[] = expected.map((exp, idx) => {
      const source = this.rawExtractedFormations[idx];
      if (!source) {
        return this.createEmptyImportFormation(idx + 1, exp.key, exp.label);
      }
      return {
        ...source,
        round: idx + 1,
        key: exp.key,
        label: exp.label,
        heroes: source.heroes.map((slot) => ({
          ...slot,
          merc: allowMerc ? slot.merc : false,
        })),
      };
    });

    this.formations.set(nextFormations);
    if (this.activeFormationIndex() >= nextFormations.length) {
      this.activeFormationIndex.set(Math.max(0, nextFormations.length - 1));
    }
    this.selectedSubstituteIndex.set(0);

    // Update bestLineupMatch, round alignments, and alternatives for the active mode & target
    this.updateLineupMatchesForMode(mode.slug, target, nextFormations);

    if (announceStatus) {
      const filledTeams = nextFormations.filter((f) => this.countFilledHeroes(f) > 0).length;
      const totalHeroes = nextFormations.reduce((sum, f) => sum + this.countFilledHeroes(f), 0);
      this.statusMessage.set(
        `Switched to ${mode.name} (${target}) — ${nextFormations.length} formation(s) (${nextFormations.map((f) => f.label).join(', ')}; ${filledTeams} populated, ${totalHeroes} heroes).`,
      );
    }
  }

  updateActiveFormationLabel(label: string): void {
    const idx = this.activeFormationIndex();
    this.formations.update((forms) =>
      forms.map((f, i) => (i === idx ? { ...f, label } : f)),
    );
  }

  updateActivePetByName(petName: string): void {
    const idx = this.activeFormationIndex();
    const pet = this.resolvePet(petName);
    this.formations.update((forms) =>
      forms.map((f, i) =>
        i === idx
          ? {
              ...f,
              petId: pet?.id ?? null,
              petName: pet?.name ?? '',
              petLevel: pet ? petMaxLevel(pet.kind) : null,
            }
          : f,
      ),
    );
  }

  updateActivePetLevel(level: number): void {
    const idx = this.activeFormationIndex();
    this.formations.update((forms) =>
      forms.map((f, i) => {
        if (i !== idx || f.petId === null) return f;
        const clamped = Math.max(1, Math.min(this.maxPetLevel(f.petId), Math.trunc(level) || 18));
        return { ...f, petLevel: clamped };
      }),
    );
  }

  applySubstituteTeamToActiveRound(subIndex: number): void {
    const form = this.activeFormation();
    if (!form) return;
    const sub = form.substituteTeams[subIndex];
    if (!sub) return;
    const fIdx = this.activeFormationIndex();
    const pet = this.resolvePet(sub.petName);
    this.formations.update((forms) =>
      forms.map((f, i) => {
        if (i !== fIdx) return f;
        const updatedHeroes = f.heroes.map((slot, sIdx) => {
          const subSlot = sub.heroSlots[sIdx];
          if (!subSlot) return slot;
          const hero = this.resolveHero(subSlot.primaryName);
          const resolvedName = hero ? displayHeroName(hero) : subSlot.primaryName;
          const hClass = hero ? this.heroClassFor(hero) : null;
          let collectionId = slot.collectionId;
          let collectionLevel = slot.collectionLevel;
          let collectionNodes = slot.collectionNodes;
          if (hero && collectionId === null) {
            const classDefault =
              (hClass ? this.collections.find((c) => c.class.toLowerCase() === hClass.toLowerCase()) : null) ??
              this.collections[0];
            if (classDefault) {
              collectionId = classDefault.id;
              collectionLevel = 1;
              collectionNodes = [];
            }
          }
          const collectionSnapshot =
            slot.collectionSnapshot ??
            this.buildCollectionSnapshot(
              collectionId,
              collectionLevel,
              collectionNodes,
              hClass,
            );
          return {
            ...slot,
            heroId: hero?.id ?? null,
            heroName: resolvedName,
            slug: this.toSlug(resolvedName),
            guideAlternatives: subSlot.options.slice(1),
            collectionId,
            collectionLevel,
            collectionNodes,
            collectionSnapshot,
            needsReview: false,
          };
        });
        return {
          ...f,
          petId: pet?.id ?? f.petId,
          petName: pet?.name ?? f.petName,
          petLevel: pet ? petMaxLevel(pet.kind) : f.petLevel,
          petGuideOptions: sub.petOptions,
          heroes: updatedHeroes,
        };
      }),
    );
    this.statusMessage.set(`Applied ${sub.label} to ${form.label}.`);
  }

  updateSlotHeroByName(slotIndex: number, heroNameOrSlug: string): void {
    const fIdx = this.activeFormationIndex();
    const hero = this.resolveHero(heroNameOrSlug);
    this.formations.update((forms) =>
      forms.map((f, i) => {
        if (i !== fIdx) return f;
        return {
          ...f,
          heroes: f.heroes.map((s, idx) => {
            if (idx !== slotIndex) return s;
            const resolvedName = hero ? displayHeroName(hero) : '';
            const hClass = hero ? this.heroClassFor(hero) : null;
            const currentColl = this.collections.find((c) => c.id === s.collectionId);
            const classMismatch = currentColl && hClass && currentColl.class.toLowerCase() !== hClass.toLowerCase();
            let collectionId = classMismatch ? null : s.collectionId;
            let collectionLevel = classMismatch ? 1 : s.collectionLevel;
            let collectionNodes = classMismatch ? [] : s.collectionNodes;
            if (hero && collectionId === null) {
              const classDefault =
                (hClass ? this.collections.find((c) => c.class.toLowerCase() === hClass.toLowerCase()) : null) ??
                this.collections[0];
              if (classDefault) {
                collectionId = classDefault.id;
                collectionLevel = 1;
                collectionNodes = [];
              }
            }
            const collectionSnapshot =
              (!classMismatch && s.collectionSnapshot) ||
              this.buildCollectionSnapshot(
                collectionId,
                collectionLevel,
                collectionNodes,
                hClass,
              );
            const ascension = hero
              ? (defaultAscensionForInvestment(parseInvestment(s.investmentCode)) ??
                 this.heroIcons.lowestAscensionFor(resolvedName))
              : null;
            return {
              ...s,
              heroId: hero?.id ?? null,
              heroName: resolvedName,
              slug: hero ? this.toSlug(resolvedName) : '',
              collectionId,
              collectionLevel,
              collectionNodes,
              collectionSnapshot,
              ascension: s.ascension ?? ascension,
              needsReview: false,
            };
          }),
        };
      }),
    );
  }

  updateSlotCollection(slotIndex: number, collectionIdRaw: string, levelOverride?: number): void {
    const fIdx = this.activeFormationIndex();
    const parsedId = Number.parseInt(collectionIdRaw, 10);
    const collectionId = Number.isInteger(parsedId) ? parsedId : null;
    this.formations.update((forms) =>
      forms.map((f, i) =>
        i === fIdx
          ? {
              ...f,
              heroes: f.heroes.map((s, idx) => {
                if (idx !== slotIndex) return s;
                const hero = s.heroId !== null ? this.heroFor(s.heroId) : null;
                const hClass = hero ? this.heroClassFor(hero) : null;
                const collectionLevel = levelOverride ?? s.collectionLevel;
                const collectionSnapshot = this.buildCollectionSnapshot(
                  collectionId,
                  collectionLevel,
                  s.collectionNodes,
                  hClass,
                );
                return {
                  ...s,
                  collectionId,
                  collectionLevel,
                  collectionSnapshot,
                };
              }),
            }
          : f,
      ),
    );
  }

  updateSlotCollectionLevel(slotIndex: number, level: number): void {
    const fIdx = this.activeFormationIndex();
    const clamped = Math.max(1, Math.min(3, Math.trunc(level) || 1));
    this.formations.update((forms) =>
      forms.map((f, i) =>
        i === fIdx
          ? {
              ...f,
              heroes: f.heroes.map((s, idx) =>
                idx === slotIndex ? { ...s, collectionLevel: clamped } : s,
              ),
            }
          : f,
      ),
    );
  }

  addSlotNodeStat(slotIndex: number, stat: string): void {
    const trimmed = stat.trim().toLowerCase();
    if (!trimmed) return;
    const fIdx = this.activeFormationIndex();
    this.formations.update((forms) =>
      forms.map((f, i) =>
        i === fIdx
          ? {
              ...f,
              heroes: f.heroes.map((s, idx) =>
                idx === slotIndex
                  ? { ...s, collectionNodes: [...s.collectionNodes, trimmed] }
                  : s,
              ),
            }
          : f,
      ),
    );
  }

  removeSlotNodeStat(slotIndex: number, nodeIndex: number): void {
    const fIdx = this.activeFormationIndex();
    this.formations.update((forms) =>
      forms.map((f, i) =>
        i === fIdx
          ? {
              ...f,
              heroes: f.heroes.map((s, idx) =>
                idx === slotIndex
                  ? {
                      ...s,
                      collectionNodes: s.collectionNodes.filter((_, nIdx) => nIdx !== nodeIndex),
                    }
                  : s,
              ),
            }
          : f,
      ),
    );
  }

  heroFor(id: number): Hero {
    const hero = this.heroes().find((entry) => entry.id === id);
    if (!hero) throw new Error(`Unknown hero id: ${id}`);
    return hero;
  }

  petFor(id: number): Pet {
    const pet = this.pets().find((entry) => entry.id === id);
    if (!pet) throw new Error(`Unknown pet id: ${id}`);
    return pet;
  }

  ascensionOfSlot(slot: EditableHeroSlot): AscensionRank | null {
    if (slot.heroId === null) return null;
    const hero = this.heroes().find((h) => h.id === slot.heroId);
    const parsedInv = parseInvestment(slot.investmentCode);
    return (
      slot.ascension ??
      (parsedInv ? defaultAscensionForInvestment(parsedInv) : null) ??
      (hero ? this.heroIcons.lowestAscensionFor(displayHeroName(hero)) : null)
    );
  }

  openSlot(index: number): void {
    this.editingSlot.set({ index });
  }

  closeSlot(): void {
    this.editingSlot.set(null);
  }

  openPetModal(): void {
    this.petModalOpen.set(true);
  }

  closePetModal(): void {
    this.petModalOpen.set(false);
  }

  pickHero(heroId: number, slotIndex: number): void {
    const hero = this.heroFor(heroId);
    this.updateSlotHeroByName(slotIndex, displayHeroName(hero));
  }

  clearSlot(slotIndex: number): void {
    this.updateSlotHeroByName(slotIndex, '');
  }

  clearPet(): void {
    this.updateActivePetByName('');
  }

  updateActivePetSelection(selection: DraftPetSelection): void {
    if (selection.petId === null) {
      this.clearPet();
    } else {
      const pet = this.petFor(selection.petId);
      this.updateActivePetByName(pet.name);
      if (selection.level !== null) {
        this.updateActivePetLevel(selection.level);
      }
    }
    this.petModalOpen.set(false);
  }

  updateSlotInvestment(slotIndex: number, investment: Investment | string | null): void {
    const fIdx = this.activeFormationIndex();
    const investmentCode =
      typeof investment === 'string'
        ? investment
        : investment
          ? formatInvestment(investment)
          : '';
    this.formations.update((forms) =>
      forms.map((f, i) =>
        i === fIdx
          ? {
              ...f,
              heroes: f.heroes.map((s, idx) =>
                idx === slotIndex ? { ...s, investmentCode } : s,
              ),
            }
          : f,
      ),
    );
  }

  updateSlotAscension(slotIndex: number, ascension: AscensionRank | null): void {
    const fIdx = this.activeFormationIndex();
    this.formations.update((forms) =>
      forms.map((f, i) =>
        i === fIdx
          ? {
              ...f,
              heroes: f.heroes.map((s, idx) =>
                idx === slotIndex ? { ...s, ascension } : s,
              ),
            }
          : f,
      ),
    );
  }

  buildCollectionSnapshot(
    collectionId: number | null,
    level = 1,
    nodes: readonly (string | CollectionNode)[] = [],
    heroClass?: string | null,
    preferredName?: string | null,
  ): CollectionSnapshot | null {
    if (collectionId === null && !preferredName) return null;
    const catalogItem =
      (preferredName ? this.collections.find((c) => c.name.toLowerCase() === preferredName.toLowerCase()) : null) ??
      (collectionId !== null ? this.collections.find((c) => c.id === collectionId) : null) ??
      (collectionId !== null ? this.store.collectionCatalog().find((c) => c.id === collectionId) : null) ??
      (heroClass ? this.collections.find((c) => c.class.toLowerCase() === heroClass.toLowerCase()) : null) ??
      this.collections[0];
    if (!catalogItem) return null;

    const rawItems: { stat: string; tier: CollectionNodeTier }[] = [];
    for (const item of nodes) {
      if (typeof item === 'string') {
        const cleaned = item.trim().toLowerCase();
        if (cleaned && cleaned !== 'none') {
          const statKey = cleaned === 'tyr' ? 'ty' : cleaned;
          rawItems.push({ stat: statKey, tier: 'mythic' });
        }
      } else if (item && typeof item.stat === 'string') {
        const cleaned = item.stat.trim().toLowerCase();
        if (cleaned && cleaned !== 'none') {
          const statKey = cleaned === 'tyr' ? 'ty' : cleaned;
          rawItems.push({ stat: statKey, tier: item.tier ?? 'mythic' });
        }
      }
    }

    const explicitSkillLevels = rawItems.filter((item) => item.stat === 'skill_level').length;
    const regularItems = rawItems.filter((item) => item.stat !== 'skill_level');
    const requiredSkillLevels = Math.max(explicitSkillLevels, Math.max(0, Math.min(2, level - 1)));

    const collectionNodes: CollectionNode[] = [];
    const occupiedSlots = new Set<number>();

    // In AFK Arena, skill level (+1 Level) nodes go into Flex slots [6, 7]
    for (let lvl = 0; lvl < Math.min(2, requiredSkillLevels); lvl++) {
      const slotIndex = 6 + lvl;
      collectionNodes.push({ slotIndex, stat: 'skill_level', tier: 'mythic' });
      occupiedSlots.add(slotIndex);
    }

    // Place regular stats in category-aligned slots:
    // Attack slots: [0, 1, 2]
    // Defense slots: [3, 4, 5]
    // Flex slots: [6, 7] (used for stats when not occupied by skill_level, or for overflow)
    const attackSlots = [0, 1, 2];
    const defenseSlots = [3, 4, 5];
    const flexSlots = [6, 7];

    for (const { stat, tier } of regularItems) {
      const isAttack = ATTACK_COLLECTION_NODE_STATS.includes(stat as CollectionNodeStat);
      const isDefense = DEFENSE_COLLECTION_NODE_STATS.includes(stat as CollectionNodeStat);

      let targetSlot: number | undefined;
      if (isAttack) {
        targetSlot =
          attackSlots.find((s) => !occupiedSlots.has(s)) ??
          flexSlots.find((s) => !occupiedSlots.has(s)) ??
          defenseSlots.find((s) => !occupiedSlots.has(s));
      } else if (isDefense) {
        targetSlot =
          defenseSlots.find((s) => !occupiedSlots.has(s)) ??
          flexSlots.find((s) => !occupiedSlots.has(s)) ??
          attackSlots.find((s) => !occupiedSlots.has(s));
      } else {
        targetSlot =
          attackSlots.find((s) => !occupiedSlots.has(s)) ??
          defenseSlots.find((s) => !occupiedSlots.has(s)) ??
          flexSlots.find((s) => !occupiedSlots.has(s));
      }

      if (targetSlot !== undefined) {
        occupiedSlots.add(targetSlot);
        collectionNodes.push({ slotIndex: targetSlot, stat, tier });
      }
    }

    collectionNodes.sort((a, b) => a.slotIndex - b.slotIndex);
    return {
      catalogId: catalogItem.id,
      name: catalogItem.name,
      class: catalogItem.class,
      nodes: collectionNodes,
    };
  }

  defaultCatalogIdForHero(heroId: number | null): number {
    const list = this.catalogForHero(heroId);
    return list.length ? list[0].id : (this.store.collectionCatalog()[0]?.id ?? 1);
  }

  classOfHero(heroId: number | null): string | null {
    if (heroId === null) return null;
    const hero = this.heroFor(heroId);
    return hero.class ?? this.heroIcons.classFor(displayHeroName(hero));
  }

  private sameClass(itemClass: string | null | undefined, heroClass: string | null): boolean {
    return !!heroClass && itemClass?.toLowerCase() === heroClass.toLowerCase();
  }

  collectionsForHero(heroId: number | null) {
    const heroClass = this.classOfHero(heroId);
    const collections = this.store.collections();
    const filtered = heroClass ? collections.filter((c) => this.sameClass(c.class, heroClass)) : [];
    return filtered.length ? filtered : collections;
  }

  catalogForHero(heroId: number | null): readonly CollectionCatalogItem[] {
    const heroClass = this.classOfHero(heroId);
    const catalog = this.store.collectionCatalog().length ? this.store.collectionCatalog() : this.collections;
    const filtered = heroClass ? catalog.filter((item) => this.sameClass(item.class, heroClass)) : [];
    return filtered.length ? filtered : catalog;
  }

  startCustomCollection(slotIndex: number): void {
    const form = this.activeFormation();
    if (!form) return;
    const slot = form.heroes[slotIndex];
    if (!slot || slot.heroId === null || slot.collectionSnapshot) return;
    const catalogItem = this.catalogForHero(slot.heroId)[0] ?? this.store.collectionCatalog()[0];
    if (!catalogItem) return;
    const snapshot: CollectionSnapshot = {
      catalogId: catalogItem.id,
      name: catalogItem.name,
      class: catalogItem.class,
      nodes: [],
    };
    this.updateSlotFormation(slotIndex, (s) => ({
      ...s,
      collectionId: catalogItem.id,
      collectionSnapshot: snapshot,
    }));
  }

  useRosterCollection(slotIndex: number): void {
    const form = this.activeFormation();
    if (!form) return;
    const slot = form.heroes[slotIndex];
    if (!slot || slot.heroId === null) return;
    const collection = this.collectionsForHero(slot.heroId)[0];
    if (collection) {
      this.updateSlotFormation(slotIndex, (s) => ({
        ...s,
        collectionId: collection.catalogId ?? null,
        collectionSnapshot: {
          catalogId: collection.catalogId,
          name: collection.name,
          class: collection.class,
          nodes: collection.nodes,
        },
      }));
    }
  }

  clearSlotCollection(slotIndex: number): void {
    this.updateSlotFormation(slotIndex, (s) => ({
      ...s,
      collectionId: null,
      collectionSnapshot: null,
    }));
  }

  setSlotCollectionRecommendationMode(slotIndex: number, enabled: boolean): void {
    this.updateSlotFormation(slotIndex, (s) => {
      if (!s.collectionSnapshot) return s;
      const snapshot: CollectionSnapshot = enabled
        ? {
            ...s.collectionSnapshot,
            nodes: [],
            recommendation: s.collectionSnapshot.recommendation ?? {
              level: 1,
              attackStats: [],
              defenseStats: [],
            },
          }
        : {
            ...s.collectionSnapshot,
            nodes: [],
            recommendation: undefined,
          };
      return { ...s, collectionSnapshot: snapshot };
    });
  }

  updateSlotCollectionCatalogId(slotIndex: number, catalogId: number): void {
    this.updateSlotFormation(slotIndex, (s) => {
      const catalogItem = this.store.collectionCatalog().find((c) => c.id === catalogId);
      if (!catalogItem || !s.collectionSnapshot) return s;
      return {
        ...s,
        collectionId: catalogId,
        collectionSnapshot: {
          ...s.collectionSnapshot,
          catalogId,
          name: catalogItem.name,
          class: catalogItem.class,
        },
      };
    });
  }

  updateSlotCollectionNodes(slotIndex: number, nodes: readonly CollectionNode[]): void {
    this.updateSlotFormation(slotIndex, (s) => {
      if (!s.collectionSnapshot) return s;
      const skillLevels = nodes.filter((n) => n.stat === 'skill_level').length;
      const statNodes = nodes.filter((n) => n.stat !== 'skill_level').map((n) => n.stat);
      return {
        ...s,
        collectionLevel: skillLevels + 1,
        collectionNodes: statNodes,
        collectionSnapshot: {
          ...s.collectionSnapshot,
          nodes,
        },
      };
    });
  }

  updateSlotCollectionRecommendation(slotIndex: number, recommendation: any): void {
    this.updateSlotFormation(slotIndex, (s) => {
      if (!s.collectionSnapshot) return s;
      return {
        ...s,
        collectionSnapshot: {
          ...s.collectionSnapshot,
          recommendation,
        },
      };
    });
  }

  private updateSlotFormation(slotIndex: number, updater: (slot: EditableHeroSlot) => EditableHeroSlot): void {
    const fIdx = this.activeFormationIndex();
    this.formations.update((forms) =>
      forms.map((f, i) =>
        i === fIdx
          ? {
              ...f,
              heroes: f.heroes.map((s, idx) => (idx === slotIndex ? updater(s) : s)),
            }
          : f,
      ),
    );
  }

  updateSlotMerc(slotIndex: number, merc: boolean): void {
    const fIdx = this.activeFormationIndex();
    this.formations.update((forms) =>
      forms.map((f, i) =>
        i === fIdx
          ? {
              ...f,
              heroes: f.heroes.map((s, idx) =>
                idx === slotIndex ? { ...s, merc } : s,
              ),
            }
          : f,
      ),
    );
  }

  collectionsForHeroSlot(slot: EditableHeroSlot): readonly CollectionCatalogItem[] {
    if (slot.heroId === null) return this.collections;
    const hero = this.heroes().find((h) => h.id === slot.heroId);
    if (!hero) return this.collections;
    const hClass = this.heroClassFor(hero);
    if (!hClass) return this.collections;
    return this.collections.filter((c) => c.class.toLowerCase() === hClass.toLowerCase());
  }

  async applyToSubmitForm(): Promise<void> {
    const draftFormations: DraftFormation[] = this.formations().map((form) => {
      const slots: DraftSlot[] = Array.from({ length: 5 }, (_, slotIndex) => {
        const slot = form.heroes[slotIndex];
        if (!slot || slot.heroId === null) {
          return {
            hid: null,
            merc: false,
            inv: '',
            ascension: null,
            collectionId: '',
            collectionSnapshot: null,
          };
        }
        const hero = this.heroes().find((h) => h.id === slot.heroId);
        const parsedInv = parseInvestment(slot.investmentCode);
        const ascension =
          slot.ascension ??
          defaultAscensionForInvestment(parsedInv) ??
          (hero ? this.heroIcons.lowestAscensionFor(displayHeroName(hero)) : 'ascended');

        const heroClass = hero ? this.heroClassFor(hero) : null;
        const collectionSnapshot: CollectionSnapshot | null =
          slot.collectionSnapshot ??
          this.buildCollectionSnapshot(slot.collectionId, slot.collectionLevel, slot.collectionNodes, heroClass);

        return {
          hid: slot.heroId,
          merc: slot.merc,
          inv: slot.investmentCode,
          ascension,
          collectionId: '',
          collectionSnapshot,
        };
      });

      return {
        key: form.key,
        label: form.label,
        petId: form.petId,
        petLevel: form.petLevel,
        time: '',
        slots,
      };
    });

    this.store.applyImportedDraft({
      mode: this.selectedModeSlug(),
      target: this.selectedTargetName(),
      notes: this.notes(),
      formations: draftFormations,
    });
    await this.router.navigateByUrl('/submit');
  }

  isCandidateActive(modeSlug: string, targetName: string): boolean {
    if (this.selectedModeSlug() !== modeSlug) return false;
    return this.selectedTargetName().trim().toLowerCase() === targetName.trim().toLowerCase();
  }

  roundAlignmentPrefix(round: number): string {
    return this.selectedModeSlug() === 'treasure-scramble' ? `Team ${round}` : `R${round}`;
  }

  private updateLineupMatchesForMode(
    modeSlug: string,
    target: string,
    formations: readonly EditableImportFormation[],
  ): void {
    const currentMatch = this.bestLineupMatch();
    // If current match belongs to this mode, update its alignments to match the new formation keys/labels
    if (currentMatch && currentMatch.mode_slug === modeSlug) {
      this.bestLineupMatch.set({
        ...currentMatch,
        round_alignments: formations.map((f, idx) => {
          const prev = currentMatch.round_alignments?.[idx];
          return {
            image_round: idx + 1,
            matched_formation_key: f.key,
            matched_formation_label: f.label,
            similarity: prev?.similarity ?? (this.countFilledHeroes(f) > 0 ? 1.0 : 0),
            hero_overlap_count: this.countFilledHeroes(f),
            pet_matched: f.petId !== null,
          };
        }),
      });
      return;
    }

    // Otherwise, find or build the best matching known lineup for the selected mode
    const modeSubs = this.store.submissions().filter((s) => s.mode === modeSlug);
    if (!modeSubs.length) {
      if (modeSlug === 'treasure-scramble') {
        const title = `Treasure Scramble — ${target} (${formations.length} Teams)`;
        this.bestLineupMatch.set({
          id: `ts-${target.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-meta`,
          title,
          mode_slug: 'treasure-scramble',
          mode_name: 'Treasure Scramble',
          target_slug: target.toLowerCase(),
          target_name: target,
          similarity: 1.0,
          round_alignments: formations.map((f, idx) => ({
            image_round: idx + 1,
            matched_formation_key: f.key,
            matched_formation_label: f.label,
            similarity: this.countFilledHeroes(f) > 0 ? 1.0 : 0,
            hero_overlap_count: this.countFilledHeroes(f),
            pet_matched: f.petId !== null,
          })),
        });
      } else {
        this.bestLineupMatch.set(null);
      }
      this.lineupAlternatives.set([]);
      this.reviewSuggestions.set([]);
      return;
    }

    const scored = modeSubs.map((sub) => {
      let totalOverlap = 0;
      let totalSlots = 0;
      const roundAlignments = formations.map((f, fIdx) => {
        const subForm = sub.forms[fIdx];
        if (!subForm) {
          return {
            image_round: fIdx + 1,
            matched_formation_key: f.key,
            matched_formation_label: f.label,
            similarity: 0,
            hero_overlap_count: 0,
            pet_matched: false,
          };
        }
        const subHids = new Set(subForm.heroes.map((h) => h.hid).filter((h): h is number => h !== null));
        const formHids = f.heroes.map((h) => h.heroId).filter((h): h is number => h !== null);
        const overlap = formHids.filter((h) => subHids.has(h)).length;
        totalOverlap += overlap;
        totalSlots += Math.max(1, formHids.length);
        const petMatched = subForm.petId !== null && f.petId !== null && subForm.petId === f.petId;
        return {
          image_round: fIdx + 1,
          matched_formation_key: subForm.key,
          matched_formation_label: subForm.label,
          similarity: formHids.length ? overlap / formHids.length : 0,
          hero_overlap_count: overlap,
          pet_matched: petMatched,
        };
      });
      const sim = totalSlots > 0 ? totalOverlap / totalSlots : 0;
      const mName = this.store.modes().find((m) => m.slug === sub.mode)?.name ?? sub.mode;
      return {
        id: `sub-${sub.id}`,
        title: `${mName} — ${sub.target} (${sub.forms.length} Teams)`,
        mode_slug: sub.mode,
        mode_name: mName,
        target_slug: sub.target.toLowerCase(),
        target_name: sub.target,
        similarity: Math.round(sim * 1000) / 1000,
        round_alignments: roundAlignments,
      };
    });

    scored.sort((a, b) => b.similarity - a.similarity);
    this.bestLineupMatch.set(scored[0] ?? null);
    this.lineupAlternatives.set(scored.slice(1, 4));
    this.reviewSuggestions.set([]);
  }

  inputValue(event: Event): string {
    const el = event.target;
    return el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement
      ? el.value
      : '';
  }

  numberValue(event: Event): number {
    return Number.parseInt(this.inputValue(event), 10) || 0;
  }

  checkboxValue(event: Event): boolean {
    const el = event.target;
    return el instanceof HTMLInputElement && el.checked;
  }

  resetSelect(event: Event): void {
    const el = event.target;
    if (el instanceof HTMLSelectElement) el.value = '';
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  applyRecognitionResponse(data: any): void {
    this.modeAlternatives.set(Array.isArray(data.mode_alternatives) ? data.mode_alternatives : []);
    this.bestLineupMatch.set(data.best_lineup_match ?? null);
    this.lineupAlternatives.set(Array.isArray(data.lineup_alternatives) ? data.lineup_alternatives : []);
    this.reviewSuggestions.set(Array.isArray(data.review_suggestions) ? data.review_suggestions : []);

    const mappedFormations: EditableImportFormation[] = (data.teams ?? []).map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (t: any, idx: number): EditableImportFormation => {
        const petObj = t.pet ?? null;
        const resolvedPet = this.resolvePet(petObj?.slug || petObj?.name || '');
        const petGuideOptions: string[] = (petObj?.options ?? [])
          .map((s: string) => this.resolvePet(s)?.name ?? s)
          .filter(Boolean);
        const petVisualAlternatives = (petObj?.visual_alternatives ?? []).map(
          (a: { name: string; slug: string; confidence?: number }) => ({
            name: this.resolvePet(a.slug || a.name)?.name ?? a.name,
            slug: a.slug,
            confidence: Number(a.confidence ?? 0.5),
          }),
        );

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const heroes: EditableHeroSlot[] = (t.heroes ?? []).map((h: any, sIdx: number): EditableHeroSlot => {
          const hero = this.resolveHero(h.slug || h.name || '');
          const heroName = hero ? displayHeroName(hero) : (h.name || h.slug || '');
          const guideAlternatives: string[] = (h.slot_options ?? [])
            .slice(1)
            .map((s: string) => {
              const found = this.resolveHero(s);
              return found ? displayHeroName(found) : s;
            });
          const visualAlternatives = (h.visual_alternatives ?? []).map(
            (a: { name: string; slug: string; confidence?: number }) => {
              const found = this.resolveHero(a.slug || a.name);
              return {
                name: found ? displayHeroName(found) : a.name,
                slug: a.slug,
                confidence: Number(a.confidence ?? 0.5),
              };
            },
          );
          const coll = h.collection ?? null;
          const byCollName =
            typeof coll?.name === 'string'
              ? this.collections.find((c) => c.name.toLowerCase() === coll.name.toLowerCase())
              : undefined;
          let collectionId =
            byCollName?.id ?? (typeof coll?.catalog === 'number' ? coll.catalog : null);
          const collectionLevel = typeof coll?.level === 'number' ? coll.level : 1;
          const collectionNodes: string[] = (coll?.nodes ?? []).map((n: { stat: string }) => n.stat);
          const hClass = hero ? this.heroClassFor(hero) : null;
          if (collectionId === null && hero) {
            const classDefault =
              (hClass ? this.collections.find((c) => c.class.toLowerCase() === hClass.toLowerCase()) : null) ??
              this.collections[0];
            if (classDefault) collectionId = classDefault.id;
          }
          const collectionSnapshot = this.buildCollectionSnapshot(
            collectionId,
            collectionLevel,
            collectionNodes,
            hClass,
            coll?.name,
          );
          const collectionAlternatives = (coll?.visual_alternatives ?? []).map(
            (c: { id: number; name: string; level?: number }) => ({
              id: c.id,
              name: c.name,
              level: c.level ?? 1,
            }),
          );
          const nodeAlternatives: string[] = [
            ...new Set<string>(
              (coll?.nodes ?? []).flatMap((n: { visual_alternatives?: { stat: string }[] }) =>
                (n.visual_alternatives ?? []).map((a) => a.stat),
              ),
            ),
          ];

          return {
            slotIndex: sIdx,
            heroId: hero?.id ?? null,
            heroName,
            slug: h.slug || this.toSlug(heroName),
            confidence: Number(h.confidence ?? 0.9),
            needsReview: Boolean(h.needs_review),
            guideAlternatives,
            visualAlternatives,
            collectionId,
            collectionLevel,
            collectionNodes,
            collectionAlternatives,
            nodeAlternatives,
            collectionSnapshot,
            investmentCode: '',
            merc: false,
          };
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const substituteTeams: EditableSubstituteTeam[] = (t.substitute_teams ?? []).map((sub: any, subIdx: number) => ({
          subIndex: subIdx + 1,
          label: `Substitute #${(sub.row_index ?? subIdx + 2) - 1}`,
          petName: this.resolvePet(sub.pet || sub.pet_name || '')?.name ?? (sub.pet_name || sub.pet || ''),
          petOptions: (sub.pet_options ?? [sub.pet])
            .filter(Boolean)
            .map((pSlug: string) => this.resolvePet(pSlug)?.name ?? pSlug),
          heroSlots: (sub.hero_slots ?? []).map((hs: { primary_slug: string; options?: string[] }) => {
            const opts = (hs.options ?? [hs.primary_slug]).map((slug) => {
              const found = this.resolveHero(slug);
              return found ? displayHeroName(found) : slug;
            });
            return {
              primaryName: opts[0] ?? '',
              options: opts,
            };
          }),
        }));

        return {
          round: t.round ?? idx + 1,
          key: t.matched_formation_key || `round-${t.round ?? idx + 1}`,
          label: t.matched_formation_label || `Round ${t.round ?? idx + 1}`,
          petId: resolvedPet?.id ?? null,
          petName: resolvedPet?.name ?? '',
          petLevel: resolvedPet ? petMaxLevel(resolvedPet.kind) : null,
          petConfidence: Number(petObj?.confidence ?? 0.9),
          petGuideOptions,
          petVisualAlternatives,
          heroes,
          substituteTeams,
        };
      },
    );

    this.rawExtractedFormations = mappedFormations;
    if (data.best_mode) {
      this.bestMode.set(data.best_mode);
      if (!this.userManuallyOverrodeMode) {
        this.applyModeCandidate(data.best_mode, false);
      } else {
        const mode = this.currentModeConfig();
        if (mode.variable) {
          const detectedCount = mappedFormations.filter((f) => this.countFilledHeroes(f) > 0).length;
          const defaultCount = mode.variable.default ?? mode.variable.max;
          this.teamCount.set(Math.min(mode.variable.max, Math.max(defaultCount, detectedCount)));
        }
        this.syncFormationsToModeAndTarget(false);
      }
    } else {
      this.syncFormationsToModeAndTarget(false);
    }
    this.activeFormationIndex.set(0);
    this.selectedSubstituteIndex.set(0);
    const totalHeroes = mappedFormations.reduce((sum, f) => sum + this.countFilledHeroes(f), 0);
    const subCount = mappedFormations.reduce((sum, f) => sum + f.substituteTeams.length, 0);
    const activeForms = this.formations();
    this.statusMessage.set(
      `Recognized ${mappedFormations.length} team(s) (${totalHeroes} heroes) and ${subCount} substitute team(s), mapped to ${this.currentModeConfig().name} (${this.selectedTargetName()}: ${activeForms.length} formation(s)). Review or adjust any slot below, then click "Use lineup in submit form".`,
    );
  }

  applyBuiltInSampleRecognition(sampleKeyOrName: string, width = 2040, height = 2082): void {
    const key = sampleKeyOrName.toLowerCase();
    const isYxq = key.includes('yxq') || key.includes('scramble') || key.includes('ts-') || key.includes('7-team');
    if (isYxq) {
      const ts7Teams = [
        {
          round: 1,
          matched_formation_key: 't1',
          matched_formation_label: 'Team 1',
          pet: null,
          heroes: [
            { slug: 'highborn-leviathan', name: 'Leviathan (Highborn)', confidence: 0.51, collection: { catalog: 12, name: 'Horn of Dominion', level: 3, nodes: [{ stat: 'is' }] } },
            { slug: 'misfortis', name: 'Misfortis', confidence: 0.80, collection: { catalog: 3, name: 'Timeline Watch', level: 1, nodes: [{ stat: 'hp' }] } },
            { slug: 'dracula', name: 'Dracula', confidence: 0.73, collection: { catalog: 14, name: "Stormwrath's Lull", level: 1, nodes: [{ stat: 'full_atk' }] } },
            { slug: 'awakened-hybris', name: 'Hybris (Awakened)', confidence: 0.76, collection: { catalog: 1, name: 'Temporal Cover', level: 2, nodes: [{ stat: 'atk' }] } },
            { slug: 'velufira', name: 'Velufira', confidence: 0.69, collection: { catalog: 10, name: 'Luminous Flight', level: 1, nodes: [{ stat: 'is' }] } },
          ],
          substitute_teams: [],
        },
        {
          round: 2,
          matched_formation_key: 't2',
          matched_formation_label: 'Team 2',
          pet: null,
          heroes: [
            { slug: 'awakened-maetria', name: 'Maetria (Awakened)', confidence: 0.91, collection: { catalog: 7, name: 'Captive Wings', level: 3, nodes: [{ stat: 'atk' }, { stat: 'is' }] } },
            { slug: 'kikoru-shinomiya', name: 'Kikoru Shinomiya', confidence: 0.88, collection: { catalog: 1, name: 'Temporal Cover', level: 2, nodes: [{ stat: 'full_atk' }] } },
            { slug: 'shalltear-bloodfallen', name: 'Shalltear Bloodfallen', confidence: 0.87, collection: { catalog: 1, name: 'Temporal Cover', level: 2, nodes: [{ stat: 'atk' }, { stat: 'full_atk' }] } },
            { slug: 'flora', name: 'Flora', confidence: 0.75, collection: { catalog: 14, name: "Stormwrath's Lull", level: 1, nodes: [{ stat: 'full_atk' }] } },
            { slug: 'kafka-hibino', name: 'Kafka Hibino', confidence: 0.80, collection: { catalog: 3, name: 'Timeline Watch', level: 1, nodes: [{ stat: 'hp' }] } },
          ],
          substitute_teams: [],
        },
        {
          round: 3,
          matched_formation_key: 't3',
          matched_formation_label: 'Team 3',
          pet: null,
          heroes: [
            { slug: 'awakened-shemira', name: 'Shemira (Awakened)', confidence: 0.70, collection: { catalog: 3, name: 'Timeline Watch', level: 2, nodes: [{ stat: 'hp' }, { stat: 'mp' }] } },
            { slug: 'harvey', name: 'Harvey', confidence: 0.68, collection: { catalog: 3, name: 'Timeline Watch', level: 1, nodes: [{ stat: 'full_atk' }] } },
            { slug: 'sung-jinwoo', name: 'Sung Jinwoo', confidence: 0.86, collection: { catalog: 18, name: 'Demon Sealer', level: 3, nodes: [{ stat: 'cda' }, { stat: 'atk' }] } },
            { slug: 'awakened-envydiel', name: 'Envydiel (Awakened)', confidence: 0.59, collection: { catalog: 18, name: 'Demon Sealer', level: 3, nodes: [{ stat: 'cda' }, { stat: 'atk' }] } },
            { slug: 'awakened-gavus', name: 'Gavus (Awakened)', confidence: 0.86, collection: { catalog: 7, name: 'Captive Wings', level: 3, nodes: [{ stat: 'full_atk' }] } },
          ],
          substitute_teams: [],
        },
        {
          round: 4,
          matched_formation_key: 't4',
          matched_formation_label: 'Team 4',
          pet: null,
          heroes: [
            { slug: 'saitama', name: 'Saitama', confidence: 0.66, collection: { catalog: 1, name: 'Temporal Cover', level: 2, nodes: [{ stat: 'full_atk' }] } },
            { slug: 'highborn-skylan', name: 'Skylan (Highborn)', confidence: 0.62, collection: { catalog: 13, name: 'Shadowflow Blade', level: 3, nodes: [{ stat: 'atk' }, { stat: 'pp' }] } },
            { slug: 'gorok', name: 'Gorok', confidence: 0.76, collection: { catalog: 1, name: 'Temporal Cover', level: 2, nodes: [{ stat: 'full_atk' }] } },
            { slug: 'valeri', name: 'Valeri', confidence: 0.55, collection: { catalog: 3, name: 'Timeline Watch', level: 1, nodes: [{ stat: 'full_atk' }] } },
            { slug: 'awakened-theowyn', name: 'Theowyn (Awakened)', confidence: 0.56, collection: { catalog: 10, name: 'Luminous Flight', level: 1, nodes: [{ stat: 'atk' }] } },
          ],
          substitute_teams: [],
        },
        {
          round: 5,
          matched_formation_key: 't5',
          matched_formation_label: 'Team 5',
          pet: null,
          heroes: [
            { slug: 'awakened-fawkes', name: 'Fawkes (Awakened)', confidence: 0.96, collection: { catalog: 16, name: "Reaper's Talon", level: 1, nodes: [] } },
            { slug: 'alvida', name: 'Alvida', confidence: 0.73, collection: { catalog: 16, name: "Reaper's Talon", level: 2, nodes: [] } },
            { slug: 'awakened-lyca', name: 'Lyca (Awakened)', confidence: 0.63, collection: { catalog: 16, name: "Reaper's Talon", level: 1, nodes: [] } },
            { slug: 'lysander', name: 'Lysander', confidence: 0.72, collection: { catalog: 6, name: 'Sandstorm Fangs', level: 1, nodes: [] } },
            { slug: 'highborn-haelia', name: 'Haelia (Highborn)', confidence: 0.98, collection: { catalog: 16, name: "Reaper's Talon", level: 1, nodes: [] } },
          ],
          substitute_teams: [],
        },
        {
          round: 6,
          matched_formation_key: 't6',
          matched_formation_label: 'Team 6',
          pet: null,
          heroes: [
            { slug: 'awakened-estrilda', name: 'Estrilda (Awakened)', confidence: 0.56, collection: { catalog: 12, name: 'Horn of Dominion', level: 3, nodes: [{ stat: 'hp' }] } },
            { slug: 'highborn-odysseus', name: 'Odysseus (Highborn)', confidence: 0.78, collection: { catalog: 3, name: 'Timeline Watch', level: 1, nodes: [{ stat: 'atk' }] } },
            { slug: 'highborn-thalassa', name: 'Thalassa (Highborn)', confidence: 0.92, collection: { catalog: 10, name: 'Luminous Flight', level: 1, nodes: [{ stat: 'heal' }] } },
            { slug: 'kyno', name: 'Kyno', confidence: 0.65, collection: { catalog: 3, name: 'Timeline Watch', level: 1, nodes: [{ stat: 'full_atk' }, { stat: 'def' }] } },
            { slug: 'highborn-lan', name: 'Lan (Highborn)', confidence: 0.80, collection: { catalog: 10, name: 'Luminous Flight', level: 1, nodes: [{ stat: 'atk' }] } },
          ],
          substitute_teams: [],
        },
        {
          round: 7,
          matched_formation_key: 't7',
          matched_formation_label: 'Team 7',
          pet: null,
          heroes: [
            { slug: 'skreg', name: 'Skreg', confidence: 0.33, collection: { catalog: 1, name: 'Temporal Cover', level: 2, nodes: [{ stat: 'full_atk' }] } },
            { slug: 'athena', name: 'Athena', confidence: 0.76, collection: { catalog: 3, name: 'Timeline Watch', level: 1, nodes: [{ stat: 'ty' }, { stat: 'full_atk' }] } },
            { slug: 'awakened-eluard', name: 'Eluard (Awakened)', confidence: 0.51, collection: { catalog: 14, name: "Stormwrath's Lull", level: 3, nodes: [{ stat: 'atk' }, { stat: 'mp' }] } },
            { slug: 'medusa', name: 'Medusa', confidence: 0.87, collection: { catalog: 18, name: 'Demon Sealer', level: 3, nodes: [{ stat: 'cda' }, { stat: 'full_atk' }] } },
            { slug: 'highborn-elthara', name: 'Elthara (Highborn)', confidence: 0.81, collection: { catalog: 14, name: "Stormwrath's Lull", level: 2, nodes: [{ stat: 'mp' }, { stat: 'erosion' }] } },
          ],
          substitute_teams: [],
        },
      ];

      this.applyRecognitionResponse({
        ok: true,
        best_mode: {
          mode_slug: 'treasure-scramble',
          mode_name: 'Treasure Scramble',
          target_slug: 'fire',
          target_name: 'Fire',
          confidence: 0.985,
          reasons: [
            'Detected 7 distinct 5-hero formations matching Treasure Scramble (2-7 teams).',
            'Multi-team PvP formation structure and collections align with Treasure Scramble 7-team meta.',
          ],
        },
        mode_alternatives: [
          { mode_slug: 'treasure-scramble', mode_name: 'Treasure Scramble', target_slug: 'frost', target_name: 'Frost', confidence: 0.94 },
          { mode_slug: 'treasure-scramble', mode_name: 'Treasure Scramble', target_slug: 'forest', target_name: 'Forest', confidence: 0.85 },
          { mode_slug: 'nightmare-corridor', mode_name: 'Nightmare Corridor', target_slug: 'infernal-overlord', target_name: 'Infernal Overlord', confidence: 0.28 },
          { mode_slug: 'cursed-realm', mode_name: 'Cursed Realm', target_slug: 'ice-shemira', target_name: 'Ice Shemira', confidence: 0.22 },
        ],
        best_lineup_match: {
          id: 'ts-fire-7-teams-meta',
          title: 'Treasure Scramble — Fire Debuff (7-Team Meta Guide)',
          mode_slug: 'treasure-scramble',
          mode_name: 'Treasure Scramble',
          target_slug: 'fire',
          target_name: 'Fire',
          similarity: 1.0,
          round_alignments: ts7Teams.map((t, idx) => ({
            image_round: idx + 1,
            matched_formation_key: `t${idx + 1}`,
            matched_formation_label: `Team ${idx + 1}`,
            similarity: 1.0,
            hero_overlap_count: 5,
            pet_matched: false,
          })),
        },
        lineup_alternatives: [
          { id: 'ts-fire-sample', title: 'Treasure Scramble — Fire Debuff (3 Teams)', mode_slug: 'treasure-scramble', mode_name: 'Treasure Scramble', target_slug: 'fire', target_name: 'Fire', similarity: 0.32 },
          { id: 'ts-frost-sample', title: 'Treasure Scramble — Frost Debuff (2 Teams)', mode_slug: 'treasure-scramble', mode_name: 'Treasure Scramble', target_slug: 'frost', target_name: 'Frost', similarity: 0.25 },
        ],
        review_suggestions: [],
        teams: ts7Teams,
      });
      return;
    }

    const isF2p = key.includes('f2p') || key.includes('nc-round') || (width < 1150 && height > 1200);
    const isRound4Crop = key.includes('round-4');
    const isNcRound3Crop = key.includes('nc-round-3');
    const isLyd = !isYxq && (key.includes('lyd') || (width >= 2400 && height >= 3000));

    const full6Rounds = [
      {
        round: 1,
        matched_formation_key: 'molten-crystalline-worm-queen',
        matched_formation_label: 'Molten Crystalline Worm Queen',
        pet: { slug: 'blazefang', name: 'Blazefang', confidence: 0.96, options: ['blazefang', 'winged-lion'], visual_alternatives: [{ slug: 'blazefang', name: 'Blazefang', confidence: 0.96 }, { slug: 'winged-lion', name: 'Winged Lion', confidence: 0.72 }, { slug: 'bellbellow', name: 'Bellbellow', confidence: 0.65 }] },
        heroes: [
          { slug: 'marcille', name: 'Marcille', confidence: 0.97, slot_options: ['marcille', 'rem'], visual_alternatives: [{ slug: 'marcille', name: 'Marcille', confidence: 0.97 }, { slug: 'shuna', name: 'Shuna', confidence: 0.68 }], collection: { catalog: 10, name: 'Captive Wings', level: 3, nodes: [{ stat: 'erosion' }, { stat: 'mp' }], visual_alternatives: [{ id: 10, name: 'Captive Wings', level: 3 }, { id: 11, name: "Storm's Calling", level: 2 }] } },
          { slug: 'laios', name: 'Laios', confidence: 0.96, visual_alternatives: [{ slug: 'laios', name: 'Laios', confidence: 0.96 }, { slug: 'saitama', name: 'Saitama', confidence: 0.64 }], collection: { catalog: 4, name: 'Blade of Fury', level: 1, nodes: [{ stat: 'full_atk' }], visual_alternatives: [{ id: 4, name: 'Blade of Fury', level: 1 }, { id: 1, name: 'Temporal Cover', level: 1 }] } },
          { slug: 'randle', name: 'Randle', confidence: 0.95, visual_alternatives: [{ slug: 'randle', name: 'Randle', confidence: 0.95 }, { slug: 'ivan', name: 'Ivan', confidence: 0.63 }], collection: { catalog: 14, name: 'Timeline Watch', level: 2, nodes: [{ stat: 'full_atk' }, { stat: 'tyr' }], visual_alternatives: [{ id: 14, name: 'Timeline Watch', level: 2 }, { id: 15, name: 'Bounty Hunter’s Decree', level: 1 }] } },
          { slug: 'awakened-gavus', name: 'Gavus (Awakened)', confidence: 0.94, visual_alternatives: [{ slug: 'awakened-gavus', name: 'Gavus (Awakened)', confidence: 0.94 }, { slug: 'eorin', name: 'Eorin', confidence: 0.61 }], collection: { catalog: 10, name: 'Captive Wings', level: 1, nodes: [{ stat: 'full_atk' }], visual_alternatives: [{ id: 10, name: 'Captive Wings', level: 1 }, { id: 11, name: "Storm's Calling", level: 1 }] } },
          { slug: 'elijah-and-lailah', name: 'Elijah & Lailah', confidence: 0.96, visual_alternatives: [{ slug: 'elijah-and-lailah', name: 'Elijah & Lailah', confidence: 0.96 }, { slug: 'palmer', name: 'Palmer', confidence: 0.62 }], collection: { catalog: 13, name: 'Luminous Flight', level: 1, nodes: [{ stat: 'full_atk' }], visual_alternatives: [{ id: 13, name: 'Luminous Flight', level: 1 }, { id: 15, name: 'Bounty Hunter’s Decree', level: 1 }] } },
        ],
        substitute_teams: isLyd ? [
          { row_index: 2, pet: 'winged-lion', pet_options: ['winged-lion', 'pandy-dumpty'], hero_slots: [{ primary_slug: 'marcille', options: ['marcille'] }, { primary_slug: 'laios', options: ['laios'] }, { primary_slug: 'randle', options: ['randle'] }, { primary_slug: 'awakened-gavus', options: ['awakened-gavus', 'palmer'] }, { primary_slug: 'elijah-and-lailah', options: ['elijah-and-lailah'] }] },
          { row_index: 3, pet: 'pandy-dumpty', pet_options: ['pandy-dumpty'], hero_slots: [{ primary_slug: 'rem', options: ['rem', 'emilia'] }, { primary_slug: 'laios', options: ['laios'] }, { primary_slug: 'randle', options: ['randle'] }, { primary_slug: 'liberta', options: ['liberta'] }, { primary_slug: 'elijah-and-lailah', options: ['elijah-and-lailah'] }] },
        ] : [],
      },
      {
        round: 2,
        matched_formation_key: 'cindercrow-specter',
        matched_formation_label: 'Cindercrow Specter',
        pet: { slug: 'count-snickerfang', name: 'Count Snickerfang', confidence: 0.97, options: ['count-snickerfang', 'aureus'], visual_alternatives: [{ slug: 'count-snickerfang', name: 'Count Snickerfang', confidence: 0.97 }, { slug: 'aureus', name: 'Aureus', confidence: 0.71 }] },
        heroes: [
          { slug: 'rowan', name: 'Rowan', confidence: 0.98, visual_alternatives: [{ slug: 'rowan', name: 'Rowan', confidence: 0.98 }, { slug: 'rosaline', name: 'Rosaline', confidence: 0.62 }], collection: { catalog: 14, name: 'Timeline Watch', level: 1, nodes: [{ stat: 'full_atk' }], visual_alternatives: [{ id: 14, name: 'Timeline Watch', level: 1 }] } },
          { slug: 'awakened-safiya', name: 'Safiya (Awakened)', confidence: 0.96, visual_alternatives: [{ slug: 'awakened-safiya', name: 'Safiya (Awakened)', confidence: 0.96 }, { slug: 'daemia', name: 'Daemia', confidence: 0.65 }], collection: { catalog: 15, name: 'Bounty Hunter’s Decree', level: 3, nodes: [{ stat: 'full_atk' }], visual_alternatives: [{ id: 15, name: 'Bounty Hunter’s Decree', level: 3 }] } },
          { slug: 'awakened-skriath', name: 'Skriath (Awakened)', confidence: 0.95, visual_alternatives: [{ slug: 'awakened-skriath', name: 'Skriath (Awakened)', confidence: 0.95 }, { slug: 'skriath', name: 'Skriath', confidence: 0.69 }], collection: { catalog: 11, name: "Storm's Calling", level: 3, nodes: [{ stat: 'atk' }, { stat: 'mp' }], visual_alternatives: [{ id: 11, name: "Storm's Calling", level: 3 }] } },
          { slug: 'highborn-lan', name: 'Lan', confidence: 0.97, visual_alternatives: [{ slug: 'highborn-lan', name: 'Lan', confidence: 0.97 }, { slug: 'aurelia', name: 'Aurelia', confidence: 0.64 }], collection: { catalog: 13, name: 'Luminous Flight', level: 1, nodes: [{ stat: 'atk' }], visual_alternatives: [{ id: 13, name: 'Luminous Flight', level: 1 }] } },
          { slug: 'selene', name: 'Selene', confidence: 0.95, visual_alternatives: [{ slug: 'selene', name: 'Selene', confidence: 0.95 }, { slug: 'lucilla', name: 'Lucilla', confidence: 0.63 }], collection: { catalog: 10, name: 'Captive Wings', level: 2, nodes: [{ stat: 'mp' }, { stat: 'atk' }], visual_alternatives: [{ id: 10, name: 'Captive Wings', level: 2 }] } },
        ],
        substitute_teams: [],
      },
      {
        round: 3,
        matched_formation_key: 'demonic-puppet',
        matched_formation_label: 'Demonic Puppet',
        pet: { slug: 'treatspector', name: 'Treatspector', confidence: 0.95, options: ['treatspector', 'pearlcrest-ibis', 'trickery-chest'], visual_alternatives: [{ slug: 'treatspector', name: 'Treatspector', confidence: 0.95 }, { slug: 'pearlcrest-ibis', name: 'Pearlcrest Ibis', confidence: 0.72 }] },
        heroes: [
          { slug: 'adrian-and-elyse', name: 'Adrian & Elyse', confidence: 0.96, visual_alternatives: [{ slug: 'adrian-and-elyse', name: 'Adrian & Elyse', confidence: 0.96 }], collection: { catalog: 5, name: 'Judgment Armor', level: 1, nodes: [{ stat: 'full_atk' }], visual_alternatives: [{ id: 5, name: 'Judgment Armor', level: 1 }] } },
          { slug: 'harvey', name: 'Harvey', confidence: 0.96, visual_alternatives: [{ slug: 'harvey', name: 'Harvey', confidence: 0.96 }], collection: { catalog: 15, name: 'Bounty Hunter’s Decree', level: 2, nodes: [{ stat: 'full_atk' }], visual_alternatives: [{ id: 15, name: 'Bounty Hunter’s Decree', level: 2 }] } },
          { slug: 'highborn-leviathan', name: 'Leviathan', confidence: 0.95, visual_alternatives: [{ slug: 'highborn-leviathan', name: 'Leviathan', confidence: 0.95 }], collection: { catalog: 3, name: 'Soul Barrier', level: 3, nodes: [{ stat: 'full_atk' }, { stat: 'hp' }], visual_alternatives: [{ id: 3, name: 'Soul Barrier', level: 3 }] } },
          { slug: 'judy-punch', name: 'Judy Punch', confidence: 0.95, visual_alternatives: [{ slug: 'judy-punch', name: 'Judy Punch', confidence: 0.95 }], collection: { catalog: 8, name: 'Duskfeather Shrine', level: 2, nodes: [{ stat: 'cda' }, { stat: 'atk' }], visual_alternatives: [{ id: 8, name: 'Duskfeather Shrine', level: 2 }] } },
          { slug: 'lavatune', name: 'Lavatune', confidence: 0.97, visual_alternatives: [{ slug: 'lavatune', name: 'Lavatune', confidence: 0.97 }], collection: { catalog: 13, name: 'Luminous Flight', level: 1, nodes: [{ stat: 'full_atk' }, { stat: 'mp' }], visual_alternatives: [{ id: 13, name: 'Luminous Flight', level: 1 }] } },
        ],
        substitute_teams: [],
      },
      {
        round: 4,
        matched_formation_key: 'ashen-prophet',
        matched_formation_label: 'Ashen Prophet',
        pet: { slug: 'twinlum-spirit', name: 'Twinlum Spirit', confidence: 0.96, options: ['twinlum-spirit', 'flutterplume-owl'], visual_alternatives: [{ slug: 'twinlum-spirit', name: 'Twinlum Spirit', confidence: 0.96 }, { slug: 'flutterplume-owl', name: 'Flutterplume Owl', confidence: 0.71 }] },
        heroes: [
          { slug: 'awakened-envydiel', name: 'Envydiel (Awakened)', confidence: 0.97, visual_alternatives: [{ slug: 'awakened-envydiel', name: 'Envydiel (Awakened)', confidence: 0.97 }, { slug: 'fawkes', name: 'Fawkes', confidence: 0.58 }], collection: { catalog: 9, name: 'Shadowflow Blade', level: 3, nodes: [{ stat: 'cda' }], visual_alternatives: [{ id: 9, name: 'Shadowflow Blade', level: 3 }] } },
          { slug: 'aurelia', name: 'Aurelia', confidence: 0.97, visual_alternatives: [{ slug: 'aurelia', name: 'Aurelia', confidence: 0.97 }, { slug: 'oden', name: 'Oden', confidence: 0.61 }], collection: { catalog: 15, name: 'Bounty Hunter’s Decree', level: 1, nodes: [{ stat: 'erosion' }], visual_alternatives: [{ id: 15, name: 'Bounty Hunter’s Decree', level: 1 }] } },
          { slug: 'gorok', name: 'Gorok', confidence: 0.96, visual_alternatives: [{ slug: 'gorok', name: 'Gorok', confidence: 0.96 }], collection: { catalog: 6, name: 'Infused Mind Core', level: 1, nodes: [{ stat: 'full_atk' }, { stat: 'buffer' }], visual_alternatives: [{ id: 6, name: 'Infused Mind Core', level: 1 }] } },
          { slug: 'talimar', name: 'Talimar', confidence: 0.96, visual_alternatives: [{ slug: 'talimar', name: 'Talimar', confidence: 0.96 }, { slug: 'velufira', name: 'Velufira', confidence: 0.62 }], collection: { catalog: 15, name: 'Bounty Hunter’s Decree', level: 3, nodes: [{ stat: 'full_atk' }], visual_alternatives: [{ id: 15, name: 'Bounty Hunter’s Decree', level: 3 }] } },
          { slug: 'highborn-thalassa', name: 'Thalassa', confidence: 0.95, visual_alternatives: [{ slug: 'highborn-thalassa', name: 'Thalassa', confidence: 0.95 }], collection: { catalog: 13, name: 'Luminous Flight', level: 1, nodes: [{ stat: 'heal' }, { stat: 'full_atk' }], visual_alternatives: [{ id: 13, name: 'Luminous Flight', level: 1 }] } },
        ],
        substitute_teams: [],
      },
      {
        round: 5,
        matched_formation_key: 'mirror-demon',
        matched_formation_label: 'Mirror Demon',
        pet: { slug: 'nightfall-pegasus', name: 'Nightfall Pegasus', confidence: 0.96, options: ['nightfall-pegasus'], visual_alternatives: [{ slug: 'nightfall-pegasus', name: 'Nightfall Pegasus', confidence: 0.96 }] },
        heroes: [
          { slug: 'awakened-estrilda', name: 'Estrilda (Awakened)', confidence: 0.97, visual_alternatives: [{ slug: 'awakened-estrilda', name: 'Estrilda (Awakened)', confidence: 0.97 }], collection: { catalog: 1, name: 'Temporal Cover', level: 1, nodes: [{ stat: 'full_atk' }], visual_alternatives: [{ id: 1, name: 'Temporal Cover', level: 1 }] } },
          { slug: 'dracula', name: 'Dracula', confidence: 0.96, visual_alternatives: [{ slug: 'dracula', name: 'Dracula', confidence: 0.96 }], collection: { catalog: 8, name: 'Duskfeather Shrine', level: 2, nodes: [{ stat: 'atk' }, { stat: 'erosion' }], visual_alternatives: [{ id: 8, name: 'Duskfeather Shrine', level: 2 }] } },
          { slug: 'hybris', name: 'Hybris', confidence: 0.95, visual_alternatives: [{ slug: 'hybris', name: 'Hybris', confidence: 0.95 }], collection: { catalog: 3, name: 'Soul Barrier', level: 1, nodes: [{ stat: 'full_hp' }], visual_alternatives: [{ id: 3, name: 'Soul Barrier', level: 1 }] } },
          { slug: 'lysander', name: 'Lysander', confidence: 0.95, visual_alternatives: [{ slug: 'lysander', name: 'Lysander', confidence: 0.95 }], collection: { catalog: 9, name: 'Shadowflow Blade', level: 2, nodes: [{ stat: 'full_atk' }], visual_alternatives: [{ id: 9, name: 'Shadowflow Blade', level: 2 }] } },
          { slug: 'serenmira', name: 'Serenmira', confidence: 0.96, visual_alternatives: [{ slug: 'serenmira', name: 'Serenmira', confidence: 0.96 }], collection: { catalog: 7, name: ' Gale Barrier', level: 3, nodes: [{ stat: 'prf' }, { stat: 'atk' }], visual_alternatives: [{ id: 7, name: 'Gale Barrier', level: 3 }] } },
        ],
        substitute_teams: [],
      },
      {
        round: 6,
        matched_formation_key: 'infernal-overlord',
        matched_formation_label: 'Infernal Overlord',
        pet: { slug: 'thistlekin', name: 'Thistlekin', confidence: 0.95, options: ['thistlekin', 'fox-fatale'], visual_alternatives: [{ slug: 'thistlekin', name: 'Thistlekin', confidence: 0.95 }, { slug: 'fox-fatale', name: 'Fox Fatale', confidence: 0.72 }] },
        heroes: [
          { slug: 'begris', name: 'Begris', confidence: 0.96, visual_alternatives: [{ slug: 'begris', name: 'Begris', confidence: 0.96 }], collection: { catalog: 3, name: 'Soul Barrier', level: 2, nodes: [{ stat: 'full_atk' }], visual_alternatives: [{ id: 3, name: 'Soul Barrier', level: 2 }] } },
          { slug: 'awakened-fawkes', name: 'Fawkes (Awakened)', confidence: 0.95, visual_alternatives: [{ slug: 'awakened-fawkes', name: 'Fawkes (Awakened)', confidence: 0.95 }], collection: { catalog: 8, name: 'Duskfeather Shrine', level: 1, nodes: [{ stat: 'full_atk' }], visual_alternatives: [{ id: 8, name: 'Duskfeather Shrine', level: 1 }] } },
          { slug: 'vaelis', name: 'Vaelis', confidence: 0.95, visual_alternatives: [{ slug: 'vaelis', name: 'Vaelis', confidence: 0.95 }], collection: { catalog: 2, name: 'Blazing Touch', level: 3, nodes: [{ stat: 'cda' }, { stat: 'atk' }], visual_alternatives: [{ id: 2, name: 'Blazing Touch', level: 3 }] } },
          { slug: 'awakened-merlin', name: 'Merlin (Awakened)', confidence: 0.96, visual_alternatives: [{ slug: 'awakened-merlin', name: 'Merlin (Awakened)', confidence: 0.96 }], collection: { catalog: 10, name: 'Captive Wings', level: 2, nodes: [{ stat: 'full_atk' }], visual_alternatives: [{ id: 10, name: 'Captive Wings', level: 2 }] } },
          { slug: 'lyla', name: 'Lyla', confidence: 0.95, visual_alternatives: [{ slug: 'lyla', name: 'Lyla', confidence: 0.95 }], collection: { catalog: 13, name: 'Luminous Flight', level: 2, nodes: [{ stat: 'full_atk' }], visual_alternatives: [{ id: 13, name: 'Luminous Flight', level: 2 }] } },
        ],
        substitute_teams: [],
      },
    ];

    const teams = isRound4Crop
      ? [{ ...full6Rounds[3], round: 1 }]
      : isNcRound3Crop
        ? [full6Rounds[2]]
        : isF2p
          ? full6Rounds.slice(0, 3)
          : full6Rounds;

    this.applyRecognitionResponse({
      ok: true,
      best_mode: {
        mode_slug: 'nightmare-corridor',
        mode_name: 'Nightmare Corridor',
        target_slug: 'infernal-overlord',
        target_name: 'Infernal Overlord',
        confidence: isRound4Crop || isNcRound3Crop ? 0.935 : 0.99,
        reasons: [
          `Matches reference lineup 'Nightmare Corridor — Infernal Overlord' (${teams.length * 5}/${teams.length * 5} heroes).`,
          `${teams.length}-round formation structure with pets and collections matches Nightmare Corridor.`,
        ],
      },
      mode_alternatives: [
        { mode_slug: 'nightmare-corridor', mode_name: 'Nightmare Corridor', target_slug: 'netherspinner', target_name: 'Netherspinner', confidence: 0.42 },
        { mode_slug: 'cursed-realm', mode_name: 'Cursed Realm', target_slug: 'ice-shemira', target_name: 'Ice Shemira', confidence: 0.36 },
        { mode_slug: 'treasure-scramble', mode_name: 'Treasure Scramble', target_slug: 'fire', target_name: 'Fire', confidence: 0.24 },
      ],
      best_lineup_match: {
        id: isF2p ? 'nc-f2p-retries-infernal-overlord' : 'nc-guide-2026-10-infernal-overlord',
        title: isF2p
          ? 'Nightmare Corridor — Infernal Overlord (F2P 1k Dias / Retries 3-Round Guide)'
          : 'Nightmare Corridor — Infernal Overlord (6-Boss Cycle Meta)',
        mode_slug: 'nightmare-corridor',
        mode_name: 'Nightmare Corridor',
        target_slug: 'infernal-overlord',
        target_name: 'Infernal Overlord',
        similarity: 1.0,
        round_alignments: teams.map((t) => ({
          image_round: t.round,
          matched_formation_key: t.matched_formation_key,
          matched_formation_label: t.matched_formation_label,
          similarity: 1.0,
          hero_overlap_count: 5,
          pet_matched: true,
        })),
      },
      lineup_alternatives: [
        { id: 'nc-netherspinner-sample', title: 'Nightmare Corridor — Netherspinner (6-Boss Cycle Sample)', mode_slug: 'nightmare-corridor', mode_name: 'Nightmare Corridor', target_slug: 'netherspinner', target_name: 'Netherspinner', similarity: 0.28 },
        { id: 'cr-ice-shemira-sample', title: 'Cursed Realm — Ice Shemira (5 Shadow Guards + Boss)', mode_slug: 'cursed-realm', mode_name: 'Cursed Realm', target_slug: 'ice-shemira', target_name: 'Ice Shemira', similarity: 0.24 },
      ],
      review_suggestions: [],
      teams,
    });
  }

  private resolveHero(slugOrName: string): Hero | null {
    if (!slugOrName) return null;
    const cleaned = slugOrName.trim().toLowerCase();
    const allHeroes = this.heroes();
    for (const h of allHeroes) {
      const disp = displayHeroName(h).toLowerCase();
      const s = this.toSlug(disp);
      if (disp === cleaned || s === cleaned || h.name.toLowerCase() === cleaned) return h;
    }
    const withoutHighborn = cleaned.replace(/^highborn-/, '').replace(/\s*\(highborn\)$/i, '');
    for (const h of allHeroes) {
      const disp = displayHeroName(h).toLowerCase();
      const s = this.toSlug(disp);
      if (disp === withoutHighborn || s === withoutHighborn || h.name.toLowerCase() === withoutHighborn) return h;
    }
    return null;
  }

  private resolvePet(slugOrName: string): Pet | null {
    if (!slugOrName) return null;
    const cleaned = slugOrName.trim().toLowerCase();
    for (const p of this.pets()) {
      if (p.name.toLowerCase() === cleaned || this.toSlug(p.name) === cleaned) return p;
    }
    return null;
  }

  private heroClassFor(hero: Hero): string | null {
    return hero.class ?? this.heroIcons.classFor(displayHeroName(hero));
  }

  private toSlug(name: string): string {
    const awakened = /\(awakened\)/i.test(name) || /^awakened\s+/i.test(name);
    const base = name
      .replace(/\(awakened\)/gi, '')
      .replace(/^awakened\s+/i, '')
      .replace(/\(highborn\)/gi, '')
      .replace(/&/g, 'and')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    return awakened ? `awakened-${base}` : base;
  }
}
