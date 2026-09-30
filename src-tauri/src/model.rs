use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

pub const MAX_DURATION: u32 = 600_000;

pub fn validate_canvas(width: u32, height: u32) -> Result<(), String> {
    if !(64..=8192).contains(&width)
        || !(64..=8192).contains(&height)
        || !width.is_multiple_of(2)
        || !height.is_multiple_of(2)
        || u64::from(width) * u64::from(height) > 8192 * 4320
    {
        return Err("Use even canvas dimensions from 64 to 8192 px, up to 35,389,440 total pixels (8K cinema).".into());
    }
    Ok(())
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Project {
    pub version: u32,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub art_direction: String,
    pub scenes: Vec<SceneDocument>,
    pub chat: Vec<Chat>,
    pub audio: Option<AudioTrack>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SceneDocument {
    pub scene: Scene,
    pub revisions: Vec<Revision>,
    pub chat: Vec<Chat>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Revision {
    pub label: String,
    pub scene: Scene,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Chat {
    pub role: String,
    pub text: String,
    pub provider: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Scene {
    pub id: String,
    pub name: String,
    pub duration_ms: u32,
    pub background: String,
    pub elements: Vec<Element>,
}

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Element {
    pub id: String,
    pub kind: Kind,
    pub text: String,
    pub path: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub fill: String,
    pub stroke: String,
    pub stroke_width: f64,
    pub font_size: f64,
    pub font_weight: u32,
    pub radius: f64,
    pub opacity: f64,
    pub rotation: f64,
    pub scale_x: f64,
    pub scale_y: f64,
    pub tracks: Vec<Track>,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    Rect,
    Ellipse,
    Text,
    Path,
}

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Track {
    pub property: Property,
    pub keyframes: Vec<Keyframe>,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Property {
    X,
    Y,
    Width,
    Height,
    Opacity,
    Rotation,
    ScaleX,
    ScaleY,
}

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Keyframe {
    pub time_ms: u32,
    pub value: f64,
    pub easing: Easing,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Easing {
    Linear,
    EaseIn,
    EaseOut,
    EaseInOut,
    Step,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AudioTrack {
    pub path: String,
    pub name: String,
    pub duration_ms: u32,
    pub peaks: Vec<f32>,
    pub bpm: f64,
    pub offset_ms: f64,
    pub beats_per_bar: u32,
    pub sections: Vec<u32>,
    pub confidence: f64,
    #[serde(default)]
    pub mix: AudioMix,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AudioMix {
    pub volume: f64,
    pub muted: bool,
    pub fade_in_ms: u32,
    pub fade_out_ms: u32,
}

impl Default for AudioMix {
    fn default() -> Self {
        Self {
            volume: 1.0,
            muted: false,
            fade_in_ms: 0,
            fade_out_ms: 0,
        }
    }
}

impl Scene {
    pub fn validate(&self) -> Result<(), String> {
        if self.id.is_empty() || self.id.len() > 100 || self.name.len() > 200 {
            return Err("Scene name or ID is invalid.".into());
        }
        if !(100..=120_000).contains(&self.duration_ms) || self.elements.len() > 250 {
            return Err("Scenes must be 100 ms to 2 minutes, with at most 250 elements.".into());
        }
        check_color(&self.background)?;
        let mut ids = std::collections::HashSet::new();
        for e in &self.elements {
            if e.id.is_empty() || !ids.insert(&e.id) || e.id.len() > 100 {
                return Err("Each element needs a unique ID.".into());
            }
            if e.text.len() > 10_000 || e.path.len() > 50_000 {
                return Err("Element text or path is too long.".into());
            }
            check_color(&e.fill)?;
            check_color(&e.stroke)?;
            for v in [
                e.x,
                e.y,
                e.width,
                e.height,
                e.stroke_width,
                e.font_size,
                e.radius,
                e.opacity,
                e.rotation,
                e.scale_x,
                e.scale_y,
            ] {
                if !v.is_finite() || v.abs() > 100_000.0 {
                    return Err("Invalid element geometry.".into());
                }
            }
            if e.width < 0.0
                || e.height < 0.0
                || e.stroke_width < 0.0
                || !(0.0..=1.0).contains(&e.opacity)
                || !(1.0..=1000.0).contains(&e.font_size)
                || e.radius < 0.0
                || !(100..=900).contains(&e.font_weight)
            {
                return Err("Invalid element size, opacity, or font.".into());
            }
            if e.tracks.len() > 8 {
                return Err("Too many animation tracks.".into());
            }
            for (i, t) in e.tracks.iter().enumerate() {
                if e.tracks[..i].iter().any(|x| x.property == t.property)
                    || t.keyframes.is_empty()
                    || t.keyframes.len() > 100
                {
                    return Err("Tracks must be unique and have 1 to 100 keyframes.".into());
                }
                let mut previous = None;
                for k in &t.keyframes {
                    if k.time_ms > self.duration_ms
                        || previous.is_some_and(|v| v >= k.time_ms)
                        || !k.value.is_finite()
                        || k.value.abs() > 100_000.0
                    {
                        return Err("Keyframes need increasing millisecond times within the scene and finite values.".into());
                    }
                    if (t.property == Property::Opacity && !(0.0..=1.0).contains(&k.value))
                        || (matches!(t.property, Property::Width | Property::Height)
                            && k.value < 0.0)
                    {
                        return Err("Invalid animated size or opacity.".into());
                    }
                    previous = Some(k.time_ms);
                }
            }
        }
        Ok(())
    }
}

impl Project {
    pub fn duration_ms(&self) -> u32 {
        self.scenes.iter().map(|d| d.scene.duration_ms).sum()
    }

    pub fn validate(&self) -> Result<(), String> {
        if self.version != 1 {
            return Err("Unsupported project version.".into());
        }
        if self.name.len() > 200 || self.art_direction.len() > 20_000 {
            return Err("Project text is too long.".into());
        }
        validate_canvas(self.width, self.height)?;
        if ![24, 30, 60].contains(&self.fps) {
            return Err("Use 24, 30, or 60 fps.".into());
        }
        if self.scenes.is_empty() || self.scenes.len() > 100 {
            return Err("Projects need 1 to 100 scenes.".into());
        }
        let mut ids = std::collections::HashSet::new();
        for d in &self.scenes {
            d.scene.validate()?;
            if !ids.insert(&d.scene.id) {
                return Err("Scene IDs must be unique.".into());
            }
            if d.revisions.len() > 50 || d.chat.len() > 100 {
                return Err("Scene history is too large.".into());
            }
            for r in &d.revisions {
                r.scene.validate()?;
            }
            if d.chat.iter().any(|m| m.text.len() > 50_000) {
                return Err("Chat message too long.".into());
            }
        }
        if self.duration_ms() > MAX_DURATION {
            return Err("Projects are limited to 10 minutes.".into());
        }
        if self.chat.len() > 100 || self.chat.iter().any(|m| m.text.len() > 50_000) {
            return Err("Project conversation is too large.".into());
        }
        if let Some(a) = &self.audio
            && (a.duration_ms > MAX_DURATION
                || a.duration_ms == 0
                || a.peaks.len() > 4000
                || !a.bpm.is_finite()
                || !(30.0..=300.0).contains(&a.bpm)
                || !a.offset_ms.is_finite()
                || a.offset_ms.abs() > f64::from(MAX_DURATION)
                || !(1..=12).contains(&a.beats_per_bar)
                || a.sections.len() > 1000
                || !a.confidence.is_finite()
                || !(0.0..=1.0).contains(&a.confidence)
                || !a.mix.volume.is_finite()
                || !(0.0..=1.0).contains(&a.mix.volume)
                || a.mix.fade_in_ms > MAX_DURATION
                || a.mix.fade_out_ms > MAX_DURATION
                || a.sections.iter().any(|s| *s > a.duration_ms)
                || a.peaks
                    .iter()
                    .any(|p| !p.is_finite() || !(0.0..=1.0).contains(p)))
        {
            return Err("Invalid audio analysis, beat grid, or sound mix.".into());
        }
        Ok(())
    }

    pub fn scene_at(&self, time_ms: f64) -> (&Scene, f64) {
        let mut start = 0.0;
        for doc in &self.scenes {
            let end = start + f64::from(doc.scene.duration_ms);
            if time_ms < end {
                return (&doc.scene, (time_ms - start).max(0.0));
            }
            start = end;
        }
        let last = &self.scenes[self.scenes.len() - 1].scene;
        (last, f64::from(last.duration_ms))
    }
}

fn check_color(s: &str) -> Result<(), String> {
    if s == "none"
        || (s.len() == 7 && s.starts_with('#') && s[1..].bytes().all(|c| c.is_ascii_hexdigit()))
    {
        Ok(())
    } else {
        Err("Colors must be #RRGGBB or none.".into())
    }
}

pub fn element(
    id: &str,
    kind: Kind,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    fill: &str,
) -> Element {
    Element {
        id: id.into(),
        kind,
        text: String::new(),
        path: String::new(),
        x,
        y,
        width,
        height,
        fill: fill.into(),
        stroke: "none".into(),
        stroke_width: 1.0,
        font_size: 32.0,
        font_weight: 400,
        radius: 0.0,
        opacity: 1.0,
        rotation: 0.0,
        scale_x: 1.0,
        scale_y: 1.0,
        tracks: vec![],
    }
}

pub fn track(property: Property, from: f64, to: f64, start: u32, end: u32) -> Track {
    Track {
        property,
        keyframes: vec![
            Keyframe {
                time_ms: start,
                value: from,
                easing: Easing::Linear,
            },
            Keyframe {
                time_ms: end,
                value: to,
                easing: Easing::EaseOut,
            },
        ],
    }
}

pub fn demo_project() -> Project {
    let mut scenes = vec![];
    for (i, (name, headline, sub, color)) in [
        (
            "A little possibility",
            "Make something move.",
            "An idea. A prompt. A little possibility.",
            "#4576f5",
        ),
        (
            "Every part in its place",
            "Every part in its place.",
            "Designed in layers. Brought to life together.",
            "#7960d4",
        ),
        (
            "Find your rhythm",
            "Find your rhythm.",
            "Bring your sound. Let the motion follow.",
            "#d97757",
        ),
        (
            "Make it yours",
            "Your next frame starts here.",
            "Storyboard  /  A local motion studio",
            "#278e75",
        ),
    ]
    .iter()
    .enumerate()
    {
        let mut title = element("headline", Kind::Text, 640.0, 150.0, 0.0, 0.0, "#18181b");
        title.text = (*headline).into();
        title.font_size = 66.0;
        title.font_weight = 700;
        title.tracks = vec![
            track(Property::Y, 175.0, 150.0, 0, 700),
            track(Property::Opacity, 0.0, 1.0, 0, 600),
        ];
        let mut subtitle = element("subtitle", Kind::Text, 640.0, 210.0, 0.0, 0.0, "#71717a");
        subtitle.text = (*sub).into();
        subtitle.font_size = 23.0;
        subtitle.tracks = vec![track(Property::Opacity, 0.0, 1.0, 350, 1000)];
        let mut elements = vec![title, subtitle];
        if i == 1 {
            for n in (0..3).rev() {
                let mut card = element(
                    &format!("layer-{n}"),
                    Kind::Rect,
                    640.0,
                    400.0 + n as f64 * 48.0,
                    390.0,
                    155.0,
                    if n == 0 { "#ffffff" } else { "#f0f0f3" },
                );
                card.radius = 16.0;
                card.stroke = "#d4d4d8".into();
                card.rotation = -8.0;
                card.tracks = vec![
                    track(Property::Y, 470.0, card.y, 400 + n * 100, 1500 + n * 100),
                    track(Property::Opacity, 0.0, 1.0, 300 + n * 100, 1000 + n * 100),
                ];
                elements.push(card);
            }
            let mut label = element("card-label", Kind::Text, 640.0, 402.0, 0.0, 0.0, "#27272a");
            label.text = "Everything, in its own time.".into();
            label.font_size = 25.0;
            label.tracks = vec![track(Property::Opacity, 0.0, 1.0, 1200, 1700)];
            elements.push(label);
        } else {
            for n in 0..7 {
                let height = if i == 2 {
                    60.0 + (n as f64 * 1.7).sin().abs() * 150.0
                } else {
                    150.0
                };
                let mut bar = element(
                    &format!("shape-{n}"),
                    if i == 0 { Kind::Ellipse } else { Kind::Rect },
                    400.0 + n as f64 * 80.0,
                    440.0,
                    if i == 0 { 60.0 } else { 38.0 },
                    height,
                    color,
                );
                bar.radius = 18.0;
                bar.tracks = vec![
                    track(Property::Y, 540.0, 440.0, 350 + n * 100, 1200 + n * 100),
                    track(Property::Opacity, 0.0, 1.0, 350 + n * 100, 1000 + n * 100),
                ];
                if i == 2 {
                    bar.tracks.push(Track {
                        property: Property::ScaleY,
                        keyframes: (0..9)
                            .map(|b| Keyframe {
                                time_ms: b * 500,
                                value: if b % 2 == 0 { 0.5 } else { 1.0 },
                                easing: Easing::EaseInOut,
                            })
                            .collect(),
                    });
                }
                elements.push(bar);
            }
        }
        let mut foot = element("eyebrow", Kind::Text, 640.0, 650.0, 0.0, 0.0, "#a1a1aa");
        foot.text = format!("0{}  /  STORYBOARD", i + 1);
        foot.font_size = 15.0;
        elements.push(foot);
        scenes.push(SceneDocument {
            scene: Scene {
                id: format!("scene-{}", i + 1),
                name: (*name).into(),
                duration_ms: 4000,
                background: "#fafafa".into(),
                elements,
            },
            revisions: vec![],
            chat: vec![],
        });
    }
    Project {version:1,name:"A little motion".into(),width:1280,height:720,fps:30,art_direction:"Quiet, precise motion. Warm white backgrounds, dark typography, and a restrained accent color. Let every movement have a reason.".into(),scenes,chat:vec![],audio:None}
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn project_roundtrip_and_untrusted_input() {
        for (width, height) in [(1080, 1920), (1080, 1080), (8192, 4320), (4320, 8192)] {
            validate_canvas(width, height).unwrap();
        }
        for (width, height) in [(0, 1080), (1081, 1920), (8192, 8192), (8194, 1080)] {
            assert!(validate_canvas(width, height).is_err());
        }
        let p = demo_project();
        p.validate().unwrap();
        let json = serde_json::to_string(&p).unwrap();
        let mut p: Project = serde_json::from_str(&json).unwrap();
        assert_eq!(p.scene_at(4000.0).0.id, "scene-2");
        p.scenes[0].scene.elements[0].fill = "url(https://example.com/track)".into();
        assert!(p.validate().is_err());
        p.scenes[0].scene.elements[0].fill = "#000000".into();
        p.scenes[0].scene.elements[0].tracks[0].keyframes[1].time_ms = 0;
        assert!(p.validate().is_err());
    }
}
