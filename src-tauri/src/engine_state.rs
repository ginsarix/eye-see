use std::sync::{Arc, Mutex, PoisonError};
use std::time::Instant;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::clip::{Embedder, Engine};

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum ModelState {
    Loading,
    Ready,
    Error { message: String },
}

/// The engine behind a mutex, so only one search or benchmark runs at a time
pub type SharedEmbedder = Arc<Mutex<dyn Embedder>>;

struct Inner {
    state: ModelState,
    embedder: Option<SharedEmbedder>,
    load_ms: Option<f64>,
}

/// The engine, once it has loaded, and its load state. Managed by Tauri.
pub struct EngineState {
    inner: Mutex<Inner>,
}

impl Default for EngineState {
    fn default() -> Self {
        Self {
            inner: Mutex::new(Inner {
                state: ModelState::Loading,
                embedder: None,
                load_ms: None,
            }),
        }
    }
}

impl EngineState {
    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub fn state(&self) -> ModelState {
        self.lock().state.clone()
    }

    pub fn load_ms(&self) -> Option<f64> {
        self.lock().load_ms
    }

    pub fn set_ready(&self, embedder: impl Embedder + 'static, load_ms: f64) {
        let mut inner = self.lock();
        inner.embedder = Some(Arc::new(Mutex::new(embedder)));
        inner.load_ms = Some(load_ms);
        inner.state = ModelState::Ready;
    }

    pub fn set_error(&self, message: String) {
        self.lock().state = ModelState::Error { message };
    }

    /// The loaded engine, or an error while it's loading or failed to load
    pub fn ready(&self) -> Result<SharedEmbedder, String> {
        self.lock()
            .embedder
            .clone()
            .ok_or_else(|| "The model isn't ready".to_string())
    }
}

#[tauri::command]
pub fn model_state(engine: State<'_, EngineState>) -> ModelState {
    engine.state()
}

/// Loads the engine from the bundled resources on a background thread, so the
/// window opens right away, then emits `model-state` with the outcome.
pub fn load_in_background(app: AppHandle) {
    std::thread::spawn(move || {
        let started = Instant::now();
        let loaded = app
            .path()
            .resource_dir()
            .map_err(|e| format!("Failed to find the app's resources: {e}"))
            .and_then(|dir| Engine::load(&dir.join("models")));

        let engine = app.state::<EngineState>();
        match loaded {
            Ok(loaded) => {
                let load_ms = started.elapsed().as_secs_f64() * 1000.0;
                log::info!("Loaded the CLIP models in {load_ms:.0} ms");
                engine.set_ready(loaded, load_ms);
            }
            Err(message) => {
                log::error!("Failed to load the CLIP models: {message}");
                engine.set_error(message);
            }
        }
        if let Err(error) = app.emit("model-state", engine.state()) {
            log::warn!("Failed to emit the model state: {error}");
        }
    });
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::test_support::FakeEmbedder;

    #[test]
    fn is_not_ready_while_loading() {
        let engine = EngineState::default();

        assert_eq!(engine.state(), ModelState::Loading);
        assert_eq!(
            engine.ready().err(),
            Some("The model isn't ready".to_string())
        );
        assert_eq!(engine.load_ms(), None);
    }

    #[test]
    fn hands_out_the_engine_once_ready() {
        let engine = EngineState::default();

        engine.set_ready(FakeEmbedder::default(), 420.0);

        assert_eq!(engine.state(), ModelState::Ready);
        assert_eq!(engine.load_ms(), Some(420.0));
        let embedder = engine.ready().unwrap();
        assert_eq!(
            embedder.lock().unwrap().embed_text("7").unwrap(),
            [7.0, 248.0]
        );
    }

    #[test]
    fn stays_unavailable_after_failing_to_load() {
        let engine = EngineState::default();

        engine.set_error("Models not found".into());

        assert_eq!(
            engine.state(),
            ModelState::Error {
                message: "Models not found".into()
            }
        );
        assert!(engine.ready().is_err());
    }

    #[test]
    fn serializes_for_the_frontend() {
        assert_eq!(
            serde_json::to_value(ModelState::Loading).unwrap(),
            json!({ "status": "loading" })
        );
        assert_eq!(
            serde_json::to_value(ModelState::Ready).unwrap(),
            json!({ "status": "ready" })
        );
        assert_eq!(
            serde_json::to_value(ModelState::Error {
                message: "boom".into()
            })
            .unwrap(),
            json!({ "status": "error", "message": "boom" })
        );
    }
}
