use std::{
    fs::{symlink_metadata, OpenOptions},
    path::{Component, Path, PathBuf},
};

use sqlx::{sqlite::SqliteConnectOptions, SqlitePool};

fn ordinary_parent(destination: &Path) -> Result<PathBuf, String> {
    if !destination.is_absolute()
        || destination.components().any(|part| matches!(part, Component::ParentDir | Component::CurDir))
        || destination.to_str().map_or(true, |text| text.split(['/', '\\']).any(|part| part == "." || part == ".."))
        || destination.file_name().is_none()
    {
        return Err("备份目标必须是已选择目录内的绝对文件路径".to_string());
    }
    #[cfg(windows)]
    if !matches!(destination.components().next(), Some(Component::Prefix(prefix)) if matches!(prefix.kind(), std::path::Prefix::Disk(_) | std::path::Prefix::VerbatimDisk(_))) {
        return Err("备份目标必须是本地磁盘目录".to_string());
    }
    let parent = destination.parent().ok_or("找不到备份目录")?;
    for ancestor in parent.ancestors() {
        let metadata = symlink_metadata(ancestor).map_err(|error| format!("无法核验备份目录：{error}"))?;
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            return Err("备份目录必须是普通本地目录".to_string());
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if metadata.file_attributes() & 0x400 != 0 {
                return Err("备份目录不能经过重解析点".to_string());
            }
        }
    }
    let resolved = parent.canonicalize().map_err(|error| error.to_string())?;
    Ok(resolved.join(destination.file_name().ok_or("找不到备份文件名")?))
}

/// Copies the registered SQLite connection's committed state, including WAL contents.
/// Existing files are never overwritten. Failed output is retained for diagnosis and
/// is never reported as a usable migration snapshot.
pub async fn create_database_snapshot(pool: &SqlitePool, destination: &Path) -> Result<(), String> {
    let path = ordinary_parent(destination)?;
    let mut reservation = OpenOptions::new();
    reservation.read(true).write(true).create_new(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        // Keep SQLite's read/write access while preventing a rename or replacement.
        reservation.share_mode(0x1 | 0x2);
    }
    let reserved = reservation.open(&path).map_err(|error| format!("无法创建新的备份文件，已有文件不会覆盖：{error}"))?;
    let result = async {
        let mut connection = pool.acquire().await.map_err(|error| error.to_string())?;
        sqlx::query("VACUUM INTO ?")
            .bind(path.to_str().ok_or("备份路径不是有效文本")?)
            .execute(&mut *connection)
            .await
            .map_err(|error| format!("一致备份未完成：{error}"))?;
        drop(connection);
        reserved.sync_all().map_err(|error| format!("备份落盘失败：{error}"))?;
        if reserved.metadata().map_err(|error| error.to_string())?.len() == 0 {
            return Err("备份文件为空".to_string());
        }
        let verified = super::open_single_connection_pool(
            SqliteConnectOptions::new().filename(&path).read_only(true).create_if_missing(false),
        )
        .await
        .map_err(|error| format!("备份无法只读打开：{error}"))?;
        let verification = async {
            let integrity: Vec<(String,)> = sqlx::query_as("PRAGMA integrity_check")
                .fetch_all(&verified).await.map_err(|error| error.to_string())?;
            if integrity != vec![("ok".to_string(),)] {
                return Err("备份未通过 SQLite 完整性核验".to_string());
            }
            if !sqlx::query("PRAGMA foreign_key_check").fetch_all(&verified).await.map_err(|error| error.to_string())?.is_empty() {
                return Err("备份存在失效外键，不能用于迁入".to_string());
            }
            let (version,): (Option<i64>,) = sqlx::query_as("SELECT MAX(version) FROM schema_migrations")
                .fetch_one(&verified).await.map_err(|error| error.to_string())?;
            if version.map_or(true, |value| value < 1) {
                return Err("备份缺少有效来源版本".to_string());
            }
            Ok(())
        }.await;
        verified.close().await;
        verification
    }.await;
    result.map_err(|error| format!("{error}；输出保留于 {}，尚未通过迁入验收", path.display()))
}
