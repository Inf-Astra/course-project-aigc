/* ---- js/gallery.js ---- */
/**
 * CLUB.gallery —— 活动图集排版
 * 把用户上传的照片排成 A4 图集 DocSpec（封面 + 每页 1/2/3 张 + 图注），
 * 交给 CLUB.docx.render 导出 Word；纯函数、无 DOM、无随机数。
 *
 * 图片数据由调用方提供：{ data: Uint8Array, mime, widthPx, heightPx, caption, src? }
 * 其中 widthPx/heightPx 用于按比例计算版面尺寸，src 仅供网页预览使用。
 */
(function (global) {
  'use strict';

  var EMU_PER_TWIP = 635;
  var EMU_PER_PX = 9525; // 96 DPI
  var CONTENT_W_TWIPS = 8306;                       // A4 210mm - 左右各 31.7mm
  var CONTENT_H_TWIPS = 16838 - 1440 - 1440;        // 上下页边距各 25.4mm
  var CONTENT_W_EMU = CONTENT_W_TWIPS * EMU_PER_TWIP;
  var CONTENT_H_EMU = CONTENT_H_TWIPS * EMU_PER_TWIP;
  var CAPTION_TWIPS = 520;                          // 每张图下方图注占用的高度

  var CN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十',
    '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十'];

  function s(v) { return v == null ? '' : String(v).trim(); }
  function n(v, d) {
    var x = parseFloat(v);
    return isFinite(x) ? x : d;
  }
  function pad2(x) { return (x < 10 ? '0' : '') + x; }

  /** 场次标题：用于每页顶部的小标题 */
  function pageLabel(index) {
    return CN_NUM[index] || String(index + 1);
  }

  /** 按版面计算单张图片的显示尺寸（EMU） */
  function fitPhoto(photo, maxW, maxH) {
    var wpx = Math.max(1, n(photo.widthPx, 1200));
    var hpx = Math.max(1, n(photo.heightPx, 900));
    var natW = wpx * EMU_PER_PX;
    var natH = hpx * EMU_PER_PX;
    var scale = Math.min(maxW / natW, maxH / natH, 1); // 不放大，避免糊
    if (!isFinite(scale) || scale <= 0) scale = Math.min(maxW / natW, maxH / natH);
    var w = Math.max(120000, Math.round(natW * scale));
    var h = Math.max(90000, Math.round(natH * scale));
    // 极端竖图/横图再兜底一次，保证不超出版面
    if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
    if (h > maxH) { w = Math.round(w * maxH / h); h = maxH; }
    return { w: w, h: h };
  }

  /**
   * 统一照片框：同一图集里所有照片共用一个宽高比
   * （1–2 张/页用 4:3，3 张/页用 3:2），保证每张显示尺寸完全一致。
   */
  function uniformBox(perPage, maxW, maxH) {
    var aspect = perPage >= 3 ? 1.5 : 4 / 3;
    var w = maxW;
    var h = Math.round(w / aspect);
    if (h > maxH) { h = maxH; w = Math.round(h * aspect); }
    return { w: w, h: h };
  }

  /**
   * 生成活动图集 DocSpec。
   * @param {object} input
   *   name/org/date/place/dateText/intro/credit/layout/photos
   * @returns {{doc: object, count: number, perPage: number, pages: number}}
   */
  function build(input) {
    var src = input && typeof input === 'object' ? input : {};
    var photos = Array.isArray(src.photos) ? src.photos.filter(function (p) {
      return p && p.data;
    }) : [];
    var perPage = Math.round(n(src.layout, 2));
    if (perPage < 1) perPage = 1;
    if (perPage > 3) perPage = 3;
    if (!photos.length) {
      return {
        doc: {
          title: '活动图集',
          blocks: [{ type: 'note', text: '尚未添加照片，请先上传活动现场照片。' }]
        },
        count: 0,
        perPage: perPage,
        pages: 0
      };
    }

    var name = s(src.name) || '活动';
    var org = s(src.org);
    var place = s(src.place);
    var dateText = s(src.dateText) || s(src.date);
    var credit = s(src.credit);
    var intro = s(src.intro);

    function captionOf(idx, text) {
      var c = s(text);
      return '图 ' + (idx + 1) + (c ? '　' + c : '');
    }

    var blocks = [];
    // ---------------- 封面（标题/副标题/信息表由 DocSpec 的 title/subtitle/meta 渲染） ----------------
    var meta = [];
    if (org) meta.push(['主办单位', org]);
    if (dateText) meta.push(['活动时间', dateText]);
    if (place) meta.push(['活动地点', place]);
    meta.push(['照片数量', photos.length + ' 张']);
    if (credit) meta.push(['摄　　影', credit]);

    if (intro) blocks.push({ type: 'p', text: intro });
    blocks.push({
      type: 'note',
      text: '本图集共收录 ' + photos.length + ' 张现场照片，按活动流程排序；图注与顺序可在「活动图集」页调整后重新导出。'
    });
    blocks.push({ type: 'pagebreak' });

    // ---------------- 照片页（统一尺寸：所有照片裁成同一个版式框） ----------------
    var box = uniformBox(perPage, CONTENT_W_EMU,
      Math.floor((CONTENT_H_EMU - perPage * CAPTION_TWIPS * EMU_PER_TWIP) / perPage));
    var pages = Math.ceil(photos.length / perPage);
    var idx = 0;
    for (var p = 0; p < pages; p++) {
      if (p > 0) blocks.push({ type: 'pagebreak' });
      for (var i = 0; i < perPage && idx < photos.length; i++, idx++) {
        var photo = photos[idx];
        blocks.push({
          type: 'image',
          data: photo.data,
          mime: photo.mime || 'image/jpeg',
          widthEmu: box.w,
          heightEmu: box.h,
          crop: true,
          caption: captionOf(idx, photo.caption),
          src: photo.src || ''
        });
      }
    }

    // ---------------- 封底说明 ----------------
    if (credit) {
      blocks.push({ type: 'p', text: '', align: 'center' });
      blocks.push({ type: 'note', text: '摄影：' + credit + (org ? '　｜　' + org : '') });
    }

    return {
      doc: {
        title: '「' + name + '」活动图集',
        subtitle: [dateText, place].filter(Boolean).join('　'),
        meta: meta,
        blocks: blocks,
        footer: (org ? org + ' · ' : '') + '活动图集'
      },
      count: photos.length,
      perPage: perPage,
      pages: pages
    };
  }

  /* ---------------------------------------------------------------- 工具 */

  /** 从 File/Blob 读取为 Uint8Array */
  function readBytes(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(new Uint8Array(reader.result)); };
      reader.onerror = function () { reject(new Error('读取图片失败')); };
      reader.readAsArrayBuffer(blob);
    });
  }

  /** 用 canvas 等比压缩到长边 maxEdge，输出 JPEG（Word 兼容性最好） */
  function compressImage(file, maxEdge) {
    maxEdge = maxEdge || 1600;
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var w = img.naturalWidth;
        var h = img.naturalHeight;
        var scale = Math.min(1, maxEdge / Math.max(w, h));
        var cw = Math.max(1, Math.round(w * scale));
        var ch = Math.max(1, Math.round(h * scale));
        var canvas = document.createElement('canvas');
        canvas.width = cw;
        canvas.height = ch;
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, cw, ch);
        ctx.drawImage(img, 0, 0, cw, ch);
        URL.revokeObjectURL(url);
        canvas.toBlob(function (blob) {
          if (!blob) { reject(new Error('图片压缩失败')); return; }
          readBytes(blob).then(function (bytes) {
            resolve({
              data: bytes,
              mime: 'image/jpeg',
              widthPx: cw,
              heightPx: ch,
              previewUrl: URL.createObjectURL(blob)
            });
          }).catch(reject);
        }, 'image/jpeg', 0.84);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('无法解析图片：' + (file.name || '')));
      };
      img.src = url;
    });
  }

  /* ---------------------------------------------------------------- PDF 页面渲染 */

  var PAGE_W = 1240;               // A4 210mm @150dpi
  var PAGE_H = 1754;               // A4 297mm @150dpi
  var PX_MM = PAGE_W / 210;
  var FONT_CJK = '"PingFang SC","Microsoft YaHei","Hiragino Sans GB","Source Han Sans SC",sans-serif';

  function newCanvas() {
    var c = document.createElement('canvas');
    c.width = PAGE_W;
    c.height = PAGE_H;
    var ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, PAGE_W, PAGE_H);
    ctx.textBaseline = 'top';
    return { canvas: c, ctx: ctx };
  }

  function loadPhotoImage(photo) {
    return new Promise(function (resolve, reject) {
      var blob = new Blob([photo.data], { type: photo.mime || 'image/jpeg' });
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('图片解码失败')); };
      img.src = url;
    });
  }

  function wrappedLines(ctx, text, maxW) {
    var out = [];
    var chars = String(text || '').split('');
    var line = '';
    var NO_START = '，。、；：！？）」』】…—,.;:!?)]}';
    for (var i = 0; i < chars.length; i++) {
      if (chars[i] === '\n') { out.push(line); line = ''; continue; }
      var test = line + chars[i];
      if (ctx.measureText(test).width > maxW && line) {
        if (NO_START.indexOf(chars[i]) >= 0) {
          // 标点不另起一行：允许轻微溢出
          out.push(test);
          line = '';
        } else {
          out.push(line);
          line = chars[i];
        }
      } else {
        line = test;
      }
    }
    if (line) out.push(line);
    return out;
  }

  /** 画一段自动换行的文字，返回结束时的 y */
  function drawWrapped(ctx, text, x, y, maxW, lineH) {
    var lines = wrappedLines(ctx, text, maxW);
    for (var i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], x, y + i * lineH);
    }
    return y + lines.length * lineH;
  }

  function drawCover(ctx, input, photos) {
    var name = s(input.name) || '活动';
    var org = s(input.org);
    var place = s(input.place);
    var dateText = s(input.dateText) || s(input.date);
    var credit = s(input.credit);
    var intro = s(input.intro);
    var M = Math.round(24 * PX_MM);
    var maxW = PAGE_W - M * 2;
    var y = Math.round(38 * PX_MM);

    ctx.fillStyle = '#94a0b8';
    ctx.font = '600 20px ' + FONT_CJK;
    ctx.fillText('活动图集　·　ACTIVITY ALBUM', M, y);
    y += Math.round(22 * PX_MM);

    ctx.fillStyle = '#101a2e';
    ctx.font = '700 54px ' + FONT_CJK;
    y = drawWrapped(ctx, '「' + name + '」活动图集', M, y, maxW, 78);
    y += Math.round(4 * PX_MM);

    if (dateText || place) {
      ctx.fillStyle = '#5b6884';
      ctx.font = '22px ' + FONT_CJK;
      ctx.fillText([dateText, place].filter(Boolean).join('　·　'), M, y);
      y += Math.round(12 * PX_MM);
    }

    ctx.strokeStyle = '#d8deec';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(M, y);
    ctx.lineTo(PAGE_W - M, y);
    ctx.stroke();
    y += Math.round(10 * PX_MM);

    var rows = [];
    if (org) rows.push(['主办单位', org]);
    if (dateText) rows.push(['活动时间', dateText]);
    if (place) rows.push(['活动地点', place]);
    rows.push(['照片数量', photos.length + ' 张']);
    if (credit) rows.push(['摄　　影', credit]);

    rows.forEach(function (row) {
      ctx.fillStyle = '#8592ab';
      ctx.font = '20px ' + FONT_CJK;
      ctx.fillText(row[0], M, y);
      ctx.fillStyle = '#24314d';
      ctx.font = '20px ' + FONT_CJK;
      var vx = M + Math.round(30 * PX_MM);
      drawWrapped(ctx, row[1], vx, y, PAGE_W - M - vx, 30);
      y += Math.round(9 * PX_MM);
    });
    y += Math.round(4 * PX_MM);

    if (intro) {
      ctx.fillStyle = '#3b475f';
      ctx.font = '21px ' + FONT_CJK;
      y = drawWrapped(ctx, intro, M, y, maxW, 36) + Math.round(6 * PX_MM);
    }

    // 页脚
    ctx.fillStyle = '#9aa6bd';
    ctx.font = '18px ' + FONT_CJK;
    var foot = [org, credit ? '摄影：' + credit : ''].filter(Boolean).join('　｜　');
    if (foot) ctx.fillText(foot, M, PAGE_H - Math.round(22 * PX_MM));
  }

  /**
   * 把图集渲染成 A4 页面 canvas（封面 + 照片页），供 PDF 导出使用。
   * @returns {Promise<HTMLCanvasElement[]>}
   */
  async function renderPageImages(input) {
    var photos = Array.isArray(input && input.photos) ? input.photos.filter(function (p) { return p && p.data; }) : [];
    if (!photos.length) throw new Error('请先上传活动现场照片');
    var perPage = Math.round(n(input.layout, 2));
    if (perPage < 1) perPage = 1;
    if (perPage > 3) perPage = 3;

    var imgs = [];
    for (var i = 0; i < photos.length; i++) {
      imgs.push(await loadPhotoImage(photos[i]));
    }

    var pages = [];
    var cover = newCanvas();
    drawCover(cover.ctx, input, photos);
    pages.push(cover.canvas);

    var side = Math.round(18 * PX_MM);
    var top = Math.round(26 * PX_MM);
    var bottom = Math.round(22 * PX_MM);
    var headerY = Math.round(13 * PX_MM);
    var totalPages = Math.ceil(photos.length / perPage);

    for (var p = 0; p < totalPages; p++) {
      var pg = newCanvas();
      var ctx = pg.ctx;
      // 页眉
      ctx.fillStyle = '#94a0b8';
      ctx.font = '16px ' + FONT_CJK;
      ctx.fillText(s(input.name) || '活动图集', side, headerY);
      var rightLabel = '活动图集';
      ctx.fillText(rightLabel, PAGE_W - side - ctx.measureText(rightLabel).width, headerY);
      ctx.strokeStyle = '#e2e7f1';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(side, headerY + 26);
      ctx.lineTo(PAGE_W - side, headerY + 26);
      ctx.stroke();

      var cellH = (PAGE_H - top - bottom) / perPage;
      var capH = 46;
      var areaW = PAGE_W - side * 2;
      var areaH = cellH - capH - 10;
      // 统一尺寸：同一页/同一图集所有照片用同一个 4:3（或 3:2）框，超出部分居中裁切
      var box = uniformBox(perPage, areaW, areaH);
      var boxX = Math.round((PAGE_W - box.w) / 2);

      for (var k = 0; k < perPage; k++) {
        var idx = p * perPage + k;
        if (idx >= photos.length) break;
        var img = imgs[idx];
        var cellTop = top + k * cellH;
        var boxY = Math.round(cellTop + (areaH - box.h) / 2);

        ctx.save();
        ctx.shadowColor = 'rgba(16,26,46,.16)';
        ctx.shadowBlur = 18;
        ctx.shadowOffsetY = 6;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(boxX, boxY, box.w, box.h);
        ctx.restore();

        // cover：按框的比例居中裁切，保证每张照片尺寸一致、不变形
        var scale = Math.max(box.w / img.naturalWidth, box.h / img.naturalHeight);
        var sw = box.w / scale;
        var sh = box.h / scale;
        var sx = (img.naturalWidth - sw) / 2;
        var sy = (img.naturalHeight - sh) / 2;
        ctx.drawImage(img, sx, sy, sw, sh, boxX, boxY, box.w, box.h);

        var caption = '图 ' + (idx + 1) + (photos[idx].caption ? '　' + s(photos[idx].caption) : '');
        ctx.fillStyle = '#7c89a1';
        ctx.font = '18px ' + FONT_CJK;
        var cw = ctx.measureText(caption).width;
        if (cw > areaW) {
          caption = caption.slice(0, Math.max(6, Math.floor(caption.length * areaW / cw) - 1)) + '…';
        }
        ctx.fillText(caption, Math.round((PAGE_W - ctx.measureText(caption).width) / 2), cellTop + areaH + 14);
      }

      ctx.fillStyle = '#a3aec2';
      ctx.font = '15px ' + FONT_CJK;
      var pn = '第 ' + (p + 1) + ' / ' + totalPages + ' 页';
      ctx.fillText(pn, PAGE_W - side - ctx.measureText(pn).width, PAGE_H - Math.round(13 * PX_MM));
      pages.push(pg.canvas);
    }
    return pages;
  }

  global.CLUB = global.CLUB || {};
  global.CLUB.gallery = {
    build: build,
    compressImage: compressImage,
    fitPhoto: fitPhoto,
    pageLabel: pageLabel,
    renderPageImages: renderPageImages
  };
})(typeof window !== 'undefined' ? window : globalThis);

