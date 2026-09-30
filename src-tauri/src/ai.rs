use crate::{
    model::{Project, Scene},
    process::{capture, program},
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::{process::Command, sync::atomic::AtomicBool, time::Duration};

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Reply {
    pub summary: String,
    pub scenes: Vec<Scene>,
}

pub fn schema() -> serde_json::Value {
    let mut schema = serde_json::to_value(schemars::schema_for!(Reply)).unwrap();
    // Claude's CLI validator does not register the 2020-12 meta-schema.
    // The object, enum, and local-reference keywords work with both providers.
    if let Some(object) = schema.as_object_mut() {
        object.remove("$schema");
    }
    schema
}

pub fn parse(provider: &str, bytes: &[u8]) -> Result<Reply, String> {
    let raw = String::from_utf8_lossy(bytes);
    let value: serde_json::Value =
        serde_json::from_str(raw.trim()).map_err(|e| format!("AI returned invalid JSON: {e}"))?;
    let payload = if provider == "claude" {
        if value.get("is_error").and_then(|v| v.as_bool()) == Some(true) {
            return Err(value
                .get("result")
                .and_then(|v| v.as_str())
                .unwrap_or("Claude returned an error.")
                .to_string());
        }
        if let Some(s) = value.get("structured_output") {
            s.clone()
        } else if let Some(s) = value.get("result").and_then(|v| v.as_str()) {
            serde_json::from_str(s).map_err(|e| format!("Claude did not return scene JSON: {e}"))?
        } else {
            value
        }
    } else {
        value
    };
    let reply: Reply =
        serde_json::from_value(payload).map_err(|e| format!("AI scene format was invalid: {e}"))?;
    if reply.summary.len() > 50_000 || reply.scenes.is_empty() || reply.scenes.len() > 100 {
        return Err("AI returned an invalid number of scenes.".into());
    }
    for s in &reply.scenes {
        s.validate()?;
    }
    Ok(reply)
}

pub fn generate(
    project: &Project,
    scene_index: Option<usize>,
    provider: &str,
    model: &str,
    effort: &str,
    prompt: &str,
    cancel: &AtomicBool,
) -> Result<Reply, String> {
    project.validate()?;
    if !["claude", "codex"].contains(&provider) {
        return Err("Choose Claude or Codex.".into());
    }
    if prompt.trim().is_empty() || prompt.len() > 20_000 || model.len() > 200 {
        return Err("Prompt or model is invalid.".into());
    }
    let work = tempfile::tempdir().map_err(|e| e.to_string())?;
    let schema = schema();
    let schema_path = work.path().join("scene.schema.json");
    std::fs::write(
        &schema_path,
        serde_json::to_vec(&schema).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    let scene = scene_index
        .map(|i| project.scenes.get(i).ok_or("Scene no longer exists."))
        .transpose()?;
    let context = if let Some(s) = scene {
        serde_json::to_value(&s.scene)
    } else {
        serde_json::to_value(project.scenes.iter().map(|s| &s.scene).collect::<Vec<_>>())
    }
    .map_err(|e| e.to_string())?;
    let context = serde_json::json!({
        "scenes": context,
        "selected_scene_global_start_ms": scene_index.map(|i|project.scenes[..i].iter().map(|d|d.scene.duration_ms).sum::<u32>())
    });
    let history = if let Some(s) = scene {
        &s.chat
    } else {
        &project.chat
    };
    let input=format!("You are a motion designer inside Storyboard. Return only JSON matching the supplied schema. Do not use tools, read files, run commands, or browse.\nCanvas: {} x {}. Coordinates are pixels. Shapes use center x/y; text uses centered x and baseline y; paths use local SVG path coordinates. All elements have ALL schema fields. Colors are #RRGGBB or none. No scripts, URLs, images, markup, or external resources. Draw with rect, ellipse, text and SVG paths. Text uses Arial. Keyframes use integer milliseconds, strictly increasing and within duration_ms. Tracks override base properties. The destination keyframe's easing controls interpolation. Time before/after keyframes holds first/last value. Rotation is degrees around element center. Scale is unitless. Each scene lasts 100 to 120000 ms, maximum 250 elements. Preserve existing IDs and unrelated details when editing.\nScope: {}.\nArt direction: {}\nCurrent scenes: {}\nRecent conversation: {}\nAudio timing: {}\nRequest: {}",project.width,project.height,if scene_index.is_some(){"Edit this scene only. Return exactly ONE scene."}else{"Create or revise the full storyboard. Return ALL scenes in playback order, maximum total 10 minutes."},project.art_direction,context,serde_json::to_string(&history.iter().rev().take(8).collect::<Vec<_>>()).unwrap(),project.audio.as_ref().map(|a|format!("Estimated BPM {}, downbeat offset {} ms, {} beats/bar, section boundaries {:?} ms. Use global music times and scene offsets.",a.bpm,a.offset_ms,a.beats_per_bar,a.sections)).unwrap_or("No audio.".into()),prompt);
    let mut cmd = Command::new(program(provider)?);
    cmd.current_dir(work.path());
    let output_path = work.path().join("reply.json");
    if provider == "claude" {
        cmd.args([
            "-p",
            "--output-format",
            "json",
            "--json-schema",
            &schema.to_string(),
            "--tools",
            "",
            "--strict-mcp-config",
            "--mcp-config",
            "{\"mcpServers\":{}}",
            "--no-session-persistence",
            "--disable-slash-commands",
            "--setting-sources",
            "",
            "--settings",
            "{\"disableAllHooks\":true}",
        ]);
    } else {
        cmd.args([
            "exec",
            "--ignore-user-config",
            "--ephemeral",
            "--sandbox",
            "read-only",
            "--skip-git-repo-check",
            "--color",
            "never",
            "--output-schema",
        ])
        .arg(&schema_path)
        .arg("--output-last-message")
        .arg(&output_path)
        .arg("-");
    }
    if !model.trim().is_empty() {
        cmd.arg("--model").arg(model.trim());
    }
    configure_effort(&mut cmd, provider, effort)?;
    let output = capture(
        &mut cmd,
        &input,
        cancel,
        Duration::from_secs(600),
        8_000_000,
    )?;
    let bytes = if provider == "codex" {
        std::fs::read(output_path).map_err(|_| {
            "Codex returned no scene. Check your login with codex login.".to_string()
        })?
    } else {
        output
    };
    let mut reply = parse(provider, &bytes)?;
    if let Some(index) = scene_index {
        if reply.scenes.len() != 1 {
            return Err("A scene edit must return exactly one scene.".into());
        }
        reply.scenes[0].id = project.scenes[index].scene.id.clone();
    }
    let mut check = project.clone();
    if let Some(index) = scene_index {
        check.scenes[index].scene = reply.scenes[0].clone();
    } else {
        check.scenes = reply
            .scenes
            .iter()
            .map(|s| crate::model::SceneDocument {
                scene: s.clone(),
                revisions: vec![],
                chat: vec![],
            })
            .collect();
    }
    check.validate()?;
    Ok(reply)
}

fn configure_effort(cmd: &mut Command, provider: &str, effort: &str) -> Result<(), String> {
    if effort.is_empty() {
        return Ok(());
    }
    if effort.len() > 32 || !effort.bytes().all(|b| b.is_ascii_lowercase()) {
        return Err("Invalid thinking effort level.".into());
    }
    if provider == "claude" {
        cmd.args(["--effort", effort]);
    } else {
        cmd.arg("-c")
            .arg(format!("model_reasoning_effort=\"{effort}\""));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn effort_reaches_each_cli_without_overriding_default() {
        for (provider, expected) in [
            ("claude", vec!["--effort", "high"]),
            ("codex", vec!["-c", "model_reasoning_effort=\"high\""]),
        ] {
            let mut cmd = Command::new(provider);
            configure_effort(&mut cmd, provider, "").unwrap();
            assert_eq!(cmd.get_args().count(), 0);
            configure_effort(&mut cmd, provider, "high").unwrap();
            assert_eq!(cmd.get_args().collect::<Vec<_>>(), expected);
            assert!(configure_effort(&mut cmd, provider, "high\"\nother=true").is_err());
        }
    }
    #[test]
    fn both_provider_envelopes_and_errors() {
        let reply = Reply {
            summary: "Updated.".into(),
            scenes: vec![crate::model::demo_project().scenes[0].scene.clone()],
        };
        let bytes = serde_json::to_vec(&reply).unwrap();
        assert_eq!(parse("codex", &bytes).unwrap().scenes.len(), 1);
        let envelope = serde_json::json!({"is_error":false,"structured_output":reply});
        assert_eq!(
            parse("claude", &serde_json::to_vec(&envelope).unwrap())
                .unwrap()
                .scenes
                .len(),
            1
        );
        assert!(
            parse("claude", br#"{"is_error":true,"result":"Not logged in"}"#)
                .unwrap_err()
                .contains("Not logged in")
        );
        assert!(parse("codex", br#"{"summary":"x","scenes":[]}"#).is_err());
    }
}
