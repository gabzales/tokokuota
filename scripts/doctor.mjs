#!/usr/bin/env node
// Preflight check. Prints OK / problem + how to fix. NEVER prints the value of any variable.
//   npm run doctor        full check (Node, install, .env.local)
//   (runs in --quick mode automatically before `npm run dev`: only Node + install, never blocks on .env)
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { platform, versions } from "node:process";

const quick = process.argv.includes("--quick");
const root = process.cwd();
const win = platform === "win32";
let failed = false;
const ok = (m) => console.log(`  OK    ${m}`);
const bad = (m, fix) => { failed = true; console.log(`  GAGAL ${m}\n        -> ${fix}`); };
const warn = (m, fix) => console.log(`  CEK   ${m}${fix ? `\n        -> ${fix}` : ""}`);

console.log("\nToko Kuota: pengecekan awal\n");

// 1. Node version
const major = Number(versions.node.split(".")[0]);
if (major >= 20) ok(`Node.js ${versions.node}`);
else bad(`Node.js ${versions.node} terlalu lama (butuh minimal 20, disarankan 22)`, "Install Node.js 22 LTS dari https://nodejs.org lalu buka terminal baru, cek dengan: node -v");

// 2. project folder + dependencies
if (!existsSync(join(root, "package.json"))) bad("Tidak ada package.json di folder ini", "Masuk dulu ke folder project (yang berisi package.json): cd toko-kuota");
else if (!existsSync(join(root, "node_modules", "next", "package.json"))) {
  bad("Paket 'next' belum terpasang (folder node_modules tidak ada / tidak lengkap)", "Jalankan: npm install   (di folder yang berisi package.json). Kalau sebelumnya error, hapus folder node_modules lalu ulangi.");
} else ok("Dependency terpasang (next ada)");

// 3. .env.local
const envPath = join(root, ".env.local");
const copyCmd = win ? "copy .env.example .env.local   (CMD)  atau  Copy-Item .env.example .env.local   (PowerShell)" : "cp .env.example .env.local";
if (!existsSync(envPath)) {
  if (quick) warn("File .env.local belum ada (halaman depan tetap jalan, login/admin belum bisa)", copyCmd);
  else bad("File .env.local belum ada", `${copyCmd}  lalu isi nilainya. Penjelasan tiap variabel: docs/08-ENV.md`);
} else if (!quick) {
  const vars = {};
  for (const raw of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i > 0) vars[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  const isUrl = (v) => { try { return /^https?:$/.test(new URL(v).protocol); } catch { return false; } };
  const required = [
    ["NEXT_PUBLIC_SUPABASE_URL", (v) => isUrl(v), "Alamat project Supabase, bentuknya https://xxxx.supabase.co"],
    ["NEXT_PUBLIC_SUPABASE_ANON_KEY", (v) => v.length >= 20, "Kunci 'anon' / 'publishable' dari Supabase > Project Settings > API"],
    ["SUPABASE_SERVICE_ROLE_KEY", (v) => v.length >= 20, "Kunci 'service_role' / 'secret' dari Supabase > Project Settings > API (RAHASIA)"],
    ["WEBHOOK_SECRET", (v) => v.length >= 24, "Karangan sendiri, minimal 24 karakter acak (lihat docs/08-ENV.md cara membuatnya)"],
    ["CRON_SECRET", (v) => v.length >= 16, "Karangan sendiri, minimal 16 karakter acak"],
  ];
  console.log("\n  Variabel wajib sekarang (isinya tidak ditampilkan):");
  for (const [k, valid, hint] of required) {
    if (!vars[k]) bad(`${k} kosong / tidak ada`, hint);
    else if (!valid(vars[k])) bad(`${k} formatnya belum benar`, hint);
    else ok(k);
  }
  if (Object.keys(vars).some((k) => /^NEXT_PUBLIC_.*(SERVICE|SECRET)/i.test(k))) {
    bad("Ada variabel rahasia yang berawalan NEXT_PUBLIC_ (akan terlihat publik di browser!)", "Hapus awalan NEXT_PUBLIC_ dari kunci service_role / secret");
  }
  if (vars.KHFYPAY_API_KEY || vars.KHFYPAY_BASE_URL) warn("KHFYPAY_* sudah diisi", "Biarkan kosong sampai Tahap 2B selesai: kalau diisi, pembelian akan benar-benar dikirim ke provider.");
  else ok("KHFYPAY_* kosong (benar untuk sekarang)");
}

console.log(failed ? "\nAda yang perlu diperbaiki di atas.\n" : "\nSemua siap.\n");
process.exit(failed ? 1 : 0);
