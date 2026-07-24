use std::{
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
    time::Duration,
};

use sqlx::sqlite::SqliteConnectOptions;
use tokio::{sync::Notify, time::timeout};

#[tokio::test]
async fn desktop_database_pool_keeps_one_physical_connection() {
    let options = SqliteConnectOptions::new().in_memory(true);
    let pool = crm_new_lib::open_single_connection_pool(options)
        .await
        .expect("single-connection pool should open");

    let first = pool
        .acquire()
        .await
        .expect("first connection should be available");
    let second = timeout(Duration::from_millis(50), pool.acquire()).await;
    assert!(
        second.is_err(),
        "a second physical connection must not be opened"
    );

    drop(first);
    let reused = timeout(Duration::from_secs(1), pool.acquire())
        .await
        .expect("released connection should become available")
        .expect("released connection should remain healthy");
    drop(reused);
    pool.close().await;
}

#[tokio::test]
async fn app_database_preparation_is_single_flight_and_idempotent() {
    let preparation = Arc::new(crm_new_lib::AppDatabasePreparation::default());
    let initialize_calls = Arc::new(AtomicUsize::new(0));
    let started = Arc::new(Notify::new());
    let release = Arc::new(Notify::new());

    let first = {
        let preparation = Arc::clone(&preparation);
        let initialize_calls = Arc::clone(&initialize_calls);
        let started = Arc::clone(&started);
        let release = Arc::clone(&release);
        tokio::spawn(async move {
            preparation
                .ensure(move || async move {
                    initialize_calls.fetch_add(1, Ordering::SeqCst);
                    started.notify_one();
                    release.notified().await;
                    crm_new_lib::open_single_connection_pool(
                        SqliteConnectOptions::new().in_memory(true),
                    )
                    .await
                    .map_err(|error| error.to_string())
                })
                .await
        })
    };
    started.notified().await;

    let second = {
        let preparation = Arc::clone(&preparation);
        let initialize_calls = Arc::clone(&initialize_calls);
        tokio::spawn(async move {
            preparation
                .ensure(move || async move {
                    initialize_calls.fetch_add(1, Ordering::SeqCst);
                    Err::<sqlx::SqlitePool, _>("duplicate preparation must not run".to_string())
                })
                .await
        })
    };
    tokio::task::yield_now().await;
    assert_eq!(initialize_calls.load(Ordering::SeqCst), 1);

    release.notify_one();
    first
        .await
        .expect("first task should join")
        .expect("first preparation should succeed");
    second
        .await
        .expect("second task should join")
        .expect("second preparation should reuse the completed initialization");
    assert_eq!(initialize_calls.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn closed_prepared_pool_is_recreated_in_the_same_process() {
    let preparation = crm_new_lib::AppDatabasePreparation::default();
    let initialize_calls = Arc::new(AtomicUsize::new(0));
    let first_pool =
        crm_new_lib::open_single_connection_pool(SqliteConnectOptions::new().in_memory(true))
            .await
            .expect("first pool should open");

    preparation
        .ensure({
            let initialize_calls = Arc::clone(&initialize_calls);
            let first_pool = first_pool.clone();
            move || async move {
                initialize_calls.fetch_add(1, Ordering::SeqCst);
                Ok(first_pool)
            }
        })
        .await
        .expect("first preparation should succeed");
    first_pool.close().await;

    let replacement_pool =
        crm_new_lib::open_single_connection_pool(SqliteConnectOptions::new().in_memory(true))
            .await
            .expect("replacement pool should open");
    preparation
        .ensure({
            let initialize_calls = Arc::clone(&initialize_calls);
            let replacement_pool = replacement_pool.clone();
            move || async move {
                initialize_calls.fetch_add(1, Ordering::SeqCst);
                Ok(replacement_pool)
            }
        })
        .await
        .expect("a closed prepared pool should be rebuilt");
    assert_eq!(initialize_calls.load(Ordering::SeqCst), 2);

    preparation
        .ensure({
            let initialize_calls = Arc::clone(&initialize_calls);
            move || async move {
                initialize_calls.fetch_add(1, Ordering::SeqCst);
                Err::<sqlx::SqlitePool, _>("healthy pool must be reused".to_string())
            }
        })
        .await
        .expect("the healthy replacement should be reused");
    assert_eq!(initialize_calls.load(Ordering::SeqCst), 2);
    replacement_pool.close().await;
}
