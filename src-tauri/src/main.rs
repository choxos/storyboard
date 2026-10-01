use std::{path::Path, sync::atomic::AtomicBool};

fn cli(args: &[String]) -> Result<(), String> {
    match args.get(1).map(String::as_str) {
        Some("--help") => println!(
            "Storyboard\n\nOpen without arguments for the macOS editor.\n\n  --demo PROJECT.storyboard\n  --check PROJECT.storyboard\n  --render PROJECT.storyboard TIME_MS FRAME.png\n  --export PROJECT.storyboard VIDEO.mp4\n  --analyze AUDIO\n  --models claude|codex\n  --generate claude|codex PROJECT.storyboard PROMPT OUTPUT.storyboard [MODEL [EFFORT]]\n"
        ),
        Some("--demo") if args.len() == 3 => {
            storyboard::storage::write(Path::new(&args[2]), &storyboard::model::demo_project())?
        }
        Some("--models") if args.len() == 3 => {
            let catalog = storyboard::models::discover(&args[2], &AtomicBool::new(false))?;
            println!(
                "{}",
                serde_json::to_string_pretty(&catalog).map_err(|e| e.to_string())?
            );
        }
        Some("--check") if args.len() == 3 => {
            let p = storyboard::storage::read(Path::new(&args[2]))?;
            println!("Valid: {} scenes, {} ms", p.scenes.len(), p.duration_ms());
        }
        Some("--render") if args.len() == 5 => {
            let p = storyboard::storage::read(Path::new(&args[2]))?;
            let time = args[3].parse::<f64>().map_err(|e| e.to_string())?;
            if !time.is_finite() || time < 0.0 {
                return Err("Time must be a finite nonnegative number.".into());
            }
            let (scene, local) = p.scene_at(time);
            let svg = storyboard::render::svg(scene, local, p.width, p.height, &p.images);
            storyboard::render::raster(
                &svg,
                p.width,
                p.height,
                &storyboard::render::options(),
                true,
            )?
            .save_png(&args[4])
            .map_err(|e| e.to_string())?;
        }
        Some("--export") if args.len() == 4 => {
            let p = storyboard::storage::read(Path::new(&args[2]))?;
            storyboard::export::mp4(&p, Path::new(&args[3]), &AtomicBool::new(false), |v| {
                eprintln!("{:.0}%", v * 100.0)
            })?;
        }
        Some("--analyze") if args.len() == 3 => {
            let a = storyboard::audio::analyze(Path::new(&args[2]), &AtomicBool::new(false))?;
            println!("{}", serde_json::to_string(&a).map_err(|e| e.to_string())?);
        }
        Some("--generate") if (6..=8).contains(&args.len()) => {
            let mut p = storyboard::storage::read(Path::new(&args[3]))?;
            let reply = storyboard::ai::generate(
                &p,
                &storyboard::ai::Request {
                    scene_index: Some(0),
                    provider: args[2].clone(),
                    model: args.get(6).cloned().unwrap_or_default(),
                    effort: args.get(7).cloned().unwrap_or_default(),
                    prompt: args[4].clone(),
                    playhead_ms: 0.0,
                    review_frames: true,
                },
                &AtomicBool::new(false),
            )?;
            p.scenes[0].scene = reply.scenes[0].clone();
            storyboard::storage::write(Path::new(&args[5]), &p)?;
            println!("{}", reply.summary);
        }
        _ => return Err("Invalid arguments. Use --help.".into()),
    }
    Ok(())
}
fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() == 1 {
        storyboard::run();
    } else if let Err(e) = cli(&args) {
        eprintln!("{e}");
        std::process::exit(1);
    }
}
