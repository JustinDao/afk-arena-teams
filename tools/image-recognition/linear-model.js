export function trainLinearClassifier(examples, options = {}) {
  const epochs = options.epochs ?? 400;
  const learningRate = options.learningRate ?? 0.08;
  const regularization = options.regularization ?? 0.01;
  if (!Number.isInteger(epochs) || epochs < 1 || epochs > 5000) {
    throw new Error('Training epochs must be an integer from 1 to 5000.');
  }
  if (!Number.isFinite(learningRate) || learningRate <= 0 || learningRate > 1) {
    throw new Error('Learning rate must be greater than 0 and no greater than 1.');
  }
  if (!Number.isFinite(regularization) || regularization < 0 || regularization > 10) {
    throw new Error('Regularization must be from 0 to 10.');
  }
  if (examples.length < 2) throw new Error('Add at least two labeled training crops.');

  const featureCount = examples[0].feature.length;
  if (!featureCount || examples.some(({ feature }) => feature.length !== featureCount)) {
    throw new Error('Training crops have incompatible image features.');
  }
  const classIds = [...new Set(examples.map(({ petId }) => Number(petId)))].sort((a, b) => a - b);
  if (classIds.length < 2) throw new Error('Training needs crops from at least two different pets.');

  const classIndex = new Map(classIds.map((id, index) => [id, index]));
  const means = new Float32Array(featureCount);
  for (const { feature } of examples) {
    for (let index = 0; index < featureCount; index++) means[index] += feature[index] / examples.length;
  }

  const scales = new Float32Array(featureCount);
  for (let index = 0; index < featureCount; index++) {
    let variance = 0;
    for (const { feature } of examples) {
      const difference = feature[index] - means[index];
      variance += difference * difference / examples.length;
    }
    scales[index] = Math.max(Math.sqrt(variance), 0.2);
  }

  const weights = new Float32Array(classIds.length * featureCount);
  const bias = new Float32Array(classIds.length);
  const classCounts = classIds.map((id) => examples.filter((example) => Number(example.petId) === id).length);
  const sampleWeights = examples.map(({ petId }) => examples.length / (classIds.length * classCounts[classIndex.get(Number(petId))]));
  const logits = new Float64Array(classIds.length);
  const probabilities = new Float64Array(classIds.length);
  const weightGradients = new Float64Array(weights.length);
  const biasGradients = new Float64Array(classIds.length);

  for (let epoch = 0; epoch < epochs; epoch++) {
    weightGradients.fill(0);
    biasGradients.fill(0);

    for (let sampleIndex = 0; sampleIndex < examples.length; sampleIndex++) {
      const { feature, petId } = examples[sampleIndex];
      const expectedClass = classIndex.get(Number(petId));
      for (let classPosition = 0; classPosition < classIds.length; classPosition++) {
        let value = bias[classPosition];
        const weightOffset = classPosition * featureCount;
        for (let featureIndex = 0; featureIndex < featureCount; featureIndex++) {
          value += weights[weightOffset + featureIndex]
            * ((feature[featureIndex] - means[featureIndex]) / scales[featureIndex]);
        }
        logits[classPosition] = value;
      }

      const maxLogit = Math.max(...logits);
      let totalProbability = 0;
      for (let classPosition = 0; classPosition < classIds.length; classPosition++) {
        probabilities[classPosition] = Math.exp(logits[classPosition] - maxLogit);
        totalProbability += probabilities[classPosition];
      }
      for (let classPosition = 0; classPosition < classIds.length; classPosition++) {
        const error = (probabilities[classPosition] / totalProbability - Number(classPosition === expectedClass))
          * sampleWeights[sampleIndex] / examples.length;
        biasGradients[classPosition] += error;
        const weightOffset = classPosition * featureCount;
        for (let featureIndex = 0; featureIndex < featureCount; featureIndex++) {
          weightGradients[weightOffset + featureIndex] += error
            * ((feature[featureIndex] - means[featureIndex]) / scales[featureIndex]);
        }
      }
    }

    for (let index = 0; index < weights.length; index++) {
      weights[index] -= learningRate * (weightGradients[index] + regularization * weights[index]);
    }
    for (let index = 0; index < bias.length; index++) bias[index] -= learningRate * biasGradients[index];
  }

  return {
    format: 'afk-pet-matcher-linear-softmax',
    version: 1,
    feature: { type: 'rgb-grid', width: 16, height: 16, channels: ['r', 'g', 'b'], values: '0-1' },
    classes: classIds,
    means: Array.from(means),
    scales: Array.from(scales),
    weights: Array.from(weights),
    bias: Array.from(bias),
    training: {
      exampleCount: examples.length,
      classCounts: Object.fromEntries(classIds.map((id, index) => [id, classCounts[index]])),
      epochs,
      learningRate,
      regularization,
      trainedAt: new Date().toISOString(),
    },
  };
}

export function rankWithLinearClassifier(feature, model) {
  if (model?.format !== 'afk-pet-matcher-linear-softmax' || model.version !== 1) {
    throw new Error('Unsupported pet classifier model.');
  }
  const featureCount = model.means.length;
  if (feature.length !== featureCount || model.weights.length !== featureCount * model.classes.length) {
    throw new Error('Pet classifier model dimensions do not match the image feature.');
  }
  const scores = model.classes.map((petId, classIndex) => {
    let score = model.bias[classIndex];
    const weightOffset = classIndex * featureCount;
    for (let index = 0; index < featureCount; index++) {
      score += model.weights[weightOffset + index] * ((feature[index] - model.means[index]) / model.scales[index]);
    }
    return { petId, score };
  });
  const maxScore = Math.max(...scores.map(({ score }) => score));
  const total = scores.reduce((sum, { score }) => sum + Math.exp(score - maxScore), 0);
  return scores
    .map(({ petId, score }) => ({ petId, probability: Math.exp(score - maxScore) / total }))
    .sort((a, b) => b.probability - a.probability);
}
