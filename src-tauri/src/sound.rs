use base64::{Engine, engine::general_purpose::STANDARD};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SoundAsset {
    pub id: String,
    pub name: String,
    pub data: String,
    pub duration_ms: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct SoundCue {
    pub id: String,
    pub sound_id: String,
    pub at_ms: u32,
    pub volume: f64,
    pub pitch: i32,
    pub trim_start_ms: u32,
    pub duration_ms: u32,
}

pub fn decode(asset: &SoundAsset) -> Result<Vec<u8>, String> {
    if asset.data.len() > 2_000_000 {
        return Err("Sound effects are limited to 15 seconds.".into());
    }
    let bytes = STANDARD
        .decode(
            asset
                .data
                .strip_prefix("data:audio/wav;base64,")
                .ok_or("Sounds must be embedded WAV data.")?,
        )
        .map_err(|_| "Invalid sound encoding.")?;
    if bytes.len() < 44 {
        return Err("Invalid sound data.".into());
    }
    let u16_at = |i| u16::from_le_bytes([bytes[i], bytes[i + 1]]) as usize;
    let u32_at =
        |i| u32::from_le_bytes([bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]]) as usize;
    let channels = u16_at(22);
    if &bytes[..4] != b"RIFF"
        || &bytes[8..16] != b"WAVEfmt "
        || &bytes[36..40] != b"data"
        || u32_at(4) != bytes.len() - 8
        || u32_at(16) != 16
        || u16_at(20) != 1
        || !(1..=2).contains(&channels)
        || u32_at(24) != 24000
        || u32_at(28) != 24000 * channels * 2
        || u16_at(32) != channels * 2
        || u16_at(34) != 16
        || u32_at(40) != bytes.len() - 44
        || !(bytes.len() - 44).is_multiple_of(channels * 2)
    {
        return Err("Invalid 24 kHz PCM sound effect.".into());
    }
    let frames = (bytes.len() - 44) / (channels * 2);
    if !(24..=360000).contains(&frames) || asset.duration_ms != ((frames + 12) / 24) as u32 {
        return Err("Sound duration must match its data, up to 15 seconds.".into());
    }
    Ok(bytes)
}

pub fn validate_assets(assets: &[SoundAsset]) -> Result<(), String> {
    if assets.len() > 40 {
        return Err("Projects support up to 40 sound clips.".into());
    }
    let mut ids = std::collections::HashSet::new();
    for asset in assets {
        if asset.id.is_empty()
            || asset.id.len() > 100
            || !ids.insert(&asset.id)
            || asset.name.len() > 1000
        {
            return Err("Invalid or duplicate sound ID or name.".into());
        }
        decode(asset)?;
    }
    Ok(())
}

pub fn validate_cues(cues: &[SoundCue], duration: u32) -> Result<(), String> {
    if cues.len() > 64 {
        return Err("Scenes support up to 64 sound cues.".into());
    }
    let mut ids = std::collections::HashSet::new();
    for cue in cues {
        if cue.id.is_empty()
            || cue.id.len() > 100
            || !ids.insert(&cue.id)
            || cue.sound_id.is_empty()
            || cue.sound_id.len() > 100
            || cue.at_ms >= duration
            || !cue.volume.is_finite()
            || !(0.0..=1.0).contains(&cue.volume)
            || !(-12..=12).contains(&cue.pitch)
            || cue.trim_start_ms >= 15000
            || !(1..=30000).contains(&cue.duration_ms)
        {
            return Err("Invalid sound cue timing, volume, pitch, or ID.".into());
        }
    }
    Ok(())
}

pub fn validate_references(cues: &[SoundCue], assets: &[SoundAsset]) -> Result<(), String> {
    for cue in cues {
        let asset = assets
            .iter()
            .find(|s| s.id == cue.sound_id)
            .ok_or("A sound cue references a missing clip.")?;
        if cue.trim_start_ms >= asset.duration_ms {
            return Err("Sound trim must be within its clip.".into());
        }
    }
    Ok(())
}
