use serde::Serialize;
use std::{
    env, fs,
    path::{Component, Path, PathBuf},
    process::Command,
};

const APP_DIR_NAME: &str = "PhysioFlow Data";

#[derive(Serialize)]
struct StorageInfo {
    supported: bool,
    selected: bool,
    name: String,
    permission: String,
    data_dir: String,
}

fn home_dir() -> Result<PathBuf, String> {
    if cfg!(target_os = "windows") {
        env::var_os("USERPROFILE")
            .map(PathBuf::from)
            .ok_or_else(|| "USERPROFILE is not set".to_string())
    } else {
        env::var_os("HOME")
            .map(PathBuf::from)
            .ok_or_else(|| "HOME is not set".to_string())
    }
}

fn data_dir() -> Result<PathBuf, String> {
    let documents = home_dir()?.join("Documents");
    Ok(documents.join(APP_DIR_NAME))
}

fn ensure_base_dirs() -> Result<PathBuf, String> {
    let dir = data_dir()?;
    for child in ["projects", "sessions", "assets"] {
        fs::create_dir_all(dir.join(child)).map_err(|err| err.to_string())?;
    }
    Ok(dir)
}

fn safe_join(relative: &str) -> Result<PathBuf, String> {
    let base = ensure_base_dirs()?;
    let mut out = base;
    for component in Path::new(relative).components() {
        match component {
            Component::Normal(part) => out.push(part),
            Component::CurDir => {}
            _ => return Err("Path traversal is not allowed".to_string()),
        }
    }
    Ok(out)
}

#[tauri::command]
fn storage_info() -> Result<StorageInfo, String> {
    let dir = ensure_base_dirs()?;
    Ok(StorageInfo {
        supported: true,
        selected: true,
        name: APP_DIR_NAME.to_string(),
        permission: "granted".to_string(),
        data_dir: dir.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn select_data_directory() -> Result<StorageInfo, String> {
    storage_info()
}

#[tauri::command]
fn open_data_directory() -> Result<bool, String> {
    let dir = ensure_base_dirs()?;
    #[cfg(target_os = "macos")]
    let status = Command::new("open").arg(&dir).status();
    #[cfg(target_os = "windows")]
    let status = Command::new("explorer").arg(&dir).status();
    #[cfg(all(unix, not(target_os = "macos")))]
    let status = Command::new("xdg-open").arg(&dir).status();

    match status {
        Ok(result) if result.success() => Ok(true),
        Ok(result) => Err(format!("Could not open data folder. Exit status: {result}")),
        Err(err) => Err(err.to_string()),
    }
}

#[tauri::command]
fn read_text(path: String) -> Result<Option<String>, String> {
    let file = safe_join(&path)?;
    if !file.exists() {
        return Ok(None);
    }
    fs::read_to_string(file)
        .map(Some)
        .map_err(|err| err.to_string())
}

#[tauri::command]
fn write_text(path: String, text: String) -> Result<bool, String> {
    let file = safe_join(&path)?;
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    fs::write(file, text).map_err(|err| err.to_string())?;
    Ok(true)
}

#[tauri::command]
fn read_binary(path: String) -> Result<Option<Vec<u8>>, String> {
    let file = safe_join(&path)?;
    if !file.exists() {
        return Ok(None);
    }
    fs::read(file).map(Some).map_err(|err| err.to_string())
}

#[tauri::command]
fn write_binary(path: String, bytes: Vec<u8>) -> Result<bool, String> {
    let file = safe_join(&path)?;
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    fs::write(file, bytes).map_err(|err| err.to_string())?;
    Ok(true)
}

#[tauri::command]
fn list_files(path: String) -> Result<Vec<String>, String> {
    let dir = safe_join(&path)?;
    let mut files = Vec::new();
    if !dir.exists() {
        return Ok(files);
    }
    for entry in fs::read_dir(dir).map_err(|err| err.to_string())? {
        let entry = entry.map_err(|err| err.to_string())?;
        if entry.file_type().map_err(|err| err.to_string())?.is_file() {
            files.push(entry.file_name().to_string_lossy().to_string());
        }
    }
    files.sort();
    Ok(files)
}

#[tauri::command]
fn list_directories(path: String) -> Result<Vec<String>, String> {
    let dir = safe_join(&path)?;
    let mut dirs = Vec::new();
    if !dir.exists() {
        return Ok(dirs);
    }
    for entry in fs::read_dir(dir).map_err(|err| err.to_string())? {
        let entry = entry.map_err(|err| err.to_string())?;
        if entry.file_type().map_err(|err| err.to_string())?.is_dir() {
            dirs.push(entry.file_name().to_string_lossy().to_string());
        }
    }
    dirs.sort();
    Ok(dirs)
}

#[tauri::command]
fn remove_entry(path: String) -> Result<bool, String> {
    let target = safe_join(&path)?;
    if !target.exists() {
        return Ok(false);
    }
    if target.is_dir() {
        fs::remove_dir_all(target).map_err(|err| err.to_string())?;
    } else {
        fs::remove_file(target).map_err(|err| err.to_string())?;
    }
    Ok(true)
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            storage_info,
            select_data_directory,
            open_data_directory,
            read_text,
            write_text,
            read_binary,
            write_binary,
            list_files,
            list_directories,
            remove_entry,
        ])
        .run(tauri::generate_context!())
        .expect("error while running PhysioFlow");
}
