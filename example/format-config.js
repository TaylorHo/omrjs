import { isImageMarker } from "./marker-image.js";

/** @param {unknown} value @param {number} [indent] */
function formatJsValue(value, indent = 0) {
  const spaces = "  ".repeat(indent);
  const inner = "  ".repeat(indent + 1);

  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "number") {
    return String(value);
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const items = value.map(
      (item) => `${inner}${formatJsValue(item, indent + 1)}`,
    );
    return `[\n${items.join(",\n")}\n${spaces}]`;
  }

  if (typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0) return "{}";
    const lines = entries.map(([key, item]) => {
      const formattedKey = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key)
        ? key
        : JSON.stringify(key);
      return `${inner}${formattedKey}: ${formatJsValue(item, indent + 1)}`;
    });
    return `{\n${lines.join(",\n")}\n${spaces}}`;
  }

  return JSON.stringify(value);
}

/**
 * @param {unknown} payload
 */
function formatPayloadForExport(payload) {
  if (!payload || typeof payload !== "object" || !("data" in payload)) {
    return payload;
  }

  const source =
    /** @type {{ data: Record<string, unknown>, config: unknown }} */ (payload);
  const data = { ...source.data };

  if (isImageMarker(data.cornerPattern)) {
    data.cornerPattern = {
      type: "image",
      width: data.cornerPattern.width,
      height: data.cornerPattern.height,
      // pixels: load from image — see marker-image.js / fetch example
    };
  }

  return { ...source, data };
}

/**
 * @param {unknown} payload
 * @param {"js" | "json"} format
 */
export function formatConfigPayload(payload, format) {
  const exportPayload = formatPayloadForExport(payload);

  if (format === "json") {
    return JSON.stringify(exportPayload, null, 2);
  }
  return formatJsValue(exportPayload, 0);
}

/** @param {"js" | "json"} format */
export function configFormatHint(format) {
  if (format === "json") {
    return "JSON — suitable for APIs, files, and tools that expect strict JSON.";
  }
  return "JavaScript object literal — paste directly into your code as data and config values.";
}
