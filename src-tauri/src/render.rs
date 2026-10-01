use crate::model::{Easing, Element, Kind, Property, Scene, Track};
use std::fmt::Write;

pub fn sample(track: &Track, time_ms: f64) -> f64 {
    let first = &track.keyframes[0];
    if time_ms <= f64::from(first.time_ms) {
        return first.value;
    }
    for pair in track.keyframes.windows(2) {
        let (a, b) = (&pair[0], &pair[1]);
        if time_ms <= f64::from(b.time_ms) {
            let t = ((time_ms - f64::from(a.time_ms)) / f64::from(b.time_ms - a.time_ms))
                .clamp(0.0, 1.0);
            let t = match b.easing {
                Easing::Linear => t,
                Easing::EaseIn => t * t * t,
                Easing::EaseOut => 1.0 - (1.0 - t).powi(3),
                Easing::EaseInOut => {
                    if t < 0.5 {
                        4.0 * t * t * t
                    } else {
                        1.0 - (-2.0 * t + 2.0).powi(3) / 2.0
                    }
                }
                Easing::Step => {
                    if t < 1.0 {
                        0.0
                    } else {
                        1.0
                    }
                }
            };
            return a.value + (b.value - a.value) * t;
        }
    }
    track.keyframes.last().unwrap().value
}

pub fn evaluated(element: &Element, time_ms: f64) -> Element {
    let mut e = element.clone();
    for t in &element.tracks {
        let v = sample(t, time_ms);
        match t.property {
            Property::X => e.x = v,
            Property::Y => e.y = v,
            Property::Width => e.width = v,
            Property::Height => e.height = v,
            Property::Opacity => e.opacity = v,
            Property::Rotation => e.rotation = v,
            Property::ScaleX => e.scale_x = v,
            Property::ScaleY => e.scale_y = v,
        }
    }
    e
}

pub fn escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

pub fn svg(
    scene: &Scene,
    time_ms: f64,
    width: u32,
    height: u32,
    images: &[crate::media::ImageAsset],
) -> String {
    let mut s = format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="{width}" height="{height}"><rect width="100%" height="100%" fill="{}"/>"#,
        escape(&scene.background)
    );
    for element in &scene.elements {
        let e = evaluated(element, time_ms);
        let _ = write!(
            s,
            r#"<g data-element="{}" transform="translate({} {}) rotate({}) scale({} {})" opacity="{}" fill="{}" stroke="{}" stroke-width="{}">"#,
            escape(&e.id),
            e.x,
            e.y,
            e.rotation,
            e.scale_x,
            e.scale_y,
            e.opacity,
            escape(&e.fill),
            escape(&e.stroke),
            e.stroke_width
        );
        match e.kind {
            Kind::Image => {
                if let Some(image) = images.iter().find(|a| a.id == e.image_id) {
                    let _ = write!(
                        s,
                        r#"<image x="{}" y="{}" width="{}" height="{}" preserveAspectRatio="xMidYMid meet" href="{}"/>"#,
                        -e.width / 2.0,
                        -e.height / 2.0,
                        e.width,
                        e.height,
                        escape(&image.data)
                    );
                }
            }
            Kind::Rect => {
                let _ = write!(
                    s,
                    r#"<rect x="{}" y="{}" width="{}" height="{}" rx="{}"/>"#,
                    -e.width / 2.0,
                    -e.height / 2.0,
                    e.width,
                    e.height,
                    e.radius
                );
            }
            Kind::Ellipse => {
                let _ = write!(
                    s,
                    r#"<ellipse rx="{}" ry="{}"/>"#,
                    e.width / 2.0,
                    e.height / 2.0
                );
            }
            Kind::Path => {
                let _ = write!(s, r#"<path d="{}"/>"#, escape(&e.path));
            }
            Kind::Text => {
                let _ = write!(
                    s,
                    r#"<text text-anchor="middle" font-family="{}" font-size="{}" font-weight="{}">"#,
                    escape(&e.font_family),
                    e.font_size,
                    e.font_weight
                );
                for (i, line) in e.text.lines().enumerate() {
                    let _ = write!(
                        s,
                        r#"<tspan x="0" dy="{}">{}</tspan>"#,
                        if i == 0 { 0.0 } else { e.font_size * 1.2 },
                        escape(line)
                    );
                }
                s.push_str("</text>");
            }
        }
        s.push_str("</g>");
    }
    s.push_str("</svg>");
    s
}

pub fn options() -> resvg::usvg::Options<'static> {
    let mut options = resvg::usvg::Options::default();
    options.fontdb_mut().load_system_fonts();
    options
}

pub fn raster(
    svg: &str,
    width: u32,
    height: u32,
    options: &resvg::usvg::Options,
    transparent: bool,
) -> Result<resvg::tiny_skia::Pixmap, String> {
    let tree = resvg::usvg::Tree::from_str(svg, options).map_err(|e| e.to_string())?;
    let mut pixmap =
        resvg::tiny_skia::Pixmap::new(width, height).ok_or("Cannot allocate frame.")?;
    if !transparent {
        pixmap.fill(resvg::tiny_skia::Color::WHITE);
    }
    let scale = resvg::tiny_skia::Transform::from_scale(
        width as f32 / tree.size().width(),
        height as f32 / tree.size().height(),
    );
    resvg::render(&tree, scale, &mut pixmap.as_mut());
    Ok(pixmap)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exact_keyframes_easing_and_xml_escape() {
        let t = crate::model::track(Property::X, 0.0, 100.0, 0, 1000);
        assert_eq!(sample(&t, 0.0), 0.0);
        assert_eq!(sample(&t, 500.0), 87.5);
        assert_eq!(sample(&t, 1000.0), 100.0);
        let mut p = crate::model::demo_project();
        p.scenes[0].scene.elements[0].text = "<script> & \"hello\"".into();
        let xml = svg(&p.scenes[0].scene, 1000.0, 1280, 720, &p.images);
        assert!(!xml.contains("<script>"));
        assert!(xml.contains("&lt;script&gt;"));
        let pixels = raster(&xml, 320, 180, &options(), true).unwrap();
        assert_eq!(pixels.data().len(), 320 * 180 * 4);
    }
}
