import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CollectionBuildEditorComponent } from './collection-build-editor.component';
import { COLLECTION_CATALOG, COLLECTION_NODE_STATS } from '../../collection-catalog';
import { CollectionNode } from '../../models';

describe('CollectionBuildEditorComponent', () => {
  let fixture: ComponentFixture<CollectionBuildEditorComponent>;
  let component: CollectionBuildEditorComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CollectionBuildEditorComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(CollectionBuildEditorComponent);
    component = fixture.componentInstance;
  });

  it('selects the correct stat and tier options in dropdowns on initial render', () => {
    const nodes: CollectionNode[] = [
      { slotIndex: 0, stat: 'erosion', tier: 'mythic' },
      { slotIndex: 1, stat: 'mp', tier: 'legendary' },
      { slotIndex: 6, stat: 'skill_level', tier: 'mythic' },
      { slotIndex: 7, stat: 'skill_level', tier: 'mythic' },
    ];

    fixture.componentRef.setInput('catalog', COLLECTION_CATALOG);
    fixture.componentRef.setInput('selectedCatalogId', 10);
    fixture.componentRef.setInput('nodeStats', COLLECTION_NODE_STATS);
    fixture.componentRef.setInput('nodes', nodes);
    fixture.detectChanges();

    const selectElements = fixture.nativeElement.querySelectorAll('fieldset .collection-node-form select') as NodeListOf<HTMLSelectElement>;
    // Each row with a stat node has either 1 select (if skill_level) or 2 selects (stat + tier).
    // Let's verify slot 0 (Attack 1) stat select
    const fieldsets = fixture.nativeElement.querySelectorAll('fieldset') as NodeListOf<HTMLFieldSetElement>;
    const attackGroup = fieldsets[0];
    const defenseGroup = fieldsets[1];
    const flexGroup = fieldsets[2];

    // Attack slot 0
    const attackRow0Select = attackGroup.querySelectorAll('.collection-node-form')[0].querySelector('select') as HTMLSelectElement;
    expect(attackRow0Select.value).toBe('erosion');
    expect(attackRow0Select.selectedOptions[0]?.value).toBe('erosion');
    expect(attackRow0Select.selectedOptions[0]?.text.trim()).toBe('EROSION');

    // Attack slot 1
    const attackRow1Select = attackGroup.querySelectorAll('.collection-node-form')[1].querySelector('select') as HTMLSelectElement;
    expect(attackRow1Select.value).toBe('mp');
    expect(attackRow1Select.selectedOptions[0]?.value).toBe('mp');
    expect(attackRow1Select.selectedOptions[0]?.text.trim()).toBe('MP');

    // Attack slot 2 (empty)
    const attackRow2Select = attackGroup.querySelectorAll('.collection-node-form')[2].querySelector('select') as HTMLSelectElement;
    expect(attackRow2Select.value).toBe('');
    expect(attackRow2Select.selectedOptions[0]?.text.trim()).toBe('No node');

    // Defense slot 0 (empty)
    const defRow0Select = defenseGroup.querySelectorAll('.collection-node-form')[0].querySelector('select') as HTMLSelectElement;
    expect(defRow0Select.value).toBe('');

    // Flex slot 0 (slotIndex 6: skill_level)
    const flexRow0Select = flexGroup.querySelectorAll('.collection-node-form')[0].querySelector('select') as HTMLSelectElement;
    expect(flexRow0Select.value).toBe('skill_level');
    expect(flexRow0Select.selectedOptions[0]?.value).toBe('skill_level');
    expect(flexRow0Select.selectedOptions[0]?.text.trim()).toBe('LEVEL');

    // Flex slot 1 (slotIndex 7: skill_level)
    const flexRow1Select = flexGroup.querySelectorAll('.collection-node-form')[1].querySelector('select') as HTMLSelectElement;
    expect(flexRow1Select.value).toBe('skill_level');
    expect(flexRow1Select.selectedOptions[0]?.value).toBe('skill_level');
    expect(flexRow1Select.selectedOptions[0]?.text.trim()).toBe('LEVEL');
  });

  it('updates nodes when user selects a different stat from the dropdown', () => {
    fixture.componentRef.setInput('catalog', COLLECTION_CATALOG);
    fixture.componentRef.setInput('selectedCatalogId', 10);
    fixture.componentRef.setInput('nodeStats', COLLECTION_NODE_STATS);
    fixture.componentRef.setInput('nodes', []);
    fixture.detectChanges();

    let emittedNodes: readonly CollectionNode[] = [];
    component.nodesChange.subscribe((n) => (emittedNodes = n));

    const fieldsets = fixture.nativeElement.querySelectorAll('fieldset') as NodeListOf<HTMLFieldSetElement>;
    const attackRow0Select = fieldsets[0].querySelectorAll('.collection-node-form')[0].querySelector('select') as HTMLSelectElement;

    attackRow0Select.value = 'atk';
    attackRow0Select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(emittedNodes.length).toBe(1);
    expect(emittedNodes[0].slotIndex).toBe(0);
    expect(emittedNodes[0].stat).toBe('atk');
  });
});
