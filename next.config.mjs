// Halaman Produksi & HPP dan Pembukuan & Akuntansi sudah dihapus; arahkan tautan lama ke menu Lainnya.
export default {
  async redirects() {
    return [
      { source: '/produksi', destination: '/lainnya', permanent: false },
      { source: '/akuntansi', destination: '/lainnya', permanent: false },
    ];
  },
};
