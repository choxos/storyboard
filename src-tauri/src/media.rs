use base64::{Engine, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};

pub const FONTS: &[&str] = &[
    "Arial",
    "Georgia",
    "Times New Roman",
    "Courier New",
    "Verdana",
    "Trebuchet MS",
];

pub fn default_font() -> String {
    "Arial".into()
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ImageAsset {
    pub id: String,
    pub name: String,
    pub data: String,
    pub width: u32,
    pub height: u32,
}

pub fn validate_images(images: &[ImageAsset]) -> Result<(), String> {
    if images.len() > 40 || images.iter().map(|i| i.data.len()).sum::<usize>() > 12_000_000 {
        return Err("Projects support up to 40 images and 12 MB of embedded image data.".into());
    }
    let mut ids = std::collections::HashSet::new();
    for image in images {
        if image.id.is_empty()
            || image.id.len() > 100
            || !ids.insert(&image.id)
            || image.name.len() > 1000
        {
            return Err("Invalid or duplicate image ID or name.".into());
        }
        if image.width == 0
            || image.height == 0
            || image.width > 4096
            || image.height > 4096
            || u64::from(image.width) * u64::from(image.height) > 4_194_304
            || image.data.len() > 5_600_000
        {
            return Err(
                "Images support up to 4 million pixels, 4096 px per side, and 4 MB.".into(),
            );
        }
        let data = image
            .data
            .strip_prefix("data:image/png;base64,")
            .ok_or("Images must be embedded PNG data.")?;
        let bytes = STANDARD
            .decode(data)
            .map_err(|_| "Invalid image encoding.")?;
        if bytes.get(..8) != Some(b"\x89PNG\r\n\x1a\n")
            || bytes.get(12..16) != Some(b"IHDR")
            || bytes.get(16..20) != Some(&image.width.to_be_bytes())
            || bytes.get(20..24) != Some(&image.height.to_be_bytes())
        {
            return Err("Invalid PNG dimensions or data.".into());
        }
        resvg::tiny_skia::Pixmap::decode_png(&bytes)
            .map_err(|e| format!("Invalid PNG image: {e}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{model, render, storage};

    #[test]
    fn embedded_image_survives_save_and_renders_its_pixels() {
        // Given a red PNG referenced by an image layer.
        let mut png = resvg::tiny_skia::Pixmap::new(2, 2).unwrap();
        png.fill(resvg::tiny_skia::Color::from_rgba8(240, 20, 30, 255));
        let mut project = model::demo_project();
        project.images.push(ImageAsset {
            id: "logo".into(),
            name: "Logo".into(),
            data: format!(
                "data:image/png;base64,{}",
                STANDARD.encode(png.encode_png().unwrap())
            ),
            width: 2,
            height: 2,
        });
        project.scenes[0].scene.elements = vec![model::element(
            "image",
            model::Kind::Image,
            32.0,
            32.0,
            64.0,
            64.0,
            "none",
        )];
        project.scenes[0].scene.elements[0].image_id = "logo".into();
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("image.storyboard");
        // When saved, reopened, and rasterized through the native renderer.
        storage::write(&path, &project).unwrap();
        let restored = storage::read(&path).unwrap();
        let frame = render::svg(&restored.scenes[0].scene, 0.0, 64, 64, &restored.images);
        let pixels = render::raster(&frame, 64, 64, &render::options(), true).unwrap();
        // Then the embedded image supplies the actual output pixels.
        assert_eq!(pixels.pixel(32, 32).unwrap().red(), 240);
        assert_eq!(pixels.pixel(32, 32).unwrap().green(), 20);
        assert_eq!(pixels.pixel(32, 32).unwrap().alpha(), 255);
        project.images[0].data = "https://example.com/tracker.png".into();
        assert!(project.validate().is_err());
    }
}
