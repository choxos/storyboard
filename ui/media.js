export const fontFamilies = [
  "Arial",
  "Georgia",
  "Times New Roman",
  "Courier New",
  "Verdana",
  "Trebuchet MS",
];

const pngSizes = new Map();
let cachedBytes = 0;
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let i = 0; i < 8; i++)
    value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});

export function pngSize(data) {
  if (pngSizes.has(data)) return pngSizes.get(data);
  if (
    typeof data !== "string" ||
    data.length > 5600000 ||
    !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(data)
  )
    throw new Error("Images must be embedded PNG files up to 4 MB.");
  const bytes = atob(data.slice(22));
  if (
    bytes.length < 45 ||
    bytes.slice(0, 8) !== "\x89PNG\r\n\x1a\n" ||
    bytes.slice(12, 16) !== "IHDR" ||
    bytes.slice(-8, -4) !== "IEND"
  )
    throw new Error("Invalid PNG image.");
  const view = new DataView(
    Uint8Array.from(bytes.slice(16, 24), (c) => c.charCodeAt(0)).buffer,
  );
  const width = view.getUint32(0),
    height = view.getUint32(4);
  if (
    !width ||
    !height ||
    width > 4096 ||
    height > 4096 ||
    width * height > 4194304
  )
    throw new Error(
      "Images support up to 4 million pixels and 4096 px per side.",
    );
  const u32 = (offset) =>
    (bytes.charCodeAt(offset) * 0x1000000 +
      (bytes.charCodeAt(offset + 1) << 16) +
      (bytes.charCodeAt(offset + 2) << 8) +
      bytes.charCodeAt(offset + 3)) >>>
    0;
  let offset = 8,
    hasPixels = false;
  while (offset < bytes.length) {
    const length = u32(offset),
      end = offset + 8 + length;
    if (end + 4 > bytes.length || (offset === 8 && length !== 13))
      throw new Error("Invalid PNG chunk.");
    let crc = 0xffffffff;
    for (let i = offset + 4; i < end; i++)
      crc = crcTable[(crc ^ bytes.charCodeAt(i)) & 255] ^ (crc >>> 8);
    if ((crc ^ 0xffffffff) >>> 0 !== u32(end))
      throw new Error("PNG data is corrupted.");
    const type = bytes.slice(offset + 4, offset + 8);
    if (type === "IDAT") hasPixels = true;
    if (type === "IEND" && (length !== 0 || end + 4 !== bytes.length))
      throw new Error("Invalid PNG ending.");
    offset = end + 4;
  }
  if (!hasPixels) throw new Error("PNG has no image data.");
  // ponytail: cache validated bytes up to one project's media budget.
  if (cachedBytes + data.length > 12000000) {
    pngSizes.clear();
    cachedBytes = 0;
  }
  cachedBytes += data.length;
  const size = [width, height];
  pngSizes.set(data, size);
  return size;
}

export async function importImage(file) {
  if (
    file.size > 10000000 ||
    !["image/png", "image/jpeg", "image/webp"].includes(file.type)
  )
    throw new Error("Choose a PNG, JPEG, or WebP image up to 10 MB.");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (!image.width || !image.height || image.width * image.height > 33554432)
      throw new Error("Choose an image with at most 32 million pixels.");
    const scale = Math.min(1, 2048 / image.width, 2048 / image.height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image conversion is unavailable.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL("image/png");
    pngSize(data);
    return {
      id: crypto.randomUUID(),
      name: file.name,
      data,
      width: canvas.width,
      height: canvas.height,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}
