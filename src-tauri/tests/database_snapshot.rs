use std::{fs, path::PathBuf, time::{SystemTime, UNIX_EPOCH}};
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode};

fn directory(case: &str) -> PathBuf {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent().unwrap()
        .join(".tmp/root-a01-a03-validation")
        .join(format!("native-snapshot-{case}-{}", SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
    fs::create_dir_all(&path).unwrap();
    path.canonicalize().unwrap()
}

async fn source(path: &PathBuf) -> sqlx::SqlitePool {
    let pool = crm_new_lib::open_single_connection_pool(SqliteConnectOptions::new()
        .filename(path).create_if_missing(true).journal_mode(SqliteJournalMode::Wal)).await.unwrap();
    sqlx::raw_sql("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY); INSERT INTO schema_migrations VALUES(58);
        CREATE TABLE workers(id TEXT PRIMARY KEY,name TEXT NOT NULL);
        CREATE TABLE history(id TEXT PRIMARY KEY,worker_id TEXT NOT NULL REFERENCES workers(id),frozen_json TEXT NOT NULL);
        CREATE TABLE originals(id TEXT PRIMARY KEY,content BLOB NOT NULL);
        CREATE TABLE commands(id TEXT PRIMARY KEY,receipt_json TEXT NOT NULL);
        CREATE TRIGGER history_immutable BEFORE UPDATE ON history BEGIN SELECT RAISE(ABORT,'immutable'); END;
        INSERT INTO workers VALUES('old-stable-worker','  同一工人原名  ');
        INSERT INTO history VALUES('history-1','old-stable-worker','{\"version\":1,\"amount\":0,\"unknown\":null}');
        INSERT INTO originals VALUES('original-1',X'000A80FF');
        INSERT INTO commands VALUES('original-command','{\"id\":\"old-stable-worker\",\"version\":1}');")
        .execute(&pool).await.unwrap();
    pool
}

#[tokio::test]
async fn snapshot_copies_committed_wal_facts_and_reopens_without_changing_the_source() {
    let dir = directory("wal");
    let source_path = dir.join("source.sqlite");
    let pool = source(&source_path).await;
    let writer = crm_new_lib::open_single_connection_pool(SqliteConnectOptions::new()
        .filename(&source_path).journal_mode(SqliteJournalMode::Wal)).await.unwrap();
    let mut pending = writer.begin().await.unwrap();
    sqlx::query("INSERT INTO workers VALUES('uncommitted-worker','尚未提交')").execute(&mut *pending).await.unwrap();
    let snapshot_path = dir.join("snapshot.sqlite");
    crm_new_lib::create_database_snapshot(&pool, &snapshot_path).await.unwrap();
    pending.rollback().await.unwrap();
    writer.close().await;
    let snapshot = crm_new_lib::open_single_connection_pool(SqliteConnectOptions::new()
        .filename(&snapshot_path).read_only(true)).await.unwrap();
    let workers: Vec<(String,String)> = sqlx::query_as("SELECT id,name FROM workers ORDER BY id").fetch_all(&snapshot).await.unwrap();
    assert_eq!(workers, vec![("old-stable-worker".to_string(),"  同一工人原名  ".to_string())]);
    let (body,): (Vec<u8>,) = sqlx::query_as("SELECT content FROM originals WHERE id='original-1'").fetch_one(&snapshot).await.unwrap();
    assert_eq!(body, vec![0,10,128,255]);
    let (frozen,): (String,) = sqlx::query_as("SELECT frozen_json FROM history").fetch_one(&snapshot).await.unwrap();
    assert_eq!(frozen, "{\"version\":1,\"amount\":0,\"unknown\":null}");
    let (receipt,): (String,) = sqlx::query_as("SELECT receipt_json FROM commands").fetch_one(&snapshot).await.unwrap();
    assert_eq!(receipt, "{\"id\":\"old-stable-worker\",\"version\":1}");
    let (version,): (i64,) = sqlx::query_as("SELECT MAX(version) FROM schema_migrations").fetch_one(&snapshot).await.unwrap();
    assert_eq!(version,58);
    snapshot.close().await;
    let original: Vec<(String,String)> = sqlx::query_as("SELECT id,name FROM workers ORDER BY id").fetch_all(&pool).await.unwrap();
    assert_eq!(original, workers);
    assert!(sqlx::query("UPDATE history SET frozen_json='changed'").execute(&pool).await.is_err());
    pool.close().await;
    let reopened = crm_new_lib::open_single_connection_pool(SqliteConnectOptions::new().filename(&snapshot_path).read_only(true)).await.unwrap();
    let (count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM commands WHERE id='original-command'").fetch_one(&reopened).await.unwrap();
    assert_eq!(count,1);
    reopened.close().await;
}

#[tokio::test]
async fn existing_files_and_unsafe_destinations_are_rejected_without_overwriting() {
    let dir = directory("targets");
    let pool = source(&dir.join("source.sqlite")).await;
    let existing = dir.join("user-document.sqlite");
    fs::write(&existing,b"original user bytes").unwrap();
    assert!(crm_new_lib::create_database_snapshot(&pool,&existing).await.is_err());
    assert_eq!(fs::read(&existing).unwrap(),b"original user bytes");
    let empty = dir.join("existing-empty.sqlite");
    fs::write(&empty,[]).unwrap();
    assert!(crm_new_lib::create_database_snapshot(&pool,&empty).await.is_err());
    assert!(crm_new_lib::create_database_snapshot(&pool,&PathBuf::from("relative.sqlite")).await.is_err());
    assert!(crm_new_lib::create_database_snapshot(&pool,&dir.join("missing/snapshot.sqlite")).await.is_err());
    // Windows verbatim PathBuf::join normalizes `..` before the guard receives it.
    // Keep the raw parent segment and a fresh filename so an existing file cannot mask the guard.
    let escaped_name = format!("escaped-{}.sqlite", dir.file_name().unwrap().to_string_lossy());
    let escaped_target = dir.parent().unwrap().join(&escaped_name);
    assert!(!escaped_target.exists());
    let mut escaped_input = dir.as_os_str().to_os_string();
    escaped_input.push(std::path::MAIN_SEPARATOR_STR);
    escaped_input.push("..");
    escaped_input.push(std::path::MAIN_SEPARATOR_STR);
    escaped_input.push(&escaped_name);
    let escaped_input = PathBuf::from(escaped_input);
    assert!(escaped_input.components().any(|part| matches!(part, std::path::Component::ParentDir)));
    assert!(crm_new_lib::create_database_snapshot(&pool,&escaped_input).await.is_err());
    assert!(!escaped_target.exists());
    pool.close().await;
}

#[tokio::test]
async fn invalid_foreign_keys_leave_an_unpublished_snapshot_and_preserve_originals() {
    let dir = directory("invalid");
    let pool = source(&dir.join("source.sqlite")).await;
    sqlx::raw_sql("PRAGMA foreign_keys=OFF; INSERT INTO history VALUES('orphan','missing-worker','{\"amount\":null}'); PRAGMA foreign_keys=ON;")
        .execute(&pool).await.unwrap();
    let output = dir.join("unverified.sqlite");
    let result = crm_new_lib::create_database_snapshot(&pool,&output).await;
    assert!(result.unwrap_err().contains("失效外键"));
    assert!(fs::metadata(&output).unwrap().len()>0);
    let (count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM history WHERE id='orphan'").fetch_one(&pool).await.unwrap();
    assert_eq!(count,1);
    pool.close().await;
}
