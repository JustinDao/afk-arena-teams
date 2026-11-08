import { createCocoDataset } from './coco-dataset.mjs';

const DATABASE_NAME = 'afk-arena-game-icon-coco-annotations';
const IMAGE_STORE = 'images';
const MINIMUM_BOX_SIZE = 4;

const elements = {
  imageInput: document.querySelector('#image-input'),
  imageSelect: document.querySelector('#image-select'),
  sourceGroup: document.querySelector('#source-group'),
  zoom: document.querySelector('#zoom'),
  zoomValue: document.querySelector('#zoom-value'),
  annotationStatus: document.querySelector('#annotation-status'),
  boxCount: document.querySelector('#box-count'),
  canvas: document.querySelector('#annotation-canvas'),
  imageEmpty: document.querySelector('#image-empty'),
  annotationList: document.querySelector('#annotation-list'),
  deleteBox: document.querySelector('#delete-box'),
  clearBoxes: document.querySelector('#clear-boxes'),
  removeImage: document.querySelector('#remove-image'),
  exportCoco: document.querySelector('#export-coco'),
  previewDetails: document.querySelector('#preview-details'),
  cocoPreview: document.querySelector('#coco-preview'),
};

const context = elements.canvas.getContext('2d');
const state = {
  database: null,
  images: [],
  currentImageId: null,
  bitmap: null,
  selectedAnnotationId: null,
  drag: null,
  zoom: 1,
};

function showStatus(message, isError = false) {
  elements.annotationStatus.textContent = message;
  elements.annotationStatus.classList.toggle('error', isError);
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(IMAGE_STORE)) {
        request.result.createObjectStore(IMAGE_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open local annotation storage.'));
  });
}

function runTransaction(mode, operation) {
  return new Promise((resolve, reject) => {
    const transaction = state.database.transaction(IMAGE_STORE, mode);
    let result;
    let request;
    try {
      request = operation(transaction.objectStore(IMAGE_STORE));
    } catch (error) {
      reject(error);
      return;
    }
    if (request) {
      request.onsuccess = () => { result = request.result; };
      request.onerror = () => reject(request.error ?? new Error('Local annotation storage failed.'));
    }
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error ?? new Error('Local annotation storage failed.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Local annotation storage was interrupted.'));
  });
}

async function imageHash(file) {
  if (!crypto.subtle) throw new Error('Secure browser storage is required. Serve this tool from localhost.');
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function currentImage() {
  return state.images.find((image) => image.id === state.currentImageId) ?? null;
}

function imageStem(fileName) {
  return fileName.replace(/\.[^.]+$/, '');
}

function totalAnnotations() {
  return state.images.reduce((count, image) => count + image.annotations.length, 0);
}

function renderImageSelect() {
  const selectedId = state.currentImageId;
  elements.imageSelect.replaceChildren(new Option('Choose an image', ''));
  for (const image of [...state.images].sort((first, second) => first.fileName.localeCompare(second.fileName))) {
    const option = new Option(`${image.fileName} · ${image.annotations.length} boxes`, image.id);
    elements.imageSelect.add(option);
  }
  elements.imageSelect.value = selectedId ?? '';
  elements.imageSelect.disabled = state.images.length === 0;
}

function renderAnnotationList() {
  const image = currentImage();
  elements.annotationList.replaceChildren();
  if (!image) return;

  image.annotations.forEach((annotation, index) => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = `Box ${index + 1} · ${annotation.x}, ${annotation.y}, ${annotation.width}×${annotation.height}`;
    button.setAttribute('aria-pressed', String(annotation.id === state.selectedAnnotationId));
    button.addEventListener('click', () => {
      state.selectedAnnotationId = annotation.id;
      render();
    });
    item.append(button);
    elements.annotationList.append(item);
  });
}

function setCanvasSize(image) {
  elements.canvas.style.width = `${Math.round(image.width * state.zoom)}px`;
  elements.canvas.style.height = `${Math.round(image.height * state.zoom)}px`;
}

function drawCanvas() {
  const image = currentImage();
  if (!image || !state.bitmap) {
    elements.canvas.hidden = true;
    elements.imageEmpty.hidden = false;
    return;
  }

  elements.canvas.hidden = false;
  elements.imageEmpty.hidden = true;
  elements.canvas.width = image.width;
  elements.canvas.height = image.height;
  setCanvasSize(image);
  context.clearRect(0, 0, image.width, image.height);
  context.drawImage(state.bitmap, 0, 0);

  for (const [index, annotation] of image.annotations.entries()) {
    const selected = annotation.id === state.selectedAnnotationId;
    context.lineWidth = selected ? 5 : 3;
    context.strokeStyle = selected ? '#ffbd54' : '#62edb5';
    context.strokeRect(annotation.x, annotation.y, annotation.width, annotation.height);
    const label = `${index + 1} · game_icon`;
    context.font = '700 18px system-ui, sans-serif';
    const labelWidth = context.measureText(label).width + 12;
    const labelY = Math.max(22, annotation.y);
    context.fillStyle = selected ? '#553b12' : '#0c211a';
    context.fillRect(annotation.x, labelY - 23, labelWidth, 24);
    context.fillStyle = selected ? '#ffe4ae' : '#9bffd7';
    context.fillText(label, annotation.x + 6, labelY - 6);
  }

  if (state.drag) {
    const { start, current } = state.drag;
    context.lineWidth = 3;
    context.setLineDash([8, 5]);
    context.strokeStyle = '#ffbd54';
    context.strokeRect(start.x, start.y, current.x - start.x, current.y - start.y);
    context.setLineDash([]);
  }
}

function render() {
  const image = currentImage();
  elements.sourceGroup.disabled = !image;
  elements.sourceGroup.value = image?.sourceGroup ?? '';
  elements.zoom.disabled = !image;
  elements.zoomValue.textContent = `${Math.round(state.zoom * 100)}%`;
  elements.boxCount.textContent = `${totalAnnotations()} box${totalAnnotations() === 1 ? '' : 'es'}`;
  elements.deleteBox.disabled = !image?.annotations.some((annotation) => annotation.id === state.selectedAnnotationId);
  elements.clearBoxes.disabled = !image || image.annotations.length === 0;
  elements.removeImage.disabled = !image;
  elements.exportCoco.disabled = state.images.length === 0 || totalAnnotations() === 0;
  renderImageSelect();
  renderAnnotationList();
  drawCanvas();
}

async function selectImage(id) {
  state.currentImageId = id || null;
  state.selectedAnnotationId = null;
  if (state.bitmap) state.bitmap.close();
  state.bitmap = null;

  const image = currentImage();
  if (image) {
    state.bitmap = await createImageBitmap(image.blob);
    state.zoom = Math.min(1, Math.max(0.5, 1100 / image.width));
    elements.zoom.value = String(Math.round(state.zoom * 100 / 25) * 25);
    state.zoom = Number(elements.zoom.value) / 100;
  }
  render();
}

async function loadFiles(files) {
  let added = 0;
  for (const file of files) {
    if (!file.type.startsWith('image/')) {
      throw new Error(`"${file.name}" is not an image.`);
    }
    const id = await imageHash(file);
    const existing = state.images.find((image) => image.id === id);
    if (existing) {
      state.currentImageId = id;
      continue;
    }

    const bitmap = await createImageBitmap(file);
    const record = {
      id,
      fileName: file.name,
      width: bitmap.width,
      height: bitmap.height,
      sourceGroup: imageStem(file.name),
      blob: file,
      annotations: [],
    };
    bitmap.close();
    await runTransaction('readwrite', (store) => store.put(record));
    state.images.push(record);
    state.currentImageId = id;
    added++;
  }
  await selectImage(state.currentImageId);
  showStatus(`Loaded ${added} new image${added === 1 ? '' : 's'}; annotation data is stored locally.`);
}

function pointFromEvent(event) {
  const image = currentImage();
  const bounds = elements.canvas.getBoundingClientRect();
  if (!image || !bounds.width || !bounds.height) return null;
  return {
    x: Math.max(0, Math.min(image.width, (event.clientX - bounds.left) * image.width / bounds.width)),
    y: Math.max(0, Math.min(image.height, (event.clientY - bounds.top) * image.height / bounds.height)),
  };
}

function annotationAt(point, image) {
  return [...image.annotations].reverse().find((annotation) => (
    point.x >= annotation.x && point.x <= annotation.x + annotation.width
    && point.y >= annotation.y && point.y <= annotation.y + annotation.height
  ));
}

function pointerDown(event) {
  const image = currentImage();
  const point = pointFromEvent(event);
  if (!image || !point) return;
  const existing = annotationAt(point, image);
  if (existing) {
    state.selectedAnnotationId = existing.id;
    render();
    return;
  }
  state.selectedAnnotationId = null;
  state.drag = { pointerId: event.pointerId, start: point, current: point };
  elements.canvas.setPointerCapture(event.pointerId);
  drawCanvas();
}

function pointerMove(event) {
  if (!state.drag) return;
  const point = pointFromEvent(event);
  if (!point) return;
  state.drag.current = point;
  drawCanvas();
}

async function pointerUp(event) {
  if (!state.drag || state.drag.pointerId !== event.pointerId) return;
  const image = currentImage();
  const start = state.drag.start;
  const end = pointFromEvent(event) ?? state.drag.current;
  state.drag = null;
  const x = Math.floor(Math.min(start.x, end.x));
  const y = Math.floor(Math.min(start.y, end.y));
  const width = Math.ceil(Math.max(start.x, end.x)) - x;
  const height = Math.ceil(Math.max(start.y, end.y)) - y;
  if (width < MINIMUM_BOX_SIZE || height < MINIMUM_BOX_SIZE) {
    showStatus(`Draw a box at least ${MINIMUM_BOX_SIZE}×${MINIMUM_BOX_SIZE} pixels.`, true);
    drawCanvas();
    return;
  }

  const annotation = { id: crypto.randomUUID(), x, y, width, height };
  image.annotations.push(annotation);
  state.selectedAnnotationId = annotation.id;
  try {
    await runTransaction('readwrite', (store) => store.put(image));
    showStatus(`Saved box ${image.annotations.length} on "${image.fileName}".`);
    render();
  } catch (error) {
    image.annotations.pop();
    state.selectedAnnotationId = null;
    console.error(error);
    showStatus(error instanceof Error ? error.message : 'Could not save this box.', true);
    render();
  }
}

async function persistCurrentImage() {
  const image = currentImage();
  if (!image) return;
  await runTransaction('readwrite', (store) => store.put(image));
  render();
}

async function deleteSelectedBox() {
  const image = currentImage();
  if (!image) return;
  const previousAnnotations = image.annotations;
  image.annotations = image.annotations.filter((annotation) => annotation.id !== state.selectedAnnotationId);
  state.selectedAnnotationId = null;
  try {
    await persistCurrentImage();
    showStatus('Selected box deleted.');
  } catch (error) {
    image.annotations = previousAnnotations;
    console.error(error);
    showStatus(error instanceof Error ? error.message : 'Could not delete the selected box.', true);
    render();
  }
}

async function clearCurrentBoxes() {
  const image = currentImage();
  if (!image || !window.confirm(`Delete all boxes on "${image.fileName}"?`)) return;
  const previousAnnotations = image.annotations;
  image.annotations = [];
  state.selectedAnnotationId = null;
  try {
    await persistCurrentImage();
    showStatus(`Cleared boxes on "${image.fileName}".`);
  } catch (error) {
    image.annotations = previousAnnotations;
    console.error(error);
    showStatus(error instanceof Error ? error.message : 'Could not clear boxes.', true);
    render();
  }
}

async function removeCurrentImage() {
  const image = currentImage();
  if (!image || !window.confirm(`Remove "${image.fileName}" and its local annotations?`)) return;
  let nextBitmap = null;
  try {
    const nextImage = state.images.find((candidate) => candidate.id !== image.id);
    if (nextImage) nextBitmap = await createImageBitmap(nextImage.blob);
    await runTransaction('readwrite', (store) => store.delete(image.id));
    state.images = state.images.filter((candidate) => candidate.id !== image.id);
    state.currentImageId = nextImage?.id ?? null;
    state.selectedAnnotationId = null;
    if (state.bitmap) state.bitmap.close();
    state.bitmap = nextBitmap;
    nextBitmap = null;
    render();
    showStatus(`Removed "${image.fileName}" from local annotations.`);
  } catch (error) {
    if (nextBitmap) nextBitmap.close();
    console.error(error);
    showStatus(error instanceof Error ? error.message : 'Could not remove this image.', true);
  }
}

function downloadDataset(dataset) {
  const contents = JSON.stringify(dataset, null, 2);
  elements.cocoPreview.value = contents;
  elements.previewDetails.hidden = false;
  const blob = new Blob([contents], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'afk-arena-icons-coco.json';
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  showStatus(`Exported ${dataset.images.length} images and ${dataset.annotations.length} COCO boxes.`);
}

function exportCoco() {
  try {
    const dataset = createCocoDataset(state.images);
    downloadDataset(dataset);
  } catch (error) {
    console.error(error);
    showStatus(error instanceof Error ? error.message : 'Could not export COCO annotations.', true);
  }
}

elements.imageInput.addEventListener('change', async (event) => {
  try {
    await loadFiles([...event.target.files]);
  } catch (error) {
    console.error(error);
    showStatus(error instanceof Error ? error.message : 'Could not load these images.', true);
    render();
  } finally {
    elements.imageInput.value = '';
  }
});

elements.imageSelect.addEventListener('change', async () => {
  try {
    await selectImage(elements.imageSelect.value);
  } catch (error) {
    console.error(error);
    showStatus(error instanceof Error ? error.message : 'Could not display this image.', true);
  }
});

elements.sourceGroup.addEventListener('change', async () => {
  const image = currentImage();
  if (!image) return;
  const previousGroup = image.sourceGroup;
  image.sourceGroup = elements.sourceGroup.value.trim();
  try {
    await persistCurrentImage();
    showStatus('Source group saved.');
  } catch (error) {
    image.sourceGroup = previousGroup;
    console.error(error);
    showStatus(error instanceof Error ? error.message : 'Could not save the source group.', true);
    render();
  }
});

elements.zoom.addEventListener('input', () => {
  state.zoom = Number(elements.zoom.value) / 100;
  elements.zoomValue.textContent = `${elements.zoom.value}%`;
  const image = currentImage();
  if (image) setCanvasSize(image);
});

elements.canvas.addEventListener('pointerdown', pointerDown);
elements.canvas.addEventListener('pointermove', pointerMove);
elements.canvas.addEventListener('pointerup', (event) => { void pointerUp(event); });
elements.canvas.addEventListener('pointercancel', () => {
  state.drag = null;
  drawCanvas();
});
elements.deleteBox.addEventListener('click', () => { void deleteSelectedBox(); });
elements.clearBoxes.addEventListener('click', () => { void clearCurrentBoxes(); });
elements.removeImage.addEventListener('click', () => { void removeCurrentImage(); });
elements.exportCoco.addEventListener('click', exportCoco);
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Delete' && event.key !== 'Backspace') return;
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
  if (!elements.deleteBox.disabled) {
    event.preventDefault();
    void deleteSelectedBox();
  }
});

async function initialize() {
  try {
    state.database = await openDatabase();
    state.images = await runTransaction('readonly', (store) => store.getAll());
    state.images.sort((first, second) => first.fileName.localeCompare(second.fileName));
    if (state.images.length) {
      state.currentImageId = state.images[0].id;
      state.bitmap = await createImageBitmap(currentImage().blob);
    }
    render();
    showStatus(state.images.length
      ? `Loaded ${state.images.length} locally saved images.`
      : 'Add guide images to begin; annotations are kept in this browser.');
  } catch (error) {
    console.error(error);
    showStatus(error instanceof Error ? error.message : 'Could not initialize local annotations.', true);
    elements.imageInput.disabled = true;
    elements.exportCoco.disabled = true;
  }
}

window.addEventListener('beforeunload', () => {
  if (state.bitmap) state.bitmap.close();
  if (state.database) state.database.close();
});

void initialize();
