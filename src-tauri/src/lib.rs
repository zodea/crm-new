use std::{fs::create_dir_all, future::Future, process::Command, time::Duration};

use sqlx::{
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
    SqlitePool,
};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_sql::{DbInstances, DbPool};
use tokio::sync::Mutex;

const APP_DATABASE_URL: &str = "sqlite:crm.db";
const GUANGDONG_TAX_QUERY_URL: &str =
    "https://etax.guangdong.chinatax.gov.cn:8443/xxbg/view/zhsffw/#/query/ybnsrzgcx";

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

fn is_allowed_external_url(url: &str) -> bool {
    url == GUANGDONG_TAX_QUERY_URL
}

#[cfg(target_os = "windows")]
fn spawn_external_url(url: &str) -> Result<(), String> {
    Command::new("rundll32")
        .arg("url.dll,FileProtocolHandler")
        .arg(url)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("无法打开系统默认浏览器：{error}"))
}

#[cfg(target_os = "macos")]
fn spawn_external_url(url: &str) -> Result<(), String> {
    Command::new("open")
        .arg(url)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("无法打开系统默认浏览器：{error}"))
}

#[cfg(all(unix, not(target_os = "macos"), not(target_os = "android")))]
fn spawn_external_url(url: &str) -> Result<(), String> {
    Command::new("xdg-open")
        .arg(url)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("无法打开系统默认浏览器：{error}"))
}

#[cfg(any(target_os = "android", target_os = "ios"))]
fn spawn_external_url(_url: &str) -> Result<(), String> {
    Err("当前移动端未启用外部浏览器能力".to_string())
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    if !is_allowed_external_url(&url) {
        return Err("不允许打开未登记的外部地址".to_string());
    }
    spawn_external_url(&url)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .manage(AppDatabasePreparation::default())
        .invoke_handler(tauri::generate_handler![
            prepare_app_database,
            open_external_url
        ])
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

#[cfg(test)]
mod tests {
    use super::{is_allowed_external_url, GUANGDONG_TAX_QUERY_URL};

    #[test]
    fn external_url_allowlist_only_contains_tax_query() {
        for (url, allowed) in [
            (GUANGDONG_TAX_QUERY_URL.to_string(), true),
            ("https://example.com".to_string(), false),
            ("file:///C:/Windows/System32".to_string(), false),
            ("javascript:alert(1)".to_string(), false),
            (
                format!("{GUANGDONG_TAX_QUERY_URL}?redirect=https://example.com"),
                false,
            ),
            (format!(" {GUANGDONG_TAX_QUERY_URL}"), false),
        ] {
            assert_eq!(is_allowed_external_url(&url), allowed, "URL: {url}");
        }
    }
}
