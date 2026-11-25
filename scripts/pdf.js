/* ---- js/pdf.js ---- */
/**
 * CLUB.pdf —— 极简 PDF 生成（零依赖）
 * 只支持「一页一张 JPEG」的场景：页面内容由上层用 canvas 画好（中文、图片、排版都在 canvas 里），
 * 这里负责按 PDF 1.4 规范打包：Catalog / Pages / Page / Image(DCTDecode) / Content。
 * 纯逻辑、无 DOM，可在 Node 中单测。
 */
(function (global) {
  'use strict';

  var A4_W = 595.28;  // 210mm @ 72dpi
  var A4_H = 841.89;  // 297mm @ 72dpi

  function pad10(n) {
    var s = String(n);
    while (s.length < 10) s = '0' + s;
    return s;
  }

  function concat(chunks) {
    var total = 0;
    var i;
    for (i = 0; i < chunks.length; i++) total += chunks[i].length;
    var out = new Uint8Array(total);
    var offset = 0;
    for (i = 0; i < chunks.length; i++) {
      out.set(chunks[i], offset);
      offset += chunks[i].length;
    }
    return out;
  }

  /**
   * 生成 PDF。
   * @param {Array<{data: Uint8Array, width: number, height: number}>} pages 每页一张 JPEG
   * @param {{title?: string}} [opts]
   * @returns {Blob} application/pdf
   */
  function fromJpegPages(pages, opts) {
    var list = Array.isArray(pages) ? pages.filter(function (p) {
      return p && p.data && p.data.length && p.width > 0 && p.height > 0;
    }) : [];
    if (!list.length) throw new Error('PDF 至少需要一页内容');

    var chunks = [];
    var pos = 0;
    var offsets = {};
    var encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;

    function pushStr(str) {
      var bytes = encoder ? encoder.encode(str) : null;
      if (!bytes) {
        bytes = new Uint8Array(str.length);
        for (var i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i) & 0xff;
      }
      chunks.push(bytes);
      pos += bytes.length;
    }
    function pushBytes(bytes) {
      chunks.push(bytes);
      pos += bytes.length;
    }
    function beginObj(num) {
      offsets[num] = pos;
      pushStr(num + ' 0 obj\n');
    }
    function endObj() { pushStr('\nendobj\n'); }

    // 文件头：第二行带二进制标记，避免被当成纯文本
    pushStr('%PDF-1.4\n');
    pushBytes(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

    var count = list.length;
    var pageId = function (i) { return 3 + i * 3; };
    var imgId = function (i) { return 4 + i * 3; };
    var contentId = function (i) { return 5 + i * 3; };

    // 1 Catalog
    beginObj(1);
    pushStr('<< /Type /Catalog /Pages 2 0 R >>');
    endObj();

    // 2 Pages
    var kids = [];
    for (var k = 0; k < count; k++) kids.push(pageId(k) + ' 0 R');
    beginObj(2);
    pushStr('<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + count + ' >>');
    endObj();

    // 每页：Page + Image + Content
    for (var p = 0; p < count; p++) {
      var page = list[p];
      beginObj(pageId(p));
      pushStr('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + A4_W + ' ' + A4_H + '] ' +
        '/Resources << /XObject << /Im0 ' + imgId(p) + ' 0 R >> /ProcSet [/PDF /ImageC] >> ' +
        '/Contents ' + contentId(p) + ' 0 R >>');
      endObj();

      beginObj(imgId(p));
      pushStr('<< /Type /XObject /Subtype /Image /Width ' + Math.round(page.width) +
        ' /Height ' + Math.round(page.height) + ' /ColorSpace /DeviceRGB ' +
        '/BitsPerComponent 8 /Filter /DCTDecode /Length ' + page.data.length + ' >>\nstream\n');
      pushBytes(page.data);
      pushStr('\nendstream');
      endObj();

      var content = 'q\n' + A4_W + ' 0 0 ' + A4_H + ' 0 0 cm\n/Im0 Do\nQ\n';
      beginObj(contentId(p));
      pushStr('<< /Length ' + content.length + ' >>\nstream\n' + content + 'endstream');
      endObj();
    }

    var xrefOffset = pos;
    var totalObjs = 2 + count * 3 + 1;
    var xref = 'xref\n0 ' + totalObjs + '\n0000000000 65535 f \n';
    for (var n = 1; n < totalObjs; n++) {
      xref += pad10(offsets[n] || 0) + ' 00000 n \n';
    }
    pushStr(xref);
    pushStr('trailer\n<< /Size ' + totalObjs + ' /Root 1 0 R >>\nstartxref\n' + xrefOffset + '\n%%EOF\n');

    var bytes = concat(chunks);
    if (typeof Blob !== 'undefined') return new Blob([bytes], { type: 'application/pdf' });
    return bytes;
  }

  global.CLUB = global.CLUB || {};
  global.CLUB.pdf = { fromJpegPages: fromJpegPages };
})(typeof window !== 'undefined' ? window : globalThis);

