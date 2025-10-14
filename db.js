import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

const MOCK_IMAGE_FOLDER = path.resolve("mock_images");

const db = new Database("chat_history_ex6.db");
db.pragma("journal_mode = WAL");

db.prepare(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  student_id TEXT NOT NULL,
  group_number TEXT NOT NULL,
  member TEXT NOT NULL,
  consent TEXT NOT NULL,
  UNIQUE(group_number, member)
)
`).run();

db.prepare(`
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT,
  image BLOB,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id)
)
`).run();

db.prepare(`
CREATE TABLE IF NOT EXISTS mock_responses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  image BLOB NOT NULL
)
`).run();

if (fs.existsSync(MOCK_IMAGE_FOLDER)) {
  const files = fs.readdirSync(MOCK_IMAGE_FOLDER)
    .filter(file => /\.(png|jpg|jpeg|gif)$/i.test(file));

  const existingCount = db.prepare("SELECT COUNT(*) as count FROM mock_responses").get().count;
  if (existingCount === 0 && files.length > 0) {
    const insert = db.prepare("INSERT INTO mock_responses (image) VALUES (?)");
    const insertMany = db.transaction((imageFiles) => {
      for (const file of imageFiles) {
        const imagePath = path.join(MOCK_IMAGE_FOLDER, file);
        const imageBuffer = fs.readFileSync(imagePath);
        insert.run(imageBuffer);
      }
    });
    insertMany(files);
    console.log(`Loaded ${files.length} mock images from folder.`);
  } else {
    console.log("Mock responses table already populated.");
  }
} else {
  console.warn("No mock_images folder found.");
}

export default db;