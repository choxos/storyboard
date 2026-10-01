use crate::{model::Project, render};
use std::path::{Path, PathBuf};

pub struct Frame {
    pub path: PathBuf,
    pub label: String,
}

pub fn render(
    project: &Project,
    index: Option<usize>,
    playhead: f64,
    directory: &Path,
) -> Result<Vec<Frame>, String> {
    let start = index
        .map(|i| {
            project.scenes[..i]
                .iter()
                .map(|d| d.scene.duration_ms)
                .sum::<u32>()
        })
        .unwrap_or(0);
    let length = index
        .map(|i| project.scenes[i].scene.duration_ms)
        .unwrap_or(project.duration_ms());
    let end = f64::from(start + length) - 1000.0 / f64::from(project.fps);
    let mut times = vec![f64::from(start), playhead.clamp(f64::from(start), end), end];
    times.sort_by(f64::total_cmp);
    times.dedup();
    let scale = (960.0 / f64::from(project.width.max(project.height))).min(1.0);
    let width = (f64::from(project.width) * scale).round().max(1.0) as u32;
    let height = (f64::from(project.height) * scale).round().max(1.0) as u32;
    let options = render::options();
    times
        .iter()
        .enumerate()
        .map(|(i, time)| {
            let (scene, local) = project.scene_at(*time);
            let svg = render::svg(scene, local, project.width, project.height, &project.images);
            let path = directory.join(format!("frame-{i}.png"));
            render::raster(&svg, width, height, &options, false)?
                .save_png(&path)
                .map_err(|e| e.to_string())?;
            Ok(Frame {
                path,
                label: format!(
                    "{}: global {:.0} ms, scene {:.0} ms",
                    scene.name, time, local
                ),
            })
        })
        .collect()
}
