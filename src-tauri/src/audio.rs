use crate::{
    model::AudioTrack,
    process::{capture, program},
};
use std::{path::Path, process::Command, sync::atomic::AtomicBool, time::Duration};

pub fn analyze(path: &Path, cancel: &AtomicBool) -> Result<AudioTrack, String> {
    if !path.is_file() {
        return Err("Audio file does not exist.".into());
    }
    let mut cmd = Command::new(program("ffmpeg")?);
    cmd.args(["-v", "error", "-nostdin", "-i"]).arg(path).args([
        "-t", "601", "-vn", "-ac", "1", "-ar", "22050", "-f", "f32le", "pipe:1",
    ]);
    let bytes = capture(&mut cmd, "", cancel, Duration::from_secs(120), 54_000_000)?;
    let samples: Vec<f32> = bytes
        .as_chunks::<4>()
        .0
        .iter()
        .map(|b| f32::from_le_bytes(*b))
        .collect();
    if samples.len() > 22050 * 600 {
        return Err("Audio must be no longer than 10 minutes.".into());
    }
    if samples.len() < 22050 / 2 || samples.iter().any(|v| !v.is_finite()) {
        return Err("Audio is too short or could not be decoded.".into());
    }
    let mut a = analyze_samples(&samples, 22050);
    a.path = path
        .canonicalize()
        .map_err(|e| e.to_string())?
        .to_string_lossy()
        .into();
    a.name = path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into();
    Ok(a)
}

pub fn analyze_samples(samples: &[f32], sample_rate: usize) -> AudioTrack {
    let hop = (sample_rate / 100).max(1);
    let energy: Vec<f64> = samples
        .chunks(hop)
        .map(|chunk| {
            (chunk.iter().map(|v| f64::from(*v).powi(2)).sum::<f64>() / chunk.len() as f64).sqrt()
        })
        .collect();
    let onset: Vec<f64> = energy
        .iter()
        .enumerate()
        .map(|(i, v)| (v - energy[i.saturating_sub(1)]).max(0.0))
        .collect();
    let hz = sample_rate as f64 / hop as f64;
    let mut best = (0, 0.0);
    for lag in (hz * 60.0 / 200.0) as usize..=(hz * 60.0 / 60.0) as usize {
        let score = onset
            .iter()
            .skip(lag)
            .zip(&onset)
            .map(|(a, b)| a * b)
            .sum::<f64>();
        if score > best.1 {
            best = (lag, score);
        }
    }
    let bpm = if best.0 > 0 {
        60.0 * hz / best.0 as f64
    } else {
        120.0
    };
    let period = (hz * 60.0 / bpm).round().max(1.0) as usize;
    let phase = (0..period)
        .max_by(|a, b| {
            let score = |offset: usize| onset.iter().skip(offset).step_by(period).sum::<f64>();
            score(*a).total_cmp(&score(*b))
        })
        .unwrap_or(0);
    let bar_phase = (0..4)
        .max_by(|a, b| {
            let score = |offset: usize| {
                energy
                    .iter()
                    .skip(phase + offset * period)
                    .step_by(period * 4)
                    .sum::<f64>()
            };
            score(*a).total_cmp(&score(*b))
        })
        .unwrap_or(0);
    let offset_ms = (phase + bar_phase * period) as f64 / hz * 1000.0;
    let duration_ms = (samples.len() as f64 / sample_rate as f64 * 1000.0).round() as u32;
    let mut sections = vec![0];
    let bar_ms = 240_000.0 / bpm;
    let mut last_energy = 0.0;
    for bar in 0..(f64::from(duration_ms) / bar_ms) as usize {
        let start = (phase + bar_phase * period + bar * 4 * period).min(energy.len());
        let end = (start + 4 * period).min(energy.len());
        let avg = energy[start..end].iter().sum::<f64>() / (end - start).max(1) as f64;
        if bar > 0 && last_energy > 0.0001 && (avg / last_energy > 1.8 || avg / last_energy < 0.5) {
            let marker = (start as f64 / hz * 1000.0).round() as u32;
            if marker - sections.last().copied().unwrap_or(0) > 2000 {
                sections.push(marker);
            }
        }
        last_energy = avg;
    }
    let peaks = samples
        .chunks(samples.len().div_ceil(1600))
        .map(|chunk| chunk.iter().fold(0.0f32, |v, x| v.max(x.abs())).min(1.0))
        .collect();
    let total = onset.iter().map(|v| v * v).sum::<f64>();
    AudioTrack {
        path: String::new(),
        name: String::new(),
        duration_ms,
        peaks,
        bpm,
        offset_ms,
        beats_per_bar: 4,
        sections,
        start_ms: 0,
        mix: Default::default(),
        confidence: if total > 0.0 {
            (best.1 / total).clamp(0.0, 1.0)
        } else {
            0.0
        },
    }
}

pub fn snap(time: f64, a: &AudioTrack, downbeats: bool) -> f64 {
    let interval = 60_000.0 / a.bpm
        * if downbeats {
            f64::from(a.beats_per_bar)
        } else {
            1.0
        };
    let offset = a.offset_ms - f64::from(a.start_ms);
    (offset + ((time - offset) / interval).round() * interval).max(0.0)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn detects_accented_clicks_and_snaps_absolute_time() {
        let mut samples = vec![0.0; 22050 * 12];
        for beat in 0..24 {
            for i in 0..220 {
                samples[beat * 11025 + i] = if beat % 4 == 0 { 0.9 } else { 0.4 };
            }
        }
        let a = analyze_samples(&samples, 22050);
        assert!((a.bpm - 120.0).abs() < 2.0, "{}", a.bpm);
        assert!(a.confidence > 0.7);
        assert!((snap(1530.0, &a, false) - 1500.0).abs() < 30.0);
        assert!(a.peaks.iter().any(|p| *p > 0.8));
        let silence = analyze_samples(&vec![0.0; 22050], 22050);
        assert_eq!(silence.confidence, 0.0);
    }
}
