use std::{
    io::{Read, Seek, SeekFrom, Write},
    path::PathBuf,
    process::{Command, Stdio},
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};
use wait_timeout::ChildExt;

pub fn program(name: &str) -> Result<PathBuf, String> {
    let mut dirs: Vec<PathBuf> =
        std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()).collect();
    if let Some(home) = std::env::var_os("HOME") {
        dirs.push(PathBuf::from(&home).join(".local/bin"));
        dirs.push(PathBuf::from(home).join(".cargo/bin"));
    }
    dirs.extend(["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"].map(PathBuf::from));
    dirs.into_iter()
        .map(|p| p.join(name))
        .find(|p| p.is_file())
        .ok_or_else(|| format!("{name} is not installed. Install it, then reopen Storyboard."))
}

pub fn capture(
    cmd: &mut Command,
    input: &str,
    cancel: &AtomicBool,
    timeout: Duration,
    limit: u64,
) -> Result<Vec<u8>, String> {
    let mut stdin = tempfile::tempfile().map_err(|e| e.to_string())?;
    stdin
        .write_all(input.as_bytes())
        .map_err(|e| e.to_string())?;
    stdin.rewind().map_err(|e| e.to_string())?;
    let mut stdout = tempfile::tempfile().map_err(|e| e.to_string())?;
    let mut stderr = tempfile::tempfile().map_err(|e| e.to_string())?;
    cmd.stdin(Stdio::from(stdin))
        .stdout(stdout.try_clone().map_err(|e| e.to_string())?)
        .stderr(stderr.try_clone().map_err(|e| e.to_string())?);
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Could not start process: {e}"))?;
    let start = Instant::now();
    let status = loop {
        if cancel.load(Ordering::Relaxed) || start.elapsed() > timeout {
            terminate(&mut child);
            return Err(if cancel.load(Ordering::Relaxed) {
                "Canceled."
            } else {
                "Process timed out. Try a smaller scene or check your CLI login."
            }
            .into());
        }
        if stdout.metadata().map_err(|e| e.to_string())?.len() > limit
            || stderr.metadata().map_err(|e| e.to_string())?.len() > 8_000_000
        {
            terminate(&mut child);
            return Err("Process output exceeded its size limit.".into());
        }
        match child.wait_timeout(Duration::from_millis(100)) {
            Ok(Some(status)) => break status,
            Ok(None) => {}
            Err(e) => {
                terminate(&mut child);
                return Err(e.to_string());
            }
        }
    };
    if !status.success() {
        let len = stderr.metadata().map_err(|e| e.to_string())?.len();
        stderr
            .seek(SeekFrom::Start(len.saturating_sub(2000)))
            .map_err(|e| e.to_string())?;
        let mut message = String::new();
        stderr
            .read_to_string(&mut message)
            .map_err(|e| e.to_string())?;
        return Err(format!("Process exited with {status}: {}", message.trim()));
    }
    stdout.rewind().map_err(|e| e.to_string())?;
    let mut result = Vec::new();
    stdout
        .take(limit + 1)
        .read_to_end(&mut result)
        .map_err(|e| e.to_string())?;
    if result.len() as u64 > limit {
        return Err("Process output exceeded its size limit.".into());
    }
    Ok(result)
}

pub fn terminate(child: &mut std::process::Child) {
    #[cfg(unix)]
    {
        let _ = Command::new("/bin/kill")
            .args(["-KILL", "--", &format!("-{}", child.id())])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    let _ = child.kill();
    let _ = child.wait();
}
