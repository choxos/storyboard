use crate::process::{program, terminate};
use serde::Serialize;
use serde_json::{Value, json};
use std::{
    collections::HashSet,
    fs::File,
    io::{Read, Write},
    process::{Child, Command, Stdio},
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

#[derive(Debug, Serialize)]
pub struct ModelOption {
    pub id: String,
    pub name: String,
    pub description: String,
    pub resolved_model: Option<String>,
    pub is_default: bool,
    pub efforts: Vec<EffortOption>,
    pub default_effort: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct EffortOption {
    pub id: String,
    pub description: String,
}

#[derive(Serialize)]
pub struct Catalog {
    pub models: Vec<ModelOption>,
    pub fetched_at: u64,
}

// Fresh CLI processes use the provider's authenticated model-discovery protocol.
// No model IDs or fallback catalog are shipped with Storyboard.
pub fn discover(provider: &str, cancel: &AtomicBool) -> Result<Catalog, String> {
    if !["claude", "codex"].contains(&provider) {
        return Err("Choose Claude or Codex.".into());
    }
    let work = tempfile::tempdir().map_err(|e| e.to_string())?;
    let mut command = Command::new(program(provider)?);
    command.current_dir(work.path());
    if provider == "codex" {
        command.args(["app-server", "--stdio"]);
    } else {
        command.args([
            "-p",
            "--input-format",
            "stream-json",
            "--output-format",
            "stream-json",
            "--verbose",
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
    }
    let mut rpc = DiscoveryProcess::start(&mut command, Duration::from_secs(30))?;
    let mut models = Vec::new();
    if provider == "codex" {
        rpc.send(json!({"id":1,"method":"initialize","params":{"clientInfo":{"name":"storyboard","version":env!("CARGO_PKG_VERSION")}}}))?;
        rpc.response(provider, &json!(1), cancel)?;
        rpc.send(json!({"method":"initialized"}))?;
        let mut cursor = Value::Null;
        let mut seen = HashSet::new();
        for id in 2..=22 {
            rpc.send(json!({"id":id,"method":"model/list","params":{"limit":100,"includeHidden":false,"cursor":cursor}}))?;
            let response = rpc.response(provider, &json!(id), cancel)?;
            models.extend(parse_models(provider, &response)?);
            cursor = response.get("nextCursor").cloned().unwrap_or(Value::Null);
            if cursor.is_null() {
                break;
            }
            let token = cursor
                .as_str()
                .filter(|s| !s.is_empty())
                .ok_or("Invalid model-list cursor.")?;
            if !seen.insert(token.to_string()) || id == 22 {
                return Err("The CLI returned an invalid model-list pagination sequence.".into());
            }
        }
    } else {
        rpc.send(json!({"type":"control_request","request_id":"models","request":{"subtype":"initialize"}}))?;
        let response = rpc.response(provider, &json!("models"), cancel)?;
        models = parse_models(provider, &response)?;
    }
    let mut ids = HashSet::new();
    models.retain(|m| ids.insert(m.id.clone()));
    if models.is_empty() {
        return Err(
            "The CLI returned no available models. Check your login, update the CLI, then refresh."
                .into(),
        );
    }
    Ok(Catalog {
        models,
        fetched_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64,
    })
}

fn parse_models(provider: &str, response: &Value) -> Result<Vec<ModelOption>, String> {
    let key = if provider == "codex" {
        "data"
    } else {
        "models"
    };
    let entries = response.get(key).and_then(Value::as_array).ok_or(
        "The CLI returned an unsupported model-list format. Update the CLI, then refresh.",
    )?;
    if entries.len() > 1000 {
        return Err("Model list is too large.".into());
    }
    entries
        .iter()
        .filter(|m| m.get("hidden") != Some(&json!(true)))
        .map(|m| {
            let text = |key: &str| -> Result<String, String> {
                let value = m
                    .get(key)
                    .and_then(Value::as_str)
                    .ok_or_else(|| format!("Model list is missing {key}."))?;
                if value.len() > 4000 || value.contains('\0') {
                    return Err("Invalid model-list text.".into());
                }
                Ok(value.into())
            };
            let id = text(if provider == "codex" {
                "model"
            } else {
                "value"
            })?;
            if id.is_empty() || id.len() > 200 || id.chars().any(char::is_control) {
                return Err("Invalid model identifier.".into());
            }
            let effort_key = if provider == "codex" {
                "supportedReasoningEfforts"
            } else {
                "supportedEffortLevels"
            };
            let efforts = m
                .get(effort_key)
                .and_then(Value::as_array)
                .map(|levels| {
                    levels
                        .iter()
                        .map(|level| {
                            let id = if provider == "codex" {
                                &level["reasoningEffort"]
                            } else {
                                level
                            };
                            let id = id
                                .as_str()
                                .filter(|v| {
                                    !v.is_empty()
                                        && v.len() <= 32
                                        && v.bytes().all(|b| b.is_ascii_lowercase())
                                })
                                .ok_or("Invalid effort level in model catalog.")?;
                            Ok(EffortOption {
                                id: id.into(),
                                description: level
                                    .get("description")
                                    .and_then(Value::as_str)
                                    .unwrap_or("")
                                    .chars()
                                    .take(4000)
                                    .collect(),
                            })
                        })
                        .collect::<Result<Vec<_>, String>>()
                })
                .transpose()?
                .unwrap_or_default();
            let default_effort = m
                .get("defaultReasoningEffort")
                .and_then(Value::as_str)
                .filter(|v| efforts.iter().any(|e| e.id == *v))
                .map(String::from);
            Ok(ModelOption {
                is_default: if provider == "codex" {
                    m.get("isDefault").and_then(Value::as_bool).unwrap_or(false)
                } else {
                    id == "default"
                },
                id,
                name: text("displayName")?,
                description: text("description")?,
                resolved_model: m
                    .get("resolvedModel")
                    .and_then(Value::as_str)
                    .filter(|v| v.len() <= 200)
                    .map(String::from),
                efforts,
                default_effort,
            })
        })
        .collect()
}

struct DiscoveryProcess {
    child: Child,
    output: File,
    _stdout: tempfile::NamedTempFile,
    stderr: tempfile::NamedTempFile,
    pending: Vec<u8>,
    deadline: Instant,
}

impl DiscoveryProcess {
    fn start(command: &mut Command, timeout: Duration) -> Result<Self, String> {
        let stdout = tempfile::NamedTempFile::new().map_err(|e| e.to_string())?;
        let stderr = tempfile::NamedTempFile::new().map_err(|e| e.to_string())?;
        // Separate file descriptions keep the reader's cursor independent of writes.
        let output = stdout.reopen().map_err(|e| e.to_string())?;
        command
            .stdin(Stdio::piped())
            .stdout(stdout.reopen().map_err(|e| e.to_string())?)
            .stderr(stderr.reopen().map_err(|e| e.to_string())?);
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            command.process_group(0);
        }
        let child = command
            .spawn()
            .map_err(|e| format!("Could not start model discovery: {e}"))?;
        Ok(Self {
            child,
            output,
            _stdout: stdout,
            stderr,
            pending: Vec::new(),
            deadline: Instant::now() + timeout,
        })
    }

    fn send(&mut self, message: Value) -> Result<(), String> {
        let input = self
            .child
            .stdin
            .as_mut()
            .ok_or("Model discovery input closed.")?;
        writeln!(input, "{message}")
            .and_then(|_| input.flush())
            .map_err(|e| e.to_string())
    }

    fn response(
        &mut self,
        provider: &str,
        id: &Value,
        cancel: &AtomicBool,
    ) -> Result<Value, String> {
        loop {
            if cancel.load(Ordering::Relaxed) {
                return Err("Model discovery canceled.".into());
            }
            if Instant::now() >= self.deadline {
                return Err(
                    "Model discovery timed out. Check your CLI login, then refresh.".into(),
                );
            }
            if self.output.metadata().map_err(|e| e.to_string())?.len() > 8_000_000
                || self
                    .stderr
                    .as_file()
                    .metadata()
                    .map_err(|e| e.to_string())?
                    .len()
                    > 8_000_000
            {
                return Err("Model discovery output exceeded its size limit.".into());
            }
            if let Some(end) = self.pending.iter().position(|b| *b == b'\n') {
                let line: Vec<_> = self.pending.drain(..=end).collect();
                if line.iter().all(u8::is_ascii_whitespace) {
                    continue;
                }
                let message: Value = serde_json::from_slice(&line)
                    .map_err(|_| "The CLI returned invalid model-discovery JSON.")?;
                let result = if provider == "codex" && message.get("id") == Some(id) {
                    if let Some(error) = message.get("error") {
                        return Err(format!(
                            "Model discovery failed: {}",
                            error
                                .get("message")
                                .and_then(Value::as_str)
                                .unwrap_or("CLI error")
                        ));
                    }
                    message.get("result")
                } else if provider == "claude"
                    && message.get("type").and_then(Value::as_str) == Some("control_response")
                    && message["response"].get("request_id") == Some(id)
                {
                    let response = &message["response"];
                    if response["subtype"] == "error" {
                        return Err(format!(
                            "Model discovery failed: {}",
                            response["error"].as_str().unwrap_or("CLI error")
                        ));
                    }
                    response.get("response")
                } else {
                    continue;
                };
                return result
                    .cloned()
                    .ok_or("The CLI returned an empty model-discovery response.".into());
            }
            let mut chunk = [0; 65536];
            let count = self.output.read(&mut chunk).map_err(|e| e.to_string())?;
            if count > 0 {
                self.pending.extend_from_slice(&chunk[..count]);
            } else {
                if let Some(status) = self.child.try_wait().map_err(|e| e.to_string())? {
                    return Err(format!(
                        "{provider} model discovery exited with {status}. Check your CLI login and version, then refresh."
                    ));
                }
                std::thread::sleep(Duration::from_millis(25));
            }
        }
    }
}

impl Drop for DiscoveryProcess {
    fn drop(&mut self) {
        terminate(&mut self.child);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalogs_preserve_future_ids_and_reject_malformed_responses() {
        let rows = parse_models("codex", &json!({"data":[
            {"model":"future-code-model","displayName":"Future model","description":"New","isDefault":true,"supportedReasoningEfforts":[{"reasoningEffort":"future","description":"A new level"}],"defaultReasoningEffort":"future"},
            {"model":"hidden-model","hidden":true}
        ]})).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, "future-code-model");
        assert!(rows[0].is_default);
        assert_eq!(rows[0].efforts[0].id, "future");
        assert_eq!(rows[0].default_effort.as_deref(), Some("future"));
        let rows = parse_models("claude", &json!({"models":[{"value":"future-alias","resolvedModel":"future-release","displayName":"Future","description":"New","supportedEffortLevels":["low","max"]},{"value":"no-effort","displayName":"Simple","description":""}]})).unwrap();
        assert_eq!(rows[0].resolved_model.as_deref(), Some("future-release"));
        assert_eq!(rows[0].efforts[1].id, "max");
        assert!(rows[1].efforts.is_empty());
        assert!(parse_models("claude", &json!({"models":[{"value":"bad-effort","displayName":"Bad","description":"","supportedEffortLevels":["bad\"level"]}]})).is_err());
        assert!(parse_models("claude", &json!({"models":[{"value":"broken"}]})).is_err());
        assert!(parse_models("codex", &json!({"data":null})).is_err());
    }

    #[test]
    fn discovery_handles_interleaved_messages_errors_and_timeouts() {
        let mut command = Command::new("/bin/sh");
        command.args(["-c", "read line; printf '%s\\n' '{\"method\":\"notice\"}' '{\"id\":2,\"result\":{\"data\":[]}}'; read line; printf '%s\\n' '{\"id\":3,\"error\":{\"message\":\"Sign in first\"}}'; sleep 5"]);
        let mut rpc = DiscoveryProcess::start(&mut command, Duration::from_millis(300)).unwrap();
        let cancel = AtomicBool::new(false);
        rpc.send(json!({"id":2})).unwrap();
        assert_eq!(
            rpc.response("codex", &json!(2), &cancel).unwrap(),
            json!({"data":[]})
        );
        rpc.send(json!({"id":3})).unwrap();
        assert!(
            rpc.response("codex", &json!(3), &cancel)
                .unwrap_err()
                .contains("Sign in first")
        );
        assert!(
            rpc.response("codex", &json!(4), &cancel)
                .unwrap_err()
                .contains("timed out")
        );
        cancel.store(true, Ordering::Relaxed);
        assert!(
            rpc.response("codex", &json!(4), &cancel)
                .unwrap_err()
                .contains("canceled")
        );
    }
}
