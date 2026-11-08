import { writeFile } from 'node:fs/promises';
import { createCocoDataset } from './coco-dataset.mjs';

const box = ([x, y, width, height]) => ({ x, y, width, height });
const boxes = (rectangles) => rectangles.map(box);

function appExportBoxes() {
  const scale = 2040 / 1558;
  const heroPositions = [[80, 157], [80, 305], [80, 452], [298, 230], [298, 378]];
  const collectionPositions = [[177, 157], [177, 305], [177, 452], [395, 230], [395, 378]];
  const panels = [
    [0, 0], [506, 0], [1013, 0],
    [0, 580], [506, 580], [1013, 580],
  ];
  const rectangles = [];
  for (const [offsetX, offsetY] of panels) {
    for (const [x, y] of heroPositions) rectangles.push([x + offsetX, y + offsetY, 85, 85]);
    for (const [x, y] of collectionPositions) rectangles.push([x + offsetX, y + offsetY, 85, 87]);
    rectangles.push([216 + offsetX, 594 + offsetY, 49, 49]);
  }
  return rectangles.map(([x, y, width, height]) => box([
    Math.round(x * scale),
    Math.round(y * scale),
    Math.round(width * scale),
    Math.round(height * scale),
  ]));
}

const records = [
  {
    id: 'infernal-overlord-app-export',
    fileName: 'afk-nightmare-corridor-infernal-overlord-9.png',
    width: 2040,
    height: 2082,
    sourceGroup: 'nightmare-corridor-app-export',
    annotations: appExportBoxes(),
  },
  {
    id: 'nc-round-1',
    fileName: 'tools/pet-matcher-lab/pilot-images/pilot-nc-round-1.png',
    width: 225,
    height: 485,
    sourceGroup: 'f2p-weekly-nc-guide',
    annotations: boxes([
      [18, 94, 71, 71], [128, 150, 71, 72], [18, 208, 71, 72],
      [128, 265, 71, 72], [18, 323, 71, 72],
      [129, 52, 70, 70],
      [179, 198, 38, 41], [67, 258, 41, 41], [177, 315, 41, 42],
    ]),
  },
  {
    id: 'nc-round-2',
    fileName: 'tools/pet-matcher-lab/pilot-images/pilot-nc-round-2.png',
    width: 225,
    height: 490,
    sourceGroup: 'f2p-weekly-nc-guide',
    annotations: boxes([
      [18, 88, 71, 71], [128, 144, 71, 72], [18, 207, 71, 72],
      [128, 260, 71, 72], [18, 320, 71, 72],
      [129, 50, 70, 71],
      [68, 133, 40, 42], [177, 198, 40, 42], [68, 260, 41, 43],
      [177, 319, 41, 43], [68, 376, 41, 43],
    ]),
  },
  {
    id: 'nc-round-3',
    fileName: 'tools/pet-matcher-lab/pilot-images/pilot-nc-round-3.png',
    width: 225,
    height: 486,
    sourceGroup: 'f2p-weekly-nc-guide',
    annotations: boxes([
      [18, 80, 71, 71], [128, 139, 71, 72], [18, 194, 71, 72],
      [128, 250, 71, 72], [18, 308, 71, 72],
      [129, 40, 70, 72],
      [68, 127, 40, 41], [178, 178, 40, 42],
      [68, 238, 41, 42], [67, 358, 42, 43],
    ]),
  },
  {
    id: 'nightmare-round-1',
    fileName: 'tools/pet-matcher-lab/pilot-images/pilot-nightmare-round-1.png',
    width: 1200,
    height: 1050,
    sourceGroup: 'lydydxhxpyyh1',
    annotations: boxes([
      [70, 198, 137, 150], [278, 198, 138, 150], [480, 198, 140, 150],
      [686, 198, 140, 150], [893, 198, 140, 150],
      [90, 431, 98, 100], [306, 430, 99, 100], [513, 430, 99, 100],
      [712, 430, 100, 100], [920, 430, 98, 100],
      [719, 732, 100, 100], [930, 727, 100, 100],
    ]),
  },
  {
    id: 'nightmare-round-2',
    fileName: 'tools/pet-matcher-lab/pilot-images/pilot-nightmare-round-2.png',
    width: 1200,
    height: 800,
    sourceGroup: 'lydydxhxpyyh1',
    annotations: boxes([
      [107, 152, 138, 150], [310, 152, 138, 150], [514, 152, 140, 150],
      [710, 152, 140, 150], [910, 152, 140, 150],
      [121, 388, 98, 96], [327, 388, 100, 96], [516, 388, 100, 96],
      [715, 388, 100, 96], [912, 388, 100, 96],
      [329, 646, 98, 98], [913, 650, 102, 98],
    ]),
  },
  {
    id: 'nightmare-round-3',
    fileName: 'tools/pet-matcher-lab/pilot-images/pilot-nightmare-round-3.png',
    width: 1200,
    height: 760,
    sourceGroup: 'lydydxhxpyyh1',
    annotations: boxes([
      [100, 133, 140, 155], [308, 133, 140, 155], [515, 133, 140, 155],
      [715, 133, 140, 155], [915, 133, 140, 155],
      [145, 377, 100, 100], [348, 377, 100, 100], [550, 377, 100, 100],
      [735, 377, 100, 100], [928, 377, 100, 100],
      [150, 615, 100, 100], [552, 615, 100, 100],
    ]),
  },
  {
    id: 'nightmare-round-4',
    fileName: 'tools/pet-matcher-lab/pilot-images/pilot-nightmare-round-4.png',
    width: 1200,
    height: 950,
    sourceGroup: 'lydydxhxpyyh1',
    annotations: boxes([
      [135, 180, 140, 160], [335, 180, 140, 160], [535, 180, 140, 160],
      [735, 180, 140, 160], [935, 180, 140, 160],
      [155, 415, 100, 100], [350, 415, 100, 100], [550, 415, 100, 100],
      [750, 415, 100, 100], [950, 415, 100, 100],
      [350, 680, 100, 100], [550, 680, 100, 100], [950, 680, 100, 100],
    ]),
  },
  {
    id: 'nightmare-round-5',
    fileName: 'tools/pet-matcher-lab/pilot-images/pilot-nightmare-round-5.png',
    width: 1200,
    height: 800,
    sourceGroup: 'lydydxhxpyyh1',
    annotations: boxes([
      [88, 160, 138, 160], [278, 160, 138, 160], [480, 160, 138, 160],
      [682, 160, 140, 160], [885, 160, 140, 160],
      [100, 385, 100, 100], [310, 385, 98, 100], [510, 385, 100, 100],
      [710, 385, 100, 100], [910, 385, 100, 100],
      [160, 647, 100, 100],
    ]),
  },
  {
    id: 'nightmare-round-6',
    fileName: 'tools/pet-matcher-lab/pilot-images/pilot-nightmare-round-6.png',
    width: 1200,
    height: 1040,
    sourceGroup: 'lydydxhxpyyh1',
    annotations: boxes([
      [90, 190, 138, 120], [290, 190, 138, 120], [490, 190, 138, 120],
      [690, 190, 140, 120], [890, 190, 140, 120],
      [95, 420, 100, 100], [295, 420, 100, 100], [495, 420, 100, 100],
      [695, 420, 100, 100], [895, 420, 100, 100],
      [309, 680, 100, 100], [914, 688, 100, 100],
    ]),
  },
];

const dataset = createCocoDataset(records);
await writeFile(
  new URL('../../afk-icon-pilot-coco.json', import.meta.url),
  `${JSON.stringify(dataset, null, 2)}\n`,
);
