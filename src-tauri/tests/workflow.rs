use std::{
    io::Write,
    process::Command,
    sync::atomic::{AtomicBool, Ordering},
};
use storyboard::{audio, export, model, process, storage};

#[test]
fn real_audio_export_and_cancellation_preserve_destination() {
    let dir = tempfile::tempdir().unwrap();
    let wav = dir.path().join("clicks.wav");
    let samples: Vec<i16> = (0..22050 * 2)
        .map(|i| if i % 11025 < 220 { 16000 } else { 0 })
        .collect();
    let mut file = std::fs::File::create(&wav).unwrap();
    let bytes = (samples.len() * 2) as u32;
    file.write_all(b"RIFF").unwrap();
    file.write_all(&(36 + bytes).to_le_bytes()).unwrap();
    file.write_all(b"WAVEfmt ").unwrap();
    file.write_all(&16u32.to_le_bytes()).unwrap();
    file.write_all(&1u16.to_le_bytes()).unwrap();
    file.write_all(&1u16.to_le_bytes()).unwrap();
    file.write_all(&22050u32.to_le_bytes()).unwrap();
    file.write_all(&44100u32.to_le_bytes()).unwrap();
    file.write_all(&2u16.to_le_bytes()).unwrap();
    file.write_all(&16u16.to_le_bytes()).unwrap();
    file.write_all(b"data").unwrap();
    file.write_all(&bytes.to_le_bytes()).unwrap();
    for sample in samples {
        file.write_all(&sample.to_le_bytes()).unwrap();
    }
    drop(file);
    let cancel = AtomicBool::new(false);
    let audio = audio::analyze(&wav, &cancel).unwrap();
    assert_eq!(audio.duration_ms, 2000);
    let mut project = model::demo_project();
    project.scenes.truncate(1);
    project.width = 320;
    project.height = 240;
    let scene = &mut project.scenes[0].scene;
    scene.duration_ms = 1000;
    scene.elements.truncate(1);
    let text = &mut scene.elements[0];
    text.x = 160.0;
    text.y = 120.0;
    text.font_size = 24.0;
    text.tracks.clear();
    project.audio = Some(audio);
    let project_path = dir.path().join("roundtrip.storyboard");
    storage::write(&project_path, &project).unwrap();
    let project = storage::read(&project_path).unwrap();
    let video = dir.path().join("movie.mp4");
    export::mp4(&project, &video, &cancel, |_| {}).unwrap();
    let probe = Command::new(process::program("ffprobe").unwrap())
        .args([
            "-v",
            "error",
            "-show_entries",
            "stream=codec_name,width,height,nb_frames:format=duration",
            "-of",
            "json",
        ])
        .arg(&video)
        .output()
        .unwrap();
    assert!(probe.status.success());
    let metadata: serde_json::Value = serde_json::from_slice(&probe.stdout).unwrap();
    assert_eq!(metadata["format"]["duration"], "1.000000");
    assert_eq!(metadata["streams"][0]["nb_frames"], "30");
    assert_eq!(metadata["streams"][0]["codec_name"], "h264");
    assert_eq!(metadata["streams"][1]["codec_name"], "aac");
    let before = std::fs::read(&video).unwrap();
    assert!(
        export::mp4(&project, &video, &cancel, |_| cancel
            .store(true, Ordering::Relaxed))
        .is_err()
    );
    assert_eq!(std::fs::read(&video).unwrap(), before);
}

#[test]
fn still_exports_match_canvas_and_preserve_files_on_invalid_input() {
    let dir = tempfile::tempdir().unwrap();
    let project = model::demo_project();
    let scene = &project.scenes[0].scene;
    let path = dir.path().join("frame.png");
    export::frame(scene, 1200.0, 320, 240, "png", &path).unwrap();
    let bytes = std::fs::read(&path).unwrap();
    assert_eq!(&bytes[..8], b"\x89PNG\r\n\x1a\n");
    assert_eq!(u32::from_be_bytes(bytes[16..20].try_into().unwrap()), 320);
    assert_eq!(u32::from_be_bytes(bytes[20..24].try_into().unwrap()), 240);
    assert!(export::frame(scene, f64::NAN, 320, 240, "png", &path).is_err());
    assert_eq!(std::fs::read(&path).unwrap(), bytes);
    let mut transparent = scene.clone();
    transparent.background = "none".into();
    transparent.elements.clear();
    export::frame(&transparent, 1200.0, 320, 240, "png", &path).unwrap();
    let decoded = Command::new(process::program("ffmpeg").unwrap())
        .args(["-v", "error", "-i"])
        .arg(&path)
        .args(["-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"])
        .output()
        .unwrap();
    assert!(decoded.status.success());
    assert_eq!(decoded.stdout.len(), 320 * 240 * 4);
    assert!(
        decoded
            .stdout
            .as_chunks::<4>()
            .0
            .iter()
            .all(|pixel| pixel[3] == 0)
    );
    let svg = dir.path().join("frame.svg");
    export::frame(scene, 1200.0, 320, 240, "svg", &svg).unwrap();
    assert_eq!(
        std::fs::read_to_string(svg).unwrap(),
        storyboard::render::svg(scene, 1200.0, 320, 240)
    );
}

#[test]
fn sound_mix_changes_encoded_audio_and_reads_older_projects() {
    let dir = tempfile::tempdir().unwrap();
    let wav = dir.path().join("tone.wav");
    let ffmpeg = process::program("ffmpeg").unwrap();
    let status = Command::new(&ffmpeg)
        .args([
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:sample_rate=22050:duration=2",
        ])
        .arg(&wav)
        .status()
        .unwrap();
    assert!(status.success());
    let cancel = AtomicBool::new(false);
    let mut project = model::demo_project();
    project.width = 160;
    project.height = 90;
    project.scenes.truncate(1);
    project.scenes[0].scene.duration_ms = 2000;
    project.scenes[0].scene.elements.clear();
    project.audio = Some(audio::analyze(&wav, &cancel).unwrap());
    let mut old = serde_json::to_value(&project).unwrap();
    old["audio"].as_object_mut().unwrap().remove("mix");
    let restored: model::Project = serde_json::from_value(old).unwrap();
    assert_eq!(restored.audio.unwrap().mix.volume, 1.0);
    let decode = |path: &std::path::Path| {
        let result = Command::new(&ffmpeg)
            .args(["-v", "error", "-i"])
            .arg(path)
            .args(["-vn", "-ac", "1", "-ar", "22050", "-f", "f32le", "pipe:1"])
            .output()
            .unwrap();
        assert!(result.status.success());
        result
            .stdout
            .as_chunks::<4>()
            .0
            .iter()
            .map(|b| f32::from_le_bytes(*b))
            .collect::<Vec<_>>()
    };
    let rms = |samples: &[f32], start: f64, end: f64| {
        let slice = &samples[(start * 22050.0) as usize..(end * 22050.0) as usize];
        (slice.iter().map(|x| f64::from(*x).powi(2)).sum::<f64>() / slice.len() as f64).sqrt()
    };
    let baseline = dir.path().join("baseline.mp4");
    export::mp4(&project, &baseline, &cancel, |_| {}).unwrap();
    let base = decode(&baseline);
    project.audio.as_mut().unwrap().mix = model::AudioMix {
        volume: 0.25,
        muted: false,
        fade_in_ms: 500,
        fade_out_ms: 500,
    };
    let mixed = dir.path().join("mixed.mp4");
    export::mp4(&project, &mixed, &cancel, |_| {}).unwrap();
    let samples = decode(&mixed);
    let ratio = rms(&samples, 0.7, 1.3) / rms(&base, 0.7, 1.3);
    assert!((ratio - 0.25).abs() < 0.02, "volume ratio {ratio}");
    assert!(rms(&samples, 0.05, 0.15) < rms(&samples, 0.7, 1.3) * 0.35);
    assert!(rms(&samples, 1.85, 1.95) < rms(&samples, 0.7, 1.3) * 0.35);
    project.audio.as_mut().unwrap().mix.muted = true;
    let muted = dir.path().join("muted.mp4");
    export::mp4(&project, &muted, &cancel, |_| {}).unwrap();
    assert!(decode(&muted).iter().all(|x| x.abs() < 0.00001));
    project.audio.as_mut().unwrap().mix.volume = f64::NAN;
    assert!(project.validate().is_err());
}
