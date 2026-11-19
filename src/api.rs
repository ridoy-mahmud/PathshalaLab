//! JSON API handlers. All DB access goes through the pool; answers are never
//! exposed until an exam is submitted.
use crate::db::{Pool, ACTIVE};
use crate::models::*;
use axum::{extract::{Query, Path, State}, http::HeaderMap, Json};
use rand::Rng;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, sync::Arc, time::{SystemTime, UNIX_EPOCH}};

pub type AppState = Arc<Pool>;
pub type ApiResult<T> = Result<Json<T>, (axum::http::StatusCode, String)>;

fn err(e: impl std::fmt::Display) -> (axum::http::StatusCode, String) {
    (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
}
fn bad(e: &str) -> (axum::http::StatusCode, String) {
    (axum::http::StatusCode::BAD_REQUEST, e.to_string())
}

fn token(headers: &HeaderMap, q: &HashMap<String, String>) -> Option<String> {
    if let Some(v) = headers.get("authorization").and_then(|v| v.to_str().ok()) {
        if let Some(t) = v.strip_prefix("Bearer ") { return Some(t.to_string()); }
    }
    q.get("token").cloned()
}

/// Guest access is enabled: no token → user 0. Login remains optional.
fn user_id(pool: &Pool, headers: &HeaderMap, q: &HashMap<String, String>) -> Result<i64, (axum::http::StatusCode, String)> {
    let Some(t) = token(headers, q) else { return Ok(0); };
    Ok(pool.optional::<i64, _>("SELECT user_id FROM app_sessions WHERE token=?1", params![t])
        .map_err(err)?
        .unwrap_or(0))
}

// ---------------------------------------------------------------- health
pub async fn health(State(p): State<AppState>) -> ApiResult<serde_json::Value> {
    let n = p.with(|c| c.query_row("SELECT COUNT(*) FROM questions", [], |r| r.get::<_, i64>(0))).map_err(err)?;
    Ok(Json(serde_json::json!({"ok": true, "questions": n, "engine": "pathshala-rs"})))
}

// ---------------------------------------------------------------- catalog
pub async fn subjects(State(p): State<AppState>) -> ApiResult<Vec<Subject>> {
    let rows = p.with(|c| {
        let mut st = c.prepare(&format!("SELECT s.id,s.slug,s.name_bn,s.name_en,COUNT(q.id) \
            FROM subjects s LEFT JOIN questions q ON q.subject_id=s.id AND {ACTIVE} \
            GROUP BY s.id ORDER BY s.id"))?;
        let mut out = vec![];
        for r in st.query_map([], |r| Ok(Subject {
            id: r.get(0)?, slug: r.get(1)?, name_bn: r.get(2)?, name_en: r.get(3)?, count: r.get(4)?,
        }))? { out.push(r?); }
        Ok(out)
    }).map_err(err)?;
    Ok(Json(rows))
}

#[derive(Deserialize)]
pub struct TopicQ { subject_id: Option<i64> }

pub async fn topics(State(p): State<AppState>, Query(q): Query<TopicQ>) -> ApiResult<Vec<Topic>> {
    let (sql, args): (String, Vec<i64>) = if let Some(sid) = q.subject_id {
        (format!("SELECT t.id,t.subject_id,t.name,COUNT(q.id) FROM topics t \
             LEFT JOIN questions q ON q.topic_id=t.id AND {ACTIVE} \
             WHERE t.subject_id=?1 GROUP BY t.id ORDER BY COUNT(q.id) DESC"), vec![sid])
    } else {
        (format!("SELECT t.id,t.subject_id,t.name,COUNT(q.id) FROM topics t \
             LEFT JOIN questions q ON q.topic_id=t.id AND {ACTIVE} \
             GROUP BY t.id ORDER BY COUNT(q.id) DESC LIMIT 200"), vec![])
    };
    let rows = p.with(|c| {
        let mut st = c.prepare(&sql)?;
        let mut out = vec![];
        for r in st.query_map(rusqlite::params_from_iter(args), |r| Ok(Topic {
            id: r.get(0)?, subject_id: r.get(1)?, name: r.get(2)?, count: r.get(3)?,
        }))? { out.push(r?); }
        Ok(out)
    }).map_err(err)?;
    Ok(Json(rows))
}

// ---------------------------------------------------------------- questions
#[derive(Deserialize, Default)]
pub struct QQuery {
    subject_id: Option<i64>, topic_id: Option<i64>, q: Option<String>,
    limit: Option<usize>, offset: Option<usize>, only_unverified: Option<u8>,
}

fn parse_opts(s: &str) -> Vec<String> {
    serde_json::from_str(s).unwrap_or_else(|_| vec![])
}

fn row_question(r: &rusqlite::Row<'_>) -> rusqlite::Result<Question> {
    let opts: String = r.get(5)?;
    let expl: String = r.get(7)?;
    Ok(Question {
        id: r.get(0)?, subject_id: r.get(1)?, topic_id: r.get(2)?,
        subject_bn: r.get(3)?, topic_name: r.get(4)?,
        prompt: r.get(6)?, options: parse_opts(&opts),
        has_explanation: !expl.trim().is_empty() && expl.trim() != "বইয়ে দেওয়া উত্তর।",
        source: r.get(8)?,
    })
}

pub async fn questions(State(p): State<AppState>, Query(q): Query<QQuery>) -> ApiResult<Vec<Question>> {
    let limit = q.limit.unwrap_or(20).min(100);
    let offset = q.offset.unwrap_or(0);
    let mut sql = format!("SELECT q.id,q.subject_id,q.topic_id,s.name_bn,t.name,q.options,q.prompt,q.explanation,q.source \
        FROM questions q JOIN subjects s ON s.id=q.subject_id JOIN topics t ON t.id=q.topic_id \
        WHERE {ACTIVE}");
    let mut args: Vec<rusqlite::types::Value> = vec![];
    if let Some(v) = q.subject_id { sql.push_str(" AND q.subject_id=?"); args.push(v.into()); }
    if let Some(v) = q.topic_id { sql.push_str(" AND q.topic_id=?"); args.push(v.into()); }
    if q.only_unverified.unwrap_or(0) == 1 { sql.push_str(" AND q.needs_review=1"); }
    if let Some(ref term) = q.q {
        sql.push_str(" AND q.id IN (SELECT rowid FROM questions_fts WHERE questions_fts MATCH ?)");
        args.push(term.clone().into());
    }
    sql.push_str(" ORDER BY q.id LIMIT ? OFFSET ?");
    args.push((limit as i64).into()); args.push((offset as i64).into());
    let rows = p.with(|c| {
        let mut st = c.prepare(&sql)?;
        let mut out = vec![];
        for r in st.query_map(rusqlite::params_from_iter(args), row_question)? { out.push(r?); }
        Ok(out)
    }).map_err(err)?;
    Ok(Json(rows))
}

#[derive(Deserialize)]
pub struct RandQ { subject_id: Option<i64>, topic_id: Option<i64>, n: Option<usize> }

pub async fn random_questions(State(p): State<AppState>, Query(q): Query<RandQ>) -> ApiResult<Vec<Question>> {
    let n = q.n.unwrap_or(10).min(100);
    let mut sql = format!("SELECT q.id,q.subject_id,q.topic_id,s.name_bn,t.name,q.options,q.prompt,q.explanation,q.source \
        FROM questions q JOIN subjects s ON s.id=q.subject_id JOIN topics t ON t.id=q.topic_id \
        WHERE {ACTIVE}");
    let mut args: Vec<i64> = vec![];
    if let Some(v) = q.subject_id { sql.push_str(" AND q.subject_id=?"); args.push(v); }
    if let Some(v) = q.topic_id { sql.push_str(" AND q.topic_id=?"); args.push(v); }
    sql.push_str(" ORDER BY RANDOM() LIMIT ?"); args.push(n as i64);
    let rows = p.with(|c| {
        let mut st = c.prepare(&sql)?;
        let mut out = vec![];
        for r in st.query_map(rusqlite::params_from_iter(args), row_question)? { out.push(r?); }
        Ok(out)
    }).map_err(err)?;
    Ok(Json(rows))
}

/// Full question incl. answer + explanation — used only for post-answer reveal.
pub async fn question_by_id(State(p): State<AppState>, Path(id): Path<i64>) -> ApiResult<QuestionFull> {
    let q = p.with(|c| c.query_row(
        "SELECT q.id,q.subject_id,q.topic_id,q.prompt,q.options,q.answer,q.explanation,t.name,s.name_bn \
         FROM questions q JOIN topics t ON t.id=q.topic_id JOIN subjects s ON s.id=q.subject_id \
         WHERE q.id=?1", params![id], |r| Ok(QuestionFull {
            id: r.get(0)?, subject_id: r.get(1)?, topic_id: r.get(2)?,
            prompt: r.get(3)?, options: parse_opts(&r.get::<_,String>(4)?),
            answer: r.get::<_,i64>(5)? as usize, explanation: r.get(6)?,
            topic_name: r.get(7)?, subject_bn: r.get(8)?,
         }))).map_err(err)?;
    Ok(Json(q))
}

// ---------------------------------------------------------------- auth
#[derive(Deserialize)]
pub struct LoginReq { phone: String, #[serde(default)] name: Option<String> }

pub async fn login(State(p): State<AppState>, Json(b): Json<LoginReq>) -> ApiResult<serde_json::Value> {
    let phone = b.phone.trim();
    if phone.is_empty() { return Err(bad("phone required")); }
    let token: String = rand::rng().sample_iter(rand::distr::Alphanumeric).take(32).map(char::from).collect();
    let uid = p.with(|c| {
        c.execute("INSERT INTO app_users(phone,name) VALUES(?1,?2) ON CONFLICT(phone) DO UPDATE SET name=excluded.name",
            params![phone, b.name.unwrap_or_default()])?;
        let id: i64 = c.query_row("SELECT id FROM app_users WHERE phone=?1", params![phone], |r| r.get(0))?;
        c.execute("INSERT INTO app_sessions(token,user_id) VALUES(?1,?2)", params![token, id])?;
        Ok(id)
    }).map_err(err)?;
    Ok(Json(serde_json::json!({"token": token, "user_id": uid})))
}

// ---------------------------------------------------------------- exams
#[derive(Deserialize)]
pub struct StartReq {
    #[serde(default)] token: String, #[serde(default)] mode: Option<String>, #[serde(default)] title: Option<String>,
    #[serde(default)] subject_ids: Vec<i64>, #[serde(default)] topic_ids: Vec<i64>,
    n: Option<usize>, #[serde(default)] duration_min: Option<i64>,
    #[serde(default)] negative: Option<f64>,
}

#[derive(Serialize)]
pub struct ExamStart { exam_id: i64, questions: Vec<Question>, duration_secs: i64, negative: f64 }

pub async fn exam_start(State(p): State<AppState>, Json(b): Json<StartReq>) -> ApiResult<ExamStart> {
    let uid = if b.token.is_empty() { 0 } else {
        p.optional::<i64, _>("SELECT user_id FROM app_sessions WHERE token=?1", params![b.token]).map_err(err)?.unwrap_or(0)
    };
    let n = b.n.unwrap_or(20).min(200);
    let mut sql = format!("SELECT q.id,q.subject_id,q.topic_id,s.name_bn,t.name,q.options,q.prompt,q.explanation,q.source \
        FROM questions q JOIN subjects s ON s.id=q.subject_id JOIN topics t ON t.id=q.topic_id \
        WHERE {ACTIVE}");
    let mut args: Vec<i64> = vec![];
    if !b.subject_ids.is_empty() {
        sql.push_str(&format!(" AND q.subject_id IN ({})", vec!["?"; b.subject_ids.len()].join(",")));
        args.extend(b.subject_ids.clone());
    }
    if !b.topic_ids.is_empty() {
        sql.push_str(&format!(" AND q.topic_id IN ({})", vec!["?"; b.topic_ids.len()].join(",")));
        args.extend(b.topic_ids.clone());
    }
    sql.push_str(" ORDER BY RANDOM() LIMIT ?"); args.push(n as i64);
    let questions = p.with(|c| {
        let mut st = c.prepare(&sql)?;
        let mut out = vec![];
        for r in st.query_map(rusqlite::params_from_iter(args), row_question)? { out.push(r?); }
        Ok(out)
    }).map_err(err)?;
    let ids: Vec<i64> = questions.iter().map(|q| q.id).collect();
    let ids_json = serde_json::to_string(&ids).unwrap();
    let dur = b.duration_min.unwrap_or(20) * 60;
    let neg = b.negative.unwrap_or(0.5);
    let mode = b.mode.unwrap_or_else(|| "practice".into());
    let title = b.title.unwrap_or_else(|| "মিক্সড প্র্যাকটিস".into());
    let exam_id = p.with(|c| {
        c.execute("INSERT INTO app_exams(user_id,mode,title,subject_ids,topic_ids,question_ids,n,duration_secs,negative_mark) \
                   VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            params![uid, mode, title, serde_json::to_string(&b.subject_ids).unwrap(),
                serde_json::to_string(&b.topic_ids).unwrap(), ids_json, n as i64, dur, neg])?;
        Ok(c.last_insert_rowid())
    }).map_err(err)?;
    Ok(Json(ExamStart { exam_id, questions, duration_secs: dur, negative: neg }))
}

#[derive(Deserialize)]
pub struct AnswerReq { #[serde(default)] token: String, question_id: i64, selected: Option<usize>, #[serde(default)] time_ms: i64 }

pub async fn exam_answer(
    State(p): State<AppState>, Path(id): Path<i64>, Json(b): Json<AnswerReq>,
) -> ApiResult<serde_json::Value> {
    let valid = p.with(|c| c.query_row("SELECT 1 FROM app_exams WHERE id=?1 AND submitted_at IS NULL",
        params![id], |r| r.get::<_,i64>(0))).optional().map_err(err)?.is_some();
    if !valid { return Err(bad("exam not active")); }
    let correct = if let Some(sel) = b.selected {
        p.with(|c| c.query_row("SELECT answer FROM questions WHERE id=?1", params![b.question_id], |r| r.get::<_,i64>(0)))
            .map_err(err)? as usize == sel
    } else { false };
    p.with(|c| c.execute("INSERT INTO app_answers(exam_id,question_id,selected,is_correct,time_ms) VALUES(?1,?2,?3,?4,?5) \
             ON CONFLICT(exam_id,question_id) DO UPDATE SET selected=excluded.selected,is_correct=excluded.is_correct,time_ms=excluded.time_ms",
        params![id, b.question_id, b.selected.map(|x| x as i64), correct as i64, b.time_ms])).map_err(err)?;
    Ok(Json(serde_json::json!({"ok": true})))
}

#[derive(Serialize, Clone)]
pub struct ResultItem {
    question_id: i64, prompt: String, options: Vec<String>, selected: Option<usize>,
    answer: usize, is_correct: bool, explanation: String, topic_name: String, subject_bn: String,
}

pub async fn exam_submit(
    State(p): State<AppState>, Path(id): Path<i64>, headers: HeaderMap, Query(q): Query<HashMap<String,String>>,
) -> ApiResult<serde_json::Value> {
    let _ = user_id(&p, &headers, &q)?;
    let (neg, ids_json) = p.with(|c| c.query_row("SELECT negative_mark,question_ids FROM app_exams WHERE id=?1",
        params![id], |r| Ok((r.get::<_,f64>(0)?, r.get::<_,String>(1)?)))).map_err(err)?;
    let ids: Vec<i64> = serde_json::from_str(&ids_json).unwrap_or_default();
    let (score, correct, wrong, skipped, items) = p.with(|c| {
        let mut items = vec![];
        let mut correct = 0i64; let mut wrong = 0i64; let mut skipped = 0i64;
        for qid in &ids {
            let sel: Option<i64> = c.query_row("SELECT selected FROM app_answers WHERE exam_id=?1 AND question_id=?2",
                params![id, qid], |r| r.get(0)).optional()?.flatten();
            let (prompt, opts, ans, expl, topic, subj): (String,String,i64,String,String,String) = c.query_row(
                "SELECT q.prompt,q.options,q.answer,q.explanation,t.name,s.name_bn FROM questions q \
                 JOIN topics t ON t.id=q.topic_id JOIN subjects s ON s.id=q.subject_id WHERE q.id=?1",
                params![qid], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?)))?;
            let is_correct = sel.map(|s| s as i64 == ans).unwrap_or(false);
            if sel.is_none() { skipped += 1 } else if is_correct { correct += 1 } else { wrong += 1 }
            items.push(ResultItem { question_id:*qid, prompt, options:parse_opts(&opts),
                selected: sel.map(|s| s as usize), answer: ans as usize, is_correct,
                explanation: expl, topic_name: topic, subject_bn: subj });
        }
        let s = correct as f64 - wrong as f64 * neg;
        Ok((s, correct, wrong, skipped, items))
    }).map_err(err)?;
    p.with(|c| c.execute("UPDATE app_exams SET submitted_at=datetime('now'),score=?1,correct=?2,wrong=?3,skipped=?4 WHERE id=?5",
        params![score, correct, wrong, skipped, id])).map_err(err)?;
    Ok(Json(serde_json::json!({"exam_id":id,"score":score,"correct":correct,"wrong":wrong,
        "skipped":skipped,"total":ids.len(),"items":items})))
}

pub async fn exam_result(
    State(p): State<AppState>, Path(id): Path<i64>, headers: HeaderMap, Query(q): Query<HashMap<String,String>>,
) -> ApiResult<serde_json::Value> {
    let _ = user_id(&p, &headers, &q)?;
    let r = p.with(|c| c.query_row("SELECT score,correct,wrong,skipped,n,duration_secs,negative_mark,title FROM app_exams WHERE id=?1",
        params![id], |r| Ok(serde_json::json!({"score":r.get::<_,f64>(0)?,"correct":r.get::<_,i64>(1)?,
            "wrong":r.get::<_,i64>(2)?,"skipped":r.get::<_,i64>(3)?,"total":r.get::<_,i64>(4)?,
            "duration_secs":r.get::<_,i64>(5)?,"negative":r.get::<_,f64>(6)?,"title":r.get::<_,String>(7)?}))))
        .map_err(err)?;
    Ok(Json(r))
}

pub async fn my_exams(State(p): State<AppState>, headers: HeaderMap, Query(q): Query<HashMap<String,String>>) -> ApiResult<serde_json::Value> {
    let uid = user_id(&p, &headers, &q)?;
    let rows = p.with(|c| {
        let mut st = c.prepare("SELECT id,title,mode,n,score,correct,wrong,skipped,submitted_at FROM app_exams WHERE user_id=?1 ORDER BY id DESC LIMIT 30")?;
        let mut out = vec![];
        for r in st.query_map(params![uid], |r| Ok(serde_json::json!({
            "id":r.get::<_,i64>(0)?,"title":r.get::<_,String>(1)?,"mode":r.get::<_,String>(2)?,
            "n":r.get::<_,i64>(3)?,"score":r.get::<_,Option<f64>>(4)?,"correct":r.get::<_,Option<i64>>(5)?,
            "wrong":r.get::<_,Option<i64>>(6)?,"skipped":r.get::<_,Option<i64>>(7)?,
            "submitted_at":r.get::<_,Option<String>>(8)? })))? { out.push(r?); }
        Ok(out)
    }).map_err(err)?;
    Ok(Json(serde_json::json!({"exams": rows})))
}

// ---------------------------------------------------------------- SM-2 review
#[derive(Deserialize)]
pub struct GradeReq { #[serde(default)] token: String, question_id: i64, grade: i64 } // 0..5

pub async fn review_grade(State(p): State<AppState>, Json(b): Json<GradeReq>) -> ApiResult<serde_json::Value> {
    let uid = if b.token.is_empty() { 0 } else {
        p.optional::<i64, _>("SELECT user_id FROM app_sessions WHERE token=?1", params![b.token]).map_err(err)?.unwrap_or(0)
    };
    let g = b.grade.clamp(0, 5);
    p.with(|c| {
        let (ease, rep, interval): (f64,i64,i64) = c.query_row(
            "SELECT ease,repetitions,interval_days FROM app_reviews WHERE user_id=?1 AND question_id=?2",
            params![uid, b.question_id], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?)))
            .optional()?.unwrap_or((2.5, 0, 0));
        let (new_rep, interval) = if g >= 3 {
            match rep { 0 => (1, 1), 1 => (2, 6), _ => (rep + 1, ((interval as f64) * ease) as i64) }
        } else { (0, 1) };
        let new_ease = (ease + 0.1 - (5 - g) as f64 * 0.08).max(1.3);
        let due = chrono_like_date(interval);
        c.execute("INSERT INTO app_reviews(user_id,question_id,ease,interval_days,repetitions,due_at,last_grade) \
            VALUES(?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(user_id,question_id) DO UPDATE SET \
            ease=excluded.ease,interval_days=excluded.interval_days,repetitions=excluded.repetitions,due_at=excluded.due_at,last_grade=excluded.last_grade",
            params![uid, b.question_id, new_ease, interval, new_rep, due, g])?;
        Ok(())
    }).map_err(err)?;
    Ok(Json(serde_json::json!({"ok": true})))
}

/// days-from-epoch → YYYY-MM-DD without a date crate.
fn chrono_like_date(days: i64) -> String {
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs() as i64 / 86400;
    let t = now + days;
    let (y, m, d) = civil_from_days(t);
    format!("{:04}-{:02}-{:02}", y, m, d)
}
fn civil_from_days(z: i64) -> (i64,i64,i64) {
    let z = z + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe/1460 + doe/36524 - doe/146096) / 365;
    let mut y = yoe + era * 400;
    let doy = doe - (365*yoe + yoe/4 - yoe/100);
    let mp = (5*doy + 2)/153;
    let d = doy - (153*mp+2)/5 + 1;
    let m = if mp < 10 { mp+3 } else { mp-9 };
    y += if m <= 2 { 1 } else { 0 };
    (y, m, d)
}

pub async fn review_due(State(p): State<AppState>, headers: HeaderMap, Query(q): Query<HashMap<String,String>>) -> ApiResult<serde_json::Value> {
    let uid = user_id(&p, &headers, &q)?;
    let rows = p.with(|c| {
        let mut st = c.prepare("SELECT r.question_id,q.prompt,q.options,s.name_bn,t.name,r.interval_days \
            FROM app_reviews r JOIN questions q ON q.id=r.question_id \
            JOIN subjects s ON s.id=q.subject_id JOIN topics t ON t.id=q.topic_id \
            WHERE r.user_id=?1 AND r.due_at<=date('now') ORDER BY r.due_at LIMIT 50")?;
        let mut out = vec![];
        for r in st.query_map(params![uid], |r| Ok(serde_json::json!({
            "id":r.get::<_,i64>(0)?,"prompt":r.get::<_,String>(1)?,"options":parse_opts(&r.get::<_,String>(2)?),
            "subject":r.get::<_,String>(3)?,"topic":r.get::<_,String>(4)?,"interval":r.get::<_,i64>(5)? })))? { out.push(r?); }
        Ok(out)
    }).map_err(err)?;
    Ok(Json(serde_json::json!({"due": rows})))
}

// ---------------------------------------------------------------- predictions
pub async fn predict(State(p): State<AppState>) -> ApiResult<serde_json::Value> {
    let rows = p.with(|c| {
        let mut st = c.prepare("SELECT t.id,t.name,s.name_bn,COUNT(q.id) AS n, \
            SUM(CASE WHEN q.explanation_origin='book' THEN 1 ELSE 0 END) AS rich \
            FROM topics t JOIN subjects s ON s.id=t.subject_id \
            JOIN questions q ON q.topic_id=t.id AND (q.canonical_id IS NULL OR q.canonical_id=q.id) \
            GROUP BY t.id HAVING n >= 5 ORDER BY n DESC LIMIT 40")?;
        let mut out = vec![];
        for r in st.query_map([], |r| Ok(serde_json::json!({
            "topic_id":r.get::<_,i64>(0)?,"topic":r.get::<_,String>(1)?,
            "subject":r.get::<_,String>(2)?,"count":r.get::<_,i64>(3)?,"rich":r.get::<_,i64>(4)? })))? { out.push(r?); }
        Ok(out)
    }).map_err(err)?;
    Ok(Json(serde_json::json!({"topics": rows})))
}

pub async fn stats(State(p): State<AppState>) -> ApiResult<serde_json::Value> {
    let s = p.with(|c| {
        let total: i64 = c.query_row("SELECT COUNT(*) FROM questions", [], |r| r.get(0))?;
        let active: i64 = c.query_row(&format!("SELECT COUNT(*) FROM questions q WHERE {ACTIVE}"), [], |r| r.get(0))?;
        let verified: i64 = c.query_row("SELECT COUNT(*) FROM verification", [], |r| r.get(0))?;
        let fixed: i64 = c.query_row("SELECT COUNT(DISTINCT question_id) FROM fix_log WHERE field='answer'", [], |r| r.get(0))?;
        Ok(serde_json::json!({"total":total,"active":active,"verified":verified,"answers_corrected":fixed}))
    }).map_err(err)?;
    Ok(Json(s))
}

// ---------------------------------------------------------------- bookmarks
pub async fn bookmarks(State(p): State<AppState>, headers: HeaderMap, Query(q): Query<HashMap<String,String>>) -> ApiResult<serde_json::Value> {
    let uid = user_id(&p, &headers, &q)?;
    let rows = p.with(|c| {
        let mut st = c.prepare("SELECT b.question_id,q.prompt,q.options,q.answer,q.explanation,t.name,s.name_bn \
            FROM app_bookmarks b JOIN questions q ON q.id=b.question_id \
            JOIN topics t ON t.id=q.topic_id JOIN subjects s ON s.id=q.subject_id \
            WHERE b.user_id=?1 ORDER BY b.created_at DESC LIMIT 200")?;
        let mut out = vec![];
        for r in st.query_map(params![uid], |r| Ok(serde_json::json!({
            "id":r.get::<_,i64>(0)?,"prompt":r.get::<_,String>(1)?,"options":parse_opts(&r.get::<_,String>(2)?),
            "answer":r.get::<_,i64>(3)? as usize,"explanation":r.get::<_,String>(4)?,
            "topic":r.get::<_,String>(5)?,"subject":r.get::<_,String>(6)? })))? { out.push(r?); }
        Ok(out)
    }).map_err(err)?;
    Ok(Json(serde_json::json!({"bookmarks": rows})))
}

pub async fn bookmark_toggle(State(p): State<AppState>, Path(id): Path<i64>, headers: HeaderMap, Query(q): Query<HashMap<String,String>>) -> ApiResult<serde_json::Value> {
    let uid = user_id(&p, &headers, &q)?;
    let added = p.with(|c| {
        let exists: bool = c.query_row("SELECT 1 FROM app_bookmarks WHERE user_id=?1 AND question_id=?2", params![uid,id], |r| r.get::<_,i64>(0)).optional()?.is_some();
        if exists { c.execute("DELETE FROM app_bookmarks WHERE user_id=?1 AND question_id=?2", params![uid,id])?; Ok(false) }
        else { c.execute("INSERT INTO app_bookmarks(user_id,question_id) VALUES(?1,?2)", params![uid,id])?; Ok(true) }
    }).map_err(err)?;
    Ok(Json(serde_json::json!({"saved": added})))
}

// ---------------------------------------------------------------- flagged MCQs (stored in data/flagged_mcqs.db)
#[derive(Deserialize, Default)]
pub struct FlaggedQuery {
    status: Option<String>, q: Option<String>, limit: Option<usize>, offset: Option<usize>,
}

pub async fn flagged_list(State(p): State<AppState>, Query(q): Query<FlaggedQuery>) -> ApiResult<serde_json::Value> {
    let status = q.status.as_deref().unwrap_or("open");
    let limit = q.limit.unwrap_or(50).clamp(1, 100) as i64;
    let offset = q.offset.unwrap_or(0).min(100_000) as i64;
    let term = q.q.as_deref().unwrap_or("").trim();
    let rows = p.with(|c| {
        let mut sql = String::from("SELECT f.id,f.source_question_id,f.origin,f.issue_type,f.reason,f.prompt,f.options,f.answer,f.explanation,f.subject,f.topic,f.source,f.status,f.created_at,f.expected_category_id,CASE WHEN f.expected_category_id=0 THEN 'সাধারণ জ্ঞান (GK)' ELSE s.name_bn END FROM flagged.mcqs f LEFT JOIN main.subjects s ON s.id=f.expected_category_id WHERE 1=1");
        let mut args: Vec<rusqlite::types::Value> = vec![];
        if status != "all" {
            sql.push_str(" AND status=?"); args.push(status.to_string().into());
        }
        if !term.is_empty() {
            sql.push_str(" AND (prompt LIKE ? OR options LIKE ? OR reason LIKE ? OR subject LIKE ? OR topic LIKE ?)");
            let pattern = format!("%{}%", term);
            for _ in 0..5 { args.push(pattern.clone().into()); }
        }
        let mut count_sql = sql.clone();
        count_sql = count_sql.replace(
            "SELECT f.id,f.source_question_id,f.origin,f.issue_type,f.reason,f.prompt,f.options,f.answer,f.explanation,f.subject,f.topic,f.source,f.status,f.created_at,f.expected_category_id,CASE WHEN f.expected_category_id=0 THEN 'সাধারণ জ্ঞান (GK)' ELSE s.name_bn END",
            "SELECT COUNT(*)",
        );
        let total: i64 = c.query_row(&count_sql, rusqlite::params_from_iter(args.clone()), |r| r.get(0))?;
        sql.push_str(" ORDER BY f.created_at DESC, f.id DESC LIMIT ? OFFSET ?");
        args.push(limit.into()); args.push(offset.into());
        let mut st = c.prepare(&sql)?;
        let mut out = vec![];
        for r in st.query_map(rusqlite::params_from_iter(args), |r| {
            let options: String = r.get(6)?;
            Ok(serde_json::json!({
                "id":r.get::<_,i64>(0)?, "question_id":r.get::<_,i64>(1)?,
                "origin":r.get::<_,String>(2)?, "issue_type":r.get::<_,String>(3)?,
                "reason":r.get::<_,String>(4)?, "prompt":r.get::<_,String>(5)?,
                "options":parse_opts(&options), "answer":r.get::<_,Option<i64>>(7)?,
                "explanation":r.get::<_,String>(8)?, "subject":r.get::<_,String>(9)?,
                "topic":r.get::<_,String>(10)?, "source":r.get::<_,String>(11)?,
                "status":r.get::<_,String>(12)?, "created_at":r.get::<_,String>(13)?,
                "expected_category_id":r.get::<_,Option<i64>>(14)?,
                "expected_category":r.get::<_,Option<String>>(15)?
            }))
        })? { out.push(r?); }
        let open: i64 = c.query_row("SELECT COUNT(*) FROM flagged.mcqs WHERE status='open'", [], |r| r.get(0))?;
        let fixed: i64 = c.query_row("SELECT COUNT(*) FROM flagged.mcqs WHERE status='fixed'", [], |r| r.get(0))?;
        Ok(serde_json::json!({"items":out,"total":total,"open":open,"fixed":fixed,"limit":limit,"offset":offset}))
    }).map_err(err)?;
    Ok(Json(rows))
}

pub async fn flagged_ids(State(p): State<AppState>) -> ApiResult<serde_json::Value> {
    let ids = p.with(|c| {
        let mut st = c.prepare("SELECT source_question_id FROM flagged.mcqs WHERE status='open'")?;
        let mut out = vec![];
        for r in st.query_map([], |r| r.get::<_,i64>(0))? { out.push(r?); }
        Ok(out)
    }).map_err(err)?;
    Ok(Json(serde_json::json!({"question_ids":ids})))
}

#[derive(Deserialize)]
pub struct FlagReq { question_id: i64, issue_type: Option<String> }

pub async fn flag_question(State(p): State<AppState>, Json(b): Json<FlagReq>) -> ApiResult<serde_json::Value> {
    if b.question_id <= 0 { return Err(bad("প্রশ্নটি চিহ্নিত করা যায়নি।")); }
    let issue = b.issue_type.unwrap_or_else(|| "needs_review".into());
    if issue.is_empty() || issue.len() > 64 || !issue.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
        return Err(bad("সমস্যার ধরনটি সঠিক নয়।"));
    }
    let added = p.with(|c| {
        c.execute("INSERT INTO flagged.mcqs
            (source_question_id,origin,issue_type,reason,prompt,options,answer,explanation,subject,topic,source,original_json,status)
            SELECT q.id,'user',?1,'',q.prompt,q.options,q.answer,q.explanation,s.name_bn,t.name,q.source,
                json_object('prompt',q.prompt,'options',q.options,'answer',q.answer,'explanation',q.explanation),'open'
            FROM main.questions q JOIN main.subjects s ON s.id=q.subject_id JOIN main.topics t ON t.id=q.topic_id
            WHERE q.id=?2
            ON CONFLICT(source_question_id) DO UPDATE SET status='open',updated_at=datetime('now')",
            params![issue,b.question_id])
    }).map_err(err)?;
    if added == 0 { return Err((axum::http::StatusCode::NOT_FOUND, "প্রশ্নটি পাওয়া যায়নি।".into())); }
    Ok(Json(serde_json::json!({"flagged":true,"question_id":b.question_id})))
}

#[derive(Deserialize)]
pub struct FlaggedUpdate {
    prompt: String, options: Vec<String>, answer: Option<usize>, issue_type: String,
    explanation: String, expected_category_id: Option<i64>,
}

pub async fn flagged_update(State(p): State<AppState>, Path(id): Path<i64>, Json(b): Json<FlaggedUpdate>) -> ApiResult<serde_json::Value> {
    let prompt = b.prompt.trim();
    if prompt.is_empty() || prompt.len() > 5000 || b.options.len() < 2 || b.options.len() > 8
        || b.options.iter().any(|o| o.trim().is_empty() || o.len() > 2000) || b.explanation.len() > 10000 {
        return Err(bad("প্রশ্ন ও অন্তত ২টি পূর্ণ অপশন দিতে হবে।"));
    }
    if b.answer.is_some_and(|a| a >= b.options.len()) { return Err(bad("সঠিক উত্তরের অপশনটি মিলছে না।")); }
    if b.issue_type.is_empty() || b.issue_type.len() > 64
        || !b.issue_type.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
        return Err(bad("সমস্যার ধরনটি সঠিক নয়।"));
    }
    let category_id = if b.issue_type == "wrong_category" {
        let Some(category_id) = b.expected_category_id else {
            return Err(bad("সঠিক ক্যাটাগরি বেছে নিন।"));
        };
        let exists = category_id == 0 || p.optional::<i64, _>("SELECT id FROM subjects WHERE id=?1", params![category_id])
            .map_err(err)?.is_some();
        if !exists { return Err(bad("সঠিক ক্যাটাগরিটি পাওয়া যায়নি।")); }
        Some(category_id)
    } else { b.expected_category_id };
    let options = serde_json::to_string(&b.options).map_err(err)?;
    let changed = p.with(|c| c.execute("UPDATE flagged.mcqs SET prompt=?1,options=?2,answer=?3,
        issue_type=?4,explanation=?5,expected_category_id=?6,updated_at=datetime('now') WHERE id=?7",
        params![prompt,options,b.answer.map(|a|a as i64),b.issue_type,b.explanation,category_id,id])).map_err(err)?;
    if changed == 0 { return Err((axum::http::StatusCode::NOT_FOUND, "Flagged MCQ পাওয়া যায়নি।".into())); }
    Ok(Json(serde_json::json!({"saved":true})))
}

pub async fn flagged_resolve(State(p): State<AppState>, Path(id): Path<i64>) -> ApiResult<serde_json::Value> {
    let changed = p.with(|c| c.execute("UPDATE flagged.mcqs SET status='fixed',updated_at=datetime('now') WHERE id=?1", params![id])).map_err(err)?;
    if changed == 0 { return Err((axum::http::StatusCode::NOT_FOUND, "Flagged MCQ পাওয়া যায়নি।".into())); }
    Ok(Json(serde_json::json!({"status":"fixed"})))
}

pub async fn flagged_remove(State(p): State<AppState>, Path(id): Path<i64>) -> ApiResult<serde_json::Value> {
    let removed = p.with(|c| c.execute("DELETE FROM flagged.mcqs WHERE source_question_id=?1 AND origin='user'", params![id])).map_err(err)?;
    Ok(Json(serde_json::json!({"flagged":false,"removed":removed > 0})))
}

pub async fn flagged_reopen(State(p): State<AppState>, Path(id): Path<i64>) -> ApiResult<serde_json::Value> {
    let changed = p.with(|c| c.execute("UPDATE flagged.mcqs SET status='open',updated_at=datetime('now') WHERE id=?1", params![id])).map_err(err)?;
    if changed == 0 { return Err((axum::http::StatusCode::NOT_FOUND, "Flagged MCQ পাওয়া যায়নি।".into())); }
    Ok(Json(serde_json::json!({"status":"open"})))
}

// ---------------------------------------------------------------- analytics
pub async fn analytics(State(p): State<AppState>, headers: HeaderMap, Query(q): Query<HashMap<String,String>>) -> ApiResult<serde_json::Value> {
    let uid = user_id(&p, &headers, &q)?;
    let rows = p.with(|c| {
        let mut st = c.prepare("SELECT s.id,s.name_bn,COUNT(a.question_id) AS n,SUM(a.is_correct) AS ok \
            FROM app_answers a JOIN app_exams e ON e.id=a.exam_id \
            JOIN questions q ON q.id=a.question_id JOIN subjects s ON s.id=q.subject_id \
            WHERE e.user_id=?1 AND a.selected IS NOT NULL GROUP BY s.id ORDER BY n DESC")?;
        let mut out = vec![];
        for r in st.query_map(params![uid], |r| {
            let n: i64 = r.get(2)?; let ok: i64 = r.get(3)?;
            Ok(serde_json::json!({"id":r.get::<_,i64>(0)?,"subject":r.get::<_,String>(1)?,
                "attempted":n,"correct":ok,"pct": if n>0 { (ok as f64/n as f64*100.0).round() } else { 0.0 }}))
        })? { out.push(r?); }
        Ok(out)
    }).map_err(err)?;
    let total_exams: i64 = p.with(|c| c.query_row("SELECT COUNT(*) FROM app_exams WHERE user_id=?1", params![uid], |r| r.get(0))).map_err(err)?;
    Ok(Json(serde_json::json!({"subjects": rows, "exams": total_exams})))
}

// ---------------------------------------------------------------- question of the day
pub async fn qotd(State(p): State<AppState>) -> ApiResult<serde_json::Value> {
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs() as i64 / 86400;
    let offset = (now * 7919) % 50000;
    let q = p.with(|c| {
        let sql = format!("SELECT q.id,q.prompt,q.options,s.name_bn,t.name FROM questions q \
            JOIN subjects s ON s.id=q.subject_id JOIN topics t ON t.id=q.topic_id \
            WHERE {ACTIVE} ORDER BY q.id LIMIT 1 OFFSET ?1");
        c.query_row(&sql, params![offset], |r| Ok(serde_json::json!({
            "id":r.get::<_,i64>(0)?,"prompt":r.get::<_,String>(1)?,"options":parse_opts(&r.get::<_,String>(2)?),
            "subject":r.get::<_,String>(3)?,"topic":r.get::<_,String>(4)? })))
    }).map_err(err)?;
    Ok(Json(q))
}

/// Create a 1-question exam around a specific question (quick practice).
pub async fn exam_single(State(p): State<AppState>, Path(qid): Path<i64>, headers: HeaderMap, Query(qp): Query<HashMap<String,String>>) -> ApiResult<ExamStart> {
    let uid = user_id(&p, &headers, &qp)?;
    let qs = p.with(|c| {
        let mut st = c.prepare("SELECT q.id,q.subject_id,q.topic_id,s.name_bn,t.name,q.options,q.prompt,q.explanation,q.source \
            FROM questions q JOIN subjects s ON s.id=q.subject_id JOIN topics t ON t.id=q.topic_id WHERE q.id=?1")?;
        let mut v = vec![];
        for r in st.query_map(params![qid], row_question)? { v.push(r?); }
        Ok(v)
    }).map_err(err)?;
    let ids_json = serde_json::to_string(&vec![qid]).unwrap();
    let exam_id = p.with(|c| {
        c.execute("INSERT INTO app_exams(user_id,mode,title,subject_ids,topic_ids,question_ids,n,duration_secs,negative_mark) \
            VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            params![uid, "practice", "একক প্রশ্ন", "[]", "[]", ids_json, 1, 120, 0.0])?;
        Ok(c.last_insert_rowid())
    }).map_err(err)?;
    Ok(Json(ExamStart { exam_id, questions: qs, duration_secs: 120, negative: 0.0 }))
}

// ---------------------------------------------------------------- BCS blueprint mock
#[derive(Deserialize)]
pub struct BlueprintReq {
    #[serde(default)] token: String,
    #[serde(default)] n: Option<usize>,
    #[serde(default)] duration_min: Option<i64>,
}
pub async fn exam_blueprint(State(p): State<AppState>, Json(b): Json<BlueprintReq>) -> ApiResult<ExamStart> {
    let uid = if b.token.is_empty() { 0 } else {
        p.optional::<i64, _>("SELECT user_id FROM app_sessions WHERE token=?1", params![b.token]).map_err(err)?.unwrap_or(0)
    };
    // BCS preliminary blueprint weights (%) per subject id 1..10
    const W: [(i64, f64); 10] = [(1,7.5),(2,7.5),(3,17.5),(4,17.5),(5,15.0),(6,10.0),(7,7.5),(8,7.5),(9,5.0),(10,5.0)];
    let total = b.n.unwrap_or(100).min(200);
    let mut picked: Vec<i64> = vec![];
    for (sid, w) in W {
        let want = ((total as f64 * w / 100.0).round() as usize).max(1);
        let sql = format!("SELECT q.id FROM questions q WHERE q.subject_id=?1 AND {ACTIVE} ORDER BY RANDOM() LIMIT ?2");
        let got = p.with(|c| {
            let mut st = c.prepare(&sql)?;
            let mut v = vec![];
            for r in st.query_map(params![sid, want as i64], |r| r.get::<_,i64>(0))? { v.push(r?); }
            Ok(v)
        }).map_err(err)?;
        picked.extend(got);
    }
    // fill shortfall from any subject
    if picked.len() < total {
        let need = total - picked.len();
        let sql = format!("SELECT q.id FROM questions q WHERE {ACTIVE} AND q.id NOT IN ({}) ORDER BY RANDOM() LIMIT ?1",
            if picked.is_empty() { "0".to_string() } else { picked.iter().map(|x| x.to_string()).collect::<Vec<_>>().join(",") });
        let extra = p.with(|c| {
            let mut st = c.prepare(&sql)?; let mut v = vec![];
            for r in st.query_map(params![need as i64], |r| r.get::<_,i64>(0))? { v.push(r?); }
            Ok(v)
        }).map_err(err)?;
        picked.extend(extra);
    }
    picked.truncate(total);
    let ids_json = serde_json::to_string(&picked).unwrap();
    let dur = b.duration_min.unwrap_or(120) * 60;
    let exam_id = p.with(|c| {
        c.execute("INSERT INTO app_exams(user_id,mode,title,subject_ids,topic_ids,question_ids,n,duration_secs,negative_mark) \
            VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            params![uid, "blueprint", "বিসিএস ব্লুপ্রিন্ট মক টেস্ট", "[]", "[]", ids_json, total as i64, dur, 0.5])?;
        Ok(c.last_insert_rowid())
    }).map_err(err)?;
    let ph = vec!["?"; picked.len()].join(",");
    let sql = format!("SELECT q.id,q.subject_id,q.topic_id,s.name_bn,t.name,q.options,q.prompt,q.explanation,q.source \
        FROM questions q JOIN subjects s ON s.id=q.subject_id JOIN topics t ON t.id=q.topic_id \
        WHERE q.id IN ({ph})");
    let mut questions = p.with(|c| {
        let mut st = c.prepare(&sql)?; let mut v = vec![];
        for r in st.query_map(rusqlite::params_from_iter(picked.iter().copied()), row_question)? { v.push(r?); }
        Ok(v)
    }).map_err(err)?;
    // preserve blueprint order
    questions.sort_by_key(|q| picked.iter().position(|&x| x == q.id).unwrap_or(usize::MAX));
    Ok(Json(ExamStart { exam_id, questions, duration_secs: dur, negative: 0.5 }))
}
