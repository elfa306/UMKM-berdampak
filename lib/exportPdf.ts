/**
 * Cetak tampilan dasbor menjadi PDF (A4) untuk diserahkan ke bank.
 * Elemen dengan atribut data-html2canvas-ignore (tombol, navigasi) tidak ikut tercetak.
 */
export async function exportPdf(el: HTMLElement, namaFile: string, judul: string) {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
  const canvas = await html2canvas(el, {
    scale: 2, backgroundColor: '#f8fafc', useCORS: true, logging: false,
    onclone: (doc) => {
      // html2canvas tidak mendukung backdrop-filter/animasi: pastikan hasilnya bersih
      doc.querySelectorAll<HTMLElement>('*').forEach((n) => { n.style.animation = 'none'; n.style.transition = 'none'; });
    },
  });
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const W = pdf.internal.pageSize.getWidth(), H = pdf.internal.pageSize.getHeight();
  const m = 10, top = 18;
  const imgW = W - m * 2;
  const imgH = (canvas.height * imgW) / canvas.width;
  const areaH = H - top - m;
  const tanggal = new Date().toLocaleDateString('id-ID', { dateStyle: 'long', timeZone: 'Asia/Jakarta' });

  let sisa = imgH, y = 0, hal = 0;
  while (sisa > 0.5) {
    if (hal > 0) pdf.addPage();
    // potong kanvas per halaman agar tidak terpotong di tengah
    const pxPerMm = canvas.height / imgH;
    const sliceH = Math.min(areaH, sisa);
    const part = document.createElement('canvas');
    part.width = canvas.width;
    part.height = Math.max(1, Math.round(sliceH * pxPerMm));
    part.getContext('2d')!.drawImage(canvas, 0, Math.round(y * pxPerMm), canvas.width, part.height, 0, 0, canvas.width, part.height);
    pdf.setFontSize(12); pdf.setTextColor(15, 23, 42); pdf.text(judul, m, 11);
    pdf.setFontSize(8); pdf.setTextColor(100, 116, 139); pdf.text(`Dicetak ${tanggal} · UMKM Kasir`, m, 15.5);
    pdf.addImage(part.toDataURL('image/jpeg', 0.92), 'JPEG', m, top, imgW, sliceH);
    y += sliceH; sisa -= sliceH; hal++;
  }
  pdf.save(namaFile);
}
