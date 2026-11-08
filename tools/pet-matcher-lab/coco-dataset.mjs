export const COCO_CATEGORY = Object.freeze({
  id: 1,
  name: 'game_icon',
  supercategory: 'catalog_icon',
});

export function createCocoDataset(records, createdAt = new Date().toISOString()) {
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error('Add at least one source image before exporting COCO annotations.');
  }
  for (const record of records) {
    if (!record || typeof record.id !== 'string' || typeof record.fileName !== 'string' || !record.fileName.trim()) {
      throw new Error('Every source image needs a stable ID and file name.');
    }
  }

  const sortedRecords = [...records].sort((first, second) => (
    first.fileName.localeCompare(second.fileName) || first.id.localeCompare(second.id)
  ));
  const fileNames = new Set();
  const images = [];
  const annotations = [];

  for (const [imageIndex, record] of sortedRecords.entries()) {
    if (fileNames.has(record.fileName)) {
      throw new Error(`COCO image file names must be unique: "${record.fileName}".`);
    }
    fileNames.add(record.fileName);
    if (!Number.isInteger(record.width) || record.width < 1
      || !Number.isInteger(record.height) || record.height < 1) {
      throw new Error(`Image "${record.fileName}" has invalid dimensions.`);
    }
    if (typeof record.sourceGroup !== 'string' || !record.sourceGroup.trim()) {
      throw new Error(`Image "${record.fileName}" needs a source group for leakage-safe splits.`);
    }
    if (!Array.isArray(record.annotations)) {
      throw new Error(`Image "${record.fileName}" has invalid annotations.`);
    }

    const imageId = imageIndex + 1;
    images.push({
      id: imageId,
      file_name: record.fileName,
      width: record.width,
      height: record.height,
      license: 0,
      source_group: record.sourceGroup.trim(),
    });

    for (const annotation of record.annotations) {
      const { x, y, width, height } = annotation;
      if (![x, y, width, height].every(Number.isFinite)
        || x < 0 || y < 0 || width <= 0 || height <= 0
        || x + width > record.width || y + height > record.height) {
        throw new Error(`Image "${record.fileName}" contains a box outside its image bounds.`);
      }

      annotations.push({
        id: annotations.length + 1,
        image_id: imageId,
        category_id: COCO_CATEGORY.id,
        bbox: [x, y, width, height],
        area: width * height,
        iscrowd: 0,
        segmentation: [],
      });
    }
  }

  return {
    info: {
      description: 'AFK Arena guide catalog-icon detection dataset',
      version: '1.0',
      date_created: createdAt,
    },
    licenses: [{ id: 0, name: 'unspecified', url: '' }],
    images,
    annotations,
    categories: [COCO_CATEGORY],
  };
}
