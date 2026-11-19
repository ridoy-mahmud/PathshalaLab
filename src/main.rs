mod api;
mod db;
mod models;

use axum::{
    routing::{get, post, put},
    Router,
};
use std::{net::SocketAddr, path::PathBuf};
use tower_http::{
    cors::{Any, CorsLayer},
    services::ServeDir,
    trace::TraceLayer,
};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt().with_env_filter("info").init();

    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let db_path = root.join("data/pathshala.db");
    let static_dir = root.join("static");

    let pool = db::Pool::open(&db_path, std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).min(8))?;
    let state: api::AppState = pool;

    let api_routes = Router::new()
        .route("/health", get(api::health))
        .route("/subjects", get(api::subjects))
        .route("/topics", get(api::topics))
        .route("/questions", get(api::questions))
        .route("/questions/random", get(api::random_questions))
        .route("/questions/{id}", get(api::question_by_id))
        .route("/auth/login", post(api::login))
        .route("/exams/start", post(api::exam_start))
        .route("/exams/blueprint", post(api::exam_blueprint))
        .route("/exams/single/{id}", post(api::exam_single))
        .route("/exams/{id}/answer", post(api::exam_answer))
        .route("/exams/{id}/submit", post(api::exam_submit))
        .route("/exams/{id}/result", get(api::exam_result))
        .route("/exams", get(api::my_exams))
        .route("/review/grade", post(api::review_grade))
        .route("/review/due", get(api::review_due))
        .route("/predict", get(api::predict))
        .route("/stats", get(api::stats))
        .route("/bookmarks", get(api::bookmarks))
        .route("/bookmark/{id}", post(api::bookmark_toggle))
        .route("/flagged", get(api::flagged_list).post(api::flag_question))
        .route("/flagged/ids", get(api::flagged_ids))
        .route("/flagged/{id}", put(api::flagged_update).delete(api::flagged_remove))
        .route("/flagged/{id}/resolve", post(api::flagged_resolve))
        .route("/flagged/{id}/reopen", post(api::flagged_reopen))
        .route("/analytics", get(api::analytics))
        .route("/qotd", get(api::qotd))
        .with_state(state.clone());

    let static_files = ServeDir::new(&static_dir)
        .append_index_html_on_directories(true);

    // The exam app IS the home page now.
    let app = Router::new()
        .nest("/api", api_routes)
        .route("/", get(|| async { axum::response::Html(include_str!("../static/app.html")) }))
        .route("/app", get(|| async { axum::response::Html(include_str!("../static/app.html")) }))
        .fallback_service(static_files)
        .layer(CorsLayer::new().allow_origin(Any).allow_methods(Any).allow_headers(Any))
        .layer(TraceLayer::new_for_http());

    let port = std::env::var("PORT").ok().and_then(|s| s.parse().ok()).unwrap_or(8080u16);
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    tracing::info!("🚀 pathshala-rs listening on http://{}", addr);
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}
