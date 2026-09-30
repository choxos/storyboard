import { applyMotionPreset } from "./editing.js";

export const sceneTemplates = {
  title: {
    name: "Opening title",
    description: "Introduce an idea with a clear headline.",
  },
  announcement: {
    name: "Announcement",
    description: "Give a launch or update its own moment.",
  },
  quote: {
    name: "Quote",
    description: "Let a few memorable words take the lead.",
  },
  statistic: {
    name: "Big number",
    description: "Make one result easy to remember.",
  },
  steps: {
    name: "Three steps",
    description: "Explain a process in a short sequence.",
  },
  endcard: {
    name: "Call to action",
    description: "Finish with a clear next step.",
  },
};

export function createElement(width, height, values = {}) {
  return {
    id: crypto.randomUUID(),
    kind: "text",
    text: "Your next idea.",
    path: "",
    x: width / 2,
    y: height / 2,
    width: 0,
    height: 0,
    fill: "#18181b",
    stroke: "none",
    stroke_width: 1,
    font_size: Math.min(64, Math.min(width, height) * 0.09),
    font_weight: 700,
    radius: 0,
    opacity: 1,
    rotation: 0,
    scale_x: 1,
    scale_y: 1,
    tracks: [],
    ...values,
  };
}

export function createTemplate(id, width, height, accent = "#4776f5") {
  if (!Object.hasOwn(sceneTemplates, id))
    throw new Error("Choose a scene template.");
  const unit = Math.min(width, height),
    portrait = height > width;
  const elements = [];
  const add = (values, preset = "fade-in") => {
    const element = createElement(width, height, values);
    if (element.font_size > 1000) {
      element.scale_x = element.scale_y = element.font_size / 1000;
      element.font_size = 1000;
    }
    applyMotionPreset(element, preset, 4000, unit * 0.06);
    elements.push(element);
    return element;
  };
  const text = (
    value,
    y,
    size,
    fill = "#18181b",
    weight = 700,
    x = width / 2,
  ) =>
    add(
      {
        text: value,
        x,
        y: height * y,
        font_size: unit * size,
        fill,
        font_weight: weight,
      },
      "slide-up",
    );
  const rect = (x, y, w, h, fill, radius = 0) =>
    add({
      kind: "rect",
      text: "",
      x: width * x,
      y: height * y,
      width: width * w,
      height: height * h,
      fill,
      radius: unit * radius,
    });
  if (id === "title") {
    rect(0.5, 0.3, 0.08, 0.008, accent);
    text(
      portrait ? "A new\nperspective." : "A new perspective.",
      portrait ? 0.43 : 0.48,
      0.09,
    );
    text(
      "A story worth sharing.",
      portrait ? 0.63 : 0.61,
      0.033,
      "#71717a",
      400,
    );
  } else if (id === "announcement") {
    rect(0.5, 0.5, 0.88, 0.72, "#f0f3ff", 0.035);
    text("JUST ANNOUNCED", 0.32, 0.027, accent);
    text("Something new\nis here.", 0.46, 0.083);
    text("Made for what comes next.", 0.69, 0.03, "#71717a", 400);
  } else if (id === "quote") {
    text("\u201c", 0.3, 0.16, accent);
    text("Good things\ntake shape.", 0.46, 0.09);
    text("Your name or source", 0.71, 0.033, "#71717a", 400);
  } else if (id === "statistic") {
    text("THE BIG PICTURE", 0.29, 0.026, "#71717a");
    add(
      { text: "87%", y: height * 0.57, font_size: unit * 0.22, fill: accent },
      "pop-in",
    );
    text("One number. A clear story.", 0.72, 0.034, "#71717a", 400);
  } else if (id === "steps") {
    text("Three simple steps", 0.23, 0.058);
    for (const [index, label] of ["Imagine", "Make", "Share"].entries()) {
      const x = portrait ? 0.5 : 0.23 + index * 0.27;
      const y = portrait ? 0.4 + index * 0.19 : 0.56;
      rect(
        x,
        y,
        portrait ? 0.74 : 0.23,
        portrait ? 0.15 : 0.32,
        "#f0f3ff",
        0.025,
      );
      text(
        `0${index + 1}`,
        y - (portrait ? 0.012 : 0.02),
        0.065,
        accent,
        700,
        width * x,
      );
      text(
        label,
        y + (portrait ? 0.04 : 0.09),
        0.032,
        "#18181b",
        400,
        width * x,
      );
    }
  } else {
    text("Let\u2019s make\nit happen.", 0.36, 0.095);
    rect(0.5, 0.64, portrait ? 0.72 : 0.38, 0.12, accent, 0.04);
    text("Find out more", 0.657, 0.036, "#ffffff");
    text("yourwebsite.com", 0.79, 0.03, "#71717a", 400);
  }
  return {
    scene: {
      id: crypto.randomUUID(),
      name: sceneTemplates[id].name,
      duration_ms: 4000,
      background: "#fafafa",
      elements,
    },
    revisions: [],
    chat: [],
  };
}
