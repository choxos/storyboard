use crate::model::Project;
use std::{io::Write, path::Path};

pub fn read(path: &Path) -> Result<Project, String> {
    let metadata = std::fs::metadata(path).map_err(|e| e.to_string())?;
    if metadata.len() > 20_000_000 {
        return Err("Project exceeds 20 MB.".into());
    }
    let text = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    let mut project: Project =
        serde_json::from_str(&text).map_err(|e| format!("Invalid project: {e}"))?;
    project.validate()?;
    if let Some(a) = &mut project.audio
        && Path::new(&a.path).is_relative()
    {
        a.path = path
            .parent()
            .unwrap_or(Path::new("."))
            .join(&a.path)
            .to_string_lossy()
            .into();
    }
    Ok(project)
}

pub fn write(path: &Path, project: &Project) -> Result<(), String> {
    project.validate()?;
    let bytes = serde_json::to_vec_pretty(project).map_err(|e| e.to_string())?;
    if bytes.len() > 20_000_000 {
        return Err("Project exceeds 20 MB. Clear old revisions before saving.".into());
    }
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let mut file = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    file.write_all(&bytes).map_err(|e| e.to_string())?;
    file.as_file().sync_all().map_err(|e| e.to_string())?;
    file.persist(path).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn invalid_save_preserves_existing_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("project.storyboard");
        let mut project = crate::model::demo_project();
        write(&path, &project).unwrap();
        let before = std::fs::read(&path).unwrap();
        project.scenes.clear();
        assert!(write(&path, &project).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), before);
        assert_eq!(read(&path).unwrap().scenes.len(), 4);
    }
}
