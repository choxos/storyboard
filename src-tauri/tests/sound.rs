use base64::{Engine, engine::general_purpose::STANDARD};
use std::{process::Command, sync::atomic::AtomicBool};
use storyboard::{
    audio, export, model, process,
    sound::{SoundAsset, SoundCue},
};

#[test]
fn encoded_cues_obey_offset_trim_pitch_and_scene_order() {
    let dir = tempfile::tempdir().unwrap();
    let ffmpeg = process::program("ffmpeg").unwrap();
    let source = Command::new(&ffmpeg)
        .args([
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "aevalsrc=if(lt(t\\,1)\\,0.2*sin(2*PI*440*t)\\,0.2*sin(2*PI*880*t)):s=24000:d=2",
            "-f",
            "s16le",
            "pipe:1",
        ])
        .output()
        .unwrap();
    assert!(source.status.success());
    let len = source.stdout.len() as u32;
    let mut wav = b"RIFF".to_vec();
    wav.extend((len + 36).to_le_bytes());
    wav.extend(b"WAVEfmt ");
    wav.extend(16_u32.to_le_bytes());
    wav.extend(1_u16.to_le_bytes());
    wav.extend(1_u16.to_le_bytes());
    wav.extend(24000_u32.to_le_bytes());
    wav.extend(48000_u32.to_le_bytes());
    wav.extend(2_u16.to_le_bytes());
    wav.extend(16_u16.to_le_bytes());
    wav.extend(b"data");
    wav.extend(len.to_le_bytes());
    wav.extend(source.stdout);
    let path = dir.path().join("tones.wav");
    std::fs::write(&path, &wav).unwrap();
    let cancel = AtomicBool::new(false);
    let mut project = model::demo_project();
    project.width = 160;
    project.height = 90;
    project.scenes.truncate(2);
    for d in &mut project.scenes {
        d.scene.duration_ms = 1000;
        d.scene.elements.clear();
    }
    project.audio = Some(audio::analyze(&path, &cancel).unwrap());
    project.audio.as_mut().unwrap().start_ms = 1000;
    let decode = |project: &model::Project, name: &str| {
        let video = dir.path().join(name);
        export::mp4(project, &video, &cancel, |_| {}).unwrap();
        let result = Command::new(&ffmpeg)
            .args(["-v", "error", "-i"])
            .arg(&video)
            .args(["-vn", "-ac", "1", "-ar", "24000", "-f", "f32le", "pipe:1"])
            .output()
            .unwrap();
        assert!(result.status.success());
        assert!(
            result.stdout.len() >= 48000 * 4,
            "{name} returned too little audio: {}",
            String::from_utf8_lossy(&result.stderr)
        );
        result
            .stdout
            .as_chunks::<4>()
            .0
            .iter()
            .map(|b| f32::from_le_bytes(*b))
            .collect::<Vec<_>>()
    };
    let rms = |s: &[f32], from: f64, to: f64| {
        let s = &s[(from * 24000.0) as usize..(to * 24000.0) as usize];
        (s.iter().map(|x| f64::from(*x).powi(2)).sum::<f64>() / s.len() as f64).sqrt()
    };
    let frequency = |s: &[f32], from: f64, to: f64| {
        let s = &s[(from * 24000.0) as usize..(to * 24000.0) as usize];
        s.windows(2).filter(|p| p[0] <= 0.0 && p[1] > 0.0).count() as f64 / (to - from)
    };
    let music = decode(&project, "offset.mp4");
    assert!((frequency(&music, 0.2, 0.8) - 880.0).abs() < 5.0);
    assert!(rms(&music, 1.3, 1.8) < 0.0001);
    project.audio.as_mut().unwrap().mix.muted = true;
    project.sounds = vec![SoundAsset {
        id: "tone".into(),
        name: "Two tones".into(),
        data: format!("data:audio/wav;base64,{}", STANDARD.encode(wav)),
        duration_ms: 2000,
    }];
    project.scenes[0].scene.sounds = vec![SoundCue {
        id: "cue".into(),
        sound_id: "tone".into(),
        at_ms: 750,
        trim_start_ms: 1000,
        duration_ms: 400,
        volume: 0.5,
        pitch: 12,
    }];
    let cues = decode(&project, "cues.mp4");
    assert!(rms(&cues, 0.1, 0.6) < 0.0001);
    assert!((frequency(&cues, 0.82, 1.08) - 1760.0).abs() < 10.0);
    assert!((rms(&cues, 0.85, 1.05) - 0.0707).abs() < 0.008);
    assert!(rms(&cues, 1.3, 1.8) < 0.0001);
    project.audio = None;
    project.scenes.reverse();
    let moved = decode(&project, "moved.mp4");
    assert!(rms(&moved, 0.8, 1.2) < 0.0001);
    assert!((frequency(&moved, 1.8, 1.95) - 1760.0).abs() < 12.0);
    project.sounds[0].duration_ms = 3000;
    assert!(project.validate().is_err());
}
