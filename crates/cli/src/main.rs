use anyhow::{bail, Result};
use clap::{Parser, Subcommand};
use icehandnote_core::auth::UserRole;
use icehandnote_db::{content_loader::load_content_directory, PostgresRepository, TutorialRepository};
use sqlx::{postgres::PgPoolOptions, Row};
use std::{env, path::PathBuf, time::Duration};
use uuid::Uuid;

#[derive(Parser)]
#[command(
    name = "icehandnote-cli",
    about = "IceHandNote Markdown 笔记校验与 PostgreSQL 同步工具"
)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// 静态校验指定目录下的所有多语言笔记 Markdown、Frontmatter、提示框与图表语法
    Validate {
        #[arg(default_value = "./content")]
        dir: PathBuf,
    },
    /// 只读检查 PostgreSQL 连接、版本、权限、可用扩展与现有数据表（不写入任何数据）
    DbCheck {
        #[arg(long)]
        database_url: Option<String>,
    },
    /// 将本地 Git 管理的笔记文章同步写入 PostgreSQL 17 数据库
    Sync {
        #[arg(default_value = "./content")]
        dir: PathBuf,
        #[arg(long)]
        database_url: Option<String>,
    },
    /// 在 PostgreSQL 创建或重置一个本站账号（默认角色为 admin）
    CreateAdmin {
        #[arg(long)]
        username: String,
        #[arg(long)]
        email: String,
        #[arg(long)]
        display_name: Option<String>,
        /// reader | author | admin
        #[arg(long, default_value = "admin")]
        role: String,
        /// 不提供时依次读取 ADMIN_PASSWORD / ICETOWNE_ADMIN_PASSWORD，仍无则自动生成高强度随机密码并只显示一次
        #[arg(long)]
        password: Option<String>,
        #[arg(long)]
        database_url: Option<String>,
    },
}

fn resolve_db_url(cli_value: Option<String>) -> Result<String> {
    let db_url = cli_value
        .or_else(|| env::var("DATABASE_URL").ok())
        .unwrap_or_default();
    if db_url.trim().is_empty() {
        bail!("請透過 --database-url、環境變數或 .env 中的 DATABASE_URL 提供 PostgreSQL 連線字串");
    }
    Ok(db_url)
}

#[tokio::main]
async fn main() -> Result<()> {
    // Load `.env` from the current directory or any parent directory
    let _ = dotenvy::dotenv();
    tracing_subscriber::fmt::init();
    let cli = Cli::parse();

    match cli.command {
        Commands::Validate { dir } => {
            let bundle = load_content_directory(&dir)?;
            let mut total_steps = 0usize;
            let mut total_docs = 0usize;

            for t in &bundle.tracks {
                println!(
                    "❄ Track [{}] ({} chapters)",
                    t.manifest.slug,
                    t.chapters.len()
                );
                for c in &t.chapters {
                    for s in &c.steps {
                        total_steps += 1;
                        total_docs += s.translations.len();
                        let locales: Vec<_> = s.translations.keys().cloned().collect();
                        println!(
                            "  ✓ {}/{} (rev v{}, locales: {})",
                            c.slug,
                            s.slug,
                            s.canonical_revision,
                            locales.join(", ")
                        );
                    }
                }
            }
            println!(
                "\n校验通过！共 {} 个专题、{} 篇文章、{} 份多语言文档。",
                bundle.tracks.len(),
                total_steps,
                total_docs
            );
        }
        Commands::DbCheck { database_url } => {
            let db_url = resolve_db_url(database_url)?;
            let pool = PgPoolOptions::new()
                .max_connections(1)
                .acquire_timeout(Duration::from_secs(10))
                .connect(&db_url)
                .await?;

            let row = sqlx::query(
                "SELECT version() AS v, current_user AS u, current_database() AS d, \
                 (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS su, \
                 has_database_privilege(current_database(), 'CREATE') AS can_create",
            )
            .fetch_one(&pool)
            .await?;
            let version: String = row.try_get("v")?;
            let user: String = row.try_get("u")?;
            let dbname: String = row.try_get("d")?;
            let su: bool = row.try_get("su")?;
            let can_create: bool = row.try_get("can_create")?;
            println!("✓ 連線成功");
            println!("  伺服器版本：{version}");
            println!("  資料庫：{dbname}　連線用戶：{user}　superuser：{su}　CREATE 權限：{can_create}");

            let ext_rows = sqlx::query(
                "SELECT a.name, a.default_version, e.extversion AS installed \
                 FROM pg_available_extensions a LEFT JOIN pg_extension e ON e.extname = a.name \
                 WHERE a.name IN ('pgcrypto', 'pg_trgm', 'pgroonga') ORDER BY a.name",
            )
            .fetch_all(&pool)
            .await?;
            println!("  擴充套件：");
            for name in ["pgcrypto", "pg_trgm", "pgroonga"] {
                let found = ext_rows
                    .iter()
                    .find(|r| r.try_get::<String, _>("name").ok().as_deref() == Some(name));
                match found {
                    Some(r) => {
                        let installed: Option<String> = r.try_get("installed").ok().flatten();
                        match installed {
                            Some(v) => println!("    - {name}: 已安裝 (v{v})"),
                            None => println!("    - {name}: 可安裝（尚未啟用）"),
                        }
                    }
                    None => println!("    - {name}: 伺服器不提供"),
                }
            }

            let table_rows = sqlx::query(
                "SELECT table_name, \
                 (xpath('/row/c/text()', query_to_xml(format('SELECT COUNT(*) AS c FROM public.%I', table_name), false, true, '')))[1]::text::bigint AS rows \
                 FROM information_schema.tables \
                 WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name",
            )
            .fetch_all(&pool)
            .await?;
            if table_rows.is_empty() {
                println!("  public schema：空（尚無任何資料表）");
            } else {
                println!("  public schema 既有資料表：");
                for r in table_rows {
                    let name: String = r.try_get("table_name")?;
                    let rows: i64 = r.try_get("rows").unwrap_or(-1);
                    println!("    - {name}（{rows} 筆）");
                }
            }
        }
        Commands::Sync { dir, database_url } => {
            let db_url = resolve_db_url(database_url)?;
            let bundle = load_content_directory(&dir)?;
            let seed_demo = env::var("SEED_DEMO_USERS")
                .map(|v| v == "true" || v == "1")
                .unwrap_or(false);
            let repo = PostgresRepository::connect_and_migrate(&db_url, seed_demo).await?;
            let count = repo.sync_bundle(&bundle).await?;
            println!("✓ 成功同步 {count} 份多语言文章至 PostgreSQL！");
        }
        Commands::CreateAdmin {
            username,
            email,
            display_name,
            role,
            password,
            database_url,
        } => {
            let db_url = resolve_db_url(database_url)?;
            let role = match role.to_ascii_lowercase().as_str() {
                "admin" => UserRole::Admin,
                "author" => UserRole::Author,
                "reader" => UserRole::Reader,
                other => bail!("未知角色：{other}（可用 reader / author / admin）"),
            };
            let (password, generated) = match password
                .or_else(|| env::var("ADMIN_PASSWORD").ok())
                .or_else(|| env::var("ICETOWNE_ADMIN_PASSWORD").ok())
                .filter(|p| !p.is_empty())
            {
                Some(p) => {
                    if p.chars().count() < 12 {
                        bail!("密码至少需 12 个字符");
                    }
                    (p, false)
                }
                None => {
                    let raw = Uuid::new_v4().simple().to_string();
                    (format!("sn-{}-{}", &raw[..10], &raw[10..20]), true)
                }
            };

            let repo = PostgresRepository::connect_and_migrate(&db_url, false).await?;
            let user = repo
                .upsert_local_account(
                    username.trim(),
                    display_name.as_deref().unwrap_or(username.trim()),
                    email.trim(),
                    role,
                    &password,
                )
                .await?;
            println!(
                "✓ 已建立/更新帳號 @{}（角色：{}，ID：{}）",
                user.username,
                user.role.as_str(),
                user.id
            );
            if generated {
                println!("  自動產生的密碼（只顯示這一次，請立即妥善保存）：{password}");
            }
        }
    }

    Ok(())
}
