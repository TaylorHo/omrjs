/** @typedef {import('../dist/data.js').ImageMarker} ImageMarker */

/**
 * @param {File} file
 * @returns {Promise<ImageMarker>}
 */
export async function loadMarkerImageFromFile(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error("Failed to load marker image"));
      img.src = url;
    });

    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, img.width, img.height);

    return {
      type: "image",
      pixels: new Uint8ClampedArray(imageData.data),
      width: img.width,
      height: img.height,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * @param {ImageMarker} marker
 */
export function markerToStorable(marker) {
  const canvas = document.createElement("canvas");
  canvas.width = marker.width;
  canvas.height = marker.height;
  const ctx = canvas.getContext("2d");
  ctx.putImageData(
    new ImageData(marker.pixels, marker.width, marker.height),
    0,
    0,
  );

  return {
    width: marker.width,
    height: marker.height,
    dataUrl: canvas.toDataURL("image/png"),
  };
}

/**
 * @param {{ width: number, height: number, dataUrl: string }} stored
 * @returns {Promise<ImageMarker>}
 */
export async function storableToMarker(stored) {
  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = () => reject(new Error("Failed to restore marker image"));
    img.src = stored.dataUrl;
  });

  const canvas = document.createElement("canvas");
  canvas.width = stored.width;
  canvas.height = stored.height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, stored.width, stored.height);

  return {
    type: "image",
    pixels: new Uint8ClampedArray(imageData.data),
    width: stored.width,
    height: stored.height,
  };
}

/** @param {unknown} value */
export function isImageMarker(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    /** @type {{ type?: string }} */ (value).type === "image" &&
    "pixels" in value &&
    "width" in value &&
    "height" in value
  );
}
