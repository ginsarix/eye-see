use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::ipc::Response;

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub path: PathBuf,
    pub is_file: bool,
}

/// Lists the direct children of `directory_path`.
///
/// Entries that can't be inspected (e.g. broken symlinks or permission errors)
/// are skipped rather than failing the whole listing.
#[tauri::command]
pub async fn read_directory(directory_path: String) -> Result<Vec<DirEntry>, String> {
    list_directory(Path::new(&directory_path))
        .await
        .map_err(|e| format!("Failed to read directory \"{directory_path}\": {e}"))
}

/// Reads a whole file and sends it to the frontend as an `ArrayBuffer`,
/// bypassing JSON serialization.
#[tauri::command]
pub async fn read_file(file_path: String) -> Result<Response, String> {
    tokio::fs::read(&file_path)
        .await
        .map(Response::new)
        .map_err(|e| format!("Failed to read file \"{file_path}\": {e}"))
}

async fn list_directory(dir: &Path) -> std::io::Result<Vec<DirEntry>> {
    let mut read_dir = tokio::fs::read_dir(dir).await?;
    let mut entries = Vec::new();

    while let Some(entry) = read_dir.next_entry().await? {
        let path = entry.path();
        // `metadata` follows symlinks, so a link to an image counts as a file.
        let Ok(metadata) = tokio::fs::metadata(&path).await else {
            log::warn!("Skipping {}: could not read metadata", path.display());
            continue;
        };

        entries.push(DirEntry {
            name: entry.file_name().to_string_lossy().into_owned(),
            path,
            is_file: metadata.is_file(),
        });
    }

    entries.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(entries)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("eye-see-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[tokio::test]
    async fn lists_files_and_directories_sorted() {
        let dir = temp_dir("list");
        std::fs::write(dir.join("b.png"), b"png").unwrap();
        std::fs::write(dir.join("a.jpg"), b"jpg").unwrap();
        std::fs::create_dir(dir.join("nested")).unwrap();

        let entries = read_directory(dir.to_string_lossy().into_owned())
            .await
            .unwrap();

        assert_eq!(
            entries,
            vec![
                DirEntry {
                    name: "a.jpg".into(),
                    path: dir.join("a.jpg"),
                    is_file: true
                },
                DirEntry {
                    name: "b.png".into(),
                    path: dir.join("b.png"),
                    is_file: true
                },
                DirEntry {
                    name: "nested".into(),
                    path: dir.join("nested"),
                    is_file: false
                },
            ]
        );
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn skips_broken_symlinks() {
        let dir = temp_dir("symlink");
        std::fs::write(dir.join("ok.png"), b"png").unwrap();
        std::os::unix::fs::symlink(dir.join("missing.png"), dir.join("broken.png")).unwrap();

        let entries = read_directory(dir.to_string_lossy().into_owned())
            .await
            .unwrap();

        let names: Vec<_> = entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, ["ok.png"]);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[tokio::test]
    async fn missing_directory_is_an_error() {
        let err = read_directory("/definitely/not/a/real/dir".into())
            .await
            .unwrap_err();
        assert!(err.contains("/definitely/not/a/real/dir"), "{err}");
    }

    #[tokio::test]
    async fn missing_file_is_an_error() {
        let Err(err) = read_file("/definitely/not/a/real/file.png".into()).await else {
            panic!("expected an error");
        };
        assert!(err.contains("file.png"), "{err}");
    }
}
