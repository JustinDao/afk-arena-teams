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
  CollectionRecommendationSpec,
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
  readonly notes?: string;
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
    id: 'cr-split-2',
    path: '5am63ydnvk1i1.png,rziiahgnvk1i1.png',
    label: 'Split 2-Image Cursed Realm — Rounds 1–3 + Rounds 4–6 (Demonic Entity)',
  },
  {
    id: 'ts-lookup-2',
    path: 'h03e45jpfk1i1.png,96yli4jpfk1i1.png',
    label: 'TS 7-Team + Hero Investment/Collection Lookup Sheet (2 Images)',
  },
  {
    id: 'nc-grid-3x6',
    path: '5w6pegdl2o1i1.png',
    label: 'Multi-Lineup Grid — 3 Separate 6-Round NC Lineups in One Image',
  },
  {
    id: 'f2p-staggered-3',
    path: 'f2p-1k-dias-retries-enjoyers-weekly-nc-v0-p843t9w3p7wh1.webp',
    label: 'F2P Staggered Guide — 3-Round Nightmare Corridor',
  },
  {
    id: 'crop-round-4',
    path: 'tools/image-recognition/pilot-images/pilot-nightmare-round-4.png',
    label: 'Single-Round Crop — Round 4 Ashen Prophet',
  },
  {
    id: 'crop-nc-round-3',
    path: 'tools/image-recognition/pilot-images/pilot-nc-round-3.png',
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
            Upload a lineup screenshot or guide to detect the mode, boss cycle, formations, heroes, pets, and collections.
          </p>
        </div>
        <div class="header-actions">
          @if (hasLoadedWorkspace()) {
            <button mat-button type="button" class="btn" (click)="resetToUpload()">Change image</button>
          }
          <a mat-button class="btn" routerLink="/submit">Back to submit form</a>
        </div>
      </header>

      @if (!hasLoadedWorkspace()) {
        <section class="panel upload-stage">
          <label class="field file-field upload-dropzone">
            <span class="upload-title">Upload screenshot or guide image(s)</span>
            <span class="muted">PNG, JPG, or WebP — supports multi-round guides</span>
            <input type="file" accept="image/*" multiple (change)="onFileSelected($event)" />
          </label>
          <div class="upload-divider" aria-hidden="true"><span>or</span></div>
          <div class="sample-picker">
            <label class="field sample-select-field">
              <span>Test with a sample guide image</span>
              <select [value]="selectedSamplePath()" (change)="selectedSamplePath.set(inputValue($event))">
                @for (sample of sampleOptions; track sample.id) {
                  <option [value]="sample.path">{{ sample.label }}</option>
                }
              </select>
            </label>
            <button
              mat-flat-button
              type="button"
              class="btn primary load-sample-btn"
              [disabled]="analyzing()"
              (click)="analyzeSampleGuide(selectedSamplePath())">
              {{ analyzing() ? 'Analyzing…' : 'Analyze sample guide' }}
            </button>
          </div>
          @if (statusMessage()) {
            <p class="status-banner" role="status">{{ statusMessage() }}</p>
          }
        </section>
      } @else {
        <div class="workspace-grid">
          <section class="panel preview-panel">
            <div class="preview-head">
              <h3>Uploaded image</h3>
              @if (imageUrl()) {
                <button
                  mat-stroked-button
                  type="button"
                  class="btn"
                  [disabled]="analyzing()"
                  (click)="analyzeUploadedImage()">
                  {{ analyzing() ? 'Analyzing…' : 'Re-analyze' }}
                </button>
              }
            </div>
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
                Sample guide analyzed. Use <strong>Change image</strong> above to upload your own screenshot.
              </div>
            }
            @if (statusMessage()) {
              <p class="status-banner" role="status">{{ statusMessage() }}</p>
            }
          </section>

          <section class="panel editor-panel">
            <div class="editor-mode-bar" aria-label="Game mode and target">
              <div class="mode-bar-main">
                <div class="mode-bar-left">
                  <div class="seg mode-seg-bar" role="group" aria-label="Game mode">
                    @for (m of store.modes(); track m.slug) {
                      <button
                        mat-button
                        type="button"
                        class="seg-btn"
                        [attr.aria-pressed]="m.slug === selectedModeSlug()"
                        (click)="onModeSelect(m.slug)">
                        {{ m.short }}
                      </button>
                    }
                  </div>
                  @if (bestMode(); as bm) {
                    @if (bm.mode_slug === selectedModeSlug()) {
                      <span class="conf-badge ok">Auto ({{ (bm.confidence * 100).toFixed(0) }}%)</span>
                    } @else {
                      <span class="conf-badge warn">Manual ({{ currentModeConfig().short }})</span>
                    }
                  }
                </div>
                <div class="mode-target-controls">
                  <label class="field target-field">
                    <span>{{ currentModeConfig().targetLabel }}</span>
                    <select [value]="selectedTargetName()" (change)="onTargetSelect(inputValue($event))">
                      @for (t of currentModeConfig().targets; track t) {
                        <option [value]="t" [selected]="t === selectedTargetName()">{{ t }}</option>
                      }
                    </select>
                  </label>
                  @if (currentModeConfig().variable; as variable) {
                    <label class="field teams-field">
                      <span>Teams ({{ variable.min }}–{{ variable.max }})</span>
                      <select [value]="teamCount()" (change)="onTeamCountChange(numberValue($event))">
                        @for (cnt of variableTeamCounts(variable); track cnt) {
                          <option [value]="cnt" [selected]="cnt === teamCount()">{{ cnt }} teams</option>
                        }
                      </select>
                    </label>
                  }
                </div>
              </div>
              <p class="rules-text">{{ currentModeConfig().rules }}</p>
            </div>
          @if (detectedLineupSets().length > 1) {
            <div class="alt-group lineup-sets-bar" role="group" aria-label="Detected lineup sets">
              <span class="alt-label">Detected lineups in image ({{ detectedLineupSets().length }}):</span>
              <div class="chip-row">
                @for (lSet of detectedLineupSets(); track lSet.index) {
                  <button
                    mat-button
                    type="button"
                    class="chip-btn"
                    [class.active-candidate]="lSet.index === activeLineupSetIndex()"
                    [attr.aria-pressed]="lSet.index === activeLineupSetIndex()"
                    (click)="selectLineupSet(lSet.index)">
                    {{ lSet.label }} ({{ lSet.teams.length }} rounds)
                  </button>
                }
              </div>
            </div>
          }
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

            @if (form.notes !== undefined) {
              <label class="field" style="margin-top: 0.75rem;">
                <span>Team notes ({{ form.label }})</span>
                <textarea
                  rows="3"
                  [value]="form.notes ?? ''"
                  placeholder="Optional per-team notes or tips…"
                  (input)="updateTeamNotes(activeFormationIndex(), inputValue($event))"
                ></textarea>
              </label>
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

          <label class="field notes-field">
            <span>Lineup notes (copied to submit form)</span>
            <textarea
              rows="2"
              [value]="notes()"
              (input)="notes.set(inputValue($event))"
              placeholder="Optional notes, kill times, or substitution tips…"></textarea>
          </label>

          <div class="footer-actions">
            <a mat-button class="btn" routerLink="/submit">Cancel</a>
            <button
              mat-flat-button
              type="button"
              class="btn primary apply-draft-btn"
              [disabled]="!hasAnyHero()"
              (click)="applyToSubmitForm()">
              Use lineup in submit form
            </button>
          </div>
        </section>
      </div>

      @if (bestMode() || bestLineupMatch() || modeAlternatives().length || lineupAlternatives().length || reviewSuggestions().length) {
        <details class="panel details-panel" [open]="reviewSuggestions().length > 0">
          <summary class="details-summary">
            <span class="details-title">Detection &amp; database match details</span>
            <span class="details-badges">
              @if (bestLineupMatch(); as bl) {
                <span class="conf-badge ok">{{ bl.title }} ({{ (bl.similarity * 100).toFixed(1) }}%)</span>
              }
              @if (reviewSuggestions().length) {
                <span class="conf-badge warn">{{ reviewSuggestions().length }} review flag{{ reviewSuggestions().length === 1 ? '' : 's' }}</span>
              }
            </span>
          </summary>
          <div class="match-summary-grid details-grid">
            <div class="summary-card">
              <div class="summary-head">
                <h3>Detected mode candidates</h3>
              </div>
              @if (bestMode(); as bm) {
                @if (bm.reasons?.length) {
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

            @if (bestLineupMatch() || lineupAlternatives().length || reviewSuggestions().length) {
              <div class="summary-card">
                <div class="summary-head">
                  <h3>{{ selectedModeSlug() === 'treasure-scramble' ? 'Closest known lineup & team alignment' : 'Closest known lineup & round alignment' }}</h3>
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
            }
          </div>
        </details>
      }
      }
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
    .import-submit-page {
      max-width: 1280px;
      margin: 0 auto;
      padding: var(--app-space-4);
    }
    .panel {
      padding: var(--app-space-4);
      margin-bottom: var(--app-space-4);
      border: 1px solid var(--app-line);
      border-radius: var(--app-radius-lg);
      background: var(--app-panel);
    }
    .page-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: var(--app-space-4);
      flex-wrap: wrap;
    }
    .page-header h2 {
      margin: 0 0 var(--app-space-1);
    }
    .subtitle,
    .muted {
      color: var(--app-muted);
      font-size: 0.9rem;
      margin: 0;
    }
    .header-actions,
    .footer-actions {
      display: flex;
      gap: var(--app-space-2);
      align-items: center;
      flex-wrap: wrap;
    }
    .footer-actions {
      justify-content: flex-end;
      margin-top: var(--app-space-4);
      padding-top: var(--app-space-3);
      border-top: 1px solid var(--app-line);
    }
    .upload-stage {
      max-width: 680px;
      margin: var(--app-space-7) auto;
      display: flex;
      flex-direction: column;
      gap: var(--app-space-4);
    }
    .upload-dropzone {
      padding: var(--app-space-7) var(--app-space-4);
      border: 1.5px dashed var(--app-line);
      border-radius: var(--app-radius);
      background: var(--app-bg);
      align-items: center;
      text-align: center;
      gap: var(--app-space-2);
    }
    .upload-title {
      font-size: 1rem;
      font-weight: 600;
    }
    .upload-dropzone input[type='file'] {
      margin-top: var(--app-space-2);
      max-width: 100%;
    }
    .upload-divider {
      display: flex;
      align-items: center;
      gap: var(--app-space-3);
      color: var(--app-muted);
      font-size: 0.85rem;
    }
    .upload-divider::before,
    .upload-divider::after {
      content: '';
      flex: 1;
      height: 1px;
      background: var(--app-line);
    }
    .sample-picker {
      display: flex;
      flex-wrap: wrap;
      gap: var(--app-space-2);
      align-items: flex-end;
    }
    .sample-select-field {
      flex: 1 1 240px;
      margin: 0;
    }
    .load-sample-btn {
      height: var(--app-control-height);
      min-height: var(--app-control-height);
      border-radius: var(--app-radius-sm);
    }
    .preview-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--app-space-2);
      margin-bottom: var(--app-space-3);
    }
    .preview-head h3 {
      margin: 0;
    }
    .editor-mode-bar {
      display: flex;
      flex-direction: column;
      gap: var(--app-space-2);
      padding-bottom: var(--app-space-3);
      margin-bottom: var(--app-space-3);
      border-bottom: 1px solid var(--app-line);
    }
    .notes-field {
      margin-top: var(--app-space-4);
    }
    .field {
      display: flex;
      flex-direction: column;
      gap: var(--app-space-1);
      font-size: 0.85rem;
      font-weight: 500;
    }
    .status-banner {
      width: 100%;
      margin: 0;
      padding: var(--app-space-2) var(--app-space-3);
      border-radius: var(--app-radius-sm);
      background: var(--app-panel-variant);
      color: var(--app-ink);
      font-size: 0.88rem;
    }
    .match-summary-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--app-space-4);
    }
    .match-summary-grid.single-card {
      grid-template-columns: 1fr;
    }
    .summary-card {
      padding: var(--app-space-3);
      border: 1px solid var(--app-line);
      border-radius: var(--app-radius);
      background: var(--app-bg);
    }
    .summary-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: var(--app-space-2);
      flex-wrap: wrap;
      margin-bottom: var(--app-space-3);
    }
    .summary-head h3 {
      margin: 0;
      font-size: 1rem;
    }
    .mode-bar {
      display: flex;
      flex-direction: column;
      gap: var(--app-space-2);
    }
    .mode-bar-main {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      justify-content: space-between;
      gap: var(--app-space-3);
    }
    .mode-bar-left {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--app-space-2);
    }
    .mode-seg-bar {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin: 0;
      border: 0;
      background: transparent;
    }
    .seg-btn {
      height: auto;
      min-height: 36px;
      border: 1px solid var(--app-line);
      border-radius: var(--app-radius-sm);
      font-size: 0.84rem;
      padding: var(--app-space-1) var(--app-space-3);
      color: var(--app-ink);
      background: var(--app-bg);
      cursor: pointer;
    }
    .seg-btn:hover {
      border-color: var(--app-primary);
    }
    .seg-btn[aria-pressed='true'] {
      border-color: var(--app-primary);
      font-weight: 600;
      background: var(--app-primary);
      color: var(--app-on-primary);
    }
    .rules-text {
      margin: 0;
      font-size: 0.82rem;
      line-height: 1.4;
      color: var(--app-muted);
    }
    .mode-target-controls {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      gap: var(--app-space-3);
    }
    .target-field {
      min-width: 200px;
      margin: 0;
    }
    .teams-field {
      min-width: 120px;
      margin: 0;
    }
    .mode-target-controls .field select {
      min-width: 0;
      width: 100%;
    }
    .details-panel {
      margin-top: var(--app-space-4);
    }
    .details-summary {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--app-space-2);
      cursor: pointer;
      font-weight: 600;
      list-style: none;
    }
    .details-summary::-webkit-details-marker {
      display: none;
    }
    .details-title::before {
      content: '▸ ';
      display: inline-block;
      transition: transform 140ms ease;
    }
    .details-panel[open] .details-title::before {
      transform: rotate(90deg);
    }
    .details-badges {
      display: flex;
      flex-wrap: wrap;
      gap: var(--app-space-2);
    }
    .details-grid {
      margin-top: var(--app-space-3);
    }
    .reason-list {
      margin: var(--app-space-2) 0;
      padding-left: 18px;
      font-size: 0.84rem;
      color: var(--app-muted);
    }
    .lineup-title {
      margin: 0 0 var(--app-space-2);
      font-size: 0.95rem;
    }
    .round-alignment-list {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: var(--app-space-3);
    }
    .alignment-pill {
      font-size: 0.8rem;
      padding: 4px 10px;
      border-radius: var(--app-radius-sm);
      border: 1px solid var(--app-line);
      background: var(--app-panel);
      color: var(--app-ink);
      font-variant-numeric: tabular-nums;
    }
    .alignment-pill strong {
      color: var(--app-primary);
    }
    .review-box {
      margin-top: var(--app-space-3);
      padding: var(--app-space-3);
      border-radius: var(--app-radius-sm);
      border: 1px solid var(--app-warning);
      background: color-mix(in srgb, var(--app-warning) 10%, transparent);
      font-size: 0.84rem;
    }
    .review-box h4 {
      margin: 0 0 6px;
      color: var(--app-warning);
      font-size: 0.88rem;
    }
    .review-box ul {
      margin: 0;
      padding-left: 18px;
    }
    .workspace-grid {
      display: grid;
      grid-template-columns: minmax(280px, 0.95fr) minmax(420px, 1.45fr);
      gap: var(--app-space-4);
      align-items: start;
    }
    .preview-panel {
      position: sticky;
      top: 84px;
    }
    .preview-panel h3 {
      margin: 0 0 var(--app-space-3);
    }
    .image-frame {
      max-height: 65vh;
      overflow: auto;
      border: 1px solid var(--app-line);
      border-radius: var(--app-radius-sm);
      background: var(--app-bg);
      margin-bottom: var(--app-space-3);
    }
    .image-frame img {
      display: block;
      max-width: 100%;
      height: auto;
    }
    .empty-preview {
      min-height: 200px;
      display: grid;
      place-items: center;
      padding: var(--app-space-4);
      border: 1px dashed var(--app-line);
      border-radius: var(--app-radius-sm);
      background: var(--app-bg);
      color: var(--app-muted);
      text-align: center;
      margin-bottom: var(--app-space-3);
    }
    .formation-tabs-bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      min-height: 46px;
      gap: 6px;
      padding-bottom: var(--app-space-2);
      border-bottom: 1px solid var(--app-line);
      margin-bottom: var(--app-space-3);
    }
    .tab-btn {
      flex: 0 0 auto;
      height: auto;
      min-height: 34px;
      border: 1px solid var(--app-line);
      border-radius: var(--app-radius-sm);
      padding: var(--app-space-1) var(--app-space-3);
      font-size: 0.84rem;
      color: var(--app-ink);
      background: var(--app-bg);
      cursor: pointer;
      white-space: nowrap;
    }
    .tab-btn:hover {
      border-color: var(--app-primary);
    }
    .tab-btn[aria-pressed='true'] {
      border-color: var(--app-primary);
      font-weight: 600;
      background: var(--app-primary);
      color: var(--app-on-primary);
    }
    .tab-btn small {
      margin-left: 6px;
      opacity: 0.8;
      font-variant-numeric: tabular-nums;
    }
    .round-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: var(--app-space-4);
      flex-wrap: wrap;
      padding-bottom: var(--app-space-3);
      border-bottom: 1px solid var(--app-line);
      margin-bottom: var(--app-space-3);
    }
    .round-label-field {
      flex: 1 1 280px;
      max-width: 480px;
    }
    .substitutes-box {
      padding: var(--app-space-3);
      border: 1px solid var(--app-line);
      border-radius: var(--app-radius);
      margin-top: var(--app-space-3);
      background: var(--app-panel-variant);
    }
    .sub-head {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .sub-head h4 {
      margin: 0;
      font-size: 0.92rem;
    }
    .sub-controls {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      align-items: center;
    }
    .sub-controls select {
      flex: 1;
      min-width: 220px;
    }
    .alt-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-top: var(--app-space-2);
    }
    .alt-label {
      font-size: 0.8rem;
      font-weight: 500;
      color: var(--app-muted);
    }
    .chip-row {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      align-items: center;
    }
    .chip-btn {
      height: auto;
      min-height: 30px;
      padding: 4px 10px;
      font-size: 0.8rem;
      border: 1px solid var(--app-line);
      border-radius: 999px;
      color: var(--app-ink);
      background: var(--app-bg);
      cursor: pointer;
    }
    .chip-btn:hover {
      border-color: var(--app-primary);
    }
    .chip-btn.active-candidate,
    .chip-btn[aria-pressed='true'] {
      border-color: var(--app-primary);
      background: var(--app-primary);
      color: var(--app-on-primary);
      font-weight: 600;
    }
    .chip-btn.guide-sub {
      border-color: var(--app-warning);
    }
    .lineup-sets-bar {
      padding: var(--app-space-3);
      margin-bottom: var(--app-space-3);
      border: 1px solid var(--app-line);
      border-radius: var(--app-radius);
      background: var(--app-bg);
    }
    .conf-badge {
      font-size: 0.76rem;
      font-weight: 600;
      padding: 2px 10px;
      border-radius: 999px;
      border: 1px solid var(--app-line);
      font-variant-numeric: tabular-nums;
    }
    .conf-badge.ok {
      border-color: var(--app-success);
      background: color-mix(in srgb, var(--app-success) 14%, transparent);
      color: var(--app-success);
    }
    .conf-badge.warn {
      border-color: var(--app-warning);
      background: color-mix(in srgb, var(--app-warning) 14%, transparent);
      color: var(--app-warning);
    }
    @media (max-width: 960px) {
      .match-summary-grid,
      .workspace-grid {
        grid-template-columns: 1fr;
      }
      .preview-panel {
        position: static;
      }
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

  readonly hasLoadedWorkspace = computed(
    () => Boolean(this.imageUrl() || this.bestMode() || this.bestLineupMatch() || this.hasAnyHero()),
  );

  resetToUpload(): void {
    this.imageUrl.set(null);
    this.uploadedDataUrls.set([]);
    this.bestMode.set(null);
    this.bestLineupMatch.set(null);
    this.modeAlternatives.set([]);
    this.lineupAlternatives.set([]);
    this.reviewSuggestions.set([]);
    this.statusMessage.set('');
    this.formations.set([]);
    this.editingSlot.set(null);
    this.petModalOpen.set(false);
  }

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
    const collectionsEnabled = this.currentModeConfig().collectionsEnabled;
    return form.heroes.map((slot) => {
      const heroId = slot.heroId;
      const heroName = slot.heroName;
      const parsedInv = parseInvestment(slot.investmentCode);
      const ascension = this.ascensionOfSlot(slot);
      const hero = heroId !== null ? this.heroFor(heroId) : null;
      const collection =
        heroId !== null && collectionsEnabled
          ? (slot.collectionSnapshot ??
              (slot.collectionId !== null
                ? this.buildCollectionSnapshot(
                    slot.collectionId,
                    slot.collectionLevel,
                    slot.collectionNodes,
                    hero ? this.heroClassFor(hero) : null,
                  )
                : null))
          : null;
      return {
        heroId,
        heroName,
        iconUrl: heroId !== null ? this.store.heroIconUrl(heroId) : null,
        hue: heroId !== null ? this.store.hue(heroName) : 200,
        ascension,
        investment: parsedInv,
        collection,
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

  readonly uploadedDataUrls = signal<readonly string[]>([]);
  readonly detectedLineupSets = signal<
    readonly { readonly index: number; readonly label: string; readonly teams: readonly unknown[] }[]
  >([]);
  readonly activeLineupSetIndex = signal(0);

  selectFormationTab(index: number): void {
    this.activeFormationIndex.set(index);
    this.selectedSubstituteIndex.set(0);
  }

  onFileSelected(event: Event): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    const files = Array.from(input.files ?? []).filter((f) => f.type.startsWith('image/'));
    if (!files.length) {
      this.statusMessage.set('Please select one or more valid image files.');
      return;
    }
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = URL.createObjectURL(files[0]);
    this.currentFileName = files.map((f) => f.name).join(',');
    this.pendingAnalyzeAfterLoad = true;
    this.imageUrl.set(this.objectUrl);
    if (files.length > 1) {
      void Promise.all(
        files.map(
          (file) =>
            new Promise<string>((resolve) => {
              const reader = new FileReader();
              reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
              reader.onerror = () => resolve('');
              reader.readAsDataURL(file);
            }),
        ),
      ).then((urls) => {
        this.uploadedDataUrls.set(urls.filter(Boolean));
      });
    } else {
      this.uploadedDataUrls.set([]);
    }
    this.statusMessage.set(
      `Loaded ${files.map((f) => f.name).join(' + ')}. Analyzing mode, lineup, and slot alternatives…`,
    );
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
        const controller = new AbortController();
        const timeoutMs = url.startsWith('http') ? 90000 : 2500;
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: samplePath }),
            signal: controller.signal,
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
        } finally {
          clearTimeout(timer);
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
        const multiUrls = this.uploadedDataUrls();
        const reqBody =
          multiUrls.length > 1
            ? { image_base64: dataUrl, images_base64: multiUrls }
            : { image_base64: dataUrl };
        const endpoints = ['/api/recognize-lineup', 'http://127.0.0.1:8174/api/recognize-lineup'];
        for (const url of endpoints) {
          const controller = new AbortController();
          const timeoutMs = url.startsWith('http') ? 90000 : 4000;
          const timer = setTimeout(() => controller.abort(), timeoutMs);
          try {
            const res = await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(reqBody),
              signal: controller.signal,
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
          } finally {
            clearTimeout(timer);
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
              petLevel: pet ? (f.petLevel ?? Math.min(18, petMaxLevel(pet.kind))) : null,
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
          petLevel: pet ? (f.petLevel ?? Math.min(18, petMaxLevel(pet.kind))) : f.petLevel,
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
    recommendationMode = true,
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

    const attackStats: CollectionNodeStat[] = [];
    const defenseStats: CollectionNodeStat[] = [];

    for (const { stat, tier } of regularItems) {
      const isAttack = ATTACK_COLLECTION_NODE_STATS.includes(stat as CollectionNodeStat);
      const isDefense = DEFENSE_COLLECTION_NODE_STATS.includes(stat as CollectionNodeStat);

      if (isAttack) {
        if (!attackStats.includes(stat) && attackStats.length < 5) attackStats.push(stat);
      } else if (isDefense) {
        if (!defenseStats.includes(stat) && defenseStats.length < 5) defenseStats.push(stat);
      } else {
        if (attackStats.length < 5) attackStats.push(stat);
        else if (defenseStats.length < 5) defenseStats.push(stat);
      }

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

    const recommendation: CollectionRecommendationSpec | undefined = recommendationMode
      ? {
          level: Math.max(1, Math.min(3, Math.trunc(level) || 1)),
          attackStats,
          defenseStats,
        }
      : undefined;

    return {
      catalogId: catalogItem.id,
      name: catalogItem.name,
      class: catalogItem.class,
      nodes: collectionNodes,
      ...(recommendation ? { recommendation } : {}),
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
      recommendation: {
        level: 1,
        attackStats: [],
        defenseStats: [],
      },
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
      if (enabled) {
        const attackStats =
          s.collectionSnapshot.recommendation?.attackStats ??
          s.collectionNodes.filter((stat) => ATTACK_COLLECTION_NODE_STATS.includes(stat as CollectionNodeStat));
        const defenseStats =
          s.collectionSnapshot.recommendation?.defenseStats ??
          s.collectionNodes.filter((stat) => DEFENSE_COLLECTION_NODE_STATS.includes(stat as CollectionNodeStat));
        const recommendation: CollectionRecommendationSpec = {
          level: s.collectionSnapshot.recommendation?.level ?? Math.max(1, Math.min(3, s.collectionLevel || 1)),
          attackStats,
          defenseStats,
        };
        return {
          ...s,
          collectionSnapshot: {
            ...s.collectionSnapshot,
            recommendation,
          },
        };
      } else {
        const nodes = s.collectionSnapshot.nodes.length
          ? s.collectionSnapshot.nodes
          : (this.buildCollectionSnapshot(
              s.collectionId,
              s.collectionLevel,
              s.collectionNodes,
              this.classOfHero(s.heroId),
              s.collectionSnapshot.name,
              false,
            )?.nodes ?? []);
        return {
          ...s,
          collectionSnapshot: {
            ...s.collectionSnapshot,
            nodes,
            recommendation: undefined,
          },
        };
      }
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

  updateSlotCollectionRecommendation(slotIndex: number, recommendation: CollectionRecommendationSpec): void {
    this.updateSlotFormation(slotIndex, (s) => {
      if (!s.collectionSnapshot) return s;
      const statNodes = [...recommendation.attackStats, ...recommendation.defenseStats];
      return {
        ...s,
        collectionLevel: recommendation.level,
        collectionNodes: statNodes,
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
        notes: form.notes ?? '',
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
  private mapRecognizedTeamsToFormations(teams: readonly any[]): EditableImportFormation[] {
    return teams.map(
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
            investmentCode: typeof h.investment?.code === 'string' ? h.investment.code : '',
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
          petLevel: resolvedPet
            ? (typeof petObj?.level === 'number'
                ? petObj.level
                : Math.min(18, petMaxLevel(resolvedPet.kind)))
            : null,
          petConfidence: Number(petObj?.confidence ?? 0.9),
          petGuideOptions,
          petVisualAlternatives,
          notes: typeof t.notes === 'string' ? t.notes : '',
          heroes,
          substituteTeams,
        };
      },
    );
  }

  updateTeamNotes(formIndex: number, notes: string): void {
    this.formations.update((forms) =>
      forms.map((f, idx) => (idx === formIndex ? { ...f, notes } : f)),
    );
  }

  selectLineupSet(setIndex: number): void {
    const sets = this.detectedLineupSets();
    const chosen = sets.find((s) => s.index === setIndex);
    if (!chosen) return;
    this.activeLineupSetIndex.set(setIndex);
    const mapped = this.mapRecognizedTeamsToFormations(chosen.teams);
    this.rawExtractedFormations = mapped;
    this.syncFormationsToModeAndTarget(false);
    this.activeFormationIndex.set(0);
    this.selectedSubstituteIndex.set(0);
    const totalHeroes = mapped.reduce((sum, f) => sum + this.countFilledHeroes(f), 0);
    this.statusMessage.set(
      `Switched to ${chosen.label} — ${mapped.length} round(s) (${totalHeroes} heroes) in ${this.currentModeConfig().name} (${this.selectedTargetName()}).`,
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  applyRecognitionResponse(data: any): void {
    this.modeAlternatives.set(Array.isArray(data.mode_alternatives) ? data.mode_alternatives : []);
    this.bestLineupMatch.set(data.best_lineup_match ?? null);
    this.lineupAlternatives.set(Array.isArray(data.lineup_alternatives) ? data.lineup_alternatives : []);
    this.reviewSuggestions.set(Array.isArray(data.review_suggestions) ? data.review_suggestions : []);
    this.detectedLineupSets.set(Array.isArray(data.lineup_sets) ? data.lineup_sets : []);
    this.activeLineupSetIndex.set(0);

    const mappedFormations: EditableImportFormation[] = this.mapRecognizedTeamsToFormations(data.teams ?? []);

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
    const setsInfo =
      this.detectedLineupSets().length > 1
        ? ` across ${this.detectedLineupSets().length} lineup sets (showing ${this.detectedLineupSets()[0]?.label})`
        : '';
    this.statusMessage.set(
      `Recognized ${mappedFormations.length} team(s) (${totalHeroes} heroes)${setsInfo} and ${subCount} substitute team(s), mapped to ${this.currentModeConfig().name} (${this.selectedTargetName()}: ${activeForms.length} formation(s)). Review or adjust any slot below, then click "Use lineup in submit form".`,
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
            { slug: 'highborn-leviathan', name: 'Leviathan (Highborn)', confidence: 0.51, investment: { code: '4012e61' }, collection: { catalog: 12, name: 'Horn of Dominion', level: 3, nodes: [{ stat: 'is' }] } },
            { slug: 'misfortis', name: 'Misfortis', confidence: 0.80, investment: { code: '309e61' }, collection: { catalog: 3, name: 'Timeline Watch', level: 1, nodes: [{ stat: 'hp' }] } },
            { slug: 'dracula', name: 'Dracula', confidence: 0.73, investment: { code: '309e62' }, collection: { catalog: 14, name: "Stormwrath's Lull", level: 1, nodes: [{ stat: 'full_atk' }] } },
            { slug: 'awakened-hybris', name: 'Hybris (Awakened)', confidence: 0.76, investment: { code: '409e68' }, collection: { catalog: 1, name: 'Temporal Cover', level: 2, nodes: [{ stat: 'atk' }] } },
            { slug: 'velufira', name: 'Velufira', confidence: 0.69, investment: { code: '409e67' }, collection: { catalog: 10, name: 'Luminous Flight', level: 1, nodes: [{ stat: 'is' }] } },
          ],
          substitute_teams: [],
        },
        {
          round: 2,
          matched_formation_key: 't2',
          matched_formation_label: 'Team 2',
          pet: null,
          heroes: [
            { slug: 'awakened-maetria', name: 'Maetria (Awakened)', confidence: 0.91, investment: { code: '309e60' }, collection: { catalog: 7, name: 'Captive Wings', level: 3, nodes: [{ stat: 'atk' }, { stat: 'is' }] } },
            { slug: 'kikoru-shinomiya', name: 'Kikoru Shinomiya', confidence: 0.88, investment: { code: '200e30' }, collection: { catalog: 1, name: 'Temporal Cover', level: 2, nodes: [{ stat: 'full_atk' }] } },
            { slug: 'shalltear-bloodfallen', name: 'Shalltear Bloodfallen', confidence: 0.87, investment: { code: '309e60' }, collection: { catalog: 1, name: 'Temporal Cover', level: 2, nodes: [{ stat: 'atk' }, { stat: 'full_atk' }] } },
            { slug: 'flora', name: 'Flora', confidence: 0.75, investment: { code: '209e30' }, collection: { catalog: 14, name: "Stormwrath's Lull", level: 1, nodes: [{ stat: 'full_atk' }] } },
            { slug: 'kafka-hibino', name: 'Kafka Hibino', confidence: 0.80, investment: { code: '309e30' }, collection: { catalog: 3, name: 'Timeline Watch', level: 1, nodes: [{ stat: 'hp' }] } },
          ],
          substitute_teams: [],
        },
        {
          round: 3,
          matched_formation_key: 't3',
          matched_formation_label: 'Team 3',
          pet: null,
          heroes: [
            { slug: 'awakened-shemira', name: 'Shemira (Awakened)', confidence: 0.70, investment: { code: '309e66' }, collection: { catalog: 3, name: 'Timeline Watch', level: 2, nodes: [{ stat: 'hp' }, { stat: 'mp' }] } },
            { slug: 'harvey', name: 'Harvey', confidence: 0.68, investment: { code: '309e60' }, collection: { catalog: 3, name: 'Timeline Watch', level: 1, nodes: [{ stat: 'full_atk' }] } },
            { slug: 'sung-jinwoo', name: 'Sung Jinwoo', confidence: 0.86, investment: { code: '409e67' }, collection: { catalog: 18, name: 'Demon Sealer', level: 3, nodes: [{ stat: 'cda' }, { stat: 'atk' }] } },
            { slug: 'awakened-envydiel', name: 'Envydiel (Awakened)', confidence: 0.59, investment: { code: '4012e67' }, collection: { catalog: 18, name: 'Demon Sealer', level: 3, nodes: [{ stat: 'cda' }, { stat: 'atk' }] } },
            { slug: 'awakened-gavus', name: 'Gavus (Awakened)', confidence: 0.86, investment: { code: '309e60' }, collection: { catalog: 7, name: 'Captive Wings', level: 3, nodes: [{ stat: 'full_atk' }] } },
          ],
          substitute_teams: [],
        },
        {
          round: 4,
          matched_formation_key: 't4',
          matched_formation_label: 'Team 4',
          pet: null,
          heroes: [
            { slug: 'saitama', name: 'Saitama', confidence: 0.66, investment: { code: '309e30' }, collection: { catalog: 1, name: 'Temporal Cover', level: 2, nodes: [{ stat: 'full_atk' }] } },
            { slug: 'highborn-skylan', name: 'Skylan (Highborn)', confidence: 0.62, investment: { code: '409e68' }, collection: { catalog: 13, name: 'Shadowflow Blade', level: 3, nodes: [{ stat: 'atk' }, { stat: 'pp' }] } },
            { slug: 'gorok', name: 'Gorok', confidence: 0.76, investment: { code: '203e30' }, collection: { catalog: 1, name: 'Temporal Cover', level: 2, nodes: [{ stat: 'full_atk' }] } },
            { slug: 'valeri', name: 'Valeri', confidence: 0.55, investment: { code: '309e33' }, collection: { catalog: 3, name: 'Timeline Watch', level: 1, nodes: [{ stat: 'full_atk' }] } },
            { slug: 'awakened-theowyn', name: 'Theowyn (Awakened)', confidence: 0.56, investment: { code: '409e60' }, collection: { catalog: 10, name: 'Luminous Flight', level: 1, nodes: [{ stat: 'atk' }] } },
          ],
          substitute_teams: [],
        },
        {
          round: 5,
          matched_formation_key: 't5',
          matched_formation_label: 'Team 5',
          pet: null,
          heroes: [
            { slug: 'awakened-fawkes', name: 'Fawkes (Awakened)', confidence: 0.96, investment: { code: '409e60' }, collection: { catalog: 14, name: "Stormwrath's Lull", level: 3, nodes: [{ stat: 'mp' }, { stat: 'atk' }] } },
            { slug: 'alvida', name: 'Alvida', confidence: 0.73, investment: { code: '409e36' }, collection: { catalog: 12, name: 'Horn of Dominion', level: 3, nodes: [{ stat: 'hp' }, { stat: 'atk' }] } },
            { slug: 'awakened-lyca', name: 'Lyca (Awakened)', confidence: 0.63, investment: { code: '409e68' }, collection: { catalog: 13, name: 'Shadowflow Blade', level: 3, nodes: [{ stat: 'atk' }, { stat: 'pp' }] } },
            { slug: 'lysander', name: 'Lysander', confidence: 0.72, investment: { code: '309e62' }, collection: { catalog: 13, name: 'Shadowflow Blade', level: 1, nodes: [{ stat: 'pp' }] } },
            { slug: 'highborn-haelia', name: 'Haelia (Highborn)', confidence: 0.98, investment: { code: '409e61' }, collection: { catalog: 10, name: 'Luminous Flight', level: 2, nodes: [{ stat: 'atk' }, { stat: 'full_atk' }] } },
          ],
          substitute_teams: [],
        },
        {
          round: 6,
          matched_formation_key: 't6',
          matched_formation_label: 'Team 6',
          pet: null,
          heroes: [
            { slug: 'awakened-estrilda', name: 'Estrilda (Awakened)', confidence: 0.56, investment: { code: '409e61' }, collection: { catalog: 12, name: 'Horn of Dominion', level: 3, nodes: [{ stat: 'hp' }] } },
            { slug: 'highborn-odysseus', name: 'Odysseus (Highborn)', confidence: 0.78, investment: { code: '409e61' }, collection: { catalog: 3, name: 'Timeline Watch', level: 1, nodes: [{ stat: 'atk' }] } },
            { slug: 'highborn-thalassa', name: 'Thalassa (Highborn)', confidence: 0.92, investment: { code: '4012e61' }, collection: { catalog: 10, name: 'Luminous Flight', level: 1, nodes: [{ stat: 'heal' }] } },
            { slug: 'kyno', name: 'Kyno', confidence: 0.65, investment: { code: '309e60' }, collection: { catalog: 3, name: 'Timeline Watch', level: 1, nodes: [{ stat: 'full_atk' }, { stat: 'def' }] } },
            { slug: 'highborn-lan', name: 'Lan (Highborn)', confidence: 0.80, investment: { code: '409e0' }, collection: { catalog: 10, name: 'Luminous Flight', level: 1, nodes: [{ stat: 'atk' }] } },
          ],
          substitute_teams: [],
        },
        {
          round: 7,
          matched_formation_key: 't7',
          matched_formation_label: 'Team 7',
          pet: null,
          heroes: [
            { slug: 'skreg', name: 'Skreg', confidence: 0.33, investment: { code: '309e33' }, collection: { catalog: 1, name: 'Temporal Cover', level: 2, nodes: [{ stat: 'full_atk' }] } },
            { slug: 'athena', name: 'Athena', confidence: 0.76, investment: { code: '3012e33' }, collection: { catalog: 3, name: 'Timeline Watch', level: 1, nodes: [{ stat: 'ty' }, { stat: 'full_atk' }] } },
            { slug: 'awakened-eluard', name: 'Eluard (Awakened)', confidence: 0.51, investment: { code: '409e60' }, collection: { catalog: 14, name: "Stormwrath's Lull", level: 3, nodes: [{ stat: 'atk' }, { stat: 'mp' }] } },
            { slug: 'medusa', name: 'Medusa', confidence: 0.87, investment: { code: '309e30' }, collection: { catalog: 18, name: 'Demon Sealer', level: 3, nodes: [{ stat: 'cda' }, { stat: 'full_atk' }] } },
            { slug: 'highborn-elthara', name: 'Elthara (Highborn)', confidence: 0.81, investment: { code: '409e60' }, collection: { catalog: 14, name: "Stormwrath's Lull", level: 2, nodes: [{ stat: 'mp' }, { stat: 'erosion' }] } },
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

    const isMultiNcGrid =
      key.includes('5w6') || key.includes('3x6') || key.includes('multi-lineup') || (width >= 3400 && height >= 5000);
    if (isMultiNcGrid) {
      const makeRound = (round: number, petSlug: string, petName: string, heroSlugs: string[]) => ({
        round,
        matched_formation_key: `round-${round}`,
        matched_formation_label: `Round ${round}`,
        pet: { slug: petSlug, name: petName, confidence: 0.95, options: [petSlug] },
        heroes: heroSlugs.map((slug) => {
          const found = this.resolveHero(slug);
          return {
            slug,
            name: found ? displayHeroName(found) : slug,
            confidence: 0.94,
          };
        }),
        substitute_teams: [],
      });
      const sets = [
        {
          index: 0,
          label: 'Set 1 — Dolphin Account',
          teams: [
            makeRound(1, 'count-snickerfang', 'Count Snickerfang', ['awakened-estrilda', 'talimar', 'dracula', 'awakened-skriath', 'tavriel']),
            makeRound(2, 'aureus', 'Aureus', ['sion', 'laios', 'rimuru', 'awakened-pippa', 'lorsan']),
            makeRound(3, 'winged-lion', 'Winged Lion', ['awakened-envydiel', 'atheus', 'aurelia', 'misha', 'gorok']),
            makeRound(4, 'nightfall-pegasus', 'Nightfall Pegasus', ['lysander', 'daemia', 'begris', 'lavatune', 'awakened-eluard']),
            makeRound(5, 'twinlum-spirit', 'Twinlum Spirit', ['highborn-leviathan', 'highborn-elthara', 'awakened-theowyn', 'kyno', 'judy-punch']),
            makeRound(6, 'blazefang', 'Blazefang', ['awakened-hybris', 'misfortis', 'highborn-lan', 'athena', 'highborn-thalassa']),
          ],
        },
        {
          index: 1,
          label: 'Set 2 — Kraken Account',
          teams: [
            makeRound(1, 'count-snickerfang', 'Count Snickerfang', ['awakened-estrilda', 'talimar', 'dracula', 'awakened-skriath', 'tavriel']),
            makeRound(2, 'treatspector', 'Treatspector', ['sion', 'laios', 'athena', 'rimuru', 'lorsan']),
            makeRound(3, 'winged-lion', 'Winged Lion', ['awakened-pippa', 'misha', 'gorok', 'highborn-odysseus', 'awakened-envydiel']),
            makeRound(4, 'nightfall-pegasus', 'Nightfall Pegasus', ['lysander', 'daemia', 'begris', 'lavatune', 'awakened-eluard']),
            makeRound(5, 'twinlum-spirit', 'Twinlum Spirit', ['highborn-leviathan', 'highborn-elthara', 'awakened-theowyn', 'kyno', 'judy-punch']),
            makeRound(6, 'blazefang', 'Blazefang', ['kafka-hibino', 'misfortis', 'highborn-lan', 'awakened-hybris', 'highborn-thalassa']),
          ],
        },
        {
          index: 2,
          label: 'Set 3 — F2P Account',
          teams: [
            makeRound(1, 'joyous-roamer', 'Joyous Roamer', ['awakened-fawkes', 'awakened-estrilda', 'talimar', 'daemia', 'knox']),
            makeRound(2, 'aureus', 'Aureus', ['sion', 'laios', 'highborn-lan', 'kyno', 'awakened-pippa']),
            makeRound(3, 'blazefang', 'Blazefang', ['ivan', 'awakened-envydiel', 'tavriel', 'gorok', 'misha']),
            makeRound(4, 'nightfall-pegasus', 'Nightfall Pegasus', ['lysander', 'begris', 'awakened-eluard', 'aurelia', 'athena']),
            makeRound(5, 'pandy-dumpty', 'Pandy Dumpty', ['highborn-leviathan', 'lavatune', 'dracula', 'awakened-hybris', 'judy-punch']),
            makeRound(6, 'twinlum-spirit', 'Twinlum Spirit', ['awakened-thoran', 'highborn-odysseus', 'velufira', 'highborn-elthara', 'awakened-theowyn']),
          ],
        },
      ];
      this.applyRecognitionResponse({
        ok: true,
        best_mode: {
          mode_slug: 'nightmare-corridor',
          mode_name: 'Nightmare Corridor',
          target_slug: 'infernal-overlord',
          target_name: 'Infernal Overlord',
          confidence: 0.99,
          reasons: ['3-column × 6-round multi-lineup grid matches Nightmare Corridor (3 separate 6-round lineups).'],
        },
        mode_alternatives: [
          { mode_slug: 'nightmare-corridor', mode_name: 'Nightmare Corridor', target_slug: 'netherspinner', target_name: 'Netherspinner', confidence: 0.42 },
        ],
        best_lineup_match: null,
        lineup_alternatives: [],
        review_suggestions: [],
        teams: sets[0].teams,
        lineup_sets: sets,
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
