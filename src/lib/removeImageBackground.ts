/**
 * Removes a (near-)white background from a product image.
 *
 * Uses a flood fill starting from the four edges so that only the background
 * connected to the borders is made transparent. White areas *inside* the
 * product (labels, highlights, etc.) are preserved.
 *
 * Returns a PNG Blob with transparency, or the original file if processing
 * is not possible (e.g. canvas unavailable).
 */

type RemoveBackgroundOptions = {
  /** 0-255: how close to white a pixel must be to count as background. */
  tolerance?: number;
  /** Pixels softer than this near the edge of the cut get partial alpha. */
  feather?: number;
};

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Slika nije mogla da se učita.'));
    };
    img.src = url;
  });
}

export async function removeImageBackground(
  file: File,
  options: RemoveBackgroundOptions = {},
): Promise<Blob> {
  const tolerance = options.tolerance ?? 32;

  let image: HTMLImageElement;
  try {
    image = await loadImage(file);
  } catch {
    return file;
  }

  const width = image.naturalWidth;
  const height = image.naturalHeight;
  if (!width || !height) return file;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;

  ctx.drawImage(image, 0, 0, width, height);

  let imageData: ImageData;
  try {
    imageData = ctx.getImageData(0, 0, width, height);
  } catch {
    // Likely a cross-origin / tainted canvas; fall back to original.
    return file;
  }

  const data = imageData.data;
  const total = width * height;
  const visited = new Uint8Array(total);

  const isNearWhite = (idx: number) => {
    const offset = idx * 4;
    const r = data[offset];
    const g = data[offset + 1];
    const b = data[offset + 2];
    const a = data[offset + 3];
    if (a === 0) return true;
    return r >= 255 - tolerance && g >= 255 - tolerance && b >= 255 - tolerance;
  };

  const stack: number[] = [];
  const pushIfEdgeWhite = (idx: number) => {
    if (!visited[idx] && isNearWhite(idx)) {
      stack.push(idx);
    }
  };

  for (let x = 0; x < width; x++) {
    pushIfEdgeWhite(x);
    pushIfEdgeWhite((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    pushIfEdgeWhite(y * width);
    pushIfEdgeWhite(y * width + (width - 1));
  }

  while (stack.length > 0) {
    const idx = stack.pop() as number;
    if (visited[idx]) continue;
    visited[idx] = 1;

    if (!isNearWhite(idx)) continue;

    // Make this background pixel transparent.
    data[idx * 4 + 3] = 0;

    const x = idx % width;
    const y = (idx - x) / width;

    if (x > 0) stack.push(idx - 1);
    if (x < width - 1) stack.push(idx + 1);
    if (y > 0) stack.push(idx - width);
    if (y < height - 1) stack.push(idx + width);
  }

  ctx.putImageData(imageData, 0, 0);

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((result) => resolve(result), 'image/png');
  });

  return blob ?? file;
}
