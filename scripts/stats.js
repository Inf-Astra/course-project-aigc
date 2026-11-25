/* ---- js/stats.js ---- */
/* ============================================================
 * stats.js — 报名数据汇总引擎（纯函数：无 DOM、无依赖、无随机数）
 * 职责：把多张列名列序各不相同的报名表按规范字段对齐合并，
 *       完成去重、归一化、分布 / 趋势 / 完整率统计，并给出数据洞察、
 *       数据质量提醒与可直接交给 CLUB.xlsx.write 的工作表结构。
 * 契约：CONTRACT.md 第 6 节；同样输入必得同样输出（确定性）。
 * ============================================================ */
(function (global) {
  'use strict';

  /* =========================================================
   * 一、基础工具
   * ======================================================= */

  /** 转字符串（number / boolean / 空值安全） */
  function str(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number') return isFinite(v) ? String(v) : '';
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    return String(v);
  }

  /** 去首尾空白（含全角空格） */
  function trim(v) {
    return str(v).replace(/^[\s\u3000]+|[\s\u3000]+$/g, '');
  }

  /** 单元格文本：先转字符串再去空白 */
  function cellText(v) {
    return trim(v);
  }

  /** 全角字符转半角（数字、字母、括号、冒号等）+ 全角空格转半角空格 */
  function toHalf(s) {
    var src = str(s);
    var out = '';
    for (var i = 0; i < src.length; i++) {
      var c = src.charCodeAt(i);
      if (c === 0x3000) out += ' ';
      else if (c >= 0xff01 && c <= 0xff5e) out += String.fromCharCode(c - 0xfee0);
      else out += src.charAt(i);
    }
    return out;
  }

  /** 列名 / 键匹配用的强规范化：半角、小写、只留数字/字母/汉字 */
  function normKey(v) {
    var s = toHalf(cellText(v)).toLowerCase();
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if ((c >= 48 && c <= 57) || (c >= 97 && c <= 122) || (c >= 0x4e00 && c <= 0x9fa5)) {
        out += s.charAt(i);
      }
    }
    return out;
  }

  /** 两位补零 */
  function pad2(n) {
    n = Number(n) || 0;
    return n < 10 ? '0' + n : String(n);
  }

  /** 百分比：保留 1 位小数，分母为 0 时返回 0 */
  function pct1(n, d) {
    if (!d || d <= 0) return 0;
    return Math.round((n / d) * 1000) / 10;
  }

  /** 百分比文本：保留 1 位小数 */
  function pctText(n, d) {
    return pct1(n, d).toFixed(1);
  }

  /** 稳定排序比较：数量降序，同数按 label 升序 */
  function cmpCountLabel(a, b) {
    if (b.count !== a.count) return b.count - a.count;
    if (a.label < b.label) return -1;
    if (a.label > b.label) return 1;
    return 0;
  }

  /* =========================================================
   * 二、规范字段与列名同义识别
   * ======================================================= */

  var FIELD_DEFS = [
    { key: 'name', label: '姓名', aliases: ['姓名', '名字', '学生姓名', '参会人', '参加人', '真实姓名'] },
    { key: 'studentId', label: '学号', aliases: ['学号', '学籍号', 'student id', 'studentid', '学号工号'] },
    { key: 'college', label: '学院', aliases: ['学院', '院系', '系别', '所在学院', '所属院系', '所在院系', '学院系'] },
    { key: 'grade', label: '年级', aliases: ['年级', '入学年份', '年级班级', '所在年级', '年级班级'] },
    { key: 'major', label: '专业', aliases: ['专业', '所学专业', '专业名称'] },
    { key: 'cls', label: '班级', aliases: ['班级', '行政班', '班号'] },
    { key: 'gender', label: '性别', aliases: ['性别'] },
    { key: 'phone', label: '手机号', aliases: ['手机', '电话', '手机号', '联系电话', '联系方式', '手机号码', '电话号码'] },
    { key: 'contact', label: 'QQ或微信', aliases: ['qq', '微信', 'wechat', '微信号', 'qq号', 'qq或微信', '微信qq'] },
    { key: 'isMember', label: '是否会员', aliases: ['是否会员', '会员', '社员', '是否社团成员', '是否本社成员', '会员身份'] },
    { key: 'diet', label: '饮食禁忌', aliases: ['饮食', '忌口', '餐食', '清真', '过敏', '饮食禁忌', '饮食要求'] },
    { key: 'shirt', label: '服装尺码', aliases: ['尺码', '服装', '衣服', 't恤', '服装尺码', '衣服尺码', 't恤尺码'] },
    { key: 'signupTime', label: '报名时间', aliases: ['报名时间', '提交时间', '填写时间', '时间戳', '日期', '报名日期'] },
    { key: 'fee', label: '缴费', aliases: ['缴费', '是否缴费', '缴费状态', '支付', '费用', '缴费金额', '交费'] },
    { key: 'session', label: '场次', aliases: ['场次', '时间段', '参与场次', '分组', '选择场次'] },
    { key: 'remark', label: '备注', aliases: ['备注', '留言', '想说的话', '建议', '期望', '其他说明'] }
  ];

  var LABEL_BY_KEY = (function () {
    var map = {};
    for (var i = 0; i < FIELD_DEFS.length; i++) map[FIELD_DEFS[i].key] = FIELD_DEFS[i].label;
    return map;
  })();

  var FIELD_ORDER = (function () {
    var map = {};
    for (var i = 0; i < FIELD_DEFS.length; i++) map[FIELD_DEFS[i].key] = i;
    return map;
  })();

  /** 别名索引（只算一次） */
  var ALIAS_INDEX = (function () {
    var idx = [];
    for (var i = 0; i < FIELD_DEFS.length; i++) {
      var def = FIELD_DEFS[i];
      var list = [];
      for (var j = 0; j < def.aliases.length; j++) {
        var a = normKey(def.aliases[j]);
        if (a) list.push(a);
      }
      idx.push({ key: def.key, label: def.label, order: i, aliases: list });
    }
    return idx;
  })();

  /**
   * 识别一个表头单元格属于哪个规范字段。
   * 匹配优先级：完全相等 > 表头包含别名 > 别名包含表头（表头至少 2 字）。
   * @param {*} header 表头原始值
   * @returns {string|null} 规范字段 key
   */
  function matchField(header) {
    var h = normKey(header);
    if (!h) return null;
    var best = null;
    for (var i = 0; i < ALIAS_INDEX.length; i++) {
      var f = ALIAS_INDEX[i];
      for (var j = 0; j < f.aliases.length; j++) {
        var a = f.aliases[j];
        var score = 0;
        if (h === a) score = 1000;
        else if (h.indexOf(a) >= 0) score = 500 + a.length;
        else if (h.length >= 2 && a.indexOf(h) >= 0) score = 100 + h.length;
        if (!score) continue;
        var cand = { key: f.key, score: score, alen: a.length, order: f.order };
        if (!best ||
          cand.score > best.score ||
          (cand.score === best.score && (cand.alen > best.alen ||
            (cand.alen === best.alen && cand.order < best.order)))) {
          best = cand;
        }
      }
    }
    return best ? best.key : null;
  }

  /* =========================================================
   * 三、字段归一化
   * ======================================================= */

  /** 手机号：转半角、去空格与 - （）等，去掉 +86 / 0086 前缀 */
  function normPhone(v) {
    var s = toHalf(cellText(v)).replace(/[\s\-()（）.．]/g, '');
    if (!s) return '';
    if (/^\+?86\d{11}$/.test(s)) return s.replace(/^\+?86/, '');
    if (/^0086\d{11}$/.test(s)) return s.slice(4);
    return s;
  }

  /** 学号：转半角大写，只留数字与字母 */
  function normStudentId(v) {
    var s = toHalf(cellText(v)).toUpperCase();
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if ((c >= 48 && c <= 57) || (c >= 65 && c <= 90)) out += s.charAt(i);
    }
    return out;
  }

  /** 尺码：转半角、去空格、大写；2XL→XXL、L码→L、（M）括号说明去掉 */
  function normShirt(v) {
    var s = toHalf(cellText(v));
    if (!s) return '';
    s = s.replace(/[（(][^)）]*[)）]/g, '');
    s = s.replace(/\s+/g, '').toUpperCase();
    s = s.replace(/[码号]$/, '');
    var m = s.match(/^(\d)XL$/);
    if (m) {
      var n = Number(m[1]);
      var prefix = '';
      for (var i = 0; i < n; i++) prefix += 'X';
      s = prefix + 'L';
    }
    return s;
  }

  /** 是否会员：统一为 是 / 否 / 未知 */
  function normMember(v) {
    var s = toHalf(cellText(v));
    if (!s) return '未知';
    var low = s.toLowerCase();
    if (/^(是|yes|y|true|1|会员|已入会|已加入|加入|有|√|✓|社员|是会员)$/.test(low)) return '是';
    if (/^(否|no|n|false|0|不是|非会员|未入会|未加入|没有|非|×|✗)$/.test(low)) return '否';
    if (/(不是|未入会|未加入|非会员|没入|没有|还不是|否)/.test(low)) return '否';
    if (/(是|已入|会员|加入|有会员)/.test(low)) return '是';
    return '未知';
  }

  /** 性别：男生/男/male→男，女生/女/female→女，其余保留原值 */
  function normGender(v) {
    var s = toHalf(cellText(v));
    if (!s) return '';
    var low = s.toLowerCase();
    if (/^(男|男生|男性|male|m|1)$/.test(low)) return '男';
    if (/^(女|女生|女性|female|f|2)$/.test(low)) return '女';
    if (s.indexOf('男') >= 0) return '男';
    if (s.indexOf('女') >= 0) return '女';
    return s;
  }

  /** 饮食禁忌：无/没有/无禁忌 一类统一为「无」，其余保留原始描述 */
  function normDiet(v) {
    var s = cellText(v);
    if (!s) return '';
    var low = toHalf(s).toLowerCase();
    if (/^(无|没有|无禁忌|无忌口|无特殊要求|不存在|否|none|no|n\/a|无饮食禁忌)$/.test(low)) return '无';
    return s;
  }

  /* ---------- 年级 ---------- */

  /** 中文数字 / 阿拉伯数字 → 1..4 */
  function gradeNum(t) {
    var map = { '一': 1, '二': 2, '三': 3, '四': 4, '1': 1, '2': 2, '3': 3, '4': 4 };
    return map[t] || 0;
  }

  /** 解析年级原始值：绝对年份 或 大几（需要全表推算基准年） */
  function parseGrade(v) {
    var s = cellText(v);
    if (!s) return null;
    var h = toHalf(s);
    var m4 = h.match(/(?:19|20)\d{2}/);
    if (m4) {
      var y = parseInt(m4[0], 10);
      if (y >= 1990 && y <= 2035) return { year: y };
    }
    var mBig = h.match(/大\s*([一二三四1234])/);
    if (mBig) return { idx: gradeNum(mBig[1]) };
    var mYear = h.match(/([一二三四1234])\s*年级/);
    if (mYear) return { idx: gradeNum(mYear[1]) };
    var mG = h.match(/(\d{2,3})\s*[级届]/);
    if (mG) {
      var n = parseInt(mG[1], 10);
      if (n >= 10 && n <= 40) return { year: 2000 + n };
      if (n >= 90 && n <= 99) return { year: 1900 + n };
    }
    return null;
  }

  /**
   * 推算「大一」的入学年份，用于把 大二/大三 变成 20XX级。
   * 取票：每个绝对年份 y 与每个年级序号 k 组合出一个基准年 y+k-1，票数为出现次数乘积；
   * 平票时优先贴近 (最大绝对年份 + 1)，再取较晚的年份，保证确定性。
   */
  function pickRefYear(yearCounts, idxCounts) {
    if (!yearCounts.length || !idxCounts.length) return 0;
    var maxYear = 0;
    for (var i = 0; i < yearCounts.length; i++) {
      if (yearCounts[i].year > maxYear) maxYear = yearCounts[i].year;
    }
    var votes = {};
    for (var a = 0; a < yearCounts.length; a++) {
      for (var b = 0; b < idxCounts.length; b++) {
        var ref = yearCounts[a].year + idxCounts[b].idx - 1;
        if (ref < 1990 || ref > 2035) continue;
        votes[ref] = (votes[ref] || 0) + yearCounts[a].count * idxCounts[b].count;
      }
    }
    var keys = Object.keys(votes);
    if (!keys.length) return 0;
    var bestRef = 0;
    var bestWeight = -1;
    var bestDist = 1e9;
    for (var c = 0; c < keys.length; c++) {
      var ref2 = parseInt(keys[c], 10);
      var w = votes[keys[c]];
      var dist = Math.abs(ref2 - (maxYear + 1));
      var better = false;
      if (w > bestWeight) better = true;
      else if (w === bestWeight) {
        if (dist < bestDist) better = true;
        else if (dist === bestDist && ref2 > bestRef) better = true;
      }
      if (better) {
        bestWeight = w;
        bestDist = dist;
        bestRef = ref2;
      }
    }
    return bestRef;
  }

  /* ---------- 学院同义合并 ---------- */

  /*
   * 常见学院简称 / 曾用名 → 同一「学院家族」。
   * 家族只决定「谁和谁算同一个学院」，最终显示名仍取数据里出现次数最多的写法
   * （契约要求），所以数据里只有简称时不会被硬改成没出现过的全称。
   */
  var COLLEGE_FAMILIES = [
    { name: '计算机科学与技术学院', aliases: ['计算机科学与技术学院', '计算机学院', '计算机系', '计算机科学学院', '信息学院', '计算机与技术学院'] },
    { name: '外国语学院', aliases: ['外国语学院', '外语学院', '外文学院', '外院', '外国语'] },
    { name: '经济管理学院', aliases: ['经济管理学院', '经管学院', '经济学院', '管理学院', '经管系', '经管'] },
    { name: '数学与统计学院', aliases: ['数学与统计学院', '数学学院', '数学院', '数学系', '统计学院'] },
    { name: '机械工程学院', aliases: ['机械工程学院', '机械学院', '机械系', '机械工程系'] },
    { name: '艺术学院', aliases: ['艺术学院', '艺术院', '美术学院', '艺术系'] },
    { name: '马克思主义学院', aliases: ['马克思主义学院', '马克思学院', '马院', '思政部'] },
    { name: '文学院', aliases: ['文学院', '文学学院', '中文学院', '中文系'] },
    { name: '软件学院', aliases: ['软件学院', '软件工程系'] }
  ];

  /** 规范化学院写法 → 家族编号（只算一次） */
  var COLLEGE_FAMILY_INDEX = (function () {
    var map = {};
    for (var i = 0; i < COLLEGE_FAMILIES.length; i++) {
      for (var j = 0; j < COLLEGE_FAMILIES[i].aliases.length; j++) {
        var key = normKey(COLLEGE_FAMILIES[i].aliases[j]);
        if (key && map[key] === undefined) map[key] = 'family' + i;
      }
    }
    return map;
  })();

  /** 学院名的核心词：去掉 学院/学部/分院/系/院/大学/本科 等通用后缀 */
  function collegeCore(name) {
    var core = normKey(name);
    var suffixes = ['研究生院', '学院', '学部', '分院', '大学', '本科', '专科', '系', '院'];
    var changed = true;
    while (changed && core.length > 1) {
      changed = false;
      for (var i = 0; i < suffixes.length; i++) {
        var sfx = suffixes[i];
        if (core.length > sfx.length && core.slice(core.length - sfx.length) === sfx) {
          core = core.slice(0, core.length - sfx.length);
          changed = true;
          break;
        }
      }
    }
    return core;
  }

  /** 两个学院写法是否应视为同一学院 */
  function collegeSimilar(a, b) {
    if (a === b) return true;
    var ca = collegeCore(a);
    var cb = collegeCore(b);
    if (ca && ca === cb) return true;
    if (ca.length >= 2 && cb.length >= 2) {
      if (ca.indexOf(cb) === 0 || cb.indexOf(ca) === 0) return true;
      if (ca.indexOf(cb) >= 0 || cb.indexOf(ca) >= 0) return true;
    }
    if (a.length >= 3 && b.length >= 3 && (a.indexOf(b) >= 0 || b.indexOf(a) >= 0)) return true;
    return false;
  }

  /**
   * 学院同义合并：按出现次数取代表写法，返回 原始写法→代表写法 的映射。
   * @returns {{map: Object, groups: Array}}
   */
  function resolveColleges(rawValues) {
    var counts = {};
    var firstSeen = {};
    var order = [];
    for (var i = 0; i < rawValues.length; i++) {
      var v = cellText(rawValues[i]);
      if (!v) continue;
      var k = normKey(v);
      if (!k) continue;
      if (counts[v] === undefined) {
        counts[v] = 0;
        firstSeen[v] = order.length;
        order.push(v);
      }
      counts[v] += 1;
    }
    var list = order.slice();
    if (list.length > 500) list = list.slice(0, 500);
    var parent = [];
    for (var p = 0; p < list.length; p++) parent.push(p);
    function find(x) {
      while (parent[x] !== x) {
        parent[x] = parent[parent[x]];
        x = parent[x];
      }
      return x;
    }
    function union(x, y) {
      var rx = find(x);
      var ry = find(y);
      if (rx !== ry) parent[ry] = rx;
    }
    /* 1) 同族简称直接归并：外语学院/外院 → 外国语学院 家族，经管学院 → 经济管理学院 家族… */
    var familyAnchor = {};
    for (var f = 0; f < list.length; f++) {
      var fam = COLLEGE_FAMILY_INDEX[normKey(list[f])];
      if (!fam) continue;
      if (familyAnchor[fam] === undefined) familyAnchor[fam] = f;
      else union(familyAnchor[fam], f);
    }
    /* 2) 模糊归并：去掉通用后缀后一方是另一方前缀，或整体互相包含 */
    for (var m = 0; m < list.length; m++) {
      for (var n = m + 1; n < list.length; n++) {
        if (collegeSimilar(list[m], list[n])) union(m, n);
      }
    }
    var buckets = {};
    for (var q = 0; q < list.length; q++) {
      var root = find(q);
      if (!buckets[root]) buckets[root] = [];
      buckets[root].push(list[q]);
    }
    var map = {};
    var groups = [];
    var rootKeys = Object.keys(buckets);
    for (var r = 0; r < rootKeys.length; r++) {
      var writings = buckets[rootKeys[r]];
      var rep = writings[0];
      var total = 0;
      for (var t = 0; t < writings.length; t++) {
        var w = writings[t];
        total += counts[w];
        /* 取出现次数最多的写法；同数时取更完整的全称，再同则取先出现的 */
        if (counts[w] > counts[rep] ||
          (counts[w] === counts[rep] && (w.length > rep.length ||
            (w.length === rep.length && firstSeen[w] < firstSeen[rep])))) {
          rep = w;
        }
      }
      for (var u = 0; u < writings.length; u++) map[writings[u]] = rep;
      groups.push({ rep: rep, writings: writings, total: total });
    }
    return { map: map, groups: groups };
  }

  /* ---------- 报名时间 ---------- */

  /** Excel 序列号 → 日期对象（不用本地时区，保证确定性） */
  function serialToDate(serial) {
    if (typeof serial !== 'number' || !isFinite(serial)) return null;
    if (serial < 20000 || serial > 80000) return null;
    var minutes = Math.round(serial * 1440);
    var dt = new Date(Date.UTC(1899, 11, 30) + minutes * 60000);
    var y = dt.getUTCFullYear();
    if (y < 1990 || y > 2100) return null;
    return {
      y: y,
      m: dt.getUTCMonth() + 1,
      d: dt.getUTCDate(),
      hh: dt.getUTCHours(),
      mm: dt.getUTCMinutes(),
      hasTime: (minutes % 1440) !== 0
    };
  }

  /** 从日期后面的剩余文本里取时间（HH:mm[:ss]） */
  function pickClock(rest) {
    if (!rest) return null;
    var m = rest.match(/(\d{1,2})\s*[:]\s*(\d{1,2})(?:\s*[:]\s*(\d{1,2}))?/);
    if (!m) return null;
    var hh = parseInt(m[1], 10);
    var mm = parseInt(m[2], 10);
    if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
    return { hh: hh, mm: mm };
  }

  /**
   * 解析报名时间，支持：数字序列号、YYYY-MM-DD[ HH:mm[:ss]]、YYYY/M/D、YYYY年M月D日、
   * YYYYMMDD、MM-DD[ HH:mm]（无年份，趋势仍可用）。
   * @returns {{y?:number,m:number,d:number,hh?:number,mm?:number,hasTime:boolean}|null}
   */
  function parseSignup(v) {
    if (typeof v === 'number') return serialToDate(v);
    var s = cellText(v);
    if (!s) return null;
    var h = toHalf(s);
    var m1 = h.match(/^(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?/);
    if (m1) {
      var y = parseInt(m1[1], 10);
      var mo = parseInt(m1[2], 10);
      var da = parseInt(m1[3], 10);
      if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31 && y >= 1990 && y <= 2100) {
        var clock = pickClock(h.slice(m1[0].length));
        return {
          y: y, m: mo, d: da,
          hh: clock ? clock.hh : 0,
          mm: clock ? clock.mm : 0,
          hasTime: !!clock
        };
      }
    }
    var m3 = h.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (m3) {
      var y3 = parseInt(m3[1], 10);
      var m3m = parseInt(m3[2], 10);
      var m3d = parseInt(m3[3], 10);
      if (m3m >= 1 && m3m <= 12 && m3d >= 1 && m3d <= 31 && y3 >= 1990 && y3 <= 2100) {
        return { y: y3, m: m3m, d: m3d, hh: 0, mm: 0, hasTime: false };
      }
    }
    if (/^\d{5}(?:\.\d+)?$/.test(h)) {
      var serial = serialToDate(Number(h));
      if (serial) return serial;
    }
    var m2 = h.match(/^(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?/);
    if (m2) {
      var mo2 = parseInt(m2[1], 10);
      var da2 = parseInt(m2[2], 10);
      if (mo2 >= 1 && mo2 <= 12 && da2 >= 1 && da2 <= 31) {
        var clock2 = pickClock(h.slice(m2[0].length));
        return {
          m: mo2, d: da2,
          hh: clock2 ? clock2.hh : 0,
          mm: clock2 ? clock2.mm : 0,
          hasTime: !!clock2
        };
      }
    }
    return null;
  }

  /** 报名时间格式化：有年份 → YYYY-MM-DD[ HH:mm]；无年份 → 保留原文 */
  function formatSignup(info, original) {
    if (!info) return cellText(original);
    if (!info.y) return cellText(original);
    var out = info.y + '-' + pad2(info.m) + '-' + pad2(info.d);
    if (info.hasTime) out += ' ' + pad2(info.hh) + ':' + pad2(info.mm);
    return out;
  }

  /* ---------- 缴费 ---------- */

  /** 解析缴费单元格：状态（paid / unpaid / unknown / missing）与金额 */
  function parseFee(v) {
    var s = cellText(v);
    if (!s) return { status: 'missing', amount: 0 };
    var h = toHalf(s);
    var t = h.trim();
    if (/^[01]$/.test(t)) return { status: t === '0' ? 'unpaid' : 'paid', amount: 0 };
    var paid = /(已缴|已交|已付|已支付|已完成|已收|paid|^y$|^yes$|^是$|^√$|^✓$|^true$)/.test(h.toLowerCase());
    var unpaid = /(未缴|未交|未付|未支付|待缴|待支付|未收|^n$|^no$|^否$|^×$|^false$|未完成)/.test(h.toLowerCase());
    if (paid && !unpaid) return { status: 'paid', amount: pickAmount(h) };
    if (unpaid && !paid) return { status: 'unpaid', amount: 0 };
    if (!paid && !unpaid) {
      if (/^\d+(?:\.\d+)?$/.test(t)) {
        var n = Number(t);
        if (n > 0) return { status: 'paid', amount: n };
        return { status: 'unpaid', amount: 0 };
      }
    }
    return { status: 'unknown', amount: 0 };
  }

  /** 从文本里挑金额：取 1–100000 之间最大的数字（跳过年份等噪声） */
  function pickAmount(h) {
    var nums = h.match(/\d+(?:\.\d+)?/g);
    if (!nums) return 0;
    var amount = 0;
    for (var i = 0; i < nums.length; i++) {
      var n = Number(nums[i]);
      if (!isFinite(n)) continue;
      if (n >= 1 && n <= 100000 && n > amount) amount = n;
    }
    return Math.round(amount * 100) / 100;
  }

  /* =========================================================
   * 四、来源表读取与跨表对齐
   * ======================================================= */

  /** 把 tables 参数规整成数组（容忍单表对象 / 非数组） */
  function normalizeTables(tables) {
    if (Array.isArray(tables)) return tables;
    if (tables && typeof tables === 'object' && Array.isArray(tables.rows)) return [tables];
    return [];
  }

  /**
   * 读取每个来源表：表头识别、列映射、数据行提取。
   * 每条原始记录带上 source / rawRow / rawIndex（全局 1 起）。
   */
  function prepareSources(tables) {
    var list = normalizeTables(tables);
    var sources = [];
    var records = [];
    var fieldAcc = {};
    var unmatched = [];
    var rawIndex = 0;

    for (var i = 0; i < list.length; i++) {
      var table = list[i];
      if (!table || typeof table !== 'object') continue;
      var name = cellText(table.name);
      if (!name) name = '表' + (i + 1);
      var rows = Array.isArray(table.rows) ? table.rows : [];
      var headerRaw = Array.isArray(rows[0]) ? rows[0] : [];
      var header = [];
      for (var c = 0; c < headerRaw.length; c++) header.push(cellText(headerRaw[c]));
      while (header.length && header[header.length - 1] === '') header.pop();

      var colKeys = [];
      var matchedHeaders = [];
      for (var c2 = 0; c2 < header.length; c2++) {
        var key = matchField(header[c2]);
        colKeys.push(key);
        if (key) {
          matchedHeaders.push(header[c2]);
          if (!fieldAcc[key]) fieldAcc[key] = { sources: [], titleCount: {}, firstTitle: '' };
          if (fieldAcc[key].sources.indexOf(name) < 0) fieldAcc[key].sources.push(name);
          if (!fieldAcc[key].titleCount[header[c2]]) {
            fieldAcc[key].titleCount[header[c2]] = 0;
            if (!fieldAcc[key].firstTitle) fieldAcc[key].firstTitle = header[c2];
          }
          fieldAcc[key].titleCount[header[c2]] += 1;
        } else if (header[c2]) {
          unmatched.push({ source: name, header: header[c2] });
        }
      }

      var rowCount = 0;
      for (var r = 1; r < rows.length; r++) {
        var row = rows[r];
        if (!Array.isArray(row)) continue;
        var vals = {};
        var any = false;
        for (var j = 0; j < row.length; j++) {
          var text = cellText(row[j]);
          if (text === '') continue;
          any = true;
          var k = j < colKeys.length ? colKeys[j] : null;
          if (k && vals[k] === undefined) vals[k] = row[j];
        }
        if (!any) continue;
        rawIndex += 1;
        rowCount += 1;
        records.push({ raw: vals, source: name, rawRow: r + 1, rawIndex: rawIndex });
      }

      sources.push({ name: name, rowCount: rowCount, header: header, matched: matchedHeaders });
    }

    var fields = [];
    for (var f = 0; f < FIELD_DEFS.length; f++) {
      var def = FIELD_DEFS[f];
      var acc = fieldAcc[def.key];
      if (!acc) continue;
      var title = acc.firstTitle || def.label;
      var bestCount = -1;
      var titles = Object.keys(acc.titleCount);
      for (var t = 0; t < titles.length; t++) {
        var cnt = acc.titleCount[titles[t]];
        if (cnt > bestCount || (cnt === bestCount && titles[t] < title)) {
          bestCount = cnt;
          title = titles[t];
        }
      }
      fields.push({ key: def.key, label: def.label, sources: acc.sources.slice(), title: title || def.label });
    }

    return { sources: sources, records: records, fields: fields, unmatched: unmatched };
  }

  /* =========================================================
   * 五、主流程：summarize
   * ======================================================= */

  /**
   * 汇总多张报名表。
   * @param {Array<{name: string, rows: Array<Array<string|number>>}>|{name?:string, rows:Array}} tables 来源表，第 1 行为表头
   * @param {{minGrade?: number}} [opts] 预留参数（二期使用，当前忽略）
   * @returns {Object} 符合 CONTRACT.md 第 6 节结构的结果对象
   */
  function summarize(tables, opts) {
    void opts;
    var prepared = prepareSources(tables);
    var records = prepared.records;

    /* --- 1. 学院同义合并（先做，去重键里的学院才能一致） --- */
    var collegeRaw = [];
    for (var i = 0; i < records.length; i++) collegeRaw.push(records[i].raw.college);
    var collegeRes = resolveColleges(collegeRaw);

    /* --- 2. 年级归一（需要全表推算基准年，先扫描一遍） --- */
    var yearCountsMap = {};
    var idxCountsMap = {};
    var gradeInfos = [];
    for (var g = 0; g < records.length; g++) {
      var info = parseGrade(records[g].raw.grade);
      gradeInfos.push(info);
      if (!info) continue;
      if (info.year) yearCountsMap[info.year] = (yearCountsMap[info.year] || 0) + 1;
      else if (info.idx) idxCountsMap[info.idx] = (idxCountsMap[info.idx] || 0) + 1;
    }
    var yearCounts = [];
    var yk = Object.keys(yearCountsMap);
    for (var y1 = 0; y1 < yk.length; y1++) yearCounts.push({ year: parseInt(yk[y1], 10), count: yearCountsMap[yk[y1]] });
    yearCounts.sort(function (a, b) { return a.year - b.year; });
    var idxCounts = [];
    var ik = Object.keys(idxCountsMap);
    for (var i2 = 0; i2 < ik.length; i2++) idxCounts.push({ idx: parseInt(ik[i2], 10), count: idxCountsMap[ik[i2]] });
    idxCounts.sort(function (a, b) { return a.idx - b.idx; });
    var refYear = pickRefYear(yearCounts, idxCounts);

    /* --- 3. 逐条归一化 --- */
    var hasFee = !!prepared.fields.filter(function (f) { return f.key === 'fee'; }).length;
    for (var r = 0; r < records.length; r++) {
      var rec = records[r];
      var raw = rec.raw;
      var name = cellText(raw.name);
      var collegeRawText = cellText(raw.college);
      var college = collegeRes.map[collegeRawText] || collegeRawText;
      var gInfo = gradeInfos[r];
      var grade = cellText(raw.grade);
      if (gInfo) {
        if (gInfo.year) grade = gInfo.year + '级';
        else if (gInfo.idx && refYear) {
          var derived = refYear - (gInfo.idx - 1);
          if (derived >= 1990 && derived <= 2035) grade = derived + '级';
        }
      }
      rec.f = {
        name: name,
        studentId: normStudentId(raw.studentId),
        college: college,
        collegeRaw: collegeRawText,
        grade: grade,
        major: cellText(raw.major),
        cls: cellText(raw.cls),
        gender: normGender(raw.gender),
        phone: normPhone(raw.phone),
        contact: cellText(raw.contact),
        isMember: normMember(raw.isMember),
        diet: normDiet(raw.diet),
        shirt: normShirt(raw.shirt),
        fee: cellText(raw.fee),
        session: cellText(raw.session),
        remark: cellText(raw.remark),
        signup: parseSignup(raw.signupTime),
        signupTime: formatSignup(parseSignup(raw.signupTime), raw.signupTime),
        feeInfo: hasFee ? parseFee(raw.fee) : { status: 'missing', amount: 0 }
      };
    }

    /* --- 4. 有效性与去重 --- */
    var invalid = [];
    var valid = [];
    for (var v = 0; v < records.length; v++) {
      if (!records[v].f.name) {
        invalid.push({
          index: records[v].rawIndex,
          reason: '缺少姓名',
          name: '',
          studentId: records[v].f.studentId,
          phone: records[v].f.phone,
          source: records[v].source
        });
      } else {
        valid.push(records[v]);
      }
    }

    var groups = [];
    var keyOwner = {};
    function keysOf(rec2) {
      var keys = [];
      var sid = rec2.f.studentId;
      if (sid && sid.length >= 4) keys.push('学号\u0001' + sid);
      var ph = rec2.f.phone;
      var digits = (ph.match(/\d/g) || []).length;
      if (ph && digits >= 7) keys.push('手机号\u0001' + ph);
      if (!keys.length && rec2.f.name) keys.push('姓名+学院\u0001' + normKey(rec2.f.name) + '|' + normKey(rec2.f.college));
      return keys;
    }
    for (var w = 0; w < valid.length; w++) {
      var rec3 = valid[w];
      var keys = keysOf(rec3);
      if (!keys.length) keys = ['无键\u0001' + (valid[w].rawIndex)];
      var hitGroups = [];
      for (var kk = 0; kk < keys.length; kk++) {
        var owner = keyOwner[keys[kk]];
        if (owner !== undefined && hitGroups.indexOf(owner) < 0) hitGroups.push(owner);
      }
      var gi;
      if (!hitGroups.length) {
        gi = groups.length;
        groups.push({
          members: [valid[w].rawIndex],
          firstRecord: rec3,
          keys: keys.slice(),
          display: displayKey(keys[0]),
          kind: kindOf(keys[0])
        });
        for (var kk2 = 0; kk2 < keys.length; kk2++) keyOwner[keys[kk2]] = gi;
      } else {
        gi = hitGroups[0];
        for (var h2 = 1; h2 < hitGroups.length; h2++) {
          gi = mergeGroups(groups, keyOwner, gi, hitGroups[h2]);
        }
        groups[gi].members.push(valid[w].rawIndex);
        for (var kk3 = 0; kk3 < keys.length; kk3++) {
          if (keyOwner[keys[kk3]] === undefined) keyOwner[keys[kk3]] = gi;
        }
      }
    }

    function displayKey(internalKey) {
      var parts = internalKey.split('\u0001');
      return parts.length > 1 ? parts[1] : internalKey;
    }
    function kindOf(internalKey) {
      var parts = internalKey.split('\u0001');
      return parts[0];
    }

    function mergeGroups(groupList, ownerMap, a, b) {
      var lo = Math.min(a, b);
      var hi = Math.max(a, b);
      if (lo === hi || groupList[hi].dead) return lo;
      groupList[lo].members = groupList[lo].members.concat(groupList[hi].members);
      for (var key in ownerMap) {
        if (ownerMap[key] === hi) ownerMap[key] = lo;
      }
      groupList[hi].dead = true;
      return lo;
    }

    var liveGroups = groups.filter(function (gr) { return !gr.dead; });
    liveGroups.sort(function (a, b) { return a.members[0] - b.members[0]; });
    for (var lg = 0; lg < liveGroups.length; lg++) {
      liveGroups[lg].members.sort(function (a, b) { return a - b; });
    }

    /* --- 5. 组装名单 --- */
    var roster = [];
    var duplicates = [];
    for (var rg = 0; rg < liveGroups.length; rg++) {
      var group = liveGroups[rg];
      var first = group.firstRecord;
      var f = first.f;
      var issues = [];
      if (!f.college) issues.push('缺学院');
      if (!f.phone) issues.push('缺手机号');
      if (!f.grade) issues.push('缺年级');
      if (!f.signup) issues.push('报名时间无法识别');
      if (f.phone && !/^\d{7,12}$/.test(f.phone)) issues.push('手机号格式可疑：' + f.phone);
      if (f.collegeRaw && f.college && f.collegeRaw !== f.college) issues.push('学院写法「' + f.collegeRaw + '」已统一');
      if (group.members.length > 1) issues.push('另有 ' + (group.members.length - 1) + ' 条重复提交已合并');
      roster.push({
        index: roster.length + 1,
        name: f.name,
        studentId: f.studentId,
        college: f.college,
        grade: f.grade,
        major: f.major,
        cls: f.cls,
        gender: f.gender,
        phone: f.phone,
        contact: f.contact,
        isMember: f.isMember,
        diet: f.diet,
        shirt: f.shirt,
        signupTime: f.signupTime,
        fee: f.fee,
        session: f.session,
        remark: f.remark,
        source: first.source,
        issues: issues,
        _fee: f.feeInfo,
        _signup: f.signup
      });
      if (group.members.length > 1) {
        duplicates.push({
          key: group.display,
          count: group.members.length,
          rows: group.members.slice(),
          kind: group.kind,
          names: group.members.map(function (idx) {
            for (var e = 0; e < records.length; e++) if (records[e].rawIndex === idx) return records[e].f.name;
            return '';
          }),
          sources: group.members.map(function (idx) {
            for (var e2 = 0; e2 < records.length; e2++) if (records[e2].rawIndex === idx) return records[e2].source;
            return '';
          })
        });
      }
    }

    /* --- 6. 汇总指标 --- */
    var rawTotal = records.length;
    var unique = roster.length;
    var invalidCount = invalid.length;
    var dupCount = rawTotal - invalidCount - unique;
    if (dupCount < 0) dupCount = 0;
    var completeCount = 0;
    for (var cc = 0; cc < roster.length; cc++) {
      if (roster[cc].name && roster[cc].college && roster[cc].phone) completeCount += 1;
    }
    var totals = {
      raw: rawTotal,
      unique: unique,
      duplicates: dupCount,
      invalid: invalidCount,
      completeRate: pct1(completeCount, unique)
    };

    /* --- 7. 分布（完整版供洞察使用，截断版对外输出） --- */
    var DIST_FIELDS = [
      { key: 'college', label: '学院' },
      { key: 'grade', label: '年级' },
      { key: 'gender', label: '性别' },
      { key: 'isMember', label: '是否会员' },
      { key: 'diet', label: '饮食禁忌' },
      { key: 'shirt', label: '服装尺码' },
      { key: 'session', label: '场次' }
    ];
    var distFull = {};
    var distributions = [];
    for (var d = 0; d < DIST_FIELDS.length; d++) {
      var fieldDef = DIST_FIELDS[d];
      var built = buildDistribution(roster, fieldDef.key, fieldDef.label);
      if (!built) continue;
      distFull[fieldDef.key] = built;
      distributions.push({
        field: fieldDef.key,
        label: fieldDef.label,
        items: truncateItems(built.items, 12),
        missing: built.missing
      });
    }

    /* --- 8. 趋势 --- */
    var dayCount = {};
    var dayOrder = [];
    for (var tr = 0; tr < roster.length; tr++) {
      var sg = roster[tr]._signup;
      if (!sg) continue;
      var label = pad2(sg.m) + '-' + pad2(sg.d);
      if (dayCount[label] === undefined) {
        dayCount[label] = 0;
        dayOrder.push(label);
      }
      dayCount[label] += 1;
    }
    dayOrder.sort(function (a, b) { return a < b ? -1 : a > b ? 1 : 0; });
    var trend = [];
    for (var t2 = 0; t2 < dayOrder.length; t2++) trend.push({ date: dayOrder[t2], count: dayCount[dayOrder[t2]] });

    /* --- 9. 完整率 --- */
    var completeness = [];
    var fieldKeys = prepared.fields.map(function (x) { return x.key; });
    fieldKeys.sort(function (a, b) { return FIELD_ORDER[a] - FIELD_ORDER[b]; });
    for (var ck = 0; ck < fieldKeys.length; ck++) {
      var fk = fieldKeys[ck];
      var filled = 0;
      for (var cr = 0; cr < roster.length; cr++) {
        var val = roster[cr][fk];
        if (fk === 'isMember') {
          if (val === '是' || val === '否') filled += 1;
        } else if (val) {
          filled += 1;
        }
      }
      completeness.push({
        field: fk,
        label: LABEL_BY_KEY[fk],
        filled: filled,
        total: roster.length,
        rate: pct1(filled, roster.length)
      });
    }

    /* --- 10. 缴费 --- */
    var fee = null;
    if (hasFee) {
      var feeTotal = 0;
      var paid = 0;
      var unpaid = 0;
      var amount = 0;
      for (var fr = 0; fr < roster.length; fr++) {
        var fi = roster[fr]._fee;
        if (fi.status === 'missing') continue;
        feeTotal += 1;
        if (fi.status === 'paid') {
          paid += 1;
          amount += fi.amount;
        } else if (fi.status === 'unpaid') {
          unpaid += 1;
        }
      }
      fee = {
        total: feeTotal,
        paid: paid,
        unpaid: unpaid,
        amount: Math.round(amount * 100) / 100
      };
    }

    /* --- 11. 洞察与提醒 --- */
    var ctx = {
      sources: prepared.sources,
      records: records,
      roster: roster,
      totals: totals,
      dist: distFull,
      trend: trend,
      completeness: completeness,
      fee: fee,
      duplicates: duplicates,
      invalid: invalid,
      unmatched: prepared.unmatched,
      fields: prepared.fields,
      collegeGroups: collegeRes.groups,
      refYear: refYear
    };
    var insights = buildInsights(ctx);
    var warnings = buildWarnings(ctx);

    /* 清理内部临时字段（_fee / _signup 不进入交付结果） */
    for (var clean = 0; clean < roster.length; clean++) {
      delete roster[clean]._fee;
      delete roster[clean]._signup;
    }

    return {
      sources: prepared.sources,
      fields: prepared.fields,
      unmatched: prepared.unmatched,
      totals: totals,
      roster: roster,
      duplicates: duplicates,
      invalid: invalid,
      distributions: distributions,
      trend: trend,
      completeness: completeness,
      fee: fee,
      insights: insights,
      warnings: warnings
    };
  }

  /** 统计一个字段的完整分布（含 missing） */
  function buildDistribution(roster, field, label) {
    var counts = {};
    var order = [];
    var missing = 0;
    for (var i = 0; i < roster.length; i++) {
      var v = roster[i][field];
      if (!v || v === '未知') {
        missing += 1;
        continue;
      }
      if (counts[v] === undefined) {
        counts[v] = 0;
        order.push(v);
      }
      counts[v] += 1;
    }
    var nonEmpty = roster.length - missing;
    if (!order.length) return null;
    var items = [];
    for (var j = 0; j < order.length; j++) {
      items.push({ label: order[j], count: counts[order[j]], pct: pct1(counts[order[j]], nonEmpty) });
    }
    items.sort(cmpCountLabel);
    return { field: field, label: label, items: items, missing: missing, nonEmpty: nonEmpty };
  }

  /** 超过 max 项时保留前 max-1 项，其余合并为「其他」（合并后仍按数量降序） */
  function truncateItems(items, max) {
    if (items.length <= max) return items.slice();
    var head = items.slice(0, max - 1);
    var rest = items.slice(max - 1);
    var otherCount = 0;
    for (var i = 0; i < rest.length; i++) otherCount += rest[i].count;
    var total = 0;
    for (var j = 0; j < items.length; j++) total += items[j].count;
    var other = { label: '其他', count: otherCount, pct: pct1(otherCount, total), merged: rest.length };
    var out = head.concat([other]);
    out.sort(cmpCountLabel);
    return out;
  }

  /* =========================================================
   * 六、洞察（6–10 条，数据驱动、互不重复）
   * ======================================================= */

  function topItems(dist, n) {
    if (!dist) return [];
    return dist.items.slice(0, n);
  }

  function distById(ctx, key) {
    return ctx.dist[key] || null;
  }

  /** 「2023级 5 人（45.5%）」式片段 */
  function itemText(item, nonEmpty) {
    return item.label + ' ' + item.count + ' 人（' + pctText(item.count, nonEmpty) + '%）';
  }

  function buildInsights(ctx) {
    var out = [];
    var totals = ctx.totals;
    var roster = ctx.roster;

    if (totals.raw === 0) {
      return [
        '本次没有读取到任何报名数据：0 个来源表、0 条记录，学院、年级、趋势都无法统计，请先上传 .xlsx 或 .csv 报名表。',
        '表头识别结果为 0 个规范字段、0 列未识别，说明文件为空或第一行不是表头；请确认第 1 行是「姓名 / 学号 / 学院」这类列名。',
        '去重与有效性检查未执行：0 条原始记录，重复 0 条、无效 0 条，暂无可用于分组的名单。',
        '报名趋势为空（0 天有记录），无法判断报名节奏，也无法推算截止前的高峰日。',
        '信息完整率为 0.0%（0 人中 0 人三项齐全），在补齐数据前不建议下任何关于报名质量的结论。',
        '缴费统计未启用（0 个表包含缴费列），如需对账请在上传的模板中加入「是否缴费」列。'
      ];
    }

    var srcCount = ctx.sources.length;
    var completeN = 0;
    for (var ci = 0; ci < roster.length; ci++) {
      if (roster[ci].name && roster[ci].college && roster[ci].phone) completeN += 1;
    }

    /* 1. 总量与去重 */
    (function () {
      var s = '本次共汇总 ' + srcCount + ' 个来源表、' + totals.raw + ' 条报名记录，去重后有效 ' + totals.unique + ' 人';
      if (totals.duplicates > 0) s += '，其中重复提交 ' + totals.duplicates + ' 条（占 ' + pctText(totals.duplicates, totals.raw) + '%）';
      if (totals.invalid > 0) s += '、缺姓名作废 ' + totals.invalid + ' 条';
      s += '，可用率 ' + pctText(totals.unique, totals.raw) + '%。';
      if (totals.duplicates === 0 && totals.invalid === 0) s += '整体口径干净，可以直接进入分组。';
      out.push(s);
    })();

    /* 2. 跨表来源对比 */
    (function () {
      var list = ctx.sources.filter(function (s) { return s.rowCount > 0; });
      if (!list.length) return;
      var sorted = list.slice().sort(function (a, b) { return b.rowCount - a.rowCount || (a.name < b.name ? -1 : 1); });
      var top = sorted[0];
      var topDone = 0;
      for (var i = 0; i < ctx.records.length; i++) {
        var rec = ctx.records[i];
        if (rec.source !== top.name) continue;
        if (rec.f.name && rec.f.college && rec.f.phone) topDone += 1;
      }
      var topRate = pctText(topDone, top.rowCount);
      if (sorted.length === 1) {
        out.push('本次只有「' + top.name + '」1 个来源、' + top.rowCount + ' 条记录，信息完整率 ' + topRate +
          '%；单一入口省事，但一旦错行就没有第二份数据可以交叉核对，建议同步保留 1 个线上备份入口。');
        return;
      }
      var second = sorted[1];
      var secondDone = 0;
      for (var j = 0; j < ctx.records.length; j++) {
        var rec2 = ctx.records[j];
        if (rec2.source !== second.name) continue;
        if (rec2.f.name && rec2.f.college && rec2.f.phone) secondDone += 1;
      }
      var secondRate = pctText(secondDone, second.rowCount);
      var diff = Math.round((Number(topRate) - Number(secondRate)) * 10) / 10;
      var s = '「' + top.name + '」' + top.rowCount + ' 条（占 ' + pctText(top.rowCount, totals.raw) + '%）是最大来源，「' +
        second.name + '」' + second.rowCount + ' 条次之（占 ' + pctText(second.rowCount, totals.raw) + '%）；两者信息完整率分别为 ' +
        topRate + '% 与 ' + secondRate + '%';
      if (diff === 0) {
        s += '，两边持平';
      } else if (diff > 0) {
        s += '，' + top.name + ' 比 ' + second.name + ' 高 ' + diff.toFixed(1) + ' 个百分点';
      } else {
        s += '，' + second.name + ' 比 ' + top.name + ' 高 ' + Math.abs(diff).toFixed(1) + ' 个百分点';
      }
      if (Math.abs(diff) > 10) s += '，完整率低的那一侧必填约束不足，下次收表前统一模板。';
      else s += '，两个入口的填写质量还算接近。';
      out.push(s);
    })();

    /* 3. 学院结构与集中度 */
    (function () {
      var dist = distById(ctx, 'college');
      if (!dist || !dist.items.length) return;
      var items = dist.items;
      var s;
      if (items.length === 1) {
        s = '学院分布高度集中：' + dist.nonEmpty + ' 人全部来自「' + items[0].label + '」，跨学院宣传还没铺开';
      } else {
        var top = items[0];
        var topTies = 1;
        while (topTies < items.length && items[topTies].count === top.count) topTies += 1;
        var second = null;
        for (var k = topTies; k < items.length; k++) {
          if (items[k].count < top.count) {
            second = items[k];
            break;
          }
        }
        if (topTies > 1) {
          var tieLabels = [];
          for (var tl = 0; tl < topTies; tl++) tieLabels.push(items[tl].label);
          s = '学院分布并列居首：' + tieLabels.join('、') + ' 各 ' + top.count + ' 人（' + pctText(top.count, dist.nonEmpty) + '%）';
          if (second) s += '，' + second.label + ' ' + second.count + ' 人紧随';
        } else {
          s = top.label + ' ' + top.count + ' 人（' + pctText(top.count, dist.nonEmpty) + '%）居首';
          if (second) {
            s += '，' + second.label + ' ' + second.count + ' 人（' + pctText(second.count, dist.nonEmpty) + '%）次之';
            var two = top.count + second.count;
            s += '，两者合计 ' + two + ' 人、占 ' + pctText(two, dist.nonEmpty) + '%';
          }
        }
        var headCount = topTies + (second ? 1 : 0);
        if (items.length > headCount) {
          var restCount = 0;
          for (var i = headCount; i < items.length; i++) restCount += items[i].count;
          s += '，其余 ' + (items.length - headCount) + ' 个学院合计 ' + restCount + ' 人';
        }
      }
      if (dist.missing > 0) s += '（另有 ' + dist.missing + ' 人未填学院）';
      s += '。';
      out.push(s);
    })();

    /* 4. 年级结构 */
    (function () {
      var dist = distById(ctx, 'grade');
      if (!dist || !dist.items.length) return;
      var items = dist.items;
      var s;
      if (items.length === 1) {
        s = '年级高度集中：' + dist.nonEmpty + ' 人全部是 ' + items[0].label + '，没有跨年级样本，活动形式可以按单一年级的口味定';
      } else {
        s = '年级以 ' + itemText(items[0], dist.nonEmpty) + '为主';
        if (items.length >= 2) s += '，' + itemText(items[1], dist.nonEmpty) + '紧随其后';
        var maxG = items[0];
        var minG = items[items.length - 1];
        if (items.length >= 3) s += '，' + itemText(minG, dist.nonEmpty) + '最少';
        if (/^\d{4}级$/.test(maxG.label) && /^\d{4}级$/.test(minG.label)) {
          var young = Number(maxG.label.slice(0, 4)) > Number(minG.label.slice(0, 4)) ? maxG : minG;
          s += '；' + young.label + ' 占 ' + pctText(young.count, dist.nonEmpty) + '%，低年级覆盖' + (pct1(young.count, dist.nonEmpty) >= 40 ? '不错' : '偏弱，可在新生群补一轮宣传');
        }
      }
      if (dist.missing > 0) s += '（' + dist.missing + ' 人年级未填）';
      out.push(s + '。');
    })();

    /* 5. 报名高峰与节奏 */
    (function () {
      var trend = ctx.trend;
      if (!trend.length) return;
      var total = 0;
      var peak = trend[0];
      for (var i = 0; i < trend.length; i++) {
        total += trend[i].count;
        if (trend[i].count > peak.count) peak = trend[i];
      }
      if (trend.length === 1) {
        out.push('报名只集中在 ' + trend[0].date + ' 这 1 天，共 ' + trend[0].count + ' 条；单日收齐便于统计，但也意味着提醒只发了一次，容易漏人。');
        return;
      }
      var tail = trend.slice(Math.max(0, trend.length - 3));
      var tailCount = 0;
      for (var j = 0; j < tail.length; j++) tailCount += tail[j].count;
      var s = '报名从 ' + trend[0].date + ' 持续到 ' + trend[trend.length - 1].date + '，' + trend.length + ' 天里共 ' + total +
        ' 条，日均 ' + (total / trend.length).toFixed(1) + ' 条；高峰在 ' + peak.date + '（' + peak.count + ' 条，占 ' +
        pctText(peak.count, total) + '%）';
      if (tail.length >= 2) s += '，最后 ' + tail.length + ' 天贡献 ' + tailCount + ' 条（' + pctText(tailCount, total) + '%）';
      if (pct1(tailCount, total) >= 40) s += '，压哨提交明显，截止提醒建议提前到 T-2 再发一次。';
      else s += '，报名节奏比较平均，没有明显的压哨现象。';
      out.push(s);
    })();

    /* 6. 缺失字段影响与补全建议 */
    (function () {
      var comp = ctx.completeness;
      if (!comp.length || !roster.length) return;
      var core = comp.filter(function (x) { return x.field === 'phone' || x.field === 'college' || x.field === 'name'; });
      var missingCore = [];
      for (var i = 0; i < core.length; i++) {
        if (core[i].filled < core[i].total) missingCore.push(core[i]);
      }
      var worst = comp.slice().sort(function (a, b) { return a.rate - b.rate || (a.field < b.field ? -1 : 1); })[0];
      if (!missingCore.length) {
        out.push('姓名、学院、手机号三项在 ' + roster.length + ' 人里全部填写完整（100.0%），名单可以直接用于分组和通知；' +
          (worst && worst.rate < 100 ? '相对最弱的是「' + worst.label + '」（' + worst.filled + '/' + worst.total + '，' + worst.rate.toFixed(1) + '%）。' : '各字段都填得比较齐。'));
        return;
      }
      var parts = [];
      for (var j = 0; j < missingCore.length; j++) {
        var m = missingCore[j];
        var miss = m.total - m.filled;
        parts.push(m.label + '缺 ' + miss + ' 人（' + (100 - m.rate).toFixed(1) + '%）');
      }
      var s = parts.join('、') + '，会直接影响拉群、场地分组和紧急联系';
      var coreWorst = null;
      for (var cw = 0; cw < core.length; cw++) {
        if (!coreWorst || core[cw].rate < coreWorst.rate) coreWorst = core[cw];
      }
      if (coreWorst && coreWorst.rate < 70) {
        s += '；其中「' + coreWorst.label + '」最缺，只有 ' + coreWorst.filled + '/' + coreWorst.total + ' 人填了';
      }
      s += '。建议把手机号与学院设为必填项，并对已有名单做一次逐个补录。';
      out.push(s);
    })();

    /* 7. 饮食与尺码备货 */
    (function () {
      var diet = distById(ctx, 'diet');
      var shirt = distById(ctx, 'shirt');
      if (!diet && !shirt) return;
      var s = '';
      if (diet && diet.items.length) {
        var special = diet.items.filter(function (x) { return x.label !== '无'; });
        var none = diet.items.filter(function (x) { return x.label === '无'; })[0];
        if (special.length) {
          var segs = [];
          var shown = special.slice(0, 3);
          for (var i = 0; i < shown.length; i++) segs.push(shown[i].label + ' ' + shown[i].count + ' 人');
          s += '饮食上有 ' + segs.join('、');
          if (special.length > 3) s += ' 等 ' + special.length + ' 类特殊需求';
          s += '（合计 ' + diet.items.reduce(function (a, b) { return a + (b.label === '无' ? 0 : b.count); }, 0) + ' 人）需要单独备注餐食';
          if (none) s += '，其余 ' + none.count + ' 人无禁忌';
          if (diet.missing > 0) s += '，' + diet.missing + ' 人未填';
        } else {
          s += '饮食方面 ' + diet.items[0].count + ' 人明确无禁忌，暂不需要单独配餐';
          if (diet.missing > 0) s += '，另有 ' + diet.missing + ' 人未填，建议报名截止后补问一次';
        }
      }
      if (shirt && shirt.items.length) {
        var tops = shirt.items.slice(0, 3);
        var need = [];
        for (var j = 0; j < tops.length; j++) {
          need.push(tops[j].label + ' ' + Math.ceil(tops[j].count * 1.1) + ' 件');
        }
        if (s) s += '；';
        s += '服装尺码 ' + tops.map(function (t) { return t.label + ' ' + t.count + ' 件'; }).join('、') +
          '，按含 10% 余量的 ' + need.join(' / ') + '备货最稳，覆盖已填尺码的 ' + shirt.nonEmpty + ' 人';
        if (shirt.missing > 0) s += '（' + shirt.missing + ' 人还没报尺码）';
      }
      out.push(s + '。');
    })();

    /* 8. 重复报名 */
    (function () {
      if (!ctx.duplicates.length) {
        if (totals.invalid > 0) {
          out.push('去重环节没有发现重复提交（0 组），但有 ' + totals.invalid + ' 条记录因缺姓名作废；' + totals.unique +
            ' 人有完整姓名可用于分组，建议先把作废的 ' + totals.invalid + ' 条补回来再统计。');
        } else {
          out.push('去重环节删掉 0 条记录：重复 0 条、作废 0 条，' + totals.unique + ' 人与原始记录数完全一致，入口把控得不错。');
        }
        return;
      }
      var keys = ctx.duplicates.slice(0, 3).map(function (d) { return d.key + '（' + d.count + ' 次）'; });
      var maxCount = 0;
      for (var i = 0; i < ctx.duplicates.length; i++) maxCount = Math.max(maxCount, ctx.duplicates[i].count);
      var s = '发现 ' + ctx.duplicates.length + ' 组重复提交，共 ' + totals.duplicates + ' 条（重复率 ' + pctText(totals.duplicates, totals.raw) +
        '%），例如 ' + keys.join('、');
      s += '；重复主要来自多个入口的交叉填写，建议在报名表加学号唯一校验，或在群里公示已报名名单让大家自查。';
      out.push(s);
    })();

    /* 9. 会员结构与招新 */
    (function () {
      var dist = distById(ctx, 'isMember');
      if (!dist || !dist.items.length) return;
      var yes = 0;
      var no = 0;
      for (var i = 0; i < dist.items.length; i++) {
        if (dist.items[i].label === '是') yes += dist.items[i].count;
        if (dist.items[i].label === '否') no += dist.items[i].count;
      }
      if (!yes && !no) return;
      var known = yes + no;
      var s = '会员 ' + yes + ' 人（' + pctText(yes, known) + '%）、非会员 ' + no + ' 人（' + pctText(no, known) + '%）';
      if (dist.missing > 0) s += '、未填 ' + dist.missing + ' 人';
      var nonMembers = roster.filter(function (x) { return x.isMember === '否'; });
      if (nonMembers.length) {
        var gradeCount = {};
        var gradeOrder = [];
        for (var j = 0; j < nonMembers.length; j++) {
          var gl = nonMembers[j].grade || '未填年级';
          if (gradeCount[gl] === undefined) {
            gradeCount[gl] = 0;
            gradeOrder.push(gl);
          }
          gradeCount[gl] += 1;
        }
        gradeOrder.sort(function (a, b) { return gradeCount[b] - gradeCount[a] || (a < b ? -1 : 1); });
        s += '；非会员以 ' + gradeOrder[0] + ' 最多（' + gradeCount[gradeOrder[0]] + ' 人）';
        if (no / known >= 0.4) s += '，招新转化空间还很大，可以在活动结束时安排一次入社登记。';
        else s += '，会员基本盘稳定，重点是把非会员留下来。';
      } else {
        s += '，全部为在册会员，这次活动主要是内部动员。';
      }
      out.push(s);
    })();

    /* 10. 缴费对账 */
    (function () {
      if (!ctx.fee) return;
      var fee = ctx.fee;
      if (fee.total === 0) {
        out.push('报名表里有缴费列，但 ' + roster.length + ' 人全部没填缴费状态，费用对账无法进行；如本次活动收费，建议在群里公示缴费名单。');
        return;
      }
      var s = '缴费信息覆盖 ' + fee.total + '/' + roster.length + ' 人（' + pctText(fee.total, roster.length) + '%），已缴 ' + fee.paid +
        ' 人、未缴 ' + fee.unpaid + ' 人';
      if (fee.amount > 0) s += '，已识别金额合计 ' + fee.amount + ' 元';
      var unknown = fee.total - fee.paid - fee.unpaid;
      if (unknown > 0) s += '，另有 ' + unknown + ' 人状态无法识别';
      s += '；建议在截止日按「已缴 / 未缴」两张表对账，避免现场收钱时重复核对。';
      out.push(s);
    })();

    /* 11. 场次 / 性别均衡 */
    (function () {
      var parts = [];
      var session = distById(ctx, 'session');
      if (session && session.items.length) {
        var top = session.items[0];
        parts.push('场次上 ' + top.label + ' ' + top.count + ' 人（' + pctText(top.count, session.nonEmpty) + '%）' +
          (session.items.length >= 2 ? '，' + session.items[1].label + ' ' + session.items[1].count + ' 人' : ''));
      }
      var gender = distById(ctx, 'gender');
      if (gender && gender.items.length) {
        var segs = [];
        for (var i = 0; i < Math.min(3, gender.items.length); i++) {
          segs.push(gender.items[i].label + ' ' + gender.items[i].count + ' 人（' + pctText(gender.items[i].count, gender.nonEmpty) + '%）');
        }
        parts.push('性别比例 ' + segs.join('、'));
      }
      if (!parts.length) return;
      out.push(parts.join('；') + '。' + (session && session.items.length >= 2 && pct1(session.items[0].count, session.nonEmpty) >= 60
        ? '场次明显不均，可以把报名页的默认选项调成人数较少的那一场。' : ''));
    })();

    /* 12. 列识别质量 */
    (function () {
      if (!ctx.fields.length && !ctx.unmatched.length) return;
      var totalCols = 0;
      for (var i = 0; i < ctx.sources.length; i++) totalCols += ctx.sources[i].header.length;
      var matchedCols = 0;
      for (var j = 0; j < ctx.sources.length; j++) matchedCols += ctx.sources[j].matched.length;
      var s = ctx.sources.length + ' 张表共 ' + totalCols + ' 列，识别出 ' + matchedCols + ' 列为规范字段（' +
        pctText(matchedCols, totalCols) + '%）';
      if (ctx.unmatched.length) {
        var names = ctx.unmatched.slice(0, 3).map(function (u) { return '「' + u.header + '」'; });
        s += '，未识别 ' + ctx.unmatched.length + ' 列，例如 ' + names.join('、') +
          '，这些内容不会进入汇总表；如果确实需要，可以下一版把它们加进字段集。';
      } else {
        s += '，没有未识别的列，字段对齐可以直接使用。';
      }
      out.push(s);
    })();

    /* 13. 完整率总述（仅在洞察不足 6 条时兜底） */
    (function () {
      if (out.length >= 6) return;
      if (!roster.length) return;
      var rate = totals.completeRate;
      var miss = roster.length - completeN;
      var s = '姓名+学院+手机号三项齐全的有 ' + completeN + ' 人，共 ' + roster.length + ' 人，完整率 ' + rate.toFixed(1) + '%';
      if (miss > 0) {
        s += '，还有 ' + miss + ' 人信息不齐；补齐这些人之后，分组、通知、场地人数都能一次算准。';
      } else {
        s += '，名单可以直接导出使用。';
      }
      out.push(s);
    })();

    /* 去重保险：按文本去重，保证「互不重复」 */
    var seen = {};
    var uniqueOut = [];
    for (var z = 0; z < out.length; z++) {
      var text = String(out[z] || '').trim();
      if (!text || seen[text]) continue;
      seen[text] = 1;
      uniqueOut.push(text);
    }
    if (uniqueOut.length > 10) uniqueOut = uniqueOut.slice(0, 10);
    if (uniqueOut.length < 6) {
      var extra = [
        '这 ' + ctx.sources.length + ' 个来源表一共覆盖 ' + totals.raw + ' 条报名记录、' + totals.unique + ' 位有效报名者，样本量' +
          (totals.unique >= 30 ? '足够支撑占比类结论。' : '偏小，占比结论先当参考，人数再翻一倍会更稳。'),
        '本次共检查 ' + roster.length + ' 人的 ' + ctx.completeness.length + ' 个字段，平均每人的信息完整度为 ' +
          (ctx.completeness.length ? (ctx.completeness.reduce(function (a, b) { return a + b.rate; }, 0) / ctx.completeness.length).toFixed(1) : '0.0') + '%。',
        '导出工作簿共 4 张工作表（汇总概览 / 报名名单 / 分布统计 / 报名趋势），' + totals.unique + ' 人的名单与分布可以直接给指导老师看。'
      ];
      for (var e = 0; e < extra.length && uniqueOut.length < 6; e++) uniqueOut.push(extra[e]);
    }
    return uniqueOut;
  }

  /* =========================================================
   * 七、数据质量提醒（2–5 条）
   * ======================================================= */

  function buildWarnings(ctx) {
    var out = [];
    var totals = ctx.totals;

    if (totals.raw === 0) {
      return [
        '未读取到任何报名数据（0 个来源表），请确认上传的是 .xlsx / .csv，且第 1 行为「姓名 / 学号 / 学院」这类表头。',
        '当前 0 列被识别为规范字段，若文件本身有数据，多半是表头顺序或合并单元格问题，建议另存为纯文本表格后重试。'
      ];
    }

    /* 1. 核心字段缺失 */
    var comp = ctx.completeness;
    var phoneComp = null;
    var collegeComp = null;
    for (var i = 0; i < comp.length; i++) {
      if (comp[i].field === 'phone') phoneComp = comp[i];
      if (comp[i].field === 'college') collegeComp = comp[i];
    }
    if (phoneComp && phoneComp.filled < phoneComp.total) {
      var missPhone = phoneComp.total - phoneComp.filled;
      out.push('「手机号」有 ' + missPhone + ' 人未填（' + pctText(missPhone, phoneComp.total) + '%），这些人无法拉群、也无法在活动前一天通知到位；' +
        '建议导出名单后逐个补录，或在群里 @ 全员补填。');
    }
    if (collegeComp && collegeComp.filled < collegeComp.total) {
      var missCol = collegeComp.total - collegeComp.filled;
      out.push('「学院」有 ' + missCol + ' 人未填（' + pctText(missCol, collegeComp.total) + '%），学院维度的人数会对不上，' +
        '分组和宣传覆盖判断都会偏；补填后再复核一次学院分布。');
    }

    /* 2. 学院写法合并（只报告实际发生归并的组） */
    var mergedGroups = ctx.collegeGroups.filter(function (g) { return g.writings.length > 1; });
    if (mergedGroups.length) {
      var parts = [];
      for (var m = 0; m < Math.min(3, mergedGroups.length); m++) {
        var g = mergedGroups[m];
        parts.push('「' + g.rep + '」归并了 ' + g.writings.join(' / '));
      }
      out.push('学院名有 ' + mergedGroups.length + ' 组同义写法，已按出现最多的写法归并：' + parts.join('；') +
        (mergedGroups.length > 3 ? ' 等' : '') + '。合并后各学院人数才一致，下次建议把学院字段改成下拉选择。');
    }

    /* 3. 无效记录 */
    if (ctx.invalid.length) {
      var idxs = ctx.invalid.slice(0, 5).map(function (x) { return '第 ' + x.index + ' 条'; });
      out.push('有 ' + ctx.invalid.length + ' 条记录因缺少姓名被作废（' + idxs.join('、') +
        '），请核对原始表格是否错行、表头是否被当成数据、或合并单元格导致姓名丢失。');
    }

    /* 4. 重复记录 */
    if (ctx.duplicates.length) {
      out.push('发现 ' + ctx.duplicates.length + ' 组重复报名、共 ' + totals.duplicates + ' 条（重复率 ' +
        pctText(totals.duplicates, totals.raw) + '%），已按学号/手机号/姓名+学院保留首次提交；如果有人中途换号或改名，请人工确认一次。');
    }

    /* 5. 未识别列 */
    if (ctx.unmatched.length) {
      var samples = ctx.unmatched.slice(0, 3).map(function (u) { return '「' + u.header + '」'; });
      out.push('有 ' + ctx.unmatched.length + ' 列未被识别（如 ' + samples.join('、') +
        '），这些信息不会进入汇总表和导出名单；如果活动需要（如宿舍号、是否参加过），请先在模板里换成规范列名。');
    }

    /* 6. 完整率偏低 */
    if (totals.unique > 0 && totals.completeRate < 80) {
      var readyN = 0;
      for (var rr = 0; rr < ctx.roster.length; rr++) {
        if (ctx.roster[rr].name && ctx.roster[rr].college && ctx.roster[rr].phone) readyN += 1;
      }
      out.push('整体信息完整率（姓名+学院+手机号齐全）只有 ' + totals.completeRate.toFixed(1) + '%，' + totals.unique + ' 人里 ' +
        readyN + ' 人三项齐全，低于 80% 的可用线；导出前建议先补齐关键字段，否则通知和分组会出现漏洞。');
    }

    /* 7. 缴费 */
    if (!ctx.fee) {
      out.push('没有检测到缴费列（是否缴费 / 缴费状态），费用对账无法自动统计；如果本次活动收费，请在报名表加上这一列并把模板发给报名者。');
    } else if (ctx.fee.total < totals.unique) {
      out.push('缴费列只覆盖 ' + ctx.fee.total + '/' + totals.unique + ' 人（' + pctText(ctx.fee.total, totals.unique) +
        '%），已缴 ' + ctx.fee.paid + ' 人、未缴 ' + ctx.fee.unpaid + ' 人；建议让未填的人补一下状态，现场收款才不会重复确认。');
    }

    /* 8. 样本量 */
    if (totals.unique > 0 && totals.unique < 10) {
      out.push('有效样本只有 ' + totals.unique + ' 人，占比类结论（如学院占比、饮食结构）波动会比较大，建议扩大样本或与上次活动数据合并再看。');
    }

    /* 9. 干净兜底 */
    if (out.length < 2) {
      out.push('数据整体干净：' + totals.raw + ' 条记录、0 条重复、0 条作废，但仍有 ' + ctx.completeness.length +
        ' 个字段需要抽查，导出前建议人工看一遍前 3 条。');
      out.push('本次未检测到明显的数据质量问题，仍建议把报名表模板固定下来（含姓名/学号/学院/手机号必填），下次汇总能省一半时间。');
    }
    if (out.length > 5) out = out.slice(0, 5);
    return out;
  }

  /* =========================================================
   * 八、导出工作表
   * ======================================================= */

  /** 空结果（exportSheets 容错用） */
  function emptyResult() {
    return {
      sources: [], fields: [], unmatched: [],
      totals: { raw: 0, unique: 0, duplicates: 0, invalid: 0, completeRate: 0 },
      roster: [], duplicates: [], invalid: [], distributions: [], trend: [],
      completeness: [], fee: null, insights: [], warnings: []
    };
  }

  /**
   * 把汇总结果转成 CLUB.xlsx.write 可直接使用的工作表数组。
   * 默认输出契约规定的 4 张表：汇总概览 / 报名名单 / 分布统计 / 报名趋势（空数据也有表头）；
   * opts.includeIssues 为 true 时额外追加第 5 张「异常名单」（无效 + 重复记录明细）。
   * @param {Object} result summarize 的返回值
   * @param {{includeIssues?: boolean}} [opts]
   * @returns {Array<{name: string, rows: Array<Array<string|number>>, widths: number[]}>}
   */
  function exportSheets(result, opts) {
    var includeIssues = !!(opts && opts.includeIssues);
    var r = result && typeof result === 'object' ? result : emptyResult();
    var totals = r.totals || emptyResult().totals;
    var roster = Array.isArray(r.roster) ? r.roster : [];
    var trend = Array.isArray(r.trend) ? r.trend : [];
    var distributions = Array.isArray(r.distributions) ? r.distributions : [];
    var invalid = Array.isArray(r.invalid) ? r.invalid : [];
    var duplicates = Array.isArray(r.duplicates) ? r.duplicates : [];
    var sources = Array.isArray(r.sources) ? r.sources : [];
    var fee = r.fee || null;
    var sheets = [];

    /* --- 1 汇总概览 --- */
    var peakDate = '';
    var peakCount = 0;
    for (var i = 0; i < trend.length; i++) {
      if (trend[i].count > peakCount) {
        peakCount = trend[i].count;
        peakDate = trend[i].date;
      }
    }
    var overview = [['指标', '数值']];
    overview.push(['来源表数量', sources.length]);
    overview.push(['原始记录数', totals.raw || 0]);
    overview.push(['去重后人数', totals.unique || 0]);
    overview.push(['重复记录数', totals.duplicates || 0]);
    overview.push(['重复率(%)', pct1(totals.duplicates || 0, totals.raw || 0)]);
    overview.push(['无效记录数', totals.invalid || 0]);
    overview.push(['可用率(%)', pct1(totals.unique || 0, totals.raw || 0)]);
    overview.push(['信息完整率(%)', totals.completeRate || 0]);
    overview.push(['报名有记录天数', trend.length]);
    overview.push(['报名高峰日', peakDate || '—']);
    overview.push(['报名高峰人数', peakCount]);
    var collegeDist = null;
    for (var d = 0; d < distributions.length; d++) {
      if (distributions[d].field === 'college') collegeDist = distributions[d];
    }
    overview.push(['学院数量', collegeDist ? collegeDist.items.length : 0]);
    var memberYes = 0;
    var memberNo = 0;
    var memberUnknown = 0;
    for (var mr = 0; mr < roster.length; mr++) {
      if (roster[mr].isMember === '是') memberYes += 1;
      else if (roster[mr].isMember === '否') memberNo += 1;
      else memberUnknown += 1;
    }
    overview.push(['会员人数', memberYes]);
    overview.push(['非会员人数', memberNo]);
    overview.push(['会员未填人数', memberUnknown]);
    if (fee) {
      overview.push(['缴费记录数', fee.total || 0]);
      overview.push(['已缴人数', fee.paid || 0]);
      overview.push(['未缴人数', fee.unpaid || 0]);
      overview.push(['已缴金额(元)', fee.amount || 0]);
    }
    var doneCount = 0;
    for (var rc = 0; rc < roster.length; rc++) {
      if (roster[rc].name && roster[rc].college && roster[rc].phone) doneCount += 1;
    }
    overview.push(['三项齐全人数', doneCount]);
    sheets.push({ name: '汇总概览', rows: overview, widths: [24, 46] });

    /* --- 2 报名名单 --- */
    var rosterRows = [[
      '序号', '姓名', '学号', '学院', '年级', '专业', '班级', '性别', '手机号', 'QQ或微信',
      '是否会员', '报名时间', '缴费', '场次', '备注', '来源表', '异常说明'
    ]];
    for (var r2 = 0; r2 < roster.length; r2++) {
      var person = roster[r2];
      rosterRows.push([
        person.index || (r2 + 1),
        person.name || '',
        person.studentId || '',
        person.college || '',
        person.grade || '',
        person.major || '',
        person.cls || '',
        person.gender || '',
        person.phone || '',
        person.contact || '',
        person.isMember || '',
        person.signupTime || '',
        person.fee || '',
        person.session || '',
        person.remark || '',
        person.source || '',
        Array.isArray(person.issues) ? person.issues.join('；') : ''
      ]);
    }
    sheets.push({
      name: '报名名单',
      rows: rosterRows,
      widths: [6, 10, 14, 18, 10, 18, 10, 6, 14, 14, 10, 18, 10, 10, 24, 14, 28]
    });

    /* --- 3 分布统计 --- */
    var distRows = [['字段', '选项', '人数', '占比(%)']];
    for (var d2 = 0; d2 < distributions.length; d2++) {
      var dist = distributions[d2];
      var items = Array.isArray(dist.items) ? dist.items : [];
      for (var it = 0; it < items.length; it++) {
        distRows.push([dist.label || dist.field, items[it].label, items[it].count, items[it].pct]);
      }
      if (dist.missing > 0) {
        var totalPeople = (dist.items || []).reduce(function (a, b) { return a + b.count; }, 0) + dist.missing;
        distRows.push([dist.label || dist.field, '（未填写）', dist.missing, pct1(dist.missing, totalPeople)]);
      }
    }
    sheets.push({ name: '分布统计', rows: distRows, widths: [16, 24, 10, 12] });

    /* --- 4 报名趋势 --- */
    var trendRows = [['日期', '报名人数', '占比(%)']];
    var trendTotal = 0;
    for (var t = 0; t < trend.length; t++) trendTotal += trend[t].count;
    for (var t2 = 0; t2 < trend.length; t2++) {
      trendRows.push([trend[t2].date, trend[t2].count, pct1(trend[t2].count, trendTotal)]);
    }
    sheets.push({ name: '报名趋势', rows: trendRows, widths: [14, 12, 12] });

    /* --- 5 异常名单（可选追加） --- */
    if (includeIssues) {
      var issueRows = [['原始序号', '类型', '问题说明', '姓名', '学号', '手机号', '来源表']];
      for (var iv = 0; iv < invalid.length; iv++) {
        var item = invalid[iv] || {};
        issueRows.push([
          item.index || '',
          '无效记录',
          item.reason || '无效记录',
          item.name || '',
          item.studentId || '',
          item.phone || '',
          item.source || ''
        ]);
      }
      for (var dp = 0; dp < duplicates.length; dp++) {
        var dup = duplicates[dp] || {};
        var rowsIdx = Array.isArray(dup.rows) ? dup.rows : [];
        var namesArr = Array.isArray(dup.names) ? dup.names : [];
        var srcArr = Array.isArray(dup.sources) ? dup.sources : [];
        for (var dr = 0; dr < rowsIdx.length; dr++) {
          issueRows.push([
            rowsIdx[dr],
            dr === 0 ? '重复提交（保留首条）' : '重复提交（已合并）',
            '重复键「' + (dup.key || '') + '」共出现 ' + (dup.count || rowsIdx.length) + ' 次',
            namesArr[dr] || '',
            '',
            dup.kind === '手机号' ? (dup.key || '') : '',
            srcArr[dr] || ''
          ]);
        }
      }
      sheets.push({ name: '异常名单', rows: issueRows, widths: [10, 22, 34, 10, 14, 14, 14] });
    }

    return sheets;
  }

  /* =========================================================
   * 九、导出 API
   * ======================================================= */

  global.CLUB = global.CLUB || {};
  global.CLUB.stats = {
    summarize: summarize,
    exportSheets: exportSheets
  };
})(typeof window !== 'undefined' ? window : globalThis);

