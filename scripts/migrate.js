
console.log("Print migration SQL:");
const fs = require('fs');
console.log(fs.readFileSync('./supabase/migrations/001_init.sql','utf8'));
