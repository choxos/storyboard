export const canvasSizes = {
  "Landscape video": [
    ["VGA · 4:3", 640, 480],
    ["SD widescreen", 854, 480],
    ["PAL square pixels · 4:3", 768, 576],
    ["HD · 16:9", 1280, 720],
    ["HD+ · 16:9", 1600, 900],
    ["Full HD · 16:9", 1920, 1080],
    ["QHD · 16:9", 2560, 1440],
    ["4K UHD · 16:9", 3840, 2160],
    ["8K UHD · 16:9", 7680, 4320],
  ],
  "Portrait video": [
    ["Portrait HD · 9:16", 720, 1280],
    ["Portrait Full HD · 9:16", 1080, 1920],
    ["Portrait QHD · 9:16", 1440, 2560],
    ["Portrait 4K · 9:16", 2160, 3840],
    ["Portrait 8K · 9:16", 4320, 7680],
  ],
  Square: [
    ["Square 720", 720, 720],
    ["Square 1080", 1080, 1080],
    ["Square 1440", 1440, 1440],
    ["Square 2160", 2160, 2160],
    ["Square 4320", 4320, 4320],
  ],
  "Social & banners": [
    ["Portrait post · 4:5", 1080, 1350],
    ["Portrait post · 3:4", 1080, 1440],
    ["Large portrait post · 4:5", 1200, 1500],
    ["Tall post · 2:3", 1000, 1500],
    ["Landscape post", 1080, 566],
    ["Link card", 1200, 628],
    ["Link preview", 1200, 630],
    ["Wide banner · 3:1", 1500, 500],
    ["Wide cover", 1640, 624],
  ],
  "Cinema & ultrawide": [
    ["DCI 2K", 2048, 1080],
    ["2K flat · 1.85:1", 1998, 1080],
    ["2K scope · 2.39:1", 2048, 858],
    ["DCI 4K", 4096, 2160],
    ["4K flat · 1.85:1", 3996, 2160],
    ["4K scope · 2.39:1", 4096, 1716],
    ["8K cinema", 8192, 4320],
    ["Ultrawide QHD", 3440, 1440],
    ["Ultrawide 4K · 2.4:1", 3840, 1600],
    ["5K ultrawide", 5120, 2160],
    ["Super ultrawide · 32:9", 5120, 1440],
  ],
  "Presentation & desktop": [
    ["XGA · 4:3", 1024, 768],
    ["UXGA · 4:3", 1600, 1200],
    ["QXGA · 4:3", 2048, 1536],
    ["WXGA · 16:10", 1280, 800],
    ["WUXGA · 16:10", 1920, 1200],
    ["WQXGA · 16:10", 2560, 1600],
    ["5K · 16:9", 5120, 2880],
    ["6K · 16:9", 6016, 3384],
  ],
};

export function resizeCanvas(project, width, height) {
  const sx = width / project.width,
    sy = height / project.height;
  const scale = (scene) => {
    for (const e of scene.elements) {
      e.x *= sx;
      e.y *= sy;
      e.width *= sx;
      e.height *= sy;
      e.font_size *= Math.min(sx, sy);
      e.radius *= Math.min(sx, sy);
      if (e.kind === "path") {
        e.scale_x *= sx;
        e.scale_y *= sy;
      } else {
        e.stroke_width *= Math.min(sx, sy);
      }
      for (const track of e.tracks) {
        const factor =
          ["x", "width"].includes(track.property) ||
          (e.kind === "path" && track.property === "scale_x")
            ? sx
            : ["y", "height"].includes(track.property) ||
                (e.kind === "path" && track.property === "scale_y")
              ? sy
              : 1;
        for (const key of track.keyframes) key.value *= factor;
      }
    }
  };
  for (const doc of project.scenes) {
    scale(doc.scene);
    for (const revision of doc.revisions) scale(revision.scene);
  }
  project.width = width;
  project.height = height;
}
