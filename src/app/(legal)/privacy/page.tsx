import { LegalPage, Todo } from "@/components/Legal";

export const metadata = { title: "Kebijakan Privasi — Toko Kuota" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Kebijakan Privasi" updated="[tanggal]">
      <section><h2>1. Data yang kami simpan</h2>
        <ul>
          <li>Akun: email, nama (opsional), dan status akun. Password dikelola oleh layanan autentikasi dan tidak kami simpan dalam bentuk terbaca.</li>
          <li>Transaksi: produk, nomor/ID tujuan, harga, status, dan waktu.</li>
          <li>Saldo: riwayat mutasi (top-up, pembelian, pengembalian) dan permintaan top-up.</li>
          <li>Keamanan: alamat IP dan email dipakai untuk membatasi percobaan berulang, dan hanya disimpan dalam bentuk hash.</li>
        </ul></section>
      <section><h2>2. Tujuan penggunaan</h2>
        <p>Menjalankan akun dan transaksi, mencatat saldo, mencegah penyalahgunaan, dan membantu pengguna saat ada kendala.</p></section>
      <section><h2>3. Pihak ketiga</h2>
        <ul>
          <li>Penyedia basis data dan autentikasi (Supabase) dan hosting (Vercel).</li>
          <li>Penyedia produk (KhfyPay) menerima kode produk dan nomor/ID tujuan untuk memproses pesanan.</li>
          <li>Layanan pengiriman email dan layanan pendeteksi transfer bank: <Todo>isi setelah dipilih</Todo>.</li>
        </ul>
        <p>Kami tidak menjual data pengguna.</p></section>
      <section><h2>4. Cookie</h2><p>Hanya cookie sesi masuk yang diperlukan agar akun tetap login. Tidak ada cookie iklan.</p></section>
      <section><h2>5. Penyimpanan dan hak pengguna</h2>
        <p>Lama penyimpanan data: <Todo>isi</Todo>. Untuk meminta akses, perbaikan, atau penghapusan data, hubungi <Todo>isi kontak</Todo>. Catatan transaksi dan saldo dapat tetap disimpan sesuai kewajiban pencatatan.</p></section>
      <section><h2>6. Perubahan</h2><p>Kebijakan ini dapat berubah, dan perubahan diumumkan di situs.</p></section>
    </LegalPage>
  );
}
