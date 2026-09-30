use std::path::{Path, PathBuf};

use crate::fs::{DirEntry, list_directory};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ImageFile {
    /// Path relative to the searched directory, always `/`-separated
    pub name: String,
    pub path: PathBuf,
}

const IMAGE_EXTENSIONS: [&str; 6] = ["jpg", "jpeg", "png", "gif", "webp", "bmp"];

fn is_image(file_name: &str) -> bool {
    file_name.rsplit_once('.').is_some_and(|(_, extension)| {
        IMAGE_EXTENSIONS.contains(&extension.to_ascii_lowercase().as_str())
    })
}

/// Lists the image files in a directory, each directory's own files before its
/// subdirectories'. When recursing, hidden and symlinked directories are
/// skipped (the latter so a link to an ancestor can't loop forever), and
/// subdirectories that can't be read are skipped with a warning.
pub fn list_images(dir: &Path, include_subdirectories: bool) -> Result<Vec<ImageFile>, String> {
    let entries = list_directory(dir)
        .map_err(|e| format!("Failed to read directory \"{}\": {e}", dir.display()))?;
    let mut images = Vec::new();
    collect_images(entries, "", include_subdirectories, &mut images);
    Ok(images)
}

fn collect_images(
    entries: Vec<DirEntry>,
    prefix: &str,
    recurse: bool,
    images: &mut Vec<ImageFile>,
) {
    images.extend(
        entries
            .iter()
            .filter(|entry| entry.is_file && is_image(&entry.name))
            .map(|entry| ImageFile {
                name: format!("{prefix}{}", entry.name),
                path: entry.path.clone(),
            }),
    );
    if !recurse {
        return;
    }

    for entry in entries {
        if entry.is_file || entry.is_symlink || entry.name.starts_with('.') {
            continue;
        }
        match list_directory(&entry.path) {
            Ok(children) => {
                collect_images(children, &format!("{prefix}{}/", entry.name), true, images)
            }
            Err(error) => log::warn!(
                "Skipping directory \"{}\": could not read it: {error}",
                entry.path.display()
            ),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::TempDir;

    fn names(images: &[ImageFile]) -> Vec<&str> {
        images.iter().map(|image| image.name.as_str()).collect()
    }

    #[test]
    fn only_lists_image_files() {
        let dir = TempDir::new("images-only");
        for name in ["cat.jpg", "DOG.PNG", "notes.txt", "README"] {
            std::fs::write(dir.join(name), b"x").unwrap();
        }
        std::fs::create_dir(dir.join("album.jpg")).unwrap();

        let images = list_images(dir.path(), false).unwrap();

        assert_eq!(
            images,
            [
                ImageFile {
                    name: "DOG.PNG".into(),
                    path: dir.join("DOG.PNG")
                },
                ImageFile {
                    name: "cat.jpg".into(),
                    path: dir.join("cat.jpg")
                },
            ]
        );
    }

    #[test]
    fn ignores_subdirectories_unless_asked_to_include_them() {
        let dir = TempDir::new("images-flat");
        std::fs::write(dir.join("a.png"), b"x").unwrap();
        std::fs::create_dir(dir.join("sub")).unwrap();
        std::fs::write(dir.join("sub/b.png"), b"x").unwrap();

        assert_eq!(names(&list_images(dir.path(), false).unwrap()), ["a.png"]);
    }

    #[test]
    fn lists_subdirectories_after_their_parent_with_relative_names() {
        let dir = TempDir::new("images-nested");
        std::fs::create_dir_all(dir.join("animals/big-cats")).unwrap();
        for name in ["z.png", "animals/cat.jpg", "animals/big-cats/lion.webp"] {
            std::fs::write(dir.join(name), b"x").unwrap();
        }

        let images = list_images(dir.path(), true).unwrap();

        assert_eq!(
            names(&images),
            ["z.png", "animals/cat.jpg", "animals/big-cats/lion.webp"]
        );
        assert_eq!(images[2].path, dir.join("animals/big-cats/lion.webp"));
    }

    #[cfg(unix)]
    #[test]
    fn skips_hidden_and_symlinked_directories() {
        let dir = TempDir::new("images-skip");
        std::fs::create_dir(dir.join(".cache")).unwrap();
        std::fs::write(dir.join(".cache/hidden.png"), b"x").unwrap();
        std::fs::write(dir.join("a.png"), b"x").unwrap();
        // A link back to the folder itself would recurse forever if followed
        std::os::unix::fs::symlink(dir.path(), dir.join("loop")).unwrap();

        assert_eq!(names(&list_images(dir.path(), true).unwrap()), ["a.png"]);
    }

    #[cfg(unix)]
    #[test]
    fn skips_subdirectories_that_cannot_be_read() {
        use std::os::unix::fs::PermissionsExt;

        let dir = TempDir::new("images-locked");
        std::fs::create_dir(dir.join("locked")).unwrap();
        std::fs::write(dir.join("locked/secret.png"), b"x").unwrap();
        std::fs::write(dir.join("a.png"), b"x").unwrap();
        std::fs::set_permissions(dir.join("locked"), std::fs::Permissions::from_mode(0o000))
            .unwrap();

        let images = list_images(dir.path(), true);

        // Restore access so the temp dir can be deleted
        std::fs::set_permissions(dir.join("locked"), std::fs::Permissions::from_mode(0o755))
            .unwrap();
        assert_eq!(names(&images.unwrap()), ["a.png"]);
    }

    #[test]
    fn fails_when_the_directory_itself_cannot_be_read() {
        let error = list_images(Path::new("/definitely/missing"), true).unwrap_err();

        assert!(error.contains("/definitely/missing"), "{error}");
    }
}
