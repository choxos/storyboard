use crate::{model::Project, sound};
use std::{path::Path, process::Command};

pub fn configure(project: &Project, cmd: &mut Command, directory: &Path) -> Result<(), String> {
    let mut filters = vec![];
    let mut outputs = vec![];
    let mut input = 1;
    if let Some(a) = &project.audio {
        cmd.args(["-ss", &(f64::from(a.start_ms) / 1000.0).to_string()])
            .arg("-i")
            .arg(&a.path);
        let end = f64::from((a.duration_ms - a.start_ms).min(project.duration_ms())) / 1000.0;
        let mut chain = format!(
            "[{input}:a]asetpts=PTS-STARTPTS,volume={}",
            if a.mix.muted { 0.0 } else { a.mix.volume }
        );
        let fade_in = (f64::from(a.mix.fade_in_ms) / 1000.0).min(end);
        let fade_out = (f64::from(a.mix.fade_out_ms) / 1000.0).min(end);
        if fade_in > 0.0 {
            chain += &format!(",afade=t=in:st=0:d={fade_in}:curve=tri");
        }
        if fade_out > 0.0 {
            chain += &format!(",afade=t=out:st={}:d={fade_out}:curve=tri", end - fade_out);
        }
        chain += "[music]";
        filters.push(chain);
        outputs.push("[music]".to_string());
        input += 1;
    }
    for (asset_index, asset) in project.sounds.iter().enumerate() {
        let mut placements = vec![];
        let mut offset = 0;
        for doc in &project.scenes {
            for cue in &doc.scene.sounds {
                if cue.sound_id == asset.id && cue.volume > 0.0 {
                    placements.push((cue, offset + cue.at_ms));
                }
            }
            offset += doc.scene.duration_ms;
        }
        if placements.is_empty() {
            continue;
        }
        let path = directory.join(format!("sound-{asset_index}.wav"));
        std::fs::write(&path, sound::decode(asset)?).map_err(|e| e.to_string())?;
        cmd.arg("-i").arg(path);
        let labels = (0..placements.len())
            .map(|i| format!("[s{asset_index}_{i}]"))
            .collect::<String>();
        filters.push(format!("[{input}:a]asplit={}{labels}", placements.len()));
        input += 1;
        for (i, (cue, at)) in placements.iter().enumerate() {
            let speed = 2.0_f64.powf(f64::from(cue.pitch) / 12.0);
            let length = (f64::from(cue.duration_ms) / 1000.0)
                .min(f64::from(asset.duration_ms - cue.trim_start_ms) / 1000.0 / speed);
            let out = format!("[c{asset_index}_{i}]");
            filters.push(format!("[s{asset_index}_{i}]atrim=start={},asetpts=PTS-STARTPTS,asetrate={},aresample=48000,atrim=duration={length},volume={},adelay={at}:all=1{out}",
                f64::from(cue.trim_start_ms) / 1000.0, (24000.0 * speed).round(), cue.volume));
            outputs.push(out);
        }
    }
    if !outputs.is_empty() {
        filters.push(format!(
            "{}amix=inputs={}:normalize=0:dropout_transition=0,apad,asetpts=N/SR/TB[mix]",
            outputs.join(""),
            outputs.len()
        ));
        cmd.args([
            "-filter_complex",
            &filters.join(";"),
            "-map",
            "0:v:0",
            "-map",
            "[mix]",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
        ]);
    }
    Ok(())
}
