use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::ipc::Response;

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub path: PathBuf,
    pub is_file: bool,
    /// Whether the entry itself is a symlink, so callers walking the tree
    /// can avoid following links into cycles.
    pub is_symlink: bool,
}

/// Lists the direct children of `directory_path`.
#[tauri::command]
pub async fn read_directory(directory_path: String) -> Result<Vec<DirEntry>, String> {
    let dir = PathBuf::from(&directory_path);
    tauri::async_runtime::spawn_blocking(move || list_directory(&dir))
        .await
        .map_err(|e| e.to_string())?
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

/// Lists the direct children of `dir`, sorted by name.
///
/// Entries that can't be inspected (e.g. broken symlinks or permission errors)
/// are skipped rather than failing the whole listing.
pub fn list_directory(dir: &Path) -> std::io::Result<Vec<DirEntry>> {
    let mut entries = Vec::new();

    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        let is_symlink = entry
            .file_type()
            .is_ok_and(|file_type| file_type.is_symlink());
        // `metadata` follows symlinks, so a link to an image counts as a file.
        let Ok(metadata) = std::fs::metadata(&path) else {
            log::warn!("Skipping {}: could not read metadata", path.display());
            continue;
        };

        entries.push(DirEntry {
            name: entry.file_name().to_string_lossy().into_owned(),
            path,
            is_file: metadata.is_file(),
            is_symlink,
        });
    }

    entries.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(entries)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::TempDir;

    #[test]
    fn lists_files_and_directories_sorted() {
        let dir = TempDir::new("list");
        std::fs::write(dir.join("b.png"), b"png").unwrap();
        std::fs::write(dir.join("a.jpg"), b"jpg").unwrap();
        std::fs::create_dir(dir.join("nested")).unwrap();

        let entries = list_directory(dir.path()).unwrap();

        assert_eq!(
            entries,
            vec![
                DirEntry {
                    name: "a.jpg".into(),
                    path: dir.join("a.jpg"),
                    is_file: true,
                    is_symlink: false
                },
                DirEntry {
                    name: "b.png".into(),
                    path: dir.join("b.png"),
                    is_file: true,
                    is_symlink: false
                },
                DirEntry {
                    name: "nested".into(),
                    path: dir.join("nested"),
                    is_file: false,
                    is_symlink: false
                },
            ]
        );
    }

    #[cfg(unix)]
    #[test]
    fn skips_broken_symlinks() {
        let dir = TempDir::new("symlink");
        std::fs::write(dir.join("ok.png"), b"png").unwrap();
        std::os::unix::fs::symlink(dir.join("missing.png"), dir.join("broken.png")).unwrap();

        let entries = list_directory(dir.path()).unwrap();

        let names: Vec<_> = entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, ["ok.png"]);
    }

    #[cfg(unix)]
    #[test]
    fn flags_symlinks() {
        let dir = TempDir::new("flags-symlink");
        std::fs::create_dir(dir.join("real")).unwrap();
        std::os::unix::fs::symlink(dir.join("real"), dir.join("link")).unwrap();

        let entries = list_directory(dir.path()).unwrap();

        let flags: Vec<_> = entries
            .iter()
            .map(|e| (e.name.as_str(), e.is_file, e.is_symlink))
            .collect();
        assert_eq!(flags, [("link", false, true), ("real", false, false)]);
    }

    #[test]
    fn missing_directory_is_an_error() {
        assert!(list_directory(Path::new("/definitely/not/a/real/dir")).is_err());
    }

    #[tokio::test]
    async fn read_directory_names_the_missing_directory() {
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
