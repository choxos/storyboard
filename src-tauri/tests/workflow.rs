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
