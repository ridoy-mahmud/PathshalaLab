//! Lightweight SQLite connection pool (round-robin) + prepared-query helpers.
use rusqlite::{Connection, OptionalExtension, params};
use std::path::Path;
use std::sync::{Arc, Mutex, atomic::{AtomicUsize, Ordering}};
use std::time::Duration;

pub struct Pool {
    conns: Vec<Mutex<Connection>>,
    next: AtomicUsize,
}

impl Pool {
    pub fn open(path: &Path, n: usize) -> rusqlite::Result<Arc<Self>> {
        let mut conns = Vec::with_capacity(n);
        let flagged_path = path.parent().unwrap_or_else(|| Path::new("."))
            .join("flagged_mcqs.db");
        for _ in 0..n {
            let c = Connection::open(path)?;
            c.execute("ATTACH DATABASE ?1 AS flagged", params![flagged_path.to_string_lossy().as_ref()])?;
            c.execute_batch("PRAGMA flagged.journal_mode=WAL;")?;
            if conns.is_empty() {
                c.execute_batch("\
                    CREATE TABLE IF NOT EXISTS flagged.mcqs (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        source_question_id INTEGER NOT NULL UNIQUE,
                        origin TEXT NOT NULL DEFAULT 'user',
                        issue_type TEXT NOT NULL DEFAULT 'needs_review',
                        reason TEXT NOT NULL DEFAULT '',
                        prompt TEXT NOT NULL,
                        options TEXT NOT NULL DEFAULT '[]',
                        answer INTEGER,
                        explanation TEXT NOT NULL DEFAULT '',
                        subject TEXT NOT NULL DEFAULT '',
                        topic TEXT NOT NULL DEFAULT '',
                        source TEXT NOT NULL DEFAULT '',
                        original_json TEXT NOT NULL DEFAULT '{}',
                        status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','fixed')),
                        created_at TEXT NOT NULL DEFAULT (datetime('now')),
                        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
                    );
                    CREATE INDEX IF NOT EXISTS flagged.idx_mcqs_status_created
                        ON mcqs(status, created_at DESC);
                    INSERT OR IGNORE INTO flagged.mcqs
                        (source_question_id,origin,issue_type,reason,prompt,options,answer,
                         explanation,subject,topic,source,original_json,status,created_at)
                    SELECT x.question_id,'quarantine',x.reason,COALESCE(x.detail,''),
                        COALESCE(q.prompt,json_extract(x.raw_json,'$.prompt'),''),
                        COALESCE(q.options,json_extract(x.raw_json,'$.options'),'[]'),
                        q.answer,COALESCE(q.explanation,''),COALESCE(s.name_bn,''),
                        COALESCE(t.name,''),COALESCE(q.source,''),x.raw_json,'open',
                        COALESCE(x.created_at,datetime('now'))
                    FROM main.quarantine x
                    LEFT JOIN main.questions q ON q.id=x.question_id
                    LEFT JOIN main.subjects s ON s.id=q.subject_id
                    LEFT JOIN main.topics t ON t.id=q.topic_id;
                ")?;
                let has_expected_category: bool = c.query_row(
                    "SELECT EXISTS(SELECT 1 FROM flagged.pragma_table_info('mcqs') WHERE name='expected_category_id')",
                    [], |r| r.get(0),
                )?;
                if !has_expected_category {
                    c.execute("ALTER TABLE flagged.mcqs ADD COLUMN expected_category_id INTEGER", [])?;
                }
            }
            c.busy_timeout(Duration::from_secs(5))?;
            c.pragma_update(None, "journal_mode", "WAL")?;
            c.pragma_update(None, "synchronous", "NORMAL")?;
            c.pragma_update(None, "cache_size", -64000)?; // 64 MB per conn
            c.pragma_update(None, "temp_store", "MEMORY")?;
            conns.push(Mutex::new(c));
        }
        Ok(Arc::new(Self { conns, next: AtomicUsize::new(0) }))
    }

    pub fn with<F, T>(&self, f: F) -> rusqlite::Result<T>
    where F: FnOnce(&Connection) -> rusqlite::Result<T> {
        let i = self.next.fetch_add(1, Ordering::Relaxed) % self.conns.len();
        let guard = self.conns[i].lock().unwrap();
        f(&guard)
    }

    pub fn optional<T, P>(&self, sql: &str, p: P) -> rusqlite::Result<Option<T>>
    where T: rusqlite::types::FromSql, P: rusqlite::Params {
        self.with(|c| c.query_row(sql, p, |r| r.get::<_, T>(0)).optional())
    }
}

/// Active-question filter shared by all queries.
pub const ACTIVE: &str = "(q.canonical_id IS NULL OR q.canonical_id = q.id) AND q.id NOT IN (SELECT question_id FROM quarantine)";
