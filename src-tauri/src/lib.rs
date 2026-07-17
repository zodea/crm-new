use std::{fs::create_dir_all, future::Future, time::Duration};

use sqlx::{
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
    SqlitePool,
};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_sql::{DbInstances, DbPool};
use tokio::sync::Mutex;

const APP_DATABASE_URL: &str = "sqlite:crm.db";

#[derive(Default)]
pub struct AppDatabasePreparation(Mutex<Option<SqlitePool>>);

impl AppDatabasePreparation {
    pub async fn ensure<Initialize, InitializeFuture>(
        &self,
        initialize: Initialize,
    ) -> Result<(), String>
    where
        Initialize: FnOnce() -> InitializeFuture,
        InitializeFuture: Future<Output = Result<SqlitePool, String>>,
    {
        let mut current = self.0.lock().await;
        if current.as_ref().is_some_and(|pool| !pool.is_closed()) {
            return Ok(());
        }

        let pool = initialize().await?;
        *current = Some(pool);
        Ok(())
    }
}

pub async fn open_single_connection_pool(
    options: SqliteConnectOptions,
) -> Result<SqlitePool, sqlx::Error> {
    SqlitePoolOptions::new()
        .max_connections(1)
        .min_connections(1)
        .acquire_timeout(Duration::from_secs(30))
        .idle_timeout(None)
        .max_lifetime(None)
        .test_before_acquire(false)
        .connect_with(options)
        .await
}

#[tauri::command]
async fn prepare_app_database(
    app: AppHandle,
    db_instances: State<'_, DbInstances>,
    preparation: State<'_, AppDatabasePreparation>,
) -> Result<(), String> {
    preparation
        .ensure(move || async move {
            let app_config_dir = app
                .path()
                .app_config_dir()
                .map_err(|error| error.to_string())?;
            create_dir_all(&app_config_dir).map_err(|error| error.to_string())?;

            let options = SqliteConnectOptions::new()
                .filename(app_config_dir.join("crm.db"))
                .create_if_missing(true);
            let pool = open_single_connection_pool(options)
                .await
                .map_err(|error| error.to_string())?;

            let previous = db_instances
                .0
                .write()
                .await
                .insert(APP_DATABASE_URL.to_string(), DbPool::Sqlite(pool.clone()));
            if let Some(DbPool::Sqlite(previous_pool)) = previous {
                previous_pool.close().await;
            }
            Ok(pool)
        })
        .await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .manage(AppDatabasePreparation::default())
        .invoke_handler(tauri::generate_handler![prepare_app_database])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
