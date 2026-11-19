use serde::Serialize;

#[derive(Serialize, Clone)]
pub struct Subject { pub id: i64, pub slug: String, pub name_bn: String, pub name_en: String, pub count: i64 }
#[derive(Serialize, Clone)]
pub struct Topic { pub id: i64, pub subject_id: i64, pub name: String, pub count: i64 }
#[derive(Serialize, Clone)]
pub struct Question {
    pub id: i64,
    pub subject_id: i64,
    pub topic_id: i64,
    pub subject_bn: String,
    pub topic_name: String,
    pub prompt: String,
    pub options: Vec<String>,
    /// Whether a book explanation exists (never leak before answering).
    pub has_explanation: bool,
    pub source: String,
}
#[derive(Serialize, Clone)]
pub struct QuestionFull {
    pub id: i64,
    pub subject_id: i64,
    pub topic_id: i64,
    pub prompt: String,
    pub options: Vec<String>,
    pub answer: usize,
    pub explanation: String,
    pub topic_name: String,
    pub subject_bn: String,
}
