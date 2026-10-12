import { LegalPage, Todo } from "@/components/Legal";

export const metadata = { title: "Syarat & Ketentuan — Toko Kuota" };

export default function TermsPage() {
  return (
    <LegalPage title="Syarat & Ketentuan" updated="[tanggal]">
      <section><h2>1. Layanan</h2>
        <p>Toko Kuota (Raja Kuota) menyediakan pembelian kuota, pulsa, dan produk digital lain menggunakan saldo akun. Produk dipenuhi oleh penyedia pihak ketiga.</p></section>
      <section><h2>2. Akun</h2>
        <ul>
          <li>Data pendaftaran harus benar, dan kamu bertanggung jawab menjaga kerahasiaan password.</li>
          <li>Akun yang dipakai untuk penyalahgunaan atau kecurangan dapat dinonaktifkan.</li>
        </ul></section>
      <section><h2>3. Saldo dan top-up</h2>
        <ul>
          <li>Top-up dilakukan dengan transfer bank ke rekening yang tampil di halaman instruksi, dengan <strong>nominal unik yang harus sama persis</strong>. Saldo yang masuk sama dengan nominal yang ditransfer.</li>
          <li>Permintaan top-up berlaku sampai batas waktu yang tertera (saat ini <Todo>24 jam: konfirmasi</Todo>).</li>
          <li>Transfer dengan nominal berbeda, di luar batas waktu, atau tanpa permintaan tidak masuk otomatis. Hubungi admin dengan bukti transfer untuk pengecekan.</li>
          <li>Biaya layanan top-up untuk pengguna: <Todo>konfirmasi: tidak ada</Todo>.</li>
          <li>Penarikan atau pengembalian saldo tunai: <Todo>isi kebijakan</Todo>.</li>
        </ul></section>
      <section><h2>4. Transaksi</h2>
        <ul>
          <li>Harga yang berlaku adalah harga saat pesanan dibuat. Saldo dipotong saat pesanan dibuat.</li>
          <li>Status transaksi: <em>Diproses</em>, <em>Berhasil</em>, atau <em>Gagal</em>. Jika transaksi <em>Gagal</em>, saldo yang terpotong dikembalikan penuh.</li>
          <li>Transaksi berstatus <em>Diproses</em> dapat memerlukan waktu. Perkiraan batas waktu: <Todo>isi</Todo>.</li>
          <li>Kesalahan nomor/ID tujuan yang diisi pembeli: <Todo>isi kebijakan</Todo>.</li>
        </ul></section>
      <section><h2>5. Larangan</h2>
        <p>Dilarang menyalahgunakan layanan, mencoba mengakses data pengguna lain, mengganggu sistem, atau memanipulasi saldo dan transaksi.</p></section>
      <section><h2>6. Batasan tanggung jawab</h2><p><Todo>isi dan tinjau bersama ahli hukum</Todo></p></section>
      <section><h2>7. Perubahan dan kontak</h2>
        <p>Ketentuan dapat berubah, dan perubahan diumumkan di situs. Kontak bantuan: <Todo>isi kontak</Todo>.</p></section>
    </LegalPage>
  );
}
