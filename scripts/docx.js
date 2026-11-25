/* ---- js/lib/docx.js ---- */
/**
 * CLUB.docx —— 零依赖 Word 文档（DocSpec → .docx）渲染
 * 按契约渲染标题/副标题/信息表与 9 种 block（h1/h2/h3/p/bullets/numbers/table/kv/quote/note/pagebreak），
 * 支持 **加粗** 内联标记、中文字体三件套、A4 页面、1.5 倍行距、首行缩进、表格边框与跨页重复表头、页脚。
 * 仅依赖 CLUB.zip（加载顺序 zip.js 在前）与 Blob；download 在 Node 下安全空操作。
 */
(function (global) {
  'use strict';

  var DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

  // A4 宽 11906 twips - 左右页边距各 1800 = 8306 twips 正文宽度
  var CONTENT_WIDTH = 8306;
  var COLOR_GRAY = '808080';
  var COLOR_QUOTE = '595959';
  var COLOR_BORDER = '999999';
  var COLOR_HEADER_FILL = 'F2F2F2';

  // 图片收集器：render() 期间有效，记录本次文档要嵌入的媒体文件
  var IMG_STATE = null;

  // ---------------------------------------------------------------------------
  // 基础 XML 工具
  // ---------------------------------------------------------------------------

  /** 过滤 XML 1.0 非法字符，并把孤立代理项替换为 U+FFFD */
  function sanitizeXmlText(value) {
    var s = String(value == null ? '' : value);
    s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '');
    s = s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '\uFFFD');
    s = s.replace(/(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '$1\uFFFD');
    return s;
  }

  function escapeXml(value) {
    return sanitizeXmlText(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  // ---------------------------------------------------------------------------
  // 段落 / 文本 run
  // ---------------------------------------------------------------------------

  /** 运行属性：中文字体放 eastAsia，西文固定 Times New Roman */
  function rPrXml(opt) {
    var o = opt || {};
    var size = o.size || 24;
    var out = '<w:rPr>' +
      '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="' +
      escapeXml(o.font || '宋体') + '" w:cs="Times New Roman"/>';
    if (o.bold) out += '<w:b/><w:bCs/>';
    if (o.italic) out += '<w:i/><w:iCs/>';
    if (o.color) out += '<w:color w:val="' + o.color + '"/>';
    out += '<w:sz w:val="' + size + '"/><w:szCs w:val="' + size + '"/>';
    out += '</w:rPr>';
    return out;
  }

  /** 把一段文本拆成普通/加粗片段；未闭合的 ** 原样保留 */
  function parseInlineSegments(text) {
    var s = String(text == null ? '' : text);
    var parts = s.split('**');
    var segs = [];
    var i;
    if (parts.length % 2 === 0) {
      var tail = parts.pop();
      for (i = 0; i < parts.length; i++) segs.push({ text: parts[i], bold: i % 2 === 1 });
      if (tail !== '') segs.push({ text: '**' + tail, bold: false });
      else segs.push({ text: '**', bold: false });
    } else {
      for (i = 0; i < parts.length; i++) segs.push({ text: parts[i], bold: i % 2 === 1 });
    }
    return segs;
  }

  /** 单段文本 → run XML（处理 \n → <w:br/>、\t → <w:tab/>） */
  function textRunsXml(text, opt) {
    var norm = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
    if (norm === '') return '';
    var pr = rPrXml(opt);
    var lines = norm.split('\n');
    var out = '';
    for (var i = 0; i < lines.length; i++) {
      if (i > 0) out += '<w:r>' + pr + '<w:br/></w:r>';
      if (lines[i] === '') continue;
      var pieces = lines[i].split('\t');
      for (var k = 0; k < pieces.length; k++) {
        if (k > 0) out += '<w:r>' + pr + '<w:tab/></w:r>';
        if (pieces[k] === '') continue;
        out += '<w:r>' + pr + '<w:t xml:space="preserve">' + escapeXml(pieces[k]) + '</w:t></w:r>';
      }
    }
    return out;
  }

  /** 支持 **加粗** 的整段 run XML */
  function inlineXml(text, base) {
    var b = base || {};
    var segs = parseInlineSegments(text);
    var out = '';
    for (var i = 0; i < segs.length; i++) {
      out += textRunsXml(segs[i].text, {
        font: b.font,
        size: b.size,
        color: b.color,
        bold: !!(b.bold || segs[i].bold)
      });
    }
    return out;
  }

  /** 段落属性（顺序遵循 OOXML pPr 序列） */
  function pPrXml(o) {
    var opt = o || {};
    var out = '';
    if (opt.keepNext) out += '<w:keepNext/>';
    if (opt.border) out += opt.border;
    if (opt.line || opt.before != null || opt.after != null) {
      out += '<w:spacing' +
        (opt.before != null ? ' w:before="' + opt.before + '"' : '') +
        (opt.after != null ? ' w:after="' + opt.after + '"' : '') +
        (opt.line ? ' w:line="' + opt.line + '" w:lineRule="auto"' : '') +
        '/>';
    }
    if (opt.indent) out += opt.indent;
    if (opt.align) out += '<w:jc w:val="' + opt.align + '"/>';
    return out ? '<w:pPr>' + out + '</w:pPr>' : '';
  }

  /** 生成一个段落 */
  function paragraphXml(text, opt) {
    var o = opt || {};
    return '<w:p>' + pPrXml(o) + inlineXml(text, {
      font: o.font || '宋体',
      size: o.size || 24,
      bold: o.bold,
      color: o.color
    }) + '</w:p>';
  }

  var ALIGN_MAP = { left: 'left', center: 'center', right: 'right', justify: 'both', both: 'both' };

  function mapAlign(align, fallback) {
    if (align && ALIGN_MAP[align]) return ALIGN_MAP[align];
    return fallback || null;
  }

  // ---------------------------------------------------------------------------
  // 表格
  // ---------------------------------------------------------------------------

  function normalizeWidths(widthsIn, colCount) {
    var given = Array.isArray(widthsIn) ? widthsIn : [];
    var out = [];
    var used = 0;
    var missing = 0;
    var i;
    for (i = 0; i < colCount; i++) {
      var w = given[i];
      if (typeof w === 'number' && isFinite(w) && w > 0) {
        var rounded = Math.round(w);
        out.push(rounded);
        used += rounded;
      } else {
        out.push(null);
        missing++;
      }
    }
    if (missing > 0) {
      var fallback = Math.floor((CONTENT_WIDTH - used) / missing);
      if (!isFinite(fallback) || fallback < 500) fallback = 500;
      for (i = 0; i < out.length; i++) {
        if (out[i] == null) out[i] = fallback;
      }
    }
    return out;
  }

  var TBL_BORDERS = '<w:tblBorders>' +
    '<w:top w:val="single" w:sz="4" w:space="0" w:color="' + COLOR_BORDER + '"/>' +
    '<w:left w:val="single" w:sz="4" w:space="0" w:color="' + COLOR_BORDER + '"/>' +
    '<w:bottom w:val="single" w:sz="4" w:space="0" w:color="' + COLOR_BORDER + '"/>' +
    '<w:right w:val="single" w:sz="4" w:space="0" w:color="' + COLOR_BORDER + '"/>' +
    '<w:insideH w:val="single" w:sz="4" w:space="0" w:color="' + COLOR_BORDER + '"/>' +
    '<w:insideV w:val="single" w:sz="4" w:space="0" w:color="' + COLOR_BORDER + '"/>' +
    '</w:tblBorders>';

  var TBL_CELL_MAR = '<w:tblCellMar>' +
    '<w:top w:w="57" w:type="dxa"/><w:left w:w="108" w:type="dxa"/>' +
    '<w:bottom w:w="57" w:type="dxa"/><w:right w:w="108" w:type="dxa"/>' +
    '</w:tblCellMar>';

  var TBL_LOOK = '<w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="0" ' +
    'w:lastColumn="0" w:noHBand="0" w:noVBand="1"/>';

  /**
   * 生成表格。rowDefs: [{ cells, header?, labelFirst? }]
   * aligns: 每列对齐（目前使用 'center' 时居中）
   */
  // 把所有表格的列宽等比缩放，使总宽恰好等于正文宽度（8306 twips）。
  // 这样不同表格的左/右边线与正文版心、页边距对齐，导出后不会出现表格超出页边距。
  function fitWidths(widths) {
    var sum = 0, i;
    for (i = 0; i < widths.length; i++) sum += widths[i];
    if (!sum || sum === CONTENT_WIDTH) return widths;
    var scaled = [];
    var used = 0;
    for (i = 0; i < widths.length; i++) {
      var v = Math.round(widths[i] * CONTENT_WIDTH / sum);
      if (v < 200) v = 200;
      scaled.push(v);
      used += v;
    }
    var diff = CONTENT_WIDTH - used;
    var maxIdx = 0;
    for (i = 1; i < scaled.length; i++) {
      if (scaled[i] > scaled[maxIdx]) maxIdx = i;
    }
    scaled[maxIdx] += diff;
    if (scaled[maxIdx] < 200) scaled[maxIdx] = 200;
    return scaled;
  }

  function tableXml(rowDefs, widthsIn, colCount, aligns) {
    if (!rowDefs.length || colCount < 1) return '';
    var widths = fitWidths(normalizeWidths(widthsIn, colCount));
    var total = 0;
    var i;
    for (i = 0; i < widths.length; i++) total += widths[i];

    var grid = '<w:tblGrid>';
    for (i = 0; i < widths.length; i++) grid += '<w:gridCol w:w="' + widths[i] + '"/>';
    grid += '</w:tblGrid>';

    var rowsXml = '';
    for (i = 0; i < rowDefs.length; i++) {
      var def = rowDefs[i];
      var isHeader = !!def.header;
      rowsXml += '<w:tr><w:trPr>' + (isHeader ? '<w:cantSplit/><w:tblHeader/>' : '<w:cantSplit/>') + '</w:trPr>';
      for (var c = 0; c < colCount; c++) {
        var isLabel = !!def.labelFirst && c === 0;
        var cellText = def.cells[c] == null ? '' : String(def.cells[c]);
        var fill = isHeader || isLabel ? COLOR_HEADER_FILL : null;
        var align = null;
        if (isHeader) {
          align = 'center';
        } else if (Array.isArray(aligns) && aligns[c] === 'center') {
          align = 'center';
        } else if (aligns === 'center') {
          align = 'center';
        }
        rowsXml += '<w:tc><w:tcPr>' +
          '<w:tcW w:w="' + widths[c] + '" w:type="dxa"/>' +
          (fill ? '<w:shd w:val="clear" w:color="auto" w:fill="' + fill + '"/>' : '') +
          '<w:vAlign w:val="center"/>' +
          '</w:tcPr>' +
          paragraphXml(cellText, {
            font: '宋体',
            size: 21,
            bold: isHeader || isLabel,
            align: align,
            line: 276,
            before: 20,
            after: 20
          }) +
          '</w:tc>';
      }
      rowsXml += '</w:tr>';
    }

    return '<w:tbl><w:tblPr>' +
      '<w:tblW w:w="' + total + '" w:type="dxa"/>' +
      '<w:tblInd w:w="0" w:type="dxa"/>' +
      '<w:jc w:val="left"/>' +
      TBL_BORDERS +
      '<w:tblLayout w:type="fixed"/>' +
      TBL_CELL_MAR +
      TBL_LOOK +
      '</w:tblPr>' + grid + rowsXml + '</w:tbl>';
  }

  // ---------------------------------------------------------------------------
  // Block 渲染
  // ---------------------------------------------------------------------------

  var HEADING_STYLE = {
    h1: { size: 32, before: 240, after: 120 },
    h2: { size: 28, before: 180, after: 100 },
    h3: { size: 24, before: 120, after: 60 }
  };

  // ---------------------------------------------------------------------------
  // 图片
  // ---------------------------------------------------------------------------

  function toBytes(data) {
    if (!data) return null;
    if (data instanceof Uint8Array) return data;
    if (typeof ArrayBuffer !== 'undefined' && data instanceof ArrayBuffer) return new Uint8Array(data);
    if (data.buffer instanceof ArrayBuffer) return new Uint8Array(data.buffer, data.byteOffset || 0, data.byteLength);
    if (typeof data === 'string') {
      // 支持 data:image/...;base64,xxxx
      var base64 = data.indexOf(',') >= 0 ? data.slice(data.indexOf(',') + 1) : data;
      var bin = atob(base64);
      var out = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    return null;
  }

  function guessImageMime(bytes) {
    if (!bytes || bytes.length < 4) return 'image/png';
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif';
    return 'image/jpeg';
  }

  function imageExt(mime) {
    if (mime === 'image/png') return 'png';
    if (mime === 'image/gif') return 'gif';
    return 'jpg';
  }

  /** 生成 Word 的 wp:inline 图片 XML（宽高单位 EMU） */
  function drawingXml(rid, cx, cy, picId, name) {
    return '<wp:inline distT="0" distB="0" distL="0" distR="0" ' +
      'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
      'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
      'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<wp:extent cx="' + cx + '" cy="' + cy + '"/>' +
      '<wp:effectExtent l="0" t="0" r="0" b="0"/>' +
      '<wp:docPr id="' + picId + '" name="图片 ' + picId + '" descr=""/>' +
      '<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
      '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      '<pic:pic><pic:nvPicPr><pic:cNvPr id="' + picId + '" name="' + escapeXml(name) + '"/>' +
      '<pic:cNvPicPr><a:picLocks noChangeAspect="1" noChangeArrowheads="1"/></pic:cNvPicPr></pic:nvPicPr>' +
      '<pic:blipFill><a:blip r:embed="' + rid + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
      '<pic:spPr bwMode="auto"><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm>' +
      '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>' +
      '</a:graphicData></a:graphic></wp:inline>';
  }

  function imageBlockXml(block) {
    if (!IMG_STATE) return '';
    var bytes = toBytes(block.data);
    if (!bytes || !bytes.length) return '';
    var mime = block.mime || guessImageMime(bytes);
    var ext = imageExt(mime);
    var idx = IMG_STATE.images.length + 1;
    var name = 'image' + idx + '.' + ext;
    var rid = 'rIdImg' + idx;
    IMG_STATE.images.push({ name: name, mime: mime, bytes: bytes, rid: rid });
    var cx = Math.max(10000, Math.round(block.widthEmu || 4700000));
    var cy = Math.max(10000, Math.round(block.heightEmu || 3100000));
    var spacing = block.spacing === false ? '' : '<w:spacing w:before="80" w:after="80" w:line="240" w:lineRule="auto"/>';
    var xml = '<w:p><w:pPr><w:keepNext/>' + spacing + '<w:jc w:val="center"/></w:pPr>' +
      '<w:r><w:drawing>' + drawingXml(rid, cx, cy, idx, name) + '</w:drawing></w:r></w:p>';
    if (block.caption) {
      xml += paragraphXml(String(block.caption), {
        font: '宋体',
        size: 18,
        color: COLOR_GRAY,
        align: 'center',
        line: 280,
        before: 40,
        after: 200
      });
    }
    return xml;
  }


  function blockXml(block) {
    if (!block || typeof block !== 'object') return '';
    var type = String(block.type || '');
    var text;
    switch (type) {
      case 'h1':
      case 'h2':
      case 'h3': {
        var hs = HEADING_STYLE[type];
        text = block.text == null ? '' : String(block.text);
        return paragraphXml(text, {
          font: '黑体',
          size: hs.size,
          bold: true,
          align: 'left',
          line: 300,
          before: hs.before,
          after: hs.after,
          keepNext: true
        });
      }
      case 'p': {
        text = block.text == null ? '' : String(block.text);
        var align = mapAlign(block.align, 'both');
        var indent = null;
        if (align !== 'center' && align !== 'right') {
          indent = '<w:ind w:firstLineChars="200" w:firstLine="480"/>';
        }
        return paragraphXml(text, {
          font: '宋体',
          size: 24,
          align: align,
          line: 360,
          before: 0,
          after: 60,
          indent: indent
        });
      }
      case 'bullets':
      case 'numbers': {
        var items = Array.isArray(block.items) ? block.items : [];
        var out = '';
        for (var i = 0; i < items.length; i++) {
          var marker = type === 'bullets' ? '• ' : (i + 1) + '. ';
          out += paragraphXml(marker + (items[i] == null ? '' : String(items[i])), {
            font: '宋体',
            size: 24,
            align: 'both',
            line: 360,
            before: 0,
            after: 40,
            indent: '<w:ind w:left="480" w:hanging="240"/>'
          });
        }
        return out;
      }
      case 'table': {
        var headerList = Array.isArray(block.headers) ? block.headers : [];
        var rowList = Array.isArray(block.rows) ? block.rows : [];
        var colCount = headerList.length;
        var bodyRows = [];
        for (var r = 0; r < rowList.length; r++) {
          var row = Array.isArray(rowList[r]) ? rowList[r] : [rowList[r]];
          bodyRows.push(row);
          if (row.length > colCount) colCount = row.length;
        }
        var widthList = Array.isArray(block.widths) ? block.widths : [];
        if (widthList.length > colCount) colCount = widthList.length;
        if (colCount < 1) return '';
        var defs = [];
        if (headerList.length) defs.push({ cells: headerList, header: true });
        for (var b = 0; b < bodyRows.length; b++) defs.push({ cells: bodyRows[b], header: false });
        if (!defs.length) return '';
        return tableXml(defs, widthList, colCount, block.align);
      }
      case 'kv': {
        var kvRows = Array.isArray(block.rows) ? block.rows : [];
        var kvDefs = [];
        for (var k = 0; k < kvRows.length; k++) {
          var kvRow = Array.isArray(kvRows[k]) ? kvRows[k] : [kvRows[k]];
          kvDefs.push({ cells: [kvRow[0], kvRow[1]], labelFirst: true });
        }
        if (!kvDefs.length) return '';
        var kvWidths = Array.isArray(block.widths) ? block.widths : [2200, 6106];
        return tableXml(kvDefs, kvWidths, 2, null);
      }
      case 'quote': {
        text = block.text == null ? '' : String(block.text);
        return paragraphXml(text, {
          font: '楷体',
          size: 24,
          color: COLOR_QUOTE,
          align: 'both',
          line: 360,
          before: 60,
          after: 120,
          border: '<w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="BFBFBF"/></w:pBdr>',
          indent: '<w:ind w:left="240" w:right="240"/>'
        });
      }
      case 'note': {
        text = block.text == null ? '' : String(block.text);
        return paragraphXml(text, {
          font: '宋体',
          size: 18,
          color: COLOR_GRAY,
          align: 'both',
          line: 300,
          before: 40,
          after: 40
        });
      }
      case 'image':
        return imageBlockXml(block);
      case 'pagebreak':
        return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
      default: {
        // 非契约类型不抛异常：有 text 按正文段落、有 items 按项目符号兜底
        if (block.text != null && String(block.text) !== '') {
          return paragraphXml(String(block.text), {
            font: '宋体',
            size: 24,
            align: 'both',
            line: 360,
            before: 0,
            after: 60,
            indent: '<w:ind w:firstLineChars="200" w:firstLine="480"/>'
          });
        }
        if (Array.isArray(block.items) && block.items.length) {
          var fallback = '';
          for (var j = 0; j < block.items.length; j++) {
            fallback += paragraphXml('• ' + (block.items[j] == null ? '' : String(block.items[j])), {
              font: '宋体',
              size: 24,
              align: 'both',
              line: 360,
              before: 0,
              after: 40,
              indent: '<w:ind w:left="480" w:hanging="240"/>'
            });
          }
          return fallback;
        }
        return '';
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 整篇文档
  // ---------------------------------------------------------------------------

  function titleXml(text) {
    return paragraphXml(text, {
      font: '黑体',
      size: 44,
      bold: true,
      align: 'center',
      line: 300,
      before: 0,
      after: 200
    });
  }

  function subtitleXml(text) {
    return paragraphXml(text, {
      font: '楷体',
      size: 28,
      align: 'center',
      line: 300,
      before: 0,
      after: 200
    });
  }

  function metaXml(meta) {
    var rows = [];
    for (var i = 0; i < meta.length; i++) {
      var item = meta[i];
      if (!Array.isArray(item)) continue;
      rows.push({ cells: [item[0], item[1]], labelFirst: true });
    }
    if (!rows.length) return '';
    return tableXml(rows, [2400, 5906], 2, null);
  }

  function buildDocumentXml(doc) {
    var spec = doc && typeof doc === 'object' ? doc : {};
    var body = '';
    if (spec.title != null && String(spec.title) !== '') body += titleXml(String(spec.title));
    if (spec.subtitle != null && String(spec.subtitle) !== '') body += subtitleXml(String(spec.subtitle));
    if (Array.isArray(spec.meta) && spec.meta.length) body += metaXml(spec.meta);
    if (Array.isArray(spec.blocks)) {
      for (var i = 0; i < spec.blocks.length; i++) {
        body += blockXml(spec.blocks[i]);
      }
    }
    // 空文档也保证至少一个段落，兼容严格的阅读器
    if (body === '') body = '<w:p/>';

    var footerRef = spec.footer != null && String(spec.footer) !== ''
      ? '<w:footerReference w:type="default" r:id="rId2"/>'
      : '';
    var sectPr = '<w:sectPr>' + footerRef +
      '<w:pgSz w:w="11906" w:h="16838"/>' +
      '<w:pgMar w:top="1440" w:right="1800" w:bottom="1440" w:left="1800" ' +
      'w:header="851" w:footer="992" w:gutter="0"/>' +
      '<w:cols w:space="425"/>' +
      '<w:docGrid w:linePitch="312"/>' +
      '</w:sectPr>';

    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<w:body>' + body + sectPr + '</w:body></w:document>';
  }

  function buildFooterXml(text) {
    var pr = rPrXml({ font: '宋体', size: 18, color: COLOR_GRAY });
    var pagePr = rPrXml({ font: '宋体', size: 18, color: COLOR_GRAY });
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<w:p><w:pPr><w:spacing w:line="240" w:lineRule="auto"/><w:jc w:val="center"/></w:pPr>' +
      '<w:r>' + pr + '<w:t xml:space="preserve">' + escapeXml(String(text)) + '</w:t></w:r>' +
      '<w:r>' + pr + '<w:t xml:space="preserve">    第 </w:t></w:r>' +
      '<w:fldSimple w:instr=" PAGE "><w:r>' + pagePr + '<w:t>1</w:t></w:r></w:fldSimple>' +
      '<w:r>' + pr + '<w:t xml:space="preserve"> 页</w:t></w:r>' +
      '</w:p></w:ftr>';
  }

  function buildStylesXml() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:docDefaults>' +
      '<w:rPrDefault><w:rPr>' +
      '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="宋体" w:cs="Times New Roman"/>' +
      '<w:sz w:val="24"/><w:szCs w:val="24"/>' +
      '<w:lang w:val="en-US" w:eastAsia="zh-CN"/>' +
      '</w:rPr></w:rPrDefault>' +
      '<w:pPrDefault><w:pPr><w:spacing w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault>' +
      '</w:docDefaults>' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal">' +
      '<w:name w:val="Normal"/><w:qFormat/></w:style>' +
      '<w:style w:type="table" w:default="1" w:styleId="TableNormal">' +
      '<w:name w:val="Normal Table"/><w:qFormat/>' +
      '<w:tblPr>' + TBL_CELL_MAR + '</w:tblPr></w:style>' +
      '</w:styles>';
  }

  function buildContentTypes(hasFooter, images) {
    var exts = {};
    (images || []).forEach(function (img) {
      var ext = imageExt(img.mime);
      exts[ext] = true;
    });
    var imageDefaults = Object.keys(exts).map(function (ext) {
      var mime = ext === 'png' ? 'image/png' : (ext === 'gif' ? 'image/gif' : 'image/jpeg');
      return '<Default Extension="' + ext + '" ContentType="' + mime + '"/>';
    }).join('');
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      imageDefaults +
      '<Override PartName="/word/document.xml" ' +
      'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ' +
      'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      (hasFooter
        ? '<Override PartName="/word/footer1.xml" ' +
          'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>'
        : '') +
      '</Types>';
  }

  function buildRootRels() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" ' +
      'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" ' +
      'Target="word/document.xml"/></Relationships>';
  }

  function buildDocumentRels(hasFooter, images) {
    var imgRels = (images || []).map(function (img) {
      return '<Relationship Id="' + img.rid + '" ' +
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" ' +
        'Target="media/' + img.name + '"/>';
    }).join('');
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" ' +
      'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" ' +
      'Target="styles.xml"/>' +
      (hasFooter
        ? '<Relationship Id="rId2" ' +
          'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" ' +
          'Target="footer1.xml"/>'
        : '') +
      imgRels +
      '</Relationships>';
  }

  /**
   * 渲染 DocSpec 为 .docx Blob。
   * @param {object} doc DocSpec
   * @returns {Blob} MIME 为 docx
   */
  function render(doc) {
    var spec = doc && typeof doc === 'object' ? doc : {};
    var footerText = spec.footer == null ? '' : String(spec.footer);
    var hasFooter = footerText !== '';

    IMG_STATE = { images: [] };
    var documentXml = buildDocumentXml(spec);
    var images = IMG_STATE.images;
    IMG_STATE = null;

    var entries = [
      { name: '[Content_Types].xml', data: buildContentTypes(hasFooter, images) },
      { name: '_rels/.rels', data: buildRootRels() },
      { name: 'word/document.xml', data: documentXml },
      { name: 'word/_rels/document.xml.rels', data: buildDocumentRels(hasFooter, images) },
      { name: 'word/styles.xml', data: buildStylesXml() }
    ];
    if (hasFooter) entries.push({ name: 'word/footer1.xml', data: buildFooterXml(footerText) });
    images.forEach(function (img) {
      entries.push({ name: 'word/media/' + img.name, data: img.bytes });
    });

    var zip = global.CLUB && global.CLUB.zip;
    if (!zip || typeof zip.createBytes !== 'function') {
      throw new Error('CLUB.docx.render 依赖 CLUB.zip，请先加载 js/lib/zip.js');
    }
    var bytes = zip.createBytes(entries);
    if (typeof Blob !== 'undefined') return new Blob([bytes], { type: DOCX_MIME });
    return bytes;
  }

  /**
   * 浏览器中触发下载；Node/无 DOM 环境下为空操作。
   * @param {Blob} blob 文件内容
   * @param {string} filename 文件名
   */
  function download(blob, filename) {
    try {
      if (!blob) return;
      if (typeof document === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) return;
      var url = URL.createObjectURL(blob);
      var link = document.createElement('a');
      link.href = url;
      link.download = filename || 'document.docx';
      if (document.body && typeof document.body.appendChild === 'function') {
        document.body.appendChild(link);
        link.click();
        if (link.parentNode) link.parentNode.removeChild(link);
      } else if (typeof link.click === 'function') {
        link.click();
      }
      if (typeof setTimeout === 'function') {
        setTimeout(function () {
          try { URL.revokeObjectURL(url); } catch (e) { /* 忽略 */ }
        }, 1000);
      } else {
        try { URL.revokeObjectURL(url); } catch (e) { /* 忽略 */ }
      }
    } catch (e) {
      // Node 或受限环境下安静失败
    }
  }

  global.CLUB = global.CLUB || {};
  global.CLUB.docx = {
    render: render,
    download: download
  };
})(typeof window !== 'undefined' ? window : globalThis);

