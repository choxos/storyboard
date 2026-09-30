pub mod ai;
pub mod audio;
pub mod export;
pub mod model;
pub mod models;
pub mod process;
pub mod render;
pub mod storage;

use model::{Project, Scene};
use serde_json::{Value, json};
use std::{
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};
use tauri::{Emitter, Manager};

#[derive(Default)]
struct Jobs {
    cancel: Arc<AtomicBool>,
    busy: Arc<AtomicBool>,
}
#[derive(Default)]
struct ModelDiscovery(Arc<AtomicBool>);
struct Busy(Arc<AtomicBool>);
impl Drop for Busy {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}
impl Jobs {
    fn begin(&self) -> Result<(Busy, Arc<AtomicBool>), String> {
        self.busy
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .map_err(|_| "Wait for the current job or cancel it.".to_string())?;
        self.cancel.store(false, Ordering::SeqCst);
        Ok((Busy(self.busy.clone()), self.cancel.clone()))
    }
}

fn recovery(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("recovery.storyboard"))
}

fn allow_audio(app: &tauri::AppHandle, p: &Project) -> Option<String> {
    if let Some(a) = &p.audio {
        if !Path::new(&a.path).is_file() {
            return Some(format!(
                "Audio missing: {}. Use Import audio to relink.",
                a.name
            ));
        }
        if let Err(e) = app.asset_protocol_scope().allow_file(&a.path) {
            return Some(e.to_string());
        }
    }
    None
}

#[tauri::command]
fn bootstrap(app: tauri::AppHandle) -> Result<Value, String> {
    let path = recovery(&app)?;
    let (project, recovered, error) = if path.exists() {
        match storage::read(&path) {
            Ok(p) => (p, true, None),
            Err(e) => (
                model::demo_project(),
                false,
                Some(format!(
                    "Recovery could not be opened: {e}. Original file is preserved."
                )),
            ),
        }
    } else {
        (model::demo_project(), false, None)
    };
    let warning = error.or_else(|| allow_audio(&app, &project));
    Ok(
        json!({"project":project,"recovered":recovered,"warning":warning,"providers":{"claude":process::program("claude").is_ok(),"codex":process::program("codex").is_ok()},"ffmpeg":process::program("ffmpeg").is_ok()}),
    )
}

#[tauri::command]
fn demo() -> Project {
    model::demo_project()
}

#[tauri::command]
async fn model_catalog(
    provider: String,
    discovery: tauri::State<'_, ModelDiscovery>,
) -> Result<models::Catalog, String> {
    let cancel = discovery.0.clone();
    cancel.store(false, Ordering::SeqCst);
    tauri::async_runtime::spawn_blocking(move || models::discover(&provider, &cancel))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn cancel_model_discovery(discovery: tauri::State<'_, ModelDiscovery>) {
    discovery.0.store(true, Ordering::SeqCst);
}

#[tauri::command]
fn render_frame(scene: Scene, time_ms: f64, width: u32, height: u32) -> Result<String, String> {
    scene.validate()?;
    model::validate_canvas(width, height)?;
    if !time_ms.is_finite() {
        return Err("Invalid frame dimensions or time.".into());
    }
    Ok(render::svg(&scene, time_ms, width, height))
}

#[tauri::command]
fn validate_project(project: Project) -> Result<(), String> {
    project.validate()
}

#[tauri::command]
fn save_recovery(app: tauri::AppHandle, project: Project) -> Result<(), String> {
    storage::write(&recovery(&app)?, &project)
}

#[tauri::command]
async fn open_project(
    app: tauri::AppHandle,
    path: Option<String>,
) -> Result<Option<Value>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = path.map(PathBuf::from).or_else(|| {
            rfd::FileDialog::new()
                .add_filter("Storyboard", &["storyboard", "json"])
                .pick_file()
        });
        path.map(|path| {
            let project = storage::read(&path)?;
            let warning = allow_audio(&app, &project);
            Ok(json!({"project":project,"path":path,"warning":warning}))
        })
        .transpose()
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn save_project(project: Project, path: Option<String>) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = path.map(PathBuf::from).or_else(|| {
            rfd::FileDialog::new()
                .add_filter("Storyboard", &["storyboard"])
                .set_file_name("Untitled.storyboard")
                .save_file()
        });
        path.map(|p| {
            storage::write(&p, &project)?;
            Ok(p.to_string_lossy().into())
        })
        .transpose()
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn import_audio(
    app: tauri::AppHandle,
    jobs: tauri::State<'_, Jobs>,
    path: Option<String>,
) -> Result<Option<model::AudioTrack>, String> {
    let (guard, cancel) = jobs.begin()?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        let path = path.map(PathBuf::from).or_else(|| {
            rfd::FileDialog::new()
                .add_filter("Audio", &["mp3", "wav", "m4a", "aac", "flac", "aiff"])
                .pick_file()
        });
        path.map(|path| {
            let audio = audio::analyze(&path, &cancel)?;
            app.asset_protocol_scope()
                .allow_file(&audio.path)
                .map_err(|e| e.to_string())?;
            Ok(audio)
        })
        .transpose()
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn generate(
    project: Project,
    scene_index: Option<usize>,
    provider: String,
    model: String,
    effort: String,
    prompt: String,
    jobs: tauri::State<'_, Jobs>,
) -> Result<ai::Reply, String> {
    let (guard, cancel) = jobs.begin()?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        ai::generate(
            &project,
            scene_index,
            &provider,
            &model,
            &effort,
            &prompt,
            &cancel,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn export_video(
    app: tauri::AppHandle,
    project: Project,
    jobs: tauri::State<'_, Jobs>,
) -> Result<Option<String>, String> {
    let (guard, cancel) = jobs.begin()?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        let path = rfd::FileDialog::new()
            .add_filter("MP4 video", &["mp4"])
            .set_file_name("Storyboard.mp4")
            .save_file();
        path.map(|p| {
            export::mp4(&project, &p, &cancel, |progress| {
                let _ = app.emit("export-progress", progress);
            })?;
            Ok(p.to_string_lossy().into())
        })
        .transpose()
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn cancel_job(jobs: tauri::State<'_, Jobs>) {
    jobs.cancel.store(true, Ordering::SeqCst);
}

#[tauri::command]
async fn export_frame(
    scene: Scene,
    time_ms: f64,
    width: u32,
    height: u32,
    format: String,
    jobs: tauri::State<'_, Jobs>,
) -> Result<Option<String>, String> {
    scene.validate()?;
    model::validate_canvas(width, height)?;
    if !time_ms.is_finite() || !["png", "svg"].contains(&format.as_str()) {
        return Err("Choose PNG or SVG and a finite frame time.".into());
    }
    let (guard, _) = jobs.begin()?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        let path = rfd::FileDialog::new()
            .add_filter(format.to_uppercase(), &[format.as_str()])
            .set_file_name(format!("Storyboard-frame.{format}"))
            .save_file();
        path.map(|path| {
            export::frame(&scene, time_ms, width, height, &format, &path)?;
            Ok(path.to_string_lossy().into_owned())
        })
        .transpose()
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn check_seams(project: Project) -> Result<Vec<f64>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        project.validate()?;
        let options = render::options();
        let width = 320;
        let height = (320.0 * project.height as f64 / project.width as f64).round() as u32;
        project
            .scenes
            .windows(2)
            .map(|pair| {
                let a = render::raster(
                    &render::svg(
                        &pair[0].scene,
                        f64::from(pair[0].scene.duration_ms),
                        project.width,
                        project.height,
                    ),
                    width,
                    height,
                    &options,
                    false,
                )?;
                let b = render::raster(
                    &render::svg(&pair[1].scene, 0.0, project.width, project.height),
                    width,
                    height,
                    &options,
                    false,
                )?;
                let changed = a
                    .data()
                    .as_chunks::<4>()
                    .0
                    .iter()
                    .zip(b.data().as_chunks::<4>().0.iter())
                    .filter(|(a, b)| (0..3).any(|i| a[i].abs_diff(b[i]) > 16))
                    .count();
                Ok(changed as f64 / (width * height) as f64 * 100.0)
            })
            .collect()
    })
    .await
    .map_err(|e| e.to_string())?
}

pub fn run() {
    tauri::Builder::default()
        .manage(Jobs::default())
        .manage(ModelDiscovery::default())
        .invoke_handler(tauri::generate_handler![
            bootstrap,
            demo,
            model_catalog,
            cancel_model_discovery,
            render_frame,
            validate_project,
            save_recovery,
            open_project,
            save_project,
            import_audio,
            generate,
            export_video,
            export_frame,
            cancel_job,
            check_seams
        ])
        .run(tauri::generate_context!())
        .expect("Unable to start Storyboard");
}
