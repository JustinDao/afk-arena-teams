'use strict';

import { rankWithLinearClassifier, trainLinearClassifier } from './linear-model.js';

const PETS = [
  [6001, 'Dreary Ball'], [6002, 'Tufty Ears'], [6003, 'Grassy Orb'], [6004, 'Polar Beast'],
  [6005, 'Fire Breather'], [6006, 'Blade Ridge'], [6007, 'Winged Lion'], [6008, 'Rock Crown Lizard'],
  [6009, 'Feline Vesperio'], [6010, 'Bellbellow'], [6011, 'Flutterplume Owl'], [6012, 'Talismane'],
  [6013, 'Phantasmoth'], [6014, 'Savage Soufflé'], [6015, 'Slumber Seal'], [6016, 'Fox Fatale'],
  [6017, 'Shroom Spooder'], [6018, 'Radish Rotunda'], [6019, 'Pandy Dumpty'], [6020, 'Ice Crown'],
  [6021, 'Aureus'], [6022, 'Pearlcrest Ibis'], [6023, 'Treatspector'], [6024, 'Joyous Roamer'],
  [6025, 'Trickery Chest'], [6026, 'Thistlekin'], [6027, 'Nightfall Pegasus'],
  [6028, 'Count Snickerfang'], [6029, 'Twinlum Spirit'], [6030, 'Blazefang'],
].map(([id, name]) => ({ id, name }));

const DB_NAME = 'afk-pet-matcher-lab';
const DB_VERSION = 1;
const DATASET_VERSION = 1;
const app = {
  database: null,
  examples: [],
  references: new Map(),
  guides: [],
  activeGuideId: '',
  sourceImage: null,
  selection: null,
  pointerStart: null,
  results: [],
  trainedModel: null,
  detection: {
    image: null,
    imageUrl: null,
    candidates: [],
  },
  toastTimer: 0,
};

const elements = Object.fromEntries([
  'detectionInput', 'detectionThreshold', 'scanImage', 'detectionStatus', 'detectionSummary',
  'detectionCanvas', 'detectionEmpty', 'detectionResults',
  'referenceInput', 'referenceStatus', 'guideInput', 'guideSplit', 'guidePicker', 'guideStatus',
  'imageEmpty', 'guideCanvas', 'cropCanvas', 'petLabel', 'sampleNote', 'saveSample', 'cropStatus',
  'datasetCount', 'importInput', 'exportDataset', 'clearDataset', 'datasetList',
  'evaluationSplit', 'runBenchmark', 'trainingEpochs', 'trainModel', 'exportModel', 'modelStatus',
  'exportResults', 'benchmarkStatus', 'benchmarkResults', 'toast',
].map((id) => [id, document.getElementById(id.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`))]));

const guideContext = elements.guideCanvas.getContext('2d', { willReadFrequently: true });
const cropContext = elements.cropCanvas.getContext('2d', { willReadFrequently: true });
const detectionContext = elements.detectionCanvas.getContext('2d');

const DETECTION_FEATURE_SIZE = 6;
const DETECTION_MAX_IMAGE_SIZE = 760;
const DETECTION_WINDOW_SIZES = [18, 24, 30, 38, 48, 60];
const DETECTION_MAX_CANDIDATES = 60;
const PET_ICON_CDN = 'https://raw.githubusercontent.com/afk-mine/cdn/main/framed_unit_icon';

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add('visible');
  window.clearTimeout(app.toastTimer);
  app.toastTimer = window.setTimeout(() => elements.toast.classList.remove('visible'), 3200);
}

function exportModel() {
  if (!app.trainedModel) return;
  downloadFile('afk-pet-matcher-model.json', JSON.stringify(app.trainedModel, null, 2), 'application/json');
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => resolve({ image, url });
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Could not read image "${file.name}".`));
    };
    image.src = url;
  });
}

function loadCdnImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load CDN reference "${url}".`));
    image.src = url;
  });
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('examples')) {
        database.createObjectStore('examples', { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open local dataset storage.'));
  });
}

function storeTransaction(mode, operation) {
  return new Promise((resolve, reject) => {
    const transaction = app.database.transaction('examples', mode);
    const request = operation(transaction.objectStore('examples'));
    transaction.oncomplete = () => resolve(request?.result);
    transaction.onerror = () => reject(transaction.error ?? new Error('Local dataset storage failed.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Local dataset storage was interrupted.'));
  });
}

function loadExamples() {
  return storeTransaction('readonly', (store) => store.getAll()).then((rows) => {
    app.examples = rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    renderExamples();
  });
}

function petLabel(id) {
  return PETS.find((pet) => pet.id === Number(id))?.name ?? 'Unknown pet';
}

function populatePetOptions() {
  const options = PETS.map(({ id, name }) => `<option value="${id}">${escapeHtml(name)}</option>`).join('');
  elements.petLabel.insertAdjacentHTML('beforeend', options);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function refreshReferenceStatus() {
  elements.referenceStatus.textContent = `${app.references.size} / ${PETS.length} reference icons loaded`;
  elements.referenceStatus.classList.toggle('ready', app.references.size === PETS.length);
}

function findPetId(filename) {
  const match = filename.match(/(?:^|[^0-9])(60[0-3][0-9])(?:[^0-9]|$)/);
  const id = match ? Number(match[1]) : null;
  return PETS.some((pet) => pet.id === id) ? id : null;
}

async function loadReferenceFiles(files) {
  const loaded = [];
  for (const file of files) {
    const id = findPetId(file.name);
    if (!id || !file.type.startsWith('image/')) continue;
    loaded.push({ id, file });
  }
  if (!loaded.length) {
    showToast('No pet icons found. Use image files named with catalog IDs such as 6030.webp.');
    return;
  }
  for (const { id, file } of loaded) {
    const { image, url } = await loadImage(file);
    const previousUrl = app.references.get(id)?.url;
    if (previousUrl) URL.revokeObjectURL(previousUrl);
    app.references.set(id, { image, url, fileName: file.name });
  }
  refreshReferenceStatus();
  showToast(`Loaded ${loaded.length} reference icon${loaded.length === 1 ? '' : 's'}.`);
}

async function loadCdnReferences() {
  const results = await Promise.allSettled(PETS.map(async (pet) => {
    const url = `${PET_ICON_CDN}/${pet.id}.webp`;
    const image = await loadCdnImage(url);
    app.references.set(pet.id, { image, url, fileName: `${pet.id}.webp (CDN square)` });
  }));
  const failures = results.filter((result) => result.status === 'rejected');
  refreshReferenceStatus();
  if (failures.length) {
    console.error('Some square CDN pet references could not be loaded:', failures);
    showToast(`Loaded ${app.references.size} square CDN references; ${failures.length} failed. You can supply local icons as overrides.`);
  }
}

function currentGuide() {
  return app.guides.find((guide) => guide.id === app.activeGuideId) ?? null;
}

function renderGuidePicker() {
  const selected = app.activeGuideId;
  elements.guidePicker.replaceChildren(new Option('Choose a guide', ''));
  for (const guide of app.guides) {
    const option = new Option(`${guide.name} · ${guide.split}`, guide.id);
    elements.guidePicker.add(option);
  }
  elements.guidePicker.value = selected;
  elements.guidePicker.disabled = app.guides.length === 0;
}

function showGuide(guide) {
  app.activeGuideId = guide?.id ?? '';
  app.sourceImage = guide?.image ?? null;
  app.selection = null;
  elements.imageEmpty.hidden = Boolean(guide);
  elements.guideCanvas.hidden = !guide;
  elements.guidePicker.value = guide?.id ?? '';
  elements.guideSplit.value = guide?.split ?? 'test';
  elements.guideStatus.textContent = guide ? `${guide.name} · ${guide.split}` : 'No guide selected';
  elements.guideStatus.classList.toggle('ready', Boolean(guide));
  elements.cropStatus.textContent = guide ? 'Drag around one pet in the image.' : 'Draw a crop on the guide image first.';
  elements.petLabel.value = '';
  elements.petLabel.disabled = !guide;
  elements.sampleNote.value = '';
  elements.saveSample.disabled = true;
  cropContext.clearRect(0, 0, elements.cropCanvas.width, elements.cropCanvas.height);
  if (!guide) return;
  elements.guideCanvas.width = guide.image.naturalWidth;
  elements.guideCanvas.height = guide.image.naturalHeight;
  guideContext.clearRect(0, 0, elements.guideCanvas.width, elements.guideCanvas.height);
  guideContext.drawImage(guide.image, 0, 0);
}

async function updateGuideSplit(split) {
  const guide = currentGuide();
  if (!guide) return;
  guide.split = split;
  renderGuidePicker();
  elements.guidePicker.value = guide.id;
  elements.guideStatus.textContent = `${guide.name} · ${guide.split}`;
  const sampleRows = document.querySelectorAll(`[data-guide-id="${CSS.escape(guide.id)}"] .split-pill`);
  sampleRows.forEach((element) => { element.textContent = split; });
  const updates = app.examples.filter((example) => example.guideId === guide.id);
  for (const sample of updates) {
    sample.split = split;
  }
  await Promise.all(updates.map((sample) => storeTransaction('readwrite', (store) => store.put(sample))));
}

function pointerPosition(event) {
  const rect = elements.guideCanvas.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(elements.guideCanvas.width, (event.clientX - rect.left) * elements.guideCanvas.width / rect.width)),
    y: Math.max(0, Math.min(elements.guideCanvas.height, (event.clientY - rect.top) * elements.guideCanvas.height / rect.height)),
  };
}

function drawSelection(selection) {
  const guide = currentGuide();
  if (!guide) return;
  guideContext.clearRect(0, 0, elements.guideCanvas.width, elements.guideCanvas.height);
  guideContext.drawImage(guide.image, 0, 0);
  if (!selection || selection.width < 1 || selection.height < 1) return;
  guideContext.save();
  guideContext.fillStyle = 'rgb(5 8 14 / 56%)';
  guideContext.fillRect(0, 0, elements.guideCanvas.width, elements.guideCanvas.height);
  guideContext.clearRect(selection.x, selection.y, selection.width, selection.height);
  guideContext.drawImage(
    guide.image,
    selection.x, selection.y, selection.width, selection.height,
    selection.x, selection.y, selection.width, selection.height,
  );
  guideContext.strokeStyle = '#ff6caa';
  guideContext.lineWidth = Math.max(2, elements.guideCanvas.width / 500);
  guideContext.strokeRect(selection.x, selection.y, selection.width, selection.height);
  guideContext.restore();
}

function updateCropPreview(selection) {
  if (!app.sourceImage || !selection || selection.width < 3 || selection.height < 3) {
    app.selection = null;
    cropContext.clearRect(0, 0, elements.cropCanvas.width, elements.cropCanvas.height);
    elements.saveSample.disabled = true;
    elements.cropStatus.textContent = 'Draw a crop on the guide image first.';
    drawSelection(null);
    return;
  }
  app.selection = selection;
  cropContext.clearRect(0, 0, elements.cropCanvas.width, elements.cropCanvas.height);
  cropContext.fillStyle = '#111621';
  cropContext.fillRect(0, 0, elements.cropCanvas.width, elements.cropCanvas.height);
  const side = Math.max(selection.width, selection.height);
  const sx = Math.max(0, selection.x + (selection.width - side) / 2);
  const sy = Math.max(0, selection.y + (selection.height - side) / 2);
  const square = Math.min(side, app.sourceImage.naturalWidth - sx, app.sourceImage.naturalHeight - sy);
  cropContext.drawImage(app.sourceImage, sx, sy, square, square, 8, 8, 176, 176);
  elements.saveSample.disabled = false;
  elements.cropStatus.textContent = `${Math.round(selection.width)} × ${Math.round(selection.height)} px selected.`;
  drawSelection(selection);
}

function canvasBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not encode the selected crop.')), 'image/png');
  });
}

function blobDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error ?? new Error('Could not encode the dataset image.'));
    reader.readAsDataURL(blob);
  });
}

async function saveSample() {
  const guide = currentGuide();
  if (!guide || !app.selection) return;
  const petId = Number(elements.petLabel.value);
  if (!PETS.some((pet) => pet.id === petId)) {
    showToast('Choose the correct pet before saving this crop.');
    return;
  }
  const image = await blobDataUrl(await canvasBlob(elements.cropCanvas));
  const example = {
    id: crypto.randomUUID(),
    petId,
    petName: petLabel(petId),
    guideId: guide.id,
    guideName: guide.name,
    split: guide.split,
    note: elements.sampleNote.value.trim(),
    crop: {
      x: app.selection.x / guide.image.naturalWidth,
      y: app.selection.y / guide.image.naturalHeight,
      width: app.selection.width / guide.image.naturalWidth,
      height: app.selection.height / guide.image.naturalHeight,
    },
    sourceWidth: guide.image.naturalWidth,
    sourceHeight: guide.image.naturalHeight,
    image,
    createdAt: new Date().toISOString(),
  };
  await storeTransaction('readwrite', (store) => store.put(example));
  app.examples.push(example);
  renderExamples();
  app.selection = null;
  elements.petLabel.value = '';
  elements.sampleNote.value = '';
  elements.saveSample.disabled = true;
  elements.cropStatus.textContent = 'Saved. Draw the next crop when ready.';
  cropContext.clearRect(0, 0, elements.cropCanvas.width, elements.cropCanvas.height);
  drawSelection(null);
}

function renderExamples() {
  elements.datasetCount.textContent = `${app.examples.length} example${app.examples.length === 1 ? '' : 's'}`;
  elements.exportDataset.disabled = app.examples.length === 0;
  elements.clearDataset.disabled = app.examples.length === 0;
  if (!app.examples.length) {
    elements.datasetList.innerHTML = '<p class="empty-state small">Saved examples appear here. They are stored in this browser until exported or cleared.</p>';
    return;
  }
  elements.datasetList.innerHTML = app.examples.map((example) => `
    <article class="sample-row" data-guide-id="${escapeHtml(example.guideId)}">
      <img src="${example.image}" alt="${escapeHtml(example.petName)} crop">
      <div class="sample-name">
        <strong>${escapeHtml(example.petName)}</strong>
        <span>${escapeHtml(example.guideName)}${example.note ? ` · ${escapeHtml(example.note)}` : ''}</span>
      </div>
      <span class="split-pill">${escapeHtml(example.split)}</span>
      <button class="remove-sample" type="button" data-remove="${escapeHtml(example.id)}" aria-label="Remove ${escapeHtml(example.petName)} sample">Remove</button>
    </article>
  `).join('');
}

function imageFromDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('A dataset crop could not be decoded.'));
    image.src = dataUrl;
  });
}

function pixelsFor(image, size, region = null) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas is unavailable.');
  if (region) {
    context.drawImage(image, region.x, region.y, region.width, region.height, 0, 0, size, size);
  } else {
    context.drawImage(image, 0, 0, size, size);
  }
  const rgba = context.getImageData(0, 0, size, size).data;
  const rgb = new Float32Array(size * size * 3);
  for (let index = 0; index < size * size; index++) {
    rgb[index * 3] = rgba[index * 4] / 255;
    rgb[index * 3 + 1] = rgba[index * 4 + 1] / 255;
    rgb[index * 3 + 2] = rgba[index * 4 + 2] / 255;
  }
  return rgb;
}

function cropRegions(image, points = [-0.05, 0, 0.05]) {
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  const cropSize = Math.min(width, height) * 0.78;
  const baseX = width / 2 + width * 0.07;
  const baseY = height / 2;
  const regions = [];
  for (const y of points) {
    for (const x of points) {
      const left = Math.max(0, Math.min(width - cropSize, baseX + width * x - cropSize / 2));
      const top = Math.max(0, Math.min(height - cropSize, baseY + height * y - cropSize / 2));
      regions.push({ x: left, y: top, width: cropSize, height: cropSize });
    }
  }
  return regions;
}

function referenceViews(image) {
  return image.naturalWidth === image.naturalHeight
    ? [null]
    : cropRegions(image, [0]);
}

function squaredDistance(first, second) {
  let total = 0;
  for (let index = 0; index < first.length; index++) {
    const difference = first[index] - second[index];
    total += difference * difference;
  }
  return total / first.length;
}

function detectionFeature(data, imageWidth, imageHeight, x, y, windowSize) {
  const feature = new Float32Array(DETECTION_FEATURE_SIZE * DETECTION_FEATURE_SIZE * 3);
  let outputIndex = 0;
  for (let row = 0; row < DETECTION_FEATURE_SIZE; row++) {
    const sourceY = Math.min(imageHeight - 1, Math.floor(y + (row + 0.5) * windowSize / DETECTION_FEATURE_SIZE));
    for (let column = 0; column < DETECTION_FEATURE_SIZE; column++) {
      const sourceX = Math.min(imageWidth - 1, Math.floor(x + (column + 0.5) * windowSize / DETECTION_FEATURE_SIZE));
      const sourceIndex = (sourceY * imageWidth + sourceX) * 4;
      feature[outputIndex++] = data[sourceIndex] / 255;
      feature[outputIndex++] = data[sourceIndex + 1] / 255;
      feature[outputIndex++] = data[sourceIndex + 2] / 255;
    }
  }
  return feature;
}

function intersectionOverUnion(first, second) {
  const left = Math.max(first.x, second.x);
  const top = Math.max(first.y, second.y);
  const right = Math.min(first.x + first.width, second.x + second.width);
  const bottom = Math.min(first.y + first.height, second.y + second.height);
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  const union = first.width * first.height + second.width * second.height - intersection;
  return union ? intersection / union : 0;
}

function nonMaximumSuppression(candidates, overlapThreshold = 0.5) {
  const accepted = [];
  for (const candidate of candidates) {
    if (accepted.every((previous) => intersectionOverUnion(candidate, previous) <= overlapThreshold)) {
      accepted.push(candidate);
      if (accepted.length >= DETECTION_MAX_CANDIDATES) break;
    }
  }
  return accepted;
}

function scanDetectionImage(image, templates, minimumConfidence, onProgress) {
  const scale = Math.min(1, DETECTION_MAX_IMAGE_SIZE / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas is unavailable for pet detection.');
  context.drawImage(image, 0, 0, width, height);
  const source = context.getImageData(0, 0, width, height).data;
  const templateFeatures = templates.map((pet) => ({
    petId: pet.id,
    name: pet.name,
    feature: pixelsFor(app.references.get(pet.id).image, DETECTION_FEATURE_SIZE),
  }));
  const rawCandidates = [];
  let totalWindows = 0;
  for (const windowSize of DETECTION_WINDOW_SIZES) {
    if (windowSize >= width || windowSize >= height) continue;
    const step = Math.max(4, Math.round(windowSize * 0.25));
    totalWindows += (Math.floor((width - windowSize) / step) + 1)
      * (Math.floor((height - windowSize) / step) + 1);
  }
  let processedWindows = 0;
  let bestConfidence = 0;
  let bestCandidate = null;

  for (const windowSize of DETECTION_WINDOW_SIZES) {
    if (windowSize >= width || windowSize >= height) continue;
    const step = Math.max(4, Math.round(windowSize * 0.25));
    for (let y = 0; y + windowSize <= height; y += step) {
      for (let x = 0; x + windowSize <= width; x += step) {
        const feature = detectionFeature(source, width, height, x, y, windowSize);
        let best = null;
        let second = null;
        for (const template of templateFeatures) {
          const distance = squaredDistance(feature, template.feature);
          if (!best || distance < best.distance) {
            second = best;
            best = { ...template, distance };
          } else if (!second || distance < second.distance) {
            second = { ...template, distance };
          }
        }

        const margin = Math.max(0, (second?.distance ?? 0) - best.distance);
        const similarity = Math.max(0, 1 - Math.sqrt(best.distance) / 0.8);
        const distinctiveness = margin / (margin + 0.004);
        const confidence = 100 * similarity * distinctiveness;
        if (confidence > bestConfidence) {
          bestConfidence = confidence;
          bestCandidate = {
            petId: best.petId,
            name: best.name,
            confidence,
            similarity: 100 * similarity,
            margin,
            distance: best.distance,
            x: x / scale,
            y: y / scale,
            width: windowSize / scale,
            height: windowSize / scale,
          };
        }
        if (confidence >= minimumConfidence) {
          rawCandidates.push({
            petId: best.petId,
            name: best.name,
            confidence,
            similarity: 100 * similarity,
            margin,
            distance: best.distance,
            x: x / scale,
            y: y / scale,
            width: windowSize / scale,
            height: windowSize / scale,
          });
        }
        processedWindows++;
        if (processedWindows % 5000 === 0) onProgress(processedWindows, totalWindows);
      }
    }
  }
  const detections = nonMaximumSuppression(rawCandidates.sort((a, b) => b.confidence - a.confidence));
  return { detections, bestCandidate, totalWindows, width, height, scale };
}

function drawDetectionOverlay(image, detections) {
  const canvas = elements.detectionCanvas;
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  detectionContext.clearRect(0, 0, canvas.width, canvas.height);
  detectionContext.drawImage(image, 0, 0);
  const baseFont = Math.max(14, canvas.width / 90);
  for (const [index, detection] of detections.entries()) {
    detectionContext.lineWidth = Math.max(3, canvas.width / 450);
    detectionContext.strokeStyle = '#62edb5';
    detectionContext.strokeRect(detection.x, detection.y, detection.width, detection.height);
    const text = `${index + 1}. ${detection.name} ${Math.round(detection.confidence)}%`;
    detectionContext.font = `700 ${baseFont}px system-ui, sans-serif`;
    const textWidth = detectionContext.measureText(text).width;
    const labelY = Math.max(baseFont + 4, detection.y);
    detectionContext.fillStyle = '#0c211a';
    detectionContext.fillRect(detection.x, labelY - baseFont - 5, textWidth + 12, baseFont + 8);
    detectionContext.fillStyle = '#9bffd7';
    detectionContext.fillText(text, detection.x + 6, labelY - 3);
  }
}

function renderDetectionResults(detections, bestCandidate, minimumConfidence, totalWindows) {
  const acceptedCount = detections.length;
  const list = detections.slice(0, 30);
  elements.detectionSummary.innerHTML = `
    <span>${totalWindows.toLocaleString()} windows scanned</span>
    <span class="accepted-count">${acceptedCount} accepted after overlap suppression</span>
    <span>Threshold ${minimumConfidence}%</span>
    ${bestCandidate ? `<span>Best candidate ${escapeHtml(bestCandidate.name)} · ${Math.round(bestCandidate.confidence)}%</span>` : ''}
  `;
  if (!list.length) {
    elements.detectionResults.innerHTML = `<p class="empty-state small">No candidate passed ${minimumConfidence}% confidence. Best candidate: ${bestCandidate ? `${escapeHtml(bestCandidate.name)} at ${Math.round(bestCandidate.confidence)}% (x ${Math.round(bestCandidate.x)}, y ${Math.round(bestCandidate.y)}).` : 'none'} Lower the threshold to inspect weaker hits.</p>`;
    return;
  }
  elements.detectionResults.innerHTML = list.map((detection, index) => `
    <article class="detection-row">
      <strong>${index + 1}. ${escapeHtml(detection.name)}</strong>
      <span class="accepted-label">${Math.round(detection.confidence)}% · candidate</span>
      <span>x ${Math.round(detection.x)}, y ${Math.round(detection.y)} · ${Math.round(detection.width)}×${Math.round(detection.height)} px</span>
      <span>${Math.round(detection.similarity)}% appearance · ${detection.margin.toFixed(3)} lead</span>
    </article>
  `).join('') + (acceptedCount > list.length
    ? `<p class="hint">Showing the strongest ${list.length} of ${acceptedCount} accepted detections.</p>`
    : '');
}

async function runPetDetection() {
  const image = app.detection.image;
  if (!image) {
    showToast('Choose a guide image to scan.');
    return;
  }
  const references = PETS.filter((pet) => app.references.has(pet.id));
  if (references.length < 2) {
    showToast('Load at least two pet reference icons before scanning.');
    return;
  }
  const minimumConfidence = Number(elements.detectionThreshold.value);
  if (!Number.isFinite(minimumConfidence) || minimumConfidence < 0 || minimumConfidence > 100) {
    showToast('Minimum confidence must be from 0 to 100.');
    return;
  }
  elements.scanImage.disabled = true;
  elements.detectionStatus.textContent = 'Scanning…';
  elements.detectionSummary.textContent = 'Checking multiple sizes and positions.';
  try {
    const result = scanDetectionImage(image, references, minimumConfidence, (done, total) => {
      elements.detectionStatus.textContent = `Scanning ${Math.round(done / total * 100)}%…`;
    });
    app.detection.candidates = result.detections;
    drawDetectionOverlay(image, result.detections);
    renderDetectionResults(result.detections, result.bestCandidate, minimumConfidence, result.totalWindows);
    elements.detectionStatus.textContent = `${result.detections.length} candidates passed threshold`;
    elements.detectionSummary.insertAdjacentHTML('beforeend', `<span>Search scale ${Math.round(result.width)}×${Math.round(result.height)}</span>`);
  } catch (error) {
    console.error(error);
    elements.detectionStatus.textContent = 'Scan failed';
    showToast(error instanceof Error ? error.message : 'Pet detection scan failed.');
  } finally {
    elements.scanImage.disabled = false;
  }
}

function makeHistogram(image, bins = 16) {
  const pixels = pixelsFor(image, 32);
  const histogram = new Float32Array(bins * 3);
  for (let index = 0; index < pixels.length; index += 3) {
    for (let channel = 0; channel < 3; channel++) {
      const bin = Math.min(bins - 1, Math.floor(pixels[index + channel] * bins));
      histogram[channel * bins + bin]++;
    }
  }
  for (let channel = 0; channel < 3; channel++) {
    let total = 0;
    for (let bin = 0; bin < bins; bin++) total += histogram[channel * bins + bin];
    for (let bin = 0; bin < bins; bin++) histogram[channel * bins + bin] /= total || 1;
  }
  return histogram;
}

function histogramDistance(first, second) {
  let total = 0;
  for (let index = 0; index < first.length; index++) total += Math.abs(first[index] - second[index]);
  return total / first.length;
}

function buildModelData() {
  const catalog = [];
  for (const pet of PETS) {
    const reference = app.references.get(pet.id);
    if (!reference) continue;
    const image = reference.image;
    const appViews = referenceViews(image).map((region) => pixelsFor(image, 16, region));
    catalog.push({
      petId: pet.id,
      appViews,
      rgb8: pixelsFor(image, 8),
      histogram: makeHistogram(image),
    });
  }
  return catalog;
}

function currentAppDistance(image, template) {
  const queryFeatures = cropRegions(image).map((region) => pixelsFor(image, 16, region));
  let total = 0;
  for (const query of queryFeatures) {
    for (const reference of template.appViews) total += squaredDistance(query, reference);
  }
  return total / (queryFeatures.length * template.appViews.length);
}

function bestAlignedDistance(image, template, alignmentCount) {
  const distances = cropRegions(image).map((region) => {
    const query = pixelsFor(image, 16, region);
    return Math.min(...template.appViews.map((reference) => squaredDistance(query, reference)));
  }).sort((a, b) => a - b);
  const bestAlignments = distances.slice(0, alignmentCount);
  return bestAlignments.reduce((total, distance) => total + distance, 0) / bestAlignments.length;
}

function catalogRankings(image, catalog) {
  const query8 = pixelsFor(image, 8);
  const queryHistogram = makeHistogram(image);
  return {
    'App-style RGB 16×16': catalog.map((template) => ({
      petId: template.petId, distance: currentAppDistance(image, template),
    })).sort((a, b) => a.distance - b.distance),
    'Best-aligned RGB 16×16': catalog.map((template) => ({
      petId: template.petId, distance: bestAlignedDistance(image, template, 3),
    })).sort((a, b) => a.distance - b.distance),
    'Single-best RGB 16×16': catalog.map((template) => ({
      petId: template.petId, distance: bestAlignedDistance(image, template, 1),
    })).sort((a, b) => a.distance - b.distance),
    'Best-five RGB 16×16': catalog.map((template) => ({
      petId: template.petId, distance: bestAlignedDistance(image, template, 5),
    })).sort((a, b) => a.distance - b.distance),
    'RGB pixels 8×8 baseline': catalog.map((template) => ({
      petId: template.petId, distance: squaredDistance(query8, template.rgb8),
    })).sort((a, b) => a.distance - b.distance),
    'RGB color histogram': catalog.map((template) => ({
      petId: template.petId, distance: histogramDistance(queryHistogram, template.histogram),
    })).sort((a, b) => a.distance - b.distance),
  };
}

function prototypeRankings(image, trainExamples) {
  if (!trainExamples.length) return null;
  const query = pixelsFor(image, 16);
  const featuresByPet = new Map();
  for (const example of trainExamples) {
    if (!featuresByPet.has(example.petId)) featuresByPet.set(example.petId, []);
    featuresByPet.get(example.petId).push({ feature: example.feature, distance: squaredDistance(query, example.feature) });
  }
  return [...featuresByPet.entries()].map(([petId, examples]) => {
    examples.sort((a, b) => a.distance - b.distance);
    const nearest = examples.slice(0, 3);
    return {
      petId: Number(petId),
      distance: nearest.reduce((total, item) => total + item.distance, 0) / nearest.length,
    };
  }).sort((a, b) => a.distance - b.distance);
}

function metricsFor(rows) {
  const count = rows.length;
  const top1 = rows.filter((row) => row.ranking[0]?.petId === row.expected).length / count;
  const top3 = rows.filter((row) => row.ranking.slice(0, 3).some((item) => item.petId === row.expected)).length / count;
  const reciprocalRank = rows.reduce((total, row) => {
    const index = row.ranking.findIndex((item) => item.petId === row.expected);
    return total + (index < 0 ? 0 : 1 / (index + 1));
  }, 0) / count;
  return { count, top1, top3, reciprocalRank };
}

function percent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function renderBenchmark(allRows, split, trainingCount, missingReferences) {
  const summaries = [...new Set(allRows.map((row) => row.model))].map((model) => {
    const rows = allRows.filter((row) => row.model === model);
    return { model, ...metricsFor(rows), rows };
  });
  const warning = missingReferences
    ? `<p class="hint">${missingReferences} catalog icon${missingReferences === 1 ? '' : 's'} missing; rankings only cover loaded references.</p>`
    : '';
  elements.benchmarkResults.innerHTML = `${warning}${summaries.map((summary) => `
    <section>
      <p class="model-title">${escapeHtml(summary.model)}</p>
      <div class="metrics">
        <div class="metric"><span>Examples · ${escapeHtml(split)}</span><strong>${summary.count}</strong></div>
        <div class="metric"><span>Top-1 accuracy</span><strong>${percent(summary.top1)}</strong></div>
        <div class="metric"><span>Top-3 accuracy</span><strong>${percent(summary.top3)}</strong></div>
        <div class="metric"><span>Mean reciprocal rank</span><strong>${summary.reciprocalRank.toFixed(3)}</strong></div>
      </div>
      <table class="rankings">
        <thead><tr><th>Guide / crop</th><th>Expected</th><th>Top candidate</th><th>Top-3</th><th>Correct rank</th></tr></thead>
        <tbody>${summary.rows.map((row) => {
          const rank = row.ranking.findIndex((item) => item.petId === row.expected) + 1;
          const top = row.ranking[0] ? petLabel(row.ranking[0].petId) : 'No candidates';
          const correct = rank === 1;
          return `<tr>
            <td>${escapeHtml(row.guideName)}${row.note ? ` · ${escapeHtml(row.note)}` : ''}</td>
            <td>${escapeHtml(petLabel(row.expected))}</td>
            <td class="${correct ? 'correct' : 'wrong'}">${escapeHtml(top)}</td>
            <td>${row.ranking.slice(0, 3).map((entry) => escapeHtml(petLabel(entry.petId))).join(', ')}</td>
            <td>${rank ? `#${rank}` : 'not ranked'}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </section>
  `).join('')  }${trainingCount ? `<p class="hint">${trainingCount} labeled training crop${trainingCount === 1 ? '' : 's'} available.</p>` : ''}`;
  app.results = allRows.map((row) => ({
    model: row.model,
    split,
    guide: row.guideName,
    expectedId: row.expected,
    expected: petLabel(row.expected),
    rank: row.ranking.findIndex((item) => item.petId === row.expected) + 1 || '',
    top1Id: row.ranking[0]?.petId ?? '',
    top1: row.ranking[0] ? petLabel(row.ranking[0].petId) : '',
    top3: row.ranking.slice(0, 3).map((entry) => petLabel(entry.petId)).join(' | '),
    top1Distance: row.ranking[0]?.distance ?? '',
  }));
  elements.exportResults.disabled = app.results.length === 0;
}

async function trainModel() {
  const trainingRows = app.examples.filter((example) => example.split === 'train');
  if (!trainingRows.length) {
    showToast('Assign labeled examples from training guides to the Train split first.');
    return;
  }
  const epochs = Number(elements.trainingEpochs.value);
  if (!Number.isInteger(epochs) || epochs < 1 || epochs > 5000) {
    showToast('Training epochs must be an integer from 1 to 5000.');
    return;
  }
  elements.trainModel.disabled = true;
  elements.modelStatus.textContent = `Training on ${trainingRows.length} labeled crop${trainingRows.length === 1 ? '' : 's'}…`;
  try {
    const trainingExamples = await Promise.all(trainingRows.map(async (example) => ({
      ...example,
      imageElement: await imageFromDataUrl(example.image),
    })));
    const model = trainLinearClassifier(trainingExamples.map((example) => ({
      petId: example.petId,
      feature: pixelsFor(example.imageElement, 16),
    })), { epochs });
    const trainingAccuracy = trainingExamples.filter((example) => (
      rankWithLinearClassifier(pixelsFor(example.imageElement, 16), model)[0]?.petId === example.petId
    )).length / trainingExamples.length;
    model.pets = model.classes.map((id) => ({ id, name: petLabel(id) }));
    model.training.trainAccuracy = trainingAccuracy;
    model.training.classCount = model.classes.length;
    app.trainedModel = model;
    elements.exportModel.disabled = false;
    const coverageWarning = model.classes.length < PETS.length
      ? ` Only ${model.classes.length}/${PETS.length} pet classes are covered; untrained pets cannot be suggested.`
      : '';
    const sparseClasses = Object.values(model.training.classCounts).filter((count) => count < 3).length;
    const sampleWarning = sparseClasses
      ? ` ${sparseClasses} class${sparseClasses === 1 ? '' : 'es'} have fewer than 3 training crops.`
      : '';
    elements.modelStatus.textContent = `Model trained: ${model.classes.length} pet classes, ${trainingExamples.length} crops. Training accuracy ${percent(trainingAccuracy)} is not a quality measure.${coverageWarning}${sampleWarning} Evaluate on held-out guides.`;
    const split = elements.evaluationSplit.value;
    if (app.examples.some((example) => example.split === split)) await runBenchmark();
  } catch (error) {
    console.error(error);
    elements.modelStatus.textContent = 'Model training failed.';
    showToast(error instanceof Error ? error.message : 'Local model training failed.');
  } finally {
    elements.trainModel.disabled = false;
  }
}

async function runBenchmark() {
  const split = elements.evaluationSplit.value;
  const samples = app.examples.filter((example) => example.split === split);
  if (!samples.length) {
    showToast(`There are no ${split} examples to evaluate.`);
    return;
  }
  if (!app.references.size) {
    showToast('Load reference pet icons before evaluating catalog matchers.');
    return;
  }
  elements.runBenchmark.disabled = true;
  elements.benchmarkStatus.textContent = 'Evaluating locally…';
  try {
    const catalog = buildModelData();
    const trainingRows = await Promise.all(app.examples
      .filter((example) => example.split === 'train')
      .map(async (example) => ({ ...example, imageElement: await imageFromDataUrl(example.image) })));
    const trainExamples = trainingRows.map((example) => ({
      ...example,
      feature: pixelsFor(example.imageElement, 16),
    }));
    const rows = [];
    for (const example of samples) {
      const image = await imageFromDataUrl(example.image);
      const rankings = catalogRankings(image, catalog);
      for (const [model, ranking] of Object.entries(rankings)) {
        rows.push({ model, ranking, expected: example.petId, guideName: example.guideName, note: example.note });
      }
      if (app.trainedModel) {
        rows.push({
          model: 'Trained linear softmax classifier',
          ranking: rankWithLinearClassifier(pixelsFor(image, 16), app.trainedModel)
            .map(({ petId, probability }) => ({ petId, distance: -probability })),
          expected: example.petId,
          guideName: example.guideName,
          note: example.note,
        });
      }
      if (split !== 'train') {
        const ranking = prototypeRankings(image, trainExamples);
        if (ranking) rows.push({
          model: 'Labeled-crop 3-NN prototype',
          ranking,
          expected: example.petId,
          guideName: example.guideName,
          note: example.note,
        });
      }
    }
    if (!rows.length) {
      showToast('No model rankings could be produced. Check that the selected icons are valid images.');
      return;
    }
    renderBenchmark(rows, split, trainExamples.length, PETS.length - catalog.length);
    elements.benchmarkStatus.textContent = `${samples.length} ${split} example${samples.length === 1 ? '' : 's'} evaluated`;
  } catch (error) {
    console.error(error);
    elements.benchmarkStatus.textContent = 'Evaluation failed';
    showToast(error instanceof Error ? error.message : 'Local evaluation failed.');
  } finally {
    elements.runBenchmark.disabled = false;
  }
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportDataset() {
  const payload = {
    schema: 'afk-arena-pet-matcher-lab',
    version: DATASET_VERSION,
    exportedAt: new Date().toISOString(),
    pets: PETS,
    examples: app.examples,
  };
  downloadFile('pet-matcher-dataset.json', JSON.stringify(payload, null, 2), 'application/json');
}

function csvCell(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function exportResults() {
  if (!app.results.length) return;
  const columns = ['model', 'split', 'guide', 'expectedId', 'expected', 'rank', 'top1Id', 'top1', 'top3', 'top1Distance'];
  const lines = [columns.join(','), ...app.results.map((row) => columns.map((column) => csvCell(row[column])).join(','))];
  downloadFile('pet-matcher-evaluation.csv', lines.join('\n'), 'text/csv');
}

async function importDataset(file) {
  const payload = JSON.parse(await file.text());
  if (payload?.schema !== 'afk-arena-pet-matcher-lab' || payload?.version !== DATASET_VERSION || !Array.isArray(payload.examples)) {
    throw new Error('Unsupported dataset file or schema version.');
  }
  const validIds = new Set(PETS.map((pet) => pet.id));
  const rows = payload.examples.filter((example) => (
    typeof example?.id === 'string'
    && validIds.has(Number(example.petId))
    && ['train', 'test', 'validation'].includes(example.split)
    && typeof example.image === 'string'
    && example.image.startsWith('data:image/')
  ));
  if (!rows.length && payload.examples.length) throw new Error('The dataset did not contain any valid labeled crops.');
  for (const row of rows) {
    await imageFromDataUrl(row.image);
    await storeTransaction('readwrite', (store) => store.put({
      ...row,
      petId: Number(row.petId),
      petName: petLabel(row.petId),
      guideId: typeof row.guideId === 'string' ? row.guideId : `imported-${row.id}`,
      guideName: typeof row.guideName === 'string' ? row.guideName : 'Imported guide',
      note: typeof row.note === 'string' ? row.note : '',
      createdAt: typeof row.createdAt === 'string' ? row.createdAt : new Date().toISOString(),
    }));
  }
  await loadExamples();
  showToast(`Imported ${rows.length} labeled crop${rows.length === 1 ? '' : 's'}.`);
}

function removeExample(id) {
  void storeTransaction('readwrite', (store) => store.delete(id)).then(() => {
    app.examples = app.examples.filter((example) => example.id !== id);
    renderExamples();
  }).catch((error) => {
    console.error(error);
    showToast('Could not remove this crop from local storage.');
  });
}

function removeGuideUrls() {
  for (const guide of app.guides) URL.revokeObjectURL(guide.url);
  app.guides = [];
  app.sourceImage = null;
}

elements.detectionInput.addEventListener('change', async (event) => {
  const [file] = event.target.files;
  if (!file) return;
  try {
    const loaded = await loadImage(file);
    if (app.detection.imageUrl) URL.revokeObjectURL(app.detection.imageUrl);
    app.detection.image = loaded.image;
    app.detection.imageUrl = loaded.url;
    app.detection.candidates = [];
    elements.detectionCanvas.hidden = false;
    elements.detectionEmpty.hidden = true;
    elements.detectionCanvas.width = loaded.image.naturalWidth;
    elements.detectionCanvas.height = loaded.image.naturalHeight;
    detectionContext.drawImage(loaded.image, 0, 0);
    elements.scanImage.disabled = false;
    elements.detectionStatus.textContent = file.name;
    elements.detectionSummary.textContent = `${loaded.image.naturalWidth}×${loaded.image.naturalHeight} image loaded. Ready to scan.`;
    elements.detectionResults.innerHTML = '<p class="empty-state small">Run the scan to inspect candidate locations.</p>';
  } catch (error) {
    console.error(error);
    showToast(error instanceof Error ? error.message : 'Could not load the detection image.');
  } finally {
    event.target.value = '';
  }
});
elements.scanImage.addEventListener('click', () => { void runPetDetection(); });

elements.referenceInput.addEventListener('change', async (event) => {
  try {
    await loadReferenceFiles([...event.target.files]);
  } catch (error) {
    console.error(error);
    showToast(error instanceof Error ? error.message : 'Could not load reference icons.');
  }
  event.target.value = '';
});

elements.guideInput.addEventListener('change', async (event) => {
  const guides = [];
  try {
    for (const file of [...event.target.files]) {
      if (!file.type.startsWith('image/')) continue;
      const { image, url } = await loadImage(file);
      guides.push({
        id: crypto.randomUUID(),
        name: file.name,
        split: elements.guideSplit.value,
        image,
        url,
      });
    }
    removeGuideUrls();
    app.guides = guides;
    renderGuidePicker();
    showGuide(guides[0] ?? null);
    if (guides.length) showToast(`Loaded ${guides.length} guide image${guides.length === 1 ? '' : 's'}.`);
  } catch (error) {
    for (const guide of guides) URL.revokeObjectURL(guide.url);
    console.error(error);
    showToast(error instanceof Error ? error.message : 'Could not load guide images.');
  } finally {
    event.target.value = '';
  }
});

elements.guidePicker.addEventListener('change', () => showGuide(currentGuide()));
elements.guideSplit.addEventListener('change', () => {
  void updateGuideSplit(elements.guideSplit.value).catch((error) => {
    console.error(error);
    showToast('Could not update this guide’s saved split.');
  });
});
elements.guideCanvas.addEventListener('pointerdown', (event) => {
  if (!app.sourceImage) return;
  elements.guideCanvas.setPointerCapture(event.pointerId);
  app.pointerStart = pointerPosition(event);
  app.selection = null;
  elements.saveSample.disabled = true;
  cropContext.clearRect(0, 0, elements.cropCanvas.width, elements.cropCanvas.height);
});
elements.guideCanvas.addEventListener('pointermove', (event) => {
  if (!app.pointerStart) return;
  const position = pointerPosition(event);
  updateCropPreview({
    x: Math.min(app.pointerStart.x, position.x),
    y: Math.min(app.pointerStart.y, position.y),
    width: Math.abs(position.x - app.pointerStart.x),
    height: Math.abs(position.y - app.pointerStart.y),
  });
});
elements.guideCanvas.addEventListener('pointerup', (event) => {
  app.pointerStart = null;
  if (elements.guideCanvas.hasPointerCapture(event.pointerId)) elements.guideCanvas.releasePointerCapture(event.pointerId);
});
elements.guideCanvas.addEventListener('pointercancel', () => { app.pointerStart = null; });
elements.saveSample.addEventListener('click', () => {
  void saveSample().catch((error) => {
    console.error(error);
    showToast(error instanceof Error ? error.message : 'Could not save this crop.');
  });
});
elements.datasetList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-remove]');
  if (button) removeExample(button.dataset.remove);
});
elements.exportDataset.addEventListener('click', exportDataset);
elements.clearDataset.addEventListener('click', async () => {
  if (!window.confirm(`Delete all ${app.examples.length} examples stored in this browser? Export the dataset first if you need a backup.`)) return;
  try {
    await storeTransaction('readwrite', (store) => store.clear());
    app.examples = [];
    app.results = [];
    renderExamples();
    elements.exportResults.disabled = true;
    elements.benchmarkResults.innerHTML = '<p class="empty-state small">Evaluation results will include top-1, top-3, mean reciprocal rank, and per-example rankings.</p>';
  } catch (error) {
    console.error(error);
    showToast('Could not clear the local dataset.');
  }
});
elements.importInput.addEventListener('change', async (event) => {
  const [file] = event.target.files;
  if (!file) return;
  try {
    await importDataset(file);
  } catch (error) {
    console.error(error);
    showToast(error instanceof Error ? error.message : 'Could not import dataset.');
  }
  event.target.value = '';
});
elements.runBenchmark.addEventListener('click', () => { void runBenchmark(); });
elements.trainModel.addEventListener('click', () => { void trainModel(); });
elements.exportModel.addEventListener('click', exportModel);
elements.exportResults.addEventListener('click', exportResults);

async function initialize() {
  populatePetOptions();
  refreshReferenceStatus();
  try {
    await Promise.all([
      loadCdnReferences(),
      openDatabase().then(async (database) => {
        app.database = database;
        await loadExamples();
      }),
    ]);
  } catch (error) {
    console.error(error);
    showToast('Browser storage is unavailable. Try opening the tool in a local browser tab.');
  }
}

void initialize();
