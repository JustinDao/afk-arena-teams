import assert from 'node:assert/strict';
import test from 'node:test';
import { createCocoDataset } from '../coco-dataset.mjs';

test('exports COCO boxes with deterministic image IDs and source groups', () => {
  const dataset = createCocoDataset([
    {
      id: 'b',
      fileName: 'second.webp',
      width: 200,
      height: 100,
      sourceGroup: 'guide-b',
      annotations: [{ x: 10, y: 20, width: 30, height: 40 }],
    },
    {
      id: 'a',
      fileName: 'first.png',
      width: 80,
      height: 80,
      sourceGroup: 'guide-a',
      annotations: [],
    },
  ], '2026-11-07T00:00:00.000Z');

  assert.deepEqual(dataset.images, [
    { id: 1, file_name: 'first.png', width: 80, height: 80, license: 0, source_group: 'guide-a' },
    { id: 2, file_name: 'second.webp', width: 200, height: 100, license: 0, source_group: 'guide-b' },
  ]);
  assert.deepEqual(dataset.annotations, [{
    id: 1,
    image_id: 2,
    category_id: 1,
    bbox: [10, 20, 30, 40],
    area: 1200,
    iscrowd: 0,
    segmentation: [],
  }]);
  assert.equal(dataset.categories[0].name, 'game_icon');
  assert.equal(dataset.info.date_created, '2026-11-07T00:00:00.000Z');
});

test('keeps images without boxes as explicit background images', () => {
  const dataset = createCocoDataset([{
    id: 'negative',
    fileName: 'text-only.png',
    width: 640,
    height: 480,
    sourceGroup: 'guide-text',
    annotations: [],
  }]);

  assert.equal(dataset.images.length, 1);
  assert.equal(dataset.annotations.length, 0);
});

test('rejects duplicate file names and boxes outside source image bounds', () => {
  const valid = {
    id: 'one',
    fileName: 'guide.png',
    width: 100,
    height: 100,
    sourceGroup: 'guide',
    annotations: [],
  };
  assert.throws(() => createCocoDataset([
    valid,
    { ...valid, id: 'two' },
  ]), /file names must be unique/);
  assert.throws(() => createCocoDataset([{
    ...valid,
    annotations: [{ x: 90, y: 90, width: 20, height: 20 }],
  }]), /outside its image bounds/);
});

test('rejects missing group keys and malformed image dimensions', () => {
  const record = {
    id: 'one',
    fileName: 'guide.png',
    width: 100,
    height: 100,
    sourceGroup: '',
    annotations: [],
  };
  assert.throws(() => createCocoDataset([record]), /source group/);
  assert.throws(() => createCocoDataset([{ ...record, sourceGroup: 'guide', width: 0 }]), /invalid dimensions/);
  assert.throws(() => createCocoDataset([{ ...record, id: undefined }]), /stable ID and file name/);
});
