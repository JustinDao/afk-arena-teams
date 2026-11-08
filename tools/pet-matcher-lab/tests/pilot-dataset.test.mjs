import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

const repositoryRoot = new URL('../../../', import.meta.url);
const dataset = JSON.parse(await readFile(new URL('../../../afk-icon-pilot-coco.json', import.meta.url), 'utf8'));

test('pilot COCO dataset references valid PNGs and source-grouped lineup crops', async () => {
  assert.equal(dataset.images.length, 10);
  assert.equal(dataset.annotations.length, 168);
  assert.equal(dataset.categories.length, 1);
  assert.equal(dataset.categories[0].name, 'game_icon');
  assert.equal(new Set(dataset.images.map((image) => image.source_group)).size, 3);

  for (const image of dataset.images) {
    const bytes = await readFile(new URL(image.file_name, repositoryRoot));
    assert.equal(bytes.toString('hex', 0, 8), '89504e470d0a1a0a', `${image.file_name} should be a PNG`);
    assert.equal(bytes.readUInt32BE(16), image.width, `${image.file_name} width should match`);
    assert.equal(bytes.readUInt32BE(20), image.height, `${image.file_name} height should match`);

    for (const annotation of dataset.annotations.filter((item) => item.image_id === image.id)) {
      const [x, y, width, height] = annotation.bbox;
      assert.equal(annotation.category_id, 1);
      assert.equal(annotation.area, width * height);
      assert.equal(annotation.iscrowd, 0);
      assert.ok(x >= 0 && y >= 0 && width > 0 && height > 0);
      assert.ok(x + width <= image.width && y + height <= image.height);
    }
  }
});
