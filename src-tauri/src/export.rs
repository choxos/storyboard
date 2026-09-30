use crate::{
    model::{Project, Scene, validate_canvas},
    process::{program, terminate},
    render,
};
use std::{
    fs::File,
    io::{Read, Seek, Write},
    path::Path,
    process::{Command, Stdio},
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};
use wait_timeout::ChildExt;

pub fn frame(
    scene: &Scene,
    time_ms: f64,
    width: u32,
    height: u32,
    format: &str,
    path: &Path,
) -> Result<(), String> {
    scene.validate()?;
    validate_canvas(width, height)?;
    if !time_ms.is_finite() || !["png", "svg"].contains(&format) {
        return Err("Choose PNG or SVG and a finite frame time.".into());
    }
    let svg = render::svg(scene, time_ms, width, height);
    let bytes = if format == "svg" {
        svg.into_bytes()
    } else {
        render::raster(&svg, width, height, &render::options())?
            .encode_png()
            .map_err(|e| e.to_string())?
    };
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let mut file = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    file.write_all(&bytes).map_err(|e| e.to_string())?;
    file.as_file().sync_all().map_err(|e| e.to_string())?;
    file.persist(path).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn mp4(
    project: &Project,
    path: &Path,
    cancel: &AtomicBool,
    mut progress: impl FnMut(f64),
) -> Result<(), String> {
    project.validate()?;
    if let Some(a) = &project.audio
        && !Path::new(&a.path).is_file()
    {
        return Err("Audio file is missing. Relink or remove it before exporting.".into());
    }
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let temporary = tempfile::Builder::new()
        .prefix(".storyboard-")
        .suffix(".mp4")
        .tempfile_in(parent)
        .map_err(|e| e.to_string())?;
    let mut errors = tempfile::tempfile().map_err(|e| e.to_string())?;
    let mut cmd = Command::new(program("ffmpeg")?);
    cmd.args([
        "-v",
        "error",
        "-nostdin",
        "-y",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgba",
        "-s",
        &format!("{}x{}", project.width, project.height),
        "-r",
        &project.fps.to_string(),
        "-i",
        "pipe:0",
    ]);
    if let Some(a) = &project.audio {
        cmd.arg("-i").arg(&a.path).args([
            "-map", "0:v:0", "-map", "1:a:0", "-af", "apad", "-c:a", "aac", "-b:a", "192k",
        ]);
    }
    cmd.args([
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        "-t",
        &format!("{:.6}", f64::from(project.duration_ms()) / 1000.0),
    ])
    .arg(temporary.path())
    .stdin(Stdio::piped())
    .stdout(Stdio::null())
    .stderr(errors.try_clone().map_err(|e| e.to_string())?);
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let mut pipe = child.stdin.take().ok_or("Cannot open encoder input.")?;
    let options = render::options();
    let frames = (f64::from(project.duration_ms()) * f64::from(project.fps) / 1000.0).ceil() as u32;
    let result = (|| {
        for frame in 0..frames {
            if cancel.load(Ordering::Relaxed) {
                return Err("Export canceled.".into());
            }
            let time = f64::from(frame) * 1000.0 / f64::from(project.fps);
            let (scene, local) = project.scene_at(time);
            let svg = render::svg(scene, local, project.width, project.height);
            let pixels = render::raster(&svg, project.width, project.height, &options)?;
            pipe.write_all(pixels.data())
                .map_err(|e| format!("Encoder stopped: {e}"))?;
            if frame % project.fps == 0 {
                progress(f64::from(frame) / f64::from(frames));
            }
        }
        Ok::<(), String>(())
    })();
    drop(pipe);
    if let Err(e) = result {
        terminate(&mut child);
        return Err(e);
    }
    let status = match child
        .wait_timeout(Duration::from_secs(60))
        .map_err(|e| e.to_string())?
    {
        Some(s) => s,
        None => {
            terminate(&mut child);
            return Err("Encoder did not finish.".into());
        }
    };
    if !status.success() {
        errors.rewind().map_err(|e| e.to_string())?;
        let mut error = String::new();
        errors
            .take(2000)
            .read_to_string(&mut error)
            .map_err(|e| e.to_string())?;
        return Err(format!("Export failed: {error}"));
    }
    if cancel.load(Ordering::Relaxed) {
        return Err("Export canceled.".into());
    }
    File::open(temporary.path())
        .and_then(|f| f.sync_all())
        .map_err(|e| e.to_string())?;
    temporary.persist(path).map_err(|e| e.to_string())?;
    progress(1.0);
    Ok(())
}
