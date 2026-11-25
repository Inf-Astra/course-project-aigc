/* ---- js/lib/zip.js ---- */
/**
 * CLUB.zip —— 零依赖 ZIP 打包工具（STORE 方式 / 确定性输出）
 * 仅依赖 TextEncoder、Uint8Array、Blob，可在浏览器与 Node 中运行。
 * 所有条目以 STORE（method 0）写入，DOS 时间固定为 1980-01-01 00:00，
 * 文件名使用 UTF-8 编码并置位通用标志 bit 11，保证同样输入得到字节级相同输出。
 */
(function (global) {
  'use strict';

  var CRC_TABLE = null;

  /** 生成（并缓存）CRC32 查表 */
  function crcTable() {
    if (CRC_TABLE) return CRC_TABLE;
    var table = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[n] = c >>> 0;
    }
    CRC_TABLE = table;
    return table;
  }

  /** 把各种二进制输入统一成 Uint8Array（不复制原数组） */
  function asBytes(data) {
    if (data == null) return new Uint8Array(0);
    if (typeof data === 'string') return utf8Encode(data);
    if (typeof Uint8Array !== 'undefined' && data instanceof Uint8Array) return data;
    if (typeof data.byteLength === 'number' && typeof data.slice === 'function') {
      // ArrayBuffer 或其它 TypedArray / DataView
      if (data.buffer && typeof data.byteOffset === 'number') {
        return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      }
      return new Uint8Array(data);
    }
    return new Uint8Array(0);
  }

  /** UTF-8 编码（优先 TextEncoder，缺失时手工编码） */
  function utf8Encode(str) {
    var s = String(str == null ? '' : str);
    if (typeof TextEncoder !== 'undefined') {
      return new TextEncoder().encode(s);
    }
    var out = [];
    for (var i = 0; i < s.length; i++) {
      var code = s.charCodeAt(i);
      if (code >= 0xD800 && code <= 0xDBFF && i + 1 < s.length) {
        var next = s.charCodeAt(i + 1);
        if (next >= 0xDC00 && next <= 0xDFFF) {
          code = 0x10000 + ((code - 0xD800) << 10) + (next - 0xDC00);
          i++;
        }
      }
      if (code < 0x80) {
        out.push(code);
      } else if (code < 0x800) {
        out.push(0xC0 | (code >> 6), 0x80 | (code & 0x3F));
      } else if (code < 0x10000) {
        out.push(0xE0 | (code >> 12), 0x80 | ((code >> 6) & 0x3F), 0x80 | (code & 0x3F));
      } else {
        out.push(
          0xF0 | (code >> 18),
          0x80 | ((code >> 12) & 0x3F),
          0x80 | ((code >> 6) & 0x3F),
          0x80 | (code & 0x3F)
        );
      }
    }
    return new Uint8Array(out);
  }

  /** 计算 Uint8Array 的 CRC32，返回无符号 32 位整数 */
  function crc32(bytes) {
    var data = asBytes(bytes);
    var table = crcTable();
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < data.length; i++) {
      crc = (crc >>> 8) ^ table[(crc ^ data[i]) & 0xFF];
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function u16(value) {
    var n = value & 0xFFFF;
    return new Uint8Array([n & 0xFF, (n >>> 8) & 0xFF]);
  }

  function u32(value) {
    var n = value >>> 0;
    return new Uint8Array([n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF]);
  }

  function concat(chunks, total) {
    var out = new Uint8Array(total);
    var offset = 0;
    for (var i = 0; i < chunks.length; i++) {
      out.set(chunks[i], offset);
      offset += chunks[i].length;
    }
    return out;
  }

  /** 规范化条目名称：统一斜杠、去掉开头的斜杠 */
  function cleanName(name) {
    var s = String(name == null ? '' : name).replace(/\\/g, '/');
    while (s.charAt(0) === '/') s = s.slice(1);
    return s;
  }

  var DATE_DOS = 33; // 1980-01-01（bit 15-9 年=0, bit 8-5 月=1, bit 4-0 日=1）
  var TIME_DOS = 0;  // 00:00:00
  var FLAG_UTF8 = 0x0800;

  /**
   * 生成 ZIP 字节。
   * @param {Array<{name:string,data:string|Uint8Array}>} entries 条目列表
   * @returns {Uint8Array} ZIP 文件字节
   */
  function createBytes(entries) {
    var list = Array.isArray(entries) ? entries : [];
    var localChunks = [];
    var centralChunks = [];
    var localSize = 0;
    var centralSize = 0;
    var count = 0;

    for (var i = 0; i < list.length; i++) {
      var entry = list[i];
      if (!entry || typeof entry !== 'object') continue;
      var name = cleanName(entry.name);
      if (!name) continue;
      var nameBytes = utf8Encode(name);
      var data = asBytes(entry.data);
      var crc = crc32(data);

      // 本地文件头
      var localHeader = concat([
        u32(0x04034B50),
        u16(20),          // version needed
        u16(FLAG_UTF8),   // general purpose flag
        u16(0),           // method: STORE
        u16(TIME_DOS),
        u16(DATE_DOS),
        u32(crc),
        u32(data.length), // compressed size
        u32(data.length), // uncompressed size
        u16(nameBytes.length),
        u16(0)            // extra length
      ], 30);
      localChunks.push(localHeader, nameBytes, data);
      localSize += localHeader.length + nameBytes.length + data.length;

      // 中央目录项
      var centralHeader = concat([
        u32(0x02014B50),
        u16(20),          // version made by
        u16(20),          // version needed
        u16(FLAG_UTF8),
        u16(0),
        u16(TIME_DOS),
        u16(DATE_DOS),
        u32(crc),
        u32(data.length),
        u32(data.length),
        u16(nameBytes.length),
        u16(0),           // extra length
        u16(0),           // comment length
        u16(0),           // disk number start
        u16(0),           // internal attributes
        u32(0),           // external attributes
        u32(localSize - (30 + nameBytes.length + data.length)) // local header offset
      ], 46);
      centralChunks.push(centralHeader, nameBytes);
      centralSize += centralHeader.length + nameBytes.length;
      count++;
    }

    // 结束记录（EOCD）
    var eocd = concat([
      u32(0x06054B50),
      u16(0),             // this disk
      u16(0),             // cd start disk
      u16(count),         // entries on this disk
      u16(count),         // total entries
      u32(centralSize),
      u32(localSize),
      u16(0)              // comment length
    ], 22);

    return concat(localChunks.concat(centralChunks, [eocd]), localSize + centralSize + eocd.length);
  }

  /**
   * 生成 ZIP Blob。
   * @param {Array<{name:string,data:string|Uint8Array}>} entries 条目列表
   * @returns {Blob} MIME 为 application/zip
   */
  function create(entries) {
    var bytes = createBytes(entries);
    if (typeof Blob !== 'undefined') {
      return new Blob([bytes], { type: 'application/zip' });
    }
    return bytes;
  }

  global.CLUB = global.CLUB || {};
  global.CLUB.zip = {
    crc32: crc32,
    create: create,
    createBytes: createBytes
  };
})(typeof window !== 'undefined' ? window : globalThis);

