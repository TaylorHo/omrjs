/** Build an ImageMarker from a binary template at a large source size. */
export function templateToImageMarker(template, tw, th, upscale = 100) {
  const width = tw * upscale;
  const height = th * upscale;
  const pixels = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sx = Math.min(tw - 1, Math.floor((x * tw) / width));
      const sy = Math.min(th - 1, Math.floor((y * th) / height));
      const val = template[sy * tw + sx] > 0.5 ? 0 : 255;
      const idx = (y * width + x) * 4;
      pixels[idx] = val;
      pixels[idx + 1] = val;
      pixels[idx + 2] = val;
      pixels[idx + 3] = 255;
    }
  }

  return { type: "image", pixels, width, height };
}
