/* ---- js/lib/xlsx.js ---- */
/**
 * CLUB.xlsx —— 零依赖 OOXML 电子表格读写
 * 读取：正则/字符串解析 xlsx（ZIP + XML），支持 workbook→rels 映射、sharedStrings 富文本、
 *       日期样式识别、合并单元格、空洞列与空行处理；不依赖 DOM。
 * 写出：生成 Excel/WPS 可打开的合法 xlsx（表头加粗灰底、冻结首行、筛选、列宽、自动换行）。
 * 依赖：CLUB.zip（加载顺序 zip.js 在前）、TextEncoder/TextDecoder、Blob、DecompressionStream。
 */
(function (global) {
  'use strict';

  var XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  // ---------------------------------------------------------------------------
  // 基础工具：UTF-8、XML 转义/反转义、属性提取
  // ---------------------------------------------------------------------------

  /** 字符串 → UTF-8 字节 */
  function utf8Encode(str) {
    var s = String(str == null ? '' : str);
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s);
    var out = [];
    for (var i = 0; i < s.length; i++) {
      var code = s.charCodeAt(i);
      if (code < 0x80) out.push(code);
      else if (code < 0x800) out.push(0xC0 | (code >> 6), 0x80 | (code & 0x3F));
      else out.push(0xE0 | (code >> 12), 0x80 | ((code >> 6) & 0x3F), 0x80 | (code & 0x3F));
    }
    return new Uint8Array(out);
  }

  /** UTF-8 字节 → 字符串 */
  function utf8Decode(bytes) {
    if (bytes == null) return '';
    if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8').decode(bytes);
    var out = '';
    for (var i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
    try {
      return decodeURIComponent(escape(out));
    } catch (e) {
      return out;
    }
  }

  /** 去掉 XML 注释 */
  function stripComments(xml) {
    return String(xml == null ? '' : xml).replace(/<!--[\s\S]*?-->/g, '');
  }

  /** 过滤 XML 1.0 非法字符，并把孤立代理项替换为 U+FFFD */
  function sanitizeXmlText(value) {
    var s = String(value == null ? '' : value);
    s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '');
    s = s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '\uFFFD');
    s = s.replace(/(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '$1\uFFFD');
    return s;
  }

  /** XML 文本转义 */
  function escapeXml(value) {
    return sanitizeXmlText(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /** XML 实体反转义 */
  function decodeXmlEntities(str) {
    if (str == null) return '';
    return String(str).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, function (m, ent) {
      if (ent.charAt(0) === '#') {
        var code = ent.charAt(1).toLowerCase() === 'x'
          ? parseInt(ent.slice(2), 16)
          : parseInt(ent.slice(1), 10);
        if (!isFinite(code) || code < 0 || code > 0x10FFFF || (code >= 0xD800 && code <= 0xDFFF)) return m;
        try {
          return String.fromCodePoint(code);
        } catch (e) {
          return m;
        }
      }
      switch (ent) {
        case 'amp': return '&';
        case 'lt': return '<';
        case 'gt': return '>';
        case 'quot': return '"';
        case 'apos': return "'";
        case 'nbsp': return '\u00A0';
        default: return m;
      }
    });
  }

  /** 从标签属性串中提取属性值（已做实体反转义） */
  function getAttr(tag, name) {
    if (tag == null || name == null) return null;
    var escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var re = new RegExp('(?:^|\\s)' + escaped + '\\s*=\\s*("([^"]*)"|\'([^\']*)\')');
    var m = re.exec(String(tag));
    if (!m) return null;
    return decodeXmlEntities(m[2] != null ? m[2] : m[3]);
  }

  // ---------------------------------------------------------------------------
  // ZIP 解包（读取 xlsx 用）：支持 STORE 与 deflate-raw
  // ---------------------------------------------------------------------------

  function readU16(bytes, p) {
    if (p < 0 || p + 1 >= bytes.length) return 0;
    return bytes[p] | (bytes[p + 1] << 8);
  }

  function readU32(bytes, p) {
    if (p < 0 || p + 3 >= bytes.length) return 0;
    return (bytes[p] | (bytes[p + 1] << 8) | (bytes[p + 2] << 16) | (bytes[p + 3] << 24)) >>> 0;
  }

  /** 从末尾查找 EOCD 记录偏移 */
  function findEocd(bytes) {
    var start = Math.max(0, bytes.length - 22 - 65535);
    for (var i = bytes.length - 22; i >= start; i--) {
      if (bytes[i] === 0x50 && bytes[i + 1] === 0x4B && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) {
        return i;
      }
    }
    return -1;
  }

  /** 汇编分块字节 */
  function joinChunks(chunks, total) {
    var out = new Uint8Array(total);
    var offset = 0;
    for (var i = 0; i < chunks.length; i++) {
      out.set(chunks[i], offset);
      offset += chunks[i].length;
    }
    return out;
  }

  /** 用 DecompressionStream('deflate-raw') 解压 */
  async function inflateRaw(data) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('当前环境不支持 Deflate 解压');
    }
    var ds = new DecompressionStream('deflate-raw');
    var readable;
    var writePromise = null;
    if (typeof Blob !== 'undefined') {
      readable = new Blob([data]).stream().pipeThrough(ds);
    } else {
      var writer = ds.writable.getWriter();
      writePromise = writer.write(data).then(function () { return writer.close(); });
      readable = ds.readable;
    }
    var reader = readable.getReader();
    var chunks = [];
    var total = 0;
    while (true) {
      var result = await reader.read();
      if (result.done) break;
      chunks.push(result.value);
      total += result.value.length;
    }
    if (writePromise) await writePromise;
    return joinChunks(chunks, total);
  }

  /** 解析 ZIP 中央目录，返回按名称取内容的方法 */
  async function unzip(bytes) {
    var eocd = findEocd(bytes);
    if (eocd < 0) throw new Error('不是有效的 ZIP 文件');
    var total = readU16(bytes, eocd + 10);
    var cdOffset = readU32(bytes, eocd + 16);
    if (total === 0 || cdOffset <= 0 || cdOffset >= bytes.length) throw new Error('ZIP 中央目录为空');
    var entries = new Map();
    var p = cdOffset;
    for (var i = 0; i < total; i++) {
      if (readU32(bytes, p) !== 0x02014B50) break;
      var method = readU16(bytes, p + 10);
      var csize = readU32(bytes, p + 20);
      var usize = readU32(bytes, p + 24);
      var nameLen = readU16(bytes, p + 28);
      var extraLen = readU16(bytes, p + 30);
      var commentLen = readU16(bytes, p + 32);
      var localOff = readU32(bytes, p + 42);
      var nameStart = p + 46;
      if (nameStart + nameLen > bytes.length) break;
      var name = utf8Decode(bytes.subarray(nameStart, nameStart + nameLen)).replace(/\\/g, '/');
      var localNameLen = readU16(bytes, localOff + 26);
      var localExtraLen = readU16(bytes, localOff + 28);
      var dataStart = localOff + 30 + localNameLen + localExtraLen;
      if (dataStart >= 0 && dataStart + csize <= bytes.length) {
        var entry = { method: method, data: bytes.subarray(dataStart, dataStart + csize), size: usize };
        entries.set(name, entry);
        if (!entries.has(name.toLowerCase())) entries.set(name.toLowerCase(), entry);
      }
      p = nameStart + nameLen + extraLen + commentLen;
    }

    async function getBytes(name) {
      if (name == null) return null;
      var entry = entries.get(String(name));
      if (!entry) entry = entries.get(String(name).toLowerCase());
      if (!entry) return null;
      if (entry.method === 0) return entry.data;
      if (entry.method === 8) return await inflateRaw(entry.data);
      throw new Error('不支持的 ZIP 压缩方式: ' + entry.method);
    }

    async function getText(name) {
      var data = await getBytes(name);
      return data == null ? null : utf8Decode(data);
    }

    return { getBytes: getBytes, getText: getText };
  }

  /** 把 ArrayBuffer / TypedArray / Blob / 字符串统一成字节 */
  async function toBytesInput(input) {
    if (input == null) return null;
    if (typeof input === 'string') return utf8Encode(input);
    if (typeof Uint8Array !== 'undefined' && input instanceof Uint8Array) return input;
    if (typeof input.byteLength === 'number' && typeof input.slice === 'function') {
      if (input.buffer && typeof input.byteOffset === 'number') {
        return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
      }
      try {
        return new Uint8Array(input);
      } catch (e) {
        return null;
      }
    }
    if (typeof input.arrayBuffer === 'function') {
      try {
        return new Uint8Array(await input.arrayBuffer());
      } catch (e) {
        return null;
      }
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // xlsx 读取：sharedStrings / styles / workbook / sheet
  // ---------------------------------------------------------------------------

  /** 解析 sharedStrings.xml，支持 <r> 富文本与 <rPh> 过滤 */
  function parseSharedStrings(xml) {
    var out = [];
    if (!xml) return out;
    var text = stripComments(xml);
    var re = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
    var m;
    while ((m = re.exec(text))) {
      out.push(itemText(m[1] || ''));
    }
    return out;
  }

  /** 从 <si>/<is> 内部提取纯文本（拼接所有 <t>，忽略注音） */
  function itemText(inner) {
    var body = String(inner || '').replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
    var re = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    var parts = [];
    var m;
    while ((m = re.exec(body))) parts.push(decodeXmlEntities(m[1]));
    return parts.join('');
  }

  function isDateFormatId(id, customFormats) {
    if (id >= 14 && id <= 22) return true;
    if (id >= 45 && id <= 47) return true;
    if (id >= 27 && id <= 36) return true;
    if (id >= 50 && id <= 58) return true;
    if (Object.prototype.hasOwnProperty.call(customFormats, id)) {
      return isDateFormatCode(customFormats[id]);
    }
    return false;
  }

  /** 判断自定义格式串是否日期/时间格式 */
  function isDateFormatCode(code) {
    if (!code) return false;
    var s = String(code);
    s = s.replace(/"[^"]*"/g, '');     // 引号内为字面量
    s = s.replace(/\\./g, '');         // 转义字符
    s = s.replace(/\[[^\]]*\]/g, '');  // [Red]、[$-409]、[h] 等
    s = s.replace(/\*./g, '');         // 填充字符
    s = s.replace(/_.?/g, '');         // 占位宽度
    return /[ymdhs]/i.test(s);
  }

  /** 解析 styles.xml，得出哪些 cellXfs 下标是日期/时间格式 */
  function parseStyles(xml) {
    var noDate = { isDate: function () { return false; } };
    if (!xml) return noDate;
    var text = stripComments(xml);
    var customFormats = {};
    var nfRe = /<numFmt\b([^>]*?)\/?>/g;
    var m;
    while ((m = nfRe.exec(text))) {
      var nfId = parseInt(getAttr(m[1], 'numFmtId'), 10);
      if (isFinite(nfId)) customFormats[nfId] = getAttr(m[1], 'formatCode') || '';
    }
    var flags = [];
    var xfBlock = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(text);
    if (xfBlock) {
      var xfRe = /<xf\b([^>]*?)\/?>/g;
      while ((m = xfRe.exec(xfBlock[1]))) {
        var id = parseInt(getAttr(m[1], 'numFmtId'), 10);
        flags.push(isDateFormatId(isFinite(id) ? id : 0, customFormats));
      }
    }
    return {
      isDate: function (index) {
        return !!flags[index];
      }
    };
  }

  var DAY_MS = 86400000;

  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function padYear(y) {
    var s = String(y);
    while (s.length < 4) s = '0' + s;
    return s;
  }

  /**
   * Excel 序列号 → 日期文本。
   * 整数（或小数部分为 0）→ YYYY-MM-DD；含时间 → YYYY-MM-DD HH:mm。
   * @param {number} serial Excel 日期序列号
   * @param {boolean} date1904 是否 1904 日期系统
   */
  function excelSerialToText(serial, date1904) {
    if (typeof serial !== 'number' || !isFinite(serial)) return '';
    var days = Math.floor(serial);
    var fraction = serial - days;
    if (fraction < 0) {
      fraction += 1;
      days -= 1;
    }
    var minutes = Math.floor(fraction * 1440 + 1e-6);
    if (minutes >= 1440) {
      minutes = 0;
      days += 1;
    }
    var hasTime = minutes > 0;
    var baseMs;
    if (date1904) {
      baseMs = Date.UTC(1904, 0, 1) + days * DAY_MS;
    } else if (days >= 60) {
      baseMs = Date.UTC(1899, 11, 30) + days * DAY_MS;
    } else {
      baseMs = Date.UTC(1899, 11, 31) + days * DAY_MS;
    }
    var d = new Date(baseMs);
    var year = d.getUTCFullYear();
    var month = d.getUTCMonth() + 1;
    var day = d.getUTCDate();
    var text = padYear(year) + '-' + pad2(month) + '-' + pad2(day);
    if (hasTime) {
      text += ' ' + pad2(Math.floor(minutes / 60)) + ':' + pad2(minutes % 60);
    }
    return text;
  }

  /** 列字母 → 0 基列号 */
  function colIndexFromLetters(letters) {
    var s = String(letters).toUpperCase();
    var n = 0;
    for (var i = 0; i < s.length; i++) {
      var code = s.charCodeAt(i);
      if (code < 65 || code > 90) return -1;
      n = n * 26 + (code - 64);
    }
    return n - 1;
  }

  /** "A1" → { row: 0, col: 0 }（行列为 0 基） */
  function parseCellRef(ref) {
    var m = /^\s*([A-Za-z]+)(\d+)\s*$/.exec(String(ref == null ? '' : ref));
    if (!m) return null;
    var col = colIndexFromLetters(m[1]);
    var row = parseInt(m[2], 10);
    if (col < 0 || !isFinite(row) || row < 1) return null;
    return { row: row - 1, col: col };
  }

  /** 解析合并区域（0 基坐标） */
  function parseMergeRanges(text) {
    var ranges = [];
    var block = /<mergeCells\b[^>]*>([\s\S]*?)<\/mergeCells>/.exec(text);
    if (!block) return ranges;
    var re = /<mergeCell\b([^>]*?)\/?>/g;
    var m;
    while ((m = re.exec(block[1]))) {
      var ref = getAttr(m[1], 'ref');
      if (!ref) continue;
      var parts = String(ref).split(':');
      var a = parseCellRef(parts[0]);
      var b = parseCellRef(parts[1] || parts[0]);
      if (!a || !b) continue;
      ranges.push({
        r1: Math.min(a.row, b.row),
        c1: Math.min(a.col, b.col),
        r2: Math.max(a.row, b.row),
        c2: Math.max(a.col, b.col)
      });
    }
    return ranges;
  }

  /** 判断单元格是否落在合并区域内且不是左上角 */
  function isMergedNonAnchor(ranges, row, col) {
    for (var i = 0; i < ranges.length; i++) {
      var r = ranges[i];
      if (row >= r.r1 && row <= r.r2 && col >= r.c1 && col <= r.c2) {
        return !(row === r.r1 && col === r.c1);
      }
    }
    return false;
  }

  /** 解析单元格取值 */
  function parseCellValue(inner, type, styleIdx, shared, styles, date1904) {
    var t = type == null ? '' : String(type);
    if (t === 'inlineStr') {
      var isMatch = /<is\b[^>]*>([\s\S]*?)<\/is>/.exec(inner);
      return itemText(isMatch ? isMatch[1] : inner);
    }
    var vMatch = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner);
    var raw = vMatch ? vMatch[1] : '';
    if (t === 's') {
      var idx = parseInt(raw, 10);
      if (!isFinite(idx) || idx < 0 || idx >= shared.length) return '';
      return shared[idx] == null ? '' : shared[idx];
    }
    if (t === 'b') {
      if (raw === '') return '';
      return (raw === '1' || /^true$/i.test(raw)) ? 'TRUE' : 'FALSE';
    }
    if (t === 'e') return '';
    if (t === 'str' || t === 'd') return decodeXmlEntities(raw);
    if (raw === '') return '';
    var num = Number(raw);
    if (!isFinite(num)) return '';
    if (styles && styles.isDate(styleIdx)) {
      var formatted = excelSerialToText(num, date1904);
      if (formatted !== '') return formatted;
    }
    return num;
  }

  /** 解析工作表 XML → rows（紧凑行，去掉整行为空的行与行尾空单元格） */
  function parseSheet(xml, shared, styles, date1904) {
    var text = stripComments(xml);
    var merges = parseMergeRanges(text);
    var rowMap = {};
    var autoRow = 0;
    var rowRe = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g;
    var m;
    while ((m = rowRe.exec(text))) {
      var rowAttrs = m[1] || '';
      var rowInner = m[2] || '';
      var rowNum = parseInt(getAttr(rowAttrs, 'r'), 10);
      if (!isFinite(rowNum) || rowNum <= 0) rowNum = autoRow + 1;
      autoRow = rowNum;
      var cells = {};
      var colCursor = -1;
      var cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
      var cm;
      while ((cm = cellRe.exec(rowInner))) {
        var cAttrs = cm[1] || '';
        var cInner = cm[2] || '';
        var ref = getAttr(cAttrs, 'r');
        var col = -1;
        if (ref) {
          var refMatch = /^\s*([A-Za-z]+)/.exec(ref);
          if (refMatch) col = colIndexFromLetters(refMatch[1]);
        }
        if (col < 0) col = colCursor + 1;
        colCursor = col;
        var type = getAttr(cAttrs, 't');
        var styleRaw = getAttr(cAttrs, 's');
        var styleIdx = styleRaw == null ? 0 : (parseInt(styleRaw, 10) || 0);
        var value = parseCellValue(cInner, type, styleIdx, shared, styles, date1904);
        if (isMergedNonAnchor(merges, rowNum - 1, col)) value = '';
        cells[col] = value;
      }
      rowMap[rowNum] = cells;
    }

    var rowNumbers = Object.keys(rowMap).map(Number).sort(function (a, b) { return a - b; });
    var rows = [];
    for (var i = 0; i < rowNumbers.length; i++) {
      var cellMap = rowMap[rowNumbers[i]];
      var maxCol = -1;
      for (var key in cellMap) {
        if (Object.prototype.hasOwnProperty.call(cellMap, key)) {
          var c = parseInt(key, 10);
          if (c > maxCol) maxCol = c;
        }
      }
      if (maxCol < 0) continue;
      var arr = [];
      for (var c2 = 0; c2 <= maxCol; c2++) {
        arr.push(Object.prototype.hasOwnProperty.call(cellMap, c2) ? cellMap[c2] : '');
      }
      while (arr.length && (arr[arr.length - 1] === '' || arr[arr.length - 1] == null)) arr.pop();
      if (arr.length) rows.push(arr);
    }
    return rows;
  }

  /** 解析 workbook.xml：sheet 名称与 r:id、日期系统 */
  function parseWorkbook(xml) {
    var text = stripComments(xml);
    var date1904 = false;
    var wbPr = /<workbookPr\b([^>]*?)\/?>/.exec(text);
    if (wbPr) {
      var flag = getAttr(wbPr[1], 'date1904');
      date1904 = flag === '1' || flag === 'true';
    }
    var sheets = [];
    var re = /<sheet\b([^>]*?)\/?>/g;
    var m;
    while ((m = re.exec(text))) {
      var attrs = m[1] || '';
      sheets.push({
        name: getAttr(attrs, 'name') || '',
        rid: getAttr(attrs, 'r:id') || '',
        sheetId: getAttr(attrs, 'sheetId') || ''
      });
    }
    return { sheets: sheets, date1904: date1904 };
  }

  /** 解析 workbook.xml.rels：rId → Target */
  function parseRels(xml) {
    var map = {};
    if (!xml) return map;
    var text = stripComments(xml);
    var re = /<Relationship\b([^>]*?)\/?>/g;
    var m;
    while ((m = re.exec(text))) {
      var id = getAttr(m[1], 'Id');
      var target = getAttr(m[1], 'Target');
      if (id) map[id] = target || '';
    }
    return map;
  }

  /** 关系 Target → 包内绝对路径（不带前导斜杠） */
  function resolveTarget(target) {
    var t = String(target == null ? '' : target).replace(/\\/g, '/');
    if (!t) return '';
    if (t.charAt(0) === '/') return t.slice(1);
    if (/^xl\//i.test(t)) return t;
    var base = ['xl'];
    var segs = t.split('/');
    for (var i = 0; i < segs.length; i++) {
      var seg = segs[i];
      if (!seg || seg === '.') continue;
      if (seg === '..') {
        if (base.length > 1) base.pop();
      } else {
        base.push(seg);
      }
    }
    return base.join('/');
  }

  /**
   * 读取 xlsx。
   * @param {ArrayBuffer|Uint8Array|Blob} input xlsx 文件内容
   * @returns {Promise<Array<{name:string, rows:Array<Array<string|number>>}>>}
   */
  async function read(input) {
    try {
      var bytes = await toBytesInput(input);
      if (!bytes || bytes.length < 22) return [];
      var archive;
      try {
        archive = await unzip(bytes);
      } catch (e) {
        return [];
      }
      var wbXml;
      try {
        wbXml = await archive.getText('xl/workbook.xml');
      } catch (e) {
        return [];
      }
      if (!wbXml) return [];
      var relsXml = null;
      var sharedXml = null;
      var stylesXml = null;
      try {
        relsXml = await archive.getText('xl/_rels/workbook.xml.rels');
      } catch (e) { relsXml = null; }
      try {
        sharedXml = await archive.getText('xl/sharedStrings.xml');
      } catch (e) { sharedXml = null; }
      try {
        stylesXml = await archive.getText('xl/styles.xml');
      } catch (e) { stylesXml = null; }

      var workbook = parseWorkbook(wbXml);
      var rels = parseRels(relsXml);
      var shared = parseSharedStrings(sharedXml);
      var styles = parseStyles(stylesXml);
      var result = [];

      for (var i = 0; i < workbook.sheets.length; i++) {
        var sheet = workbook.sheets[i];
        var target = rels[sheet.rid];
        if (!target) target = 'worksheets/sheet' + (i + 1) + '.xml';
        var path = resolveTarget(target);
        var rows = [];
        try {
          var sheetXml = path ? await archive.getText(path) : null;
          if (sheetXml) rows = parseSheet(sheetXml, shared, styles, workbook.date1904);
        } catch (e) {
          rows = [];
        }
        result.push({ name: sheet.name, rows: rows });
      }
      return result;
    } catch (e) {
      return [];
    }
  }

  // ---------------------------------------------------------------------------
  // xlsx 写出
  // ---------------------------------------------------------------------------

  /** 列号（1 基）→ 列字母 */
  function colLetter(index) {
    var n = Math.floor(index);
    var s = '';
    while (n > 0) {
      var rem = (n - 1) % 26;
      s = String.fromCharCode(65 + rem) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s || 'A';
  }

  /** 工作表名清洗：去非法字符、限 31 字符、非空、去重（不区分大小写） */
  function cleanSheetName(raw, used, index) {
    var s = raw == null ? '' : String(raw);
    s = s.replace(/[\[\]:*?\/\\]/g, '');
    s = s.replace(/[\u0000-\u001F]/g, '');
    s = s.replace(/^'+|'+$/g, '');
    s = s.trim();
    if (!s) s = 'Sheet' + (index + 1);
    var chars = Array.from(s);
    if (chars.length > 31) s = chars.slice(0, 31).join('');
    if (!s) s = 'Sheet' + (index + 1);
    var base = s;
    var n = 2;
    while (used[s.toLowerCase()]) {
      var suffix = ' (' + n + ')';
      var keep = Math.max(1, 31 - suffix.length);
      s = Array.from(base).slice(0, keep).join('') + suffix;
      n++;
    }
    used[s.toLowerCase()] = true;
    return s;
  }

  /** 基础行数据规范化 */
  function normalizeRows(rows) {
    if (!Array.isArray(rows)) return [];
    return rows.map(function (row) {
      if (Array.isArray(row)) return row;
      if (row == null) return [];
      return [row];
    });
  }

  function repeatChar(ch, n) {
    var s = '';
    for (var i = 0; i < n; i++) s += ch;
    return s;
  }

  /** 数字安全转换为 XML 文本（避免部分阅读器不接受科学计数法） */
  function numberToXml(n) {
    if (Object.is(n, -0)) return '0';
    var s = String(n);
    if (!/e/i.test(s)) return s;
    var m = /^(-?)(\d+)(?:\.(\d+))?e([+-]?\d+)$/i.exec(s);
    if (!m) return s;
    var sign = m[1];
    var intPart = m[2];
    var fracPart = m[3] || '';
    var exp = parseInt(m[4], 10);
    var digits = intPart + fracPart;
    var point = intPart.length + exp;
    if (Math.abs(point) > 400) return s;
    if (point <= 0) return sign + '0.' + repeatChar('0', -point) + digits;
    if (point >= digits.length) return sign + digits + repeatChar('0', point - digits.length);
    return sign + digits.slice(0, point) + '.' + digits.slice(point);
  }

  /** 单元格文本截断到 Excel 上限 32767 字符 */
  function cellText(value) {
    var s = String(value == null ? '' : value);
    if (s.length > 32767) s = s.slice(0, 32767);
    return s;
  }

  /** 生成工作表 XML */
  function buildSheetXml(rows, widths) {
    var maxCols = 0;
    var lastDataRow = 0;
    var i;
    for (i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (!row || !row.length) continue;
      var len = row.length;
      while (len > 0 && (row[len - 1] == null || row[len - 1] === '')) len--;
      if (len === 0) continue;
      lastDataRow = i + 1;
      if (len > maxCols) maxCols = len;
    }
    var widthList = Array.isArray(widths) ? widths : [];
    if (widthList.length > maxCols) maxCols = widthList.length;

    var rowChunks = [];
    for (i = 0; i < rows.length; i++) {
      var cells = [];
      var r = rows[i] || [];
      for (var j = 0; j < r.length; j++) {
        var value = r[j];
        if (value == null || value === '') continue;
        var ref = colLetter(j + 1) + (i + 1);
        var style = i === 0 ? 1 : 2;
        if (typeof value === 'number') {
          if (!isFinite(value)) continue;
          cells.push('<c r="' + ref + '" s="' + style + '"><v>' + numberToXml(value) + '</v></c>');
        } else if (typeof value === 'string' || typeof value === 'boolean') {
          var text = cellText(typeof value === 'boolean' ? (value ? 'TRUE' : 'FALSE') : value);
          if (text === '') continue;
          cells.push(
            '<c r="' + ref + '" s="' + style + '" t="inlineStr"><is><t xml:space="preserve">' +
            escapeXml(text) + '</t></is></c>'
          );
        }
      }
      if (cells.length) rowChunks.push('<row r="' + (i + 1) + '">' + cells.join('') + '</row>');
    }

    var colsChunks = [];
    for (var c = 0; c < maxCols; c++) {
      var w = widthList[c];
      if (typeof w !== 'number' || !isFinite(w)) w = 14;
      w = Math.max(1, Math.min(255, w));
      colsChunks.push('<col min="' + (c + 1) + '" max="' + (c + 1) + '" width="' + (Math.round(w * 100) / 100) + '" customWidth="1"/>');
    }

    var autoFilter = '';
    if (maxCols > 0 && lastDataRow > 0) {
      autoFilter = '<autoFilter ref="A1:' + colLetter(maxCols) + lastDataRow + '"/>';
    }

    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetViews><sheetView workbookViewId="0">' +
      '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
      '<selection pane="bottomLeft" activeCell="A2" sqref="A2"/>' +
      '</sheetView></sheetViews>' +
      '<sheetFormatPr defaultRowHeight="16.5"/>' +
      (colsChunks.length ? '<cols>' + colsChunks.join('') + '</cols>' : '') +
      '<sheetData>' + rowChunks.join('') + '</sheetData>' +
      autoFilter +
      '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>' +
      '</worksheet>';
  }

  /** 生成 styles.xml：表头加粗浅灰底、细边框、自动换行、垂直居中 */
  function buildStylesXml() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<fonts count="2">' +
      '<font><sz val="11"/><name val="宋体"/><charset val="134"/></font>' +
      '<font><b/><sz val="11"/><name val="宋体"/><charset val="134"/></font>' +
      '</fonts>' +
      '<fills count="3">' +
      '<fill><patternFill patternType="none"/></fill>' +
      '<fill><patternFill patternType="gray125"/></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/><bgColor rgb="FFF2F2F2"/></patternFill></fill>' +
      '</fills>' +
      '<borders count="2">' +
      '<border><left/><right/><top/><bottom/><diagonal/></border>' +
      '<border><left style="thin"><color rgb="FFBFBFBF"/></left><right style="thin"><color rgb="FFBFBFBF"/></right>' +
      '<top style="thin"><color rgb="FFBFBFBF"/></top><bottom style="thin"><color rgb="FFBFBFBF"/></bottom><diagonal/></border>' +
      '</borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="3">' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>' +
      '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>' +
      '</cellXfs>' +
      '<cellStyles count="1"><cellStyle name="常规" xfId="0" builtinId="0"/></cellStyles>' +
      '</styleSheet>';
  }

  function buildWorkbookXml(sheets) {
    var items = [];
    for (var i = 0; i < sheets.length; i++) {
      items.push('<sheet name="' + escapeXml(sheets[i].name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>');
    }
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<bookViews><workbookView xWindow="0" yWindow="0" windowWidth="24000" windowHeight="12000"/></bookViews>' +
      '<sheets>' + items.join('') + '</sheets>' +
      '<calcPr calcId="191029"/>' +
      '</workbook>';
  }

  function buildWorkbookRels(count) {
    var items = [];
    for (var i = 0; i < count; i++) {
      items.push('<Relationship Id="rId' + (i + 1) + '" ' +
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" ' +
        'Target="worksheets/sheet' + (i + 1) + '.xml"/>');
    }
    items.push('<Relationship Id="rId' + (count + 1) + '" ' +
      'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>');
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      items.join('') + '</Relationships>';
  }

  function buildRootRels() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" ' +
      'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" ' +
      'Target="xl/workbook.xml"/></Relationships>';
  }

  function buildContentTypes(sheetCount) {
    var items = [
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
      '<Default Extension="xml" ContentType="application/xml"/>',
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
    ];
    for (var i = 1; i <= sheetCount; i++) {
      items.push('<Override PartName="/xl/worksheets/sheet' + i + '.xml" ' +
        'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>');
    }
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      items.join('') + '</Types>';
  }

  /**
   * 生成 xlsx 文件。
   * @param {Array<{name:string, rows:Array<Array<string|number|null>>, widths?:number[]}>} sheets
   * @returns {Blob} MIME 为 xlsx
   */
  function write(sheets) {
    var list = Array.isArray(sheets) ? sheets : [];
    if (!list.length) list = [{ name: 'Sheet1', rows: [] }];
    var used = {};
    var prepared = [];
    for (var i = 0; i < list.length; i++) {
      var item = (list[i] && typeof list[i] === 'object') ? list[i] : {};
      var name = cleanSheetName(item.name, used, i);
      prepared.push({
        name: name,
        rows: normalizeRows(item.rows),
        widths: Array.isArray(item.widths) ? item.widths : []
      });
    }

    var entries = [
      { name: '[Content_Types].xml', data: buildContentTypes(prepared.length) },
      { name: '_rels/.rels', data: buildRootRels() },
      { name: 'xl/workbook.xml', data: buildWorkbookXml(prepared) },
      { name: 'xl/_rels/workbook.xml.rels', data: buildWorkbookRels(prepared.length) },
      { name: 'xl/styles.xml', data: buildStylesXml() }
    ];
    for (var k = 0; k < prepared.length; k++) {
      entries.push({
        name: 'xl/worksheets/sheet' + (k + 1) + '.xml',
        data: buildSheetXml(prepared[k].rows, prepared[k].widths)
      });
    }

    var zip = global.CLUB && global.CLUB.zip;
    if (!zip || typeof zip.createBytes !== 'function') {
      throw new Error('CLUB.xlsx.write 依赖 CLUB.zip，请先加载 js/lib/zip.js');
    }
    var bytes = zip.createBytes(entries);
    if (typeof Blob !== 'undefined') return new Blob([bytes], { type: XLSX_MIME });
    return bytes;
  }

  global.CLUB = global.CLUB || {};
  global.CLUB.xlsx = {
    read: read,
    write: write
  };
})(typeof window !== 'undefined' ? window : globalThis);

