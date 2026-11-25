/* ---- js/app.js ---- */
/* 活动流 · 应用层：三流程 UI、状态管理、预览渲染与文件导出 */
(function () {
  'use strict';

  var CLUB = window.CLUB || {};
  var $ = function (id) { return document.getElementById(id); };
  var LS_KEY = 'clubflow.v1';

  var state = {
    planForm: {},
    sumForm: {},
    sources: [],      // [{ name, rows }]
    plan: null,
    stats: null,
    summary: null,
    planTab: 'doc',
    sumTab: 'press',
    rosterQuery: '',
    album: { photos: [], layout: 2, credit: '', intro: '', built: null }
  };

  var PLAN_TABS = [
    { key: 'doc', label: '活动策划书' },
    { key: 'venueForm', label: '场地申请表' },
    { key: 'notice', label: '活动通知' },
    { key: 'handbook', label: '执行手册' },
    { key: 'signTemplate', label: '报名表模板' }
  ];
  var SUM_TABS = [
    { key: 'press', label: '新闻稿' },
    { key: 'report', label: '活动总结' },
    { key: 'social', label: '社媒文案' }
  ];
  var ROSTER_COLS = [
    ['name', '姓名'], ['studentId', '学号'], ['college', '学院'], ['grade', '年级'],
    ['major', '专业'], ['phone', '手机号'],
    ['signupTime', '报名时间'], ['source', '来源']
  ];

  /* ---------------------------------------------------------------- 工具 */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function inline(s) {
    return esc(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  }
  function toast(msg, isErr) {
    var el = $('toast');
    el.textContent = msg;
    el.className = 'toast show' + (isErr ? ' err' : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.className = 'toast' + (isErr ? ' err' : ''); }, 2600);
  }
  function debounce(fn, ms) {
    var t;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms || 300);
    };
  }
  function todayISO() {
    var d = new Date();
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function num(v, def) {
    var n = parseFloat(v);
    return isFinite(n) ? n : (def == null ? 0 : def);
  }
  // 空值保留为 null：交给 summary 判定「未填写」并估算，而不是当成 0
  function numOrNull(v) {
    if (v === '' || v === null || v === undefined) return null;
    var n = parseFloat(v);
    return isFinite(n) ? n : null;
  }
  function lines(text) {
    return String(text || '').split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
  }
  function fmtDate(iso) {
    if (!iso) return '待定';
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) return iso;
    var wd = ['日', '一', '二', '三', '四', '五', '六'][new Date(iso + 'T00:00:00').getDay()];
    return m[1] + '年' + (+m[2]) + '月' + (+m[3]) + '日（周' + wd + '）';
  }
  function download(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 800);
  }
  function stamp() {
    var d = new Date();
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate());
  }
  function safeName(s, def) {
    var v = String(s || '').replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '');
    return v || def || '活动';
  }

  /* ---------------------------------------------------------------- 状态持久化 */
  var save = debounce(function () {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        planForm: state.planForm,
        sumForm: state.sumForm,
        plan: state.plan,
        stats: state.stats,
        summary: state.summary,
        sources: state.sources,
        album: {
          layout: state.album.layout,
          credit: state.album.credit,
          intro: state.album.intro
        }
      }));
    } catch (e) { /* 超配额时忽略 */ }
  }, 400);

  function loadSaved() {
    var raw = null;
    try { raw = localStorage.getItem(LS_KEY); } catch (e) { return; }
    if (!raw) return;
    var d;
    try { d = JSON.parse(raw); } catch (e) { return; }
    state.planForm = d.planForm || {};
    state.sumForm = d.sumForm || {};
    state.sources = d.sources || [];
    state.plan = d.plan || null;
    state.stats = d.stats || null;
    state.summary = d.summary || null;
    if (d.album) {
      state.album.layout = d.album.layout || 2;
      state.album.credit = d.album.credit || '';
      state.album.intro = d.album.intro || '';
    }
  }

  /* ---------------------------------------------------------------- 表单读写 */
  function formData(form) {
    var out = {};
    Array.prototype.forEach.call(form.elements, function (el) {
      if (!el.name) return;
      if (el.type === 'checkbox') out[el.name] = el.checked;
      else out[el.name] = el.value;
    });
    return out;
  }

  function applyForm(form, data) {
    if (!data) return;
    Array.prototype.forEach.call(form.elements, function (el) {
      if (!el.name || !(el.name in data)) return;
      if (el.type === 'checkbox') el.checked = !!data[el.name];
      else el.value = data[el.name] == null ? '' : data[el.name];
    });
  }

  function collectPlan() {
    var f = formData($('planForm'));
    return {
      name: f.name, type: f.type, theme: f.theme, org: f.org, coOrg: f.coOrg,
      date: f.date, timeStart: f.timeStart, timeEnd: f.timeEnd, place: f.place,
      scale: num(f.scale, 60), audience: f.audience, purpose: f.purpose, background: f.background,
      highlights: f.highlights, guests: f.guests, contactName: f.contactName,
      contactPhone: f.contactPhone, budget: num(f.budget, 0), fee: num(f.fee, 0),
      registrationDeadline: f.registrationDeadline, needVenue: !!f.needVenue,
      venueNeeds: f.venueNeeds, materials: f.materials, prizes: f.prizes
    };
  }

  function collectSummary() {
    var f = formData($('sumForm'));
    var process = lines(f.process).map(function (line) {
      var m = /^(\d{1,2}[:：]\d{2})\s*[-—－~～至]?\s*(.*)$/.exec(line);
      return m ? { time: m[1].replace('：', ':'), content: m[2] || '' } : { time: '', content: line };
    });
    var quotes = lines(f.quotes).map(function (line) {
      var m = /^([^:：]{1,12})[:：]\s*(.+)$/.exec(line);
      return m ? { who: m[1].trim(), text: m[2].trim() } : { who: '参与者', text: line };
    });
    return {
      name: f.name, org: f.org, date: f.date, place: f.place,
      type: (state.plan && state.plan.info && state.plan.info.type) || '活动',
      theme: (state.plan && state.plan.info && state.plan.info.theme) || '',
      audience: (state.plan && state.plan.info && state.plan.info.audience) || '',
      scale: (state.plan && state.plan.info && state.plan.info.scale) || numOrNull(f.signupCount) || 0,
      actualCount: numOrNull(f.actualCount),
      signupCount: numOrNull(f.signupCount),
      guests: f.guests, process: process, highlights: lines(f.highlights),
      quotes: quotes, feedback: f.feedback, awards: f.awards,
      budgetPlan: num(f.budgetPlan, 0), budgetActual: num(f.budgetActual, 0),
      issues: lines(f.issues), improvements: lines(f.improvements),
      contactName: f.contactName, contactPhone: f.contactPhone, photos: [],
      stats: state.stats
    };
  }

  /* ---------------------------------------------------------------- 预览渲染（DocSpec → HTML） */
  function renderDoc(doc) {
    if (!doc) return '<p class="center">暂无内容</p>';
    var h = [];
    if (doc.title) h.push('<h1 class="doc-h1">' + inline(doc.title) + '</h1>');
    if (doc.subtitle) h.push('<div class="doc-sub">' + inline(doc.subtitle) + '</div>');
    if (doc.meta && doc.meta.length) {
      h.push('<div class="doc-meta">');
      doc.meta.forEach(function (row) {
        h.push('<div><b>' + inline(row[0]) + '</b><span>' + inline(row[1]) + '</span></div>');
      });
      h.push('</div>');
    }
    (doc.blocks || []).forEach(function (b) {
      if (!b || !b.type) return;
      switch (b.type) {
        case 'h1': h.push('<h1>' + inline(b.text) + '</h1>'); break;
        case 'h2': h.push('<h2>' + inline(b.text) + '</h2>'); break;
        case 'h3': h.push('<h3>' + inline(b.text) + '</h3>'); break;
        case 'p':
          h.push('<p class="' + (b.align || '') + '">' + inline(b.text) + '</p>');
          break;
        case 'bullets':
          h.push('<ul class="doc-list">' + (b.items || []).map(function (t) {
            return '<li>' + inline(t) + '</li>';
          }).join('') + '</ul>');
          break;
        case 'numbers':
          h.push('<ol class="doc-list">' + (b.items || []).map(function (t) {
            return '<li>' + inline(t) + '</li>';
          }).join('') + '</ol>');
          break;
        case 'table':
          h.push('<table class="doc-table">');
          if (b.headers && b.headers.length) {
            h.push('<thead><tr>' + b.headers.map(function (t) {
              return '<th>' + inline(t) + '</th>';
            }).join('') + '</tr></thead>');
          }
          h.push('<tbody>' + (b.rows || []).map(function (row) {
            return '<tr>' + row.map(function (cell) {
              var txt = String(cell == null ? '' : cell);
              var numeric = /^[¥￥]?\s?[\d,]+(\.\d+)?\s?(元|人|份|个|张|套|瓶|米|小时)?$/.test(txt) && txt !== '';
              return '<td' + (numeric ? ' class="num"' : '') + '>' + inline(txt) + '</td>';
            }).join('') + '</tr>';
          }).join('') + '</tbody></table>');
          break;
        case 'kv':
          h.push('<table class="doc-table kv-table">');
          (b.rows || []).forEach(function (row) {
            h.push('<tr><th style="width:28%">' + inline(row[0]) + '</th><td>' + inline(row[1]) + '</td></tr>');
          });
          h.push('</table>');
          break;
        case 'quote': h.push('<div class="doc-quote">' + inline(b.text) + '</div>'); break;
        case 'note': h.push('<div class="doc-note">' + inline(b.text) + '</div>'); break;
        case 'image': {
          var caption = b.caption ? '<figcaption>' + inline(b.caption) + '</figcaption>' : '';
          var imgStyle = '';
          if (b.crop && b.widthEmu && b.heightEmu) {
            imgStyle = ' style="width:' + Math.round(b.widthEmu / 9525) + 'px;height:' +
              Math.round(b.heightEmu / 9525) + 'px;object-fit:cover;max-height:none"';
          }
          var img = b.src ? '<img src="' + b.src + '" alt=""' + imgStyle + '>' : '';
          h.push('<figure class="doc-img">' + img + caption + '</figure>');
          break;
        }
        case 'pagebreak': h.push('<div class="doc-pagebreak"></div>'); break;
        default: break;
      }
    });
    return h.join('');
  }

  function renderPlain(text) {
    return '<div style="white-space:pre-wrap;font-family:var(--font);font-size:14px;line-height:1.9;text-indent:0">' +
      inline(text) + '</div>';
  }

  /* ---------------------------------------------------------------- 步骤 / 进度 */
  function switchTab(tab) {
    Array.prototype.forEach.call(document.querySelectorAll('.step'), function (b) {
      b.classList.toggle('is-active', b.dataset.tab === tab);
    });
    Array.prototype.forEach.call(document.querySelectorAll('.panel'), function (p) {
      p.classList.toggle('is-active', p.id === 'panel-' + tab);
    });
    if (tab === 'sum') syncSummaryFromContext();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function updateProgress() {
    var done = [!!state.plan, !!state.stats, !!state.summary, !!(state.album && state.album.built)];
    var pct = Math.round(done.filter(Boolean).length / 4 * 100);
    var bar = $('progressBar');
    if (bar) bar.style.width = pct + '%';
    if ($('progressText')) $('progressText').textContent = '流程完成度 ' + pct + '%';
    var keys = ['plan', 'reg', 'sum', 'album'];
    keys.forEach(function (k, i) {
      var el = document.querySelector('.step[data-tab="' + k + '"]');
      if (el) el.classList.toggle('is-done', done[i]);
    });
  }

  function updateProfile() {
    var p = state.planForm;
    var txt;
    if (!p.name) txt = '尚未填写活动信息';
    else txt = [p.name, p.date ? fmtDate(p.date).replace(/（.*?）/, '') : '', p.place || '']
      .filter(Boolean).join(' · ');
    var chip = document.querySelector('#profileChip .profile-text');
    if (chip) chip.textContent = txt;
  }

  /* ---------------------------------------------------------------- ① 策划 */
  function renderPlanTabs() {
    var tabs = PLAN_TABS.filter(function (t) {
      if (t.key === 'venueForm') return !!(state.plan && state.plan.venueForm);
      if (t.key === 'signTemplate') return !!(state.plan && state.plan.signTemplate);
      return !!(state.plan && state.plan[t.key]);
    });
    var host = $('planTabs');
    host.innerHTML = tabs.map(function (t) {
      return '<button type="button" class="doc-tab' + (state.planTab === t.key ? ' is-active' : '') +
        '" data-tab="' + t.key + '" role="tab">' + esc(t.label) + '</button>';
    }).join('');
    Array.prototype.forEach.call(host.querySelectorAll('.doc-tab'), function (btn) {
      btn.addEventListener('click', function () {
        state.planTab = btn.dataset.tab;
        renderPlanTabs();
        renderPlanDoc();
      });
    });
    if (!tabs.some(function (t) { return t.key === state.planTab; })) {
      state.planTab = tabs.length ? tabs[0].key : 'doc';
      renderPlanTabs();
    }
  }

  function renderPlanDoc() {
    var res = state.plan;
    if (!res) return;
    var tab = state.planTab;
    var preview = $('planPreview');
    var title = '';
    if (tab === 'signTemplate') {
      var st = res.signTemplate;
      title = st.title || '报名表模板';
      var rows = (st.sheets && st.sheets[0] && st.sheets[0].rows) || [];
      var head = rows[0] || [];
      var body = rows.slice(1);
      preview.innerHTML = '<h1 class="doc-h1">' + esc(title) + '</h1>' +
        '<p class="center" style="text-indent:0;color:#6b7891;font-family:var(--font);font-size:12.5px">' +
        '可直接导入问卷星 / 腾讯文档，或另存为 Excel 分发给报名同学。</p>' +
        '<table class="doc-table"><thead><tr>' + head.map(function (c) { return '<th>' + inline(c) + '</th>'; }).join('') +
        '</tr></thead><tbody>' + body.map(function (r) {
          return '<tr>' + r.map(function (c) { return '<td>' + inline(c) + '</td>'; }).join('') + '</tr>';
        }).join('') + '</tbody></table>';
    } else {
      var doc = res[tab];
      title = (doc && doc.title) || '';
      preview.innerHTML = renderDoc(doc);
    }
    $('planDocTitle').textContent = title;
    $('btnPlanXlsx').style.display = tab === 'signTemplate' ? '' : 'none';
    $('planResult').classList.remove('is-hidden');
    $('planResult').classList.add('is-visible');
  }

  function generatePlan(silent) {
    if (!CLUB.plan || !CLUB.plan.generate) { toast('策划模块未加载', true); return false; }
    var input = collectPlan();
    if (!input.name) { toast('请先填写活动名称', true); $('p-name').focus(); return false; }
    if (!input.date) { toast('请选择活动日期', true); $('p-date').focus(); return false; }
    if (!input.org) { toast('请填写主办单位', true); $('p-org').focus(); return false; }
    try {
      state.plan = CLUB.plan.generate(input);
    } catch (e) {
      console.error(e);
      toast('生成失败：' + e.message, true);
      return false;
    }
    state.planForm = input;
    renderPlanTabs();
    renderPlanDoc();
    syncSummaryFromContext();
    updateProgress();
    updateProfile();
    save();
    if (!silent) toast('已生成 5 份文档，可预览并导出');
    return true;
  }

  function exportPlan() {
    if (!state.plan) return;
    var tab = state.planTab;
    var base = safeName(state.plan.info && state.plan.info.name || '活动');
    try {
      if (tab === 'signTemplate') {
        var st = state.plan.signTemplate;
        download(CLUB.xlsx.write(st.sheets), base + '-报名表模板-' + stamp() + '.xlsx');
        toast('报名表模板已导出');
        return;
      }
      var doc = state.plan[tab];
      if (!doc) { toast('该文档未生成', true); return; }
      var labels = { doc: '活动策划书', venueForm: '场地使用申请表', notice: '活动通知', handbook: '执行手册' };
      download(CLUB.docx.render(doc), base + '-' + (labels[tab] || '文档') + '-' + stamp() + '.docx');
      toast('已导出 DOCX');
    } catch (e) {
      console.error(e);
      toast('导出失败：' + e.message, true);
    }
  }

  /* ---------------------------------------------------------------- ② 报名 */
  function decodeText(buf) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
    catch (e) {
      try { return new TextDecoder('gbk').decode(buf); }
      catch (e2) { return new TextDecoder('utf-8').decode(buf); }
    }
  }

  function parseCSV(text) {
    text = text.replace(/^\uFEFF/, '');
    var firstLine = text.split(/\r?\n/)[0] || '';
    var counts = { ',': 0, '\t': 0, ';': 0 };
    var inQ = false;
    for (var i = 0; i < firstLine.length; i++) {
      var ch = firstLine[i];
      if (ch === '"') inQ = !inQ;
      else if (!inQ && counts[ch] !== undefined) counts[ch]++;
    }
    var delim = ',';
    if (counts['\t'] > counts[','] && counts['\t'] >= counts[';']) delim = '\t';
    else if (counts[';'] > counts[','] && counts[';'] > counts['\t']) delim = ';';

    var rows = [], row = [], cell = '', q = false;
    for (var p = 0; p < text.length; p++) {
      var c = text[p];
      if (q) {
        if (c === '"') {
          if (text[p + 1] === '"') { cell += '"'; p++; }
          else q = false;
        } else cell += c;
      } else if (c === '"') q = true;
      else if (c === delim) { row.push(cell); cell = ''; }
      else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else if (c === '\r') { /* skip */ }
      else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (v) { return String(v).trim() !== ''; }); });
  }

  function readFile(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('读取失败：' + file.name)); };
      reader.onload = function () {
        var buf = reader.result;
        var lower = file.name.toLowerCase();
        if (/\.xlsx?$/.test(lower)) {
          if (!CLUB.xlsx || !CLUB.xlsx.read) { reject(new Error('表格引擎未加载')); return; }
          CLUB.xlsx.read(buf).then(function (sheets) {
            var tables = sheets.map(function (s) {
              return { name: sheets.length > 1 ? file.name + ' · ' + s.name : file.name, rows: s.rows };
            }).filter(function (t) { return t.rows.length > 1; });
            resolve(tables);
          }).catch(reject);
        } else {
          var text = decodeText(buf);
          resolve([{ name: file.name, rows: parseCSV(text) }]);
        }
      };
      reader.readAsArrayBuffer(file);
    });
  }

  function renderSources() {
    var host = $('sourceList');
    if (!state.sources.length) { host.innerHTML = ''; return; }
    host.innerHTML = state.sources.map(function (s, i) {
      return '<span class="source-chip"><b>' + esc(s.name) + '</b><small>' +
        Math.max(0, s.rows.length - 1) + ' 条</small><button type="button" data-i="' + i +
        '" title="移除">×</button></span>';
    }).join('');
    Array.prototype.forEach.call(host.querySelectorAll('button'), function (b) {
      b.addEventListener('click', function () {
        state.sources.splice(+b.dataset.i, 1);
        renderSources();
        save();
      });
    });
  }

  function addSources(tables, silent) {
    var added = 0;
    tables.forEach(function (t) {
      if (!t || !t.rows || t.rows.length < 2) return;
      var dup = state.sources.some(function (s) { return s.name === t.name && s.rows.length === t.rows.length; });
      if (dup) return;
      state.sources.push(t);
      added++;
    });
    renderSources();
    save();
    if (!silent) toast(added ? '已添加 ' + added + ' 张报名表' : '没有新的有效数据', !added);
  }

  async function handleFiles(files, silent) {
    var list = Array.prototype.slice.call(files);
    if (!list.length) return;
    var all = [];
    for (var i = 0; i < list.length; i++) {
      try {
        var tables = await readFile(list[i]);
        all = all.concat(tables);
      } catch (e) {
        toast(e.message || ('解析失败：' + list[i].name), true);
      }
    }
    addSources(all, silent);
    if (!silent && all.length) toast('解析完成，点击「开始汇总」查看统计');
  }

  function kpi(label, value, sub, warn) {
    return '<div class="kpi' + (warn ? ' warn' : '') + '"><div class="k-label">' + esc(label) +
      '</div><div class="k-value">' + esc(value) + '</div><div class="k-sub">' + esc(sub || '') + '</div></div>';
  }

  function barChart(dist) {
    var max = Math.max.apply(null, dist.items.map(function (d) { return d.count; }).concat([1]));
    return '<div class="chart"><h3>' + esc(dist.label) +
      '<small>缺失 ' + dist.missing + ' 人</small></h3>' +
      dist.items.slice(0, 8).map(function (d) {
        return '<div class="bar-row"><span class="bar-label" title="' + esc(d.label) + '">' + esc(d.label) +
          '</span><span class="bar-track"><span class="bar-fill" style="width:' +
          Math.max(2, Math.round(d.count / max * 100)) + '%"></span></span>' +
          '<span class="bar-val">' + d.count + ' · ' + d.pct + '%</span></div>';
      }).join('') + '</div>';
  }

  function trendChart(trend) {
    if (!trend || !trend.length) return '';
    var max = Math.max.apply(null, trend.map(function (t) { return t.count; }).concat([1]));
    return '<div class="chart"><h3>报名趋势<small>共 ' + trend.length + ' 天</small></h3>' +
      '<div class="trend">' + trend.map(function (t) {
        return '<div class="trend-col"><span class="trend-num">' + t.count + '</span>' +
          '<span class="trend-bar" style="height:' + Math.max(4, Math.round(t.count / max * 92)) + '%"></span>' +
          '<span class="trend-lab">' + esc(t.date) + '</span></div>';
      }).join('') + '</div></div>';
  }

  function renderStats() {
    var r = state.stats;
    if (!r) return;
    $('regResult').classList.remove('is-hidden');
    $('regResult').classList.add('is-visible');

    var t = r.totals || {};
    var kpis = [
      kpi('原始记录', t.raw, state.sources.length + ' 份表格合计', false),
      kpi('去重报名人数', t.unique, t.duplicates ? ('已合并 ' + t.duplicates + ' 条重复') : '无重复记录', false),
      kpi('重复 / 无效', t.duplicates + ' / ' + t.invalid, t.invalid ? '无效记录已排除' : '数据质量良好', false),
      kpi('信息完整率', t.completeRate + '%', '姓名 + 学院 + 手机俱全', t.completeRate < 80)
    ];
    if (r.fee && r.fee.total) {
      kpis.push(kpi('已缴费', (r.fee.paid || 0) + ' 人', '应收 ¥' + (r.fee.amount || 0), false));
    }
    $('kpis').innerHTML = kpis.join('');

    var dists = (r.distributions || []).slice(0, 4);
    $('charts').innerHTML = dists.map(barChart).join('') +
      ((r.distributions || [])[4] ? barChart(r.distributions[4]) : '') + trendChart(r.trend);

    $('insights').innerHTML = (r.insights || []).map(function (s) {
      return '<li>' + esc(s) + '</li>';
    }).join('') || '<li>暂无洞察</li>';
    $('warnings').innerHTML = (r.warnings || []).map(function (s) {
      return '<li>' + esc(s) + '</li>';
    }).join('') || '<li>未发现明显数据问题</li>';

    $('rosterCount').textContent = '（' + r.roster.length + ' 人）';
    renderRoster();
  }

  function renderRoster() {
    var r = state.stats;
    if (!r) return;
    var q = (state.rosterQuery || '').trim().toLowerCase();
    var rows = r.roster.filter(function (p) {
      if (!q) return true;
      return [p.name, p.studentId, p.college, p.major, p.phone].some(function (v) {
        return String(v || '').toLowerCase().indexOf(q) >= 0;
      });
    });
    var shown = rows.slice(0, 120);
    var head = '<thead><tr><th>#</th>' + ROSTER_COLS.map(function (c) { return '<th>' + c[1] + '</th>'; }).join('') +
      '<th>异常</th></tr></thead>';
    var body = shown.map(function (p, i) {
      return '<tr><td>' + (i + 1) + '</td>' + ROSTER_COLS.map(function (c) {
        var v = p[c[0]];
        if (c[0] === 'name') return '<td><b>' + esc(v) + '</b></td>';
        if (c[0] === 'source') return '<td><span class="tag">' + esc(v) + '</span></td>';
        return '<td>' + esc(v == null || v === '' ? '—' : v) + '</td>';
      }).join('') + '<td>' + (p.issues && p.issues.length
        ? '<span class="tag warn">' + esc(p.issues.join('、')) + '</span>' : '—') + '</td></tr>';
    }).join('');
    $('rosterTable').innerHTML = head + '<tbody>' + body + '</tbody>';
    $('rosterFoot').textContent = rows.length > shown.length
      ? '显示前 ' + shown.length + ' 人（共 ' + rows.length + ' 人），完整名单请导出 XLSX'
      : '共 ' + rows.length + ' 人' + (q ? '（已按「' + q + '」筛选）' : '');
  }

  function summarize() {
    if (!CLUB.stats || !CLUB.stats.summarize) { toast('汇总模块未加载', true); return; }
    if (!state.sources.length) { toast('请先上传报名表，或加载示例数据', true); return; }
    try {
      state.stats = CLUB.stats.summarize(state.sources.map(function (s) {
        return { name: s.name, rows: s.rows };
      }));
    } catch (e) {
      console.error(e);
      toast('汇总失败：' + e.message, true);
      return;
    }
    renderStats();
    syncSummaryFromContext();
    updateProgress();
    save();
    var t = state.stats.totals;
    toast('已汇总 ' + t.raw + ' 条记录，去重后 ' + t.unique + ' 人');
  }

  function exportStats() {
    if (!state.stats) return;
    try {
      var sheets = CLUB.stats.exportSheets(state.stats);
      var base = safeName((state.plan && state.plan.info && state.plan.info.name) || '活动');
      download(CLUB.xlsx.write(sheets), base + '-报名汇总-' + stamp() + '.xlsx');
      toast('汇总表已导出（' + sheets.length + ' 个工作表）');
    } catch (e) {
      console.error(e);
      toast('导出失败：' + e.message, true);
    }
  }

  /* ---------------------------------------------------------------- ③ 总结 */
  function syncSummaryFromContext() {
    var info = (state.plan && state.plan.info) || null;
    var setIfEmpty = function (id, val) {
      var el = $(id);
      if (el && !el.value && val != null && val !== '') el.value = val;
    };
    if (info) {
      setIfEmpty('s-name', info.name);
      setIfEmpty('s-date', info.date);
      setIfEmpty('s-place', info.place);
      setIfEmpty('s-org', info.org);
      setIfEmpty('s-contactName', info.contactName);
      setIfEmpty('s-budget', info.budget);
    }
    if (state.stats) {
      var t = state.stats.totals;
      setIfEmpty('s-signup', t.unique);
      if (!$('s-actual').value && t.unique) $('s-actual').value = Math.max(1, Math.round(t.unique * 0.92));
    }
  }

  function renderSumTabs() {
    var host = $('sumTabs');
    host.innerHTML = SUM_TABS.map(function (t) {
      return '<button type="button" class="doc-tab' + (state.sumTab === t.key ? ' is-active' : '') +
        '" data-tab="' + t.key + '" role="tab">' + esc(t.label) + '</button>';
    }).join('');
    Array.prototype.forEach.call(host.querySelectorAll('.doc-tab'), function (btn) {
      btn.addEventListener('click', function () {
        state.sumTab = btn.dataset.tab;
        renderSumTabs();
        renderSumDoc();
      });
    });
  }

  function renderSumDoc() {
    var s = state.summary;
    if (!s) return;
    var tab = state.sumTab;
    var preview = $('sumPreview');
    var title = '';
    if (tab === 'social') {
      var so = s.social || {};
      title = '社媒文案三件套';
      preview.innerHTML = '<h1 class="doc-h1">社媒文案</h1>' +
        '<h2>公众号标题</h2><p style="text-indent:0">' + inline(so.title) + '</p>' +
        '<h2>朋友圈</h2><p style="text-indent:0">' + inline(so.moments) + '</p>' +
        '<h2>微博</h2><p style="text-indent:0">' + inline(so.weibo) + '</p>' +
        '<h2>推文正文</h2>' + renderPlain(so.article || '');
    } else {
      var doc = s[tab];
      title = (doc && doc.title) || '';
      preview.innerHTML = renderDoc(doc);
    }
    $('sumDocTitle').textContent = title;
    $('sumResult').classList.remove('is-hidden');
    $('sumResult').classList.add('is-visible');
  }

  function generateSummary() {
    if (!CLUB.summary || !CLUB.summary.generate) { toast('总结模块未加载', true); return; }
    syncSummaryFromContext();
    var input = collectSummary();
    if (!input.name) { toast('请填写活动名称（或先生成策划）', true); return; }
    try {
      state.summary = CLUB.summary.generate(input);
    } catch (e) {
      console.error(e);
      toast('生成失败：' + e.message, true);
      return;
    }
    state.sumForm = formData($('sumForm'));
    renderSumTabs();
    renderSumDoc();
    updateProgress();
    save();
    toast('新闻稿与活动总结已生成');
  }

  /** 把社媒文案整理成 DocSpec，供导出 DOCX 使用 */
  function socialDocSpec() {
    var so = (state.summary && state.summary.social) || {};
    var info = (state.plan && state.plan.info) || {};
    var name = info.name || '活动';
    var dateTxt = info.date ? fmtDate(info.date).replace(/（.*?）/, '') : '';
    var blocks = [
      { type: 'note', text: '以下文案可直接复制到公众号、朋友圈与微博，按平台字数限制整理。' },
      { type: 'h2', text: '一、公众号标题' },
      { type: 'p', text: so.title || '' },
      { type: 'h2', text: '二、朋友圈' },
      { type: 'p', text: so.moments || '' },
      { type: 'h2', text: '三、微博' },
      { type: 'p', text: so.weibo || '' },
      { type: 'h2', text: '四、推文正文' }
    ];
    String(so.article || '').split(/\n+/).forEach(function (line) {
      var t = line.trim();
      if (t) blocks.push({ type: 'p', text: t });
    });
    return {
      title: '「' + name + '」社媒文案',
      subtitle: [dateTxt, info.org || ''].filter(Boolean).join('　'),
      blocks: blocks,
      footer: (info.org || '') + ' · 社媒文案'
    };
  }

  function exportSummary() {
    if (!state.summary) return;
    var base = safeName((state.plan && state.plan.info && state.plan.info.name) || '活动');
    try {
      if (state.sumTab === 'social') {
        var socialDoc = socialDocSpec();
        download(CLUB.docx.render(socialDoc), base + '-社媒文案-' + stamp() + '.docx');
        toast('社媒文案已导出 DOCX');
        return;
      }
      var doc = state.summary[state.sumTab];
      if (!doc) { toast('该文档未生成', true); return; }
      var labels = { press: '新闻稿', report: '活动总结' };
      download(CLUB.docx.render(doc), base + '-' + (labels[state.sumTab] || '文档') + '-' + stamp() + '.docx');
      toast('已导出 DOCX');
    } catch (e) {
      console.error(e);
      toast('导出失败：' + e.message, true);
    }
  }

  function copySocial() {
    var so = (state.summary && state.summary.social) || {};
    var text = '【公众号标题】\n' + (so.title || '') + '\n\n【朋友圈】\n' + (so.moments || '') +
      '\n\n【微博】\n' + (so.weibo || '') + '\n\n【推文正文】\n' + (so.article || '');
    // 兜底：部分浏览器（尤其 file:// 打开时）没有 clipboard API，用临时 textarea 复制
    function fallbackCopy() {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand('copy');
        document.body.removeChild(ta);
        toast(ok ? '文案已复制到剪贴板' : '复制失败，请手动选择文本', !ok);
      } catch (e) {
        toast('复制失败，请手动选择文本', true);
      }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast('文案已复制到剪贴板'); }, fallbackCopy);
    } else {
      fallbackCopy();
    }
  }

  /* ---------------------------------------------------------------- ④ 活动图集 */
  var ALBUM_MAX = 60;
  var photoSeq = 0;

  function albumInfo() {
    var info = (state.plan && state.plan.info) || {};
    var form = state.planForm || {};
    return {
      name: info.name || form.name || '活动',
      org: info.org || form.org || '',
      place: info.place || form.place || '',
      date: info.date || form.date || ''
    };
  }

  function addAlbumFiles(files) {
    var list = Array.prototype.slice.call(files || []).filter(function (f) {
      return f && /^image\//.test(f.type || '') && !/svg/.test(f.type || '');
    });
    if (!list.length) { toast('请选择 JPG / PNG 图片文件', true); return; }
    var remain = ALBUM_MAX - state.album.photos.length;
    if (remain <= 0) { toast('最多 ' + ALBUM_MAX + ' 张照片，请先删除部分图片', true); return; }
    if (list.length > remain) {
      toast('最多 ' + ALBUM_MAX + ' 张，本次只处理前 ' + remain + ' 张');
      list = list.slice(0, remain);
    }
    if (!CLUB.gallery || !CLUB.gallery.compressImage) { toast('图集模块未加载', true); return; }
    toast('正在处理 ' + list.length + ' 张照片…');
    Promise.all(list.map(function (file) {
      return CLUB.gallery.compressImage(file, 1600).then(function (p) {
        photoSeq += 1;
        return {
          id: 'photo' + photoSeq,
          data: p.data,
          mime: p.mime,
          widthPx: p.widthPx,
          heightPx: p.heightPx,
          src: p.previewUrl,
          caption: '',
          name: file.name
        };
      });
    })).then(function (added) {
      state.album.photos = state.album.photos.concat(added);
      state.album.built = null;
      renderAlbumList();
      updateProgress();
      toast('已添加 ' + added.length + ' 张照片');
    }).catch(function (e) {
      console.error(e);
      toast('图片处理失败：' + (e.message || '未知错误'), true);
    });
  }

  function renderAlbumList() {
    var photos = state.album.photos || [];
    var host = $('albumList');
    host.innerHTML = photos.map(function (p, i) {
      return '<div class="photo-card" data-id="' + p.id + '">' +
        '<div class="photo-thumb"><img src="' + p.src + '" alt=""><span class="photo-no">' + (i + 1) + '</span></div>' +
        '<input class="photo-caption" data-id="' + p.id + '" value="' + esc(p.caption || '') +
        '" placeholder="图注（可选），如：签到现场" maxlength="60">' +
        '<div class="photo-actions">' +
        '<button type="button" data-act="up" title="上移">↑</button>' +
        '<button type="button" data-act="down" title="下移">↓</button>' +
        '<button type="button" data-act="del" class="del" title="删除">✕</button>' +
        '</div></div>';
    }).join('');
    $('albumForm').classList.toggle('is-hidden', photos.length === 0);
    var hint = $('albumHint');
    hint.classList.toggle('is-hidden', photos.length === 0);
    hint.textContent = '共 ' + photos.length + ' 张照片 · 用 ↑ ↓ 调整顺序，图注会打印在照片下方' +
      (state.album.built ? ' · 照片有变动，请重新点「生成图集」' : '');
    if (photos.length === 0) {
      $('albumResult').classList.add('is-hidden');
    }
  }

  function movePhoto(id, delta) {
    var arr = state.album.photos;
    var i = arr.findIndex(function (p) { return p.id === id; });
    var j = i + delta;
    if (i < 0 || j < 0 || j >= arr.length) return;
    var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    state.album.built = null;
    renderAlbumList();
  }

  function removePhoto(id) {
    state.album.photos = state.album.photos.filter(function (p) { return p.id !== id; });
    state.album.built = null;
    renderAlbumList();
    updateProgress();
  }

  function generateAlbum() {
    if (!CLUB.gallery || !CLUB.gallery.build) { toast('图集模块未加载', true); return; }
    if (!state.album.photos.length) { toast('请先上传活动现场照片', true); return; }
    state.album.layout = num($('albumLayout').value, 2);
    state.album.credit = $('albumCredit').value.trim();
    state.album.intro = $('albumIntro').value.trim();
    var info = albumInfo();
    try {
      state.album.built = CLUB.gallery.build({
        name: info.name,
        org: info.org,
        place: info.place,
        dateText: info.date ? fmtDate(info.date) : '',
        intro: state.album.intro,
        credit: state.album.credit,
        layout: state.album.layout,
        photos: state.album.photos
      });
    } catch (e) {
      console.error(e);
      toast('生成图集失败：' + e.message, true);
      return;
    }
    var built = state.album.built;
    $('albumPreview').innerHTML = renderDoc(built.doc);
    $('albumDocTitle').textContent = built.doc.title + ' · 共 ' + built.count + ' 张 / ' + built.pages + ' 页';
    $('albumResult').classList.remove('is-hidden');
    $('albumResult').classList.add('is-visible');
    updateProgress();
    save();
    toast('图集已生成（' + built.count + ' 张 / ' + built.pages + ' 页）');
  }

  function canvasToJpeg(canvas, quality) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (!blob) { reject(new Error('页面渲染失败')); return; }
        var reader = new FileReader();
        reader.onload = function () {
          resolve({ data: new Uint8Array(reader.result), width: canvas.width, height: canvas.height });
        };
        reader.onerror = function () { reject(new Error('页面编码失败')); };
        reader.readAsArrayBuffer(blob);
      }, 'image/jpeg', quality || 0.9);
    });
  }

  async function exportAlbum() {
    if (!state.album.photos.length) { toast('请先上传活动现场照片', true); return; }
    if (!CLUB.gallery || !CLUB.gallery.renderPageImages || !CLUB.pdf) {
      toast('PDF 模块未加载', true);
      return;
    }
    var btn = $('btnAlbumExport');
    var info = albumInfo();
    state.album.layout = num($('albumLayout').value, 2);
    state.album.credit = $('albumCredit').value.trim();
    state.album.intro = $('albumIntro').value.trim();
    btn.disabled = true;
    try {
      toast('正在排版并生成 PDF…');
      var pages = await CLUB.gallery.renderPageImages({
        name: info.name,
        org: info.org,
        place: info.place,
        dateText: info.date ? fmtDate(info.date) : '',
        intro: state.album.intro,
        credit: state.album.credit,
        layout: state.album.layout,
        photos: state.album.photos
      });
      var jpegs = [];
      for (var i = 0; i < pages.length; i++) {
        jpegs.push(await canvasToJpeg(pages[i], 0.9));
      }
      var blob = CLUB.pdf.fromJpegPages(jpegs);
      download(blob, safeName(info.name) + '-活动图集-' + stamp() + '.pdf');
      toast('PDF 已导出（' + pages.length + ' 页）');
    } catch (e) {
      console.error(e);
      toast('导出 PDF 失败：' + (e.message || '未知错误'), true);
    } finally {
      btn.disabled = false;
    }
  }

  function clearAlbum() {
    if (!state.album.photos.length) { toast('还没有照片', true); return; }
    if (!confirm('确定清空全部照片吗？')) return;
    state.album.photos = [];
    state.album.built = null;
    renderAlbumList();
    updateProgress();
    toast('已清空照片');
  }

  /* ---------------------------------------------------------------- 示例 / 重置 */
  function applySamples() {
    var S = window.CLUB_SAMPLES;
    if (!S) { toast('示例数据未加载', true); return; }
    if (S.profile) {
      Object.keys(S.profile).forEach(function (k) {
        var el = document.querySelector('#planForm [name="' + k + '"]');
        if (!el) return;
        if (el.type === 'checkbox') el.checked = !!S.profile[k];
        else el.value = S.profile[k];
      });
    }
    state.planForm = formData($('planForm'));
    updateProfile();
    save();
    toast('示例活动需求已填入，可直接生成');
  }

  function loadDemoAll() {
    var S = window.CLUB_SAMPLES;
    if (!S) { toast('示例数据未加载', true); return; }
    applySamples();
    generatePlan(true);
    if (S.csvA) {
      addSources([{ name: '报名表-A（线上收集）.csv', rows: parseCSV(S.csvA) }], true);
    }
    if (S.csvB) {
      addSources([{ name: '报名表-B（线下补录）.csv', rows: parseCSV(S.csvB) }], true);
    }
    if (state.sources.length) summarize();
    switchTab('sum');
    if (S.materials) {
      Object.keys(S.materials).forEach(function (k) {
        var el = document.querySelector('#sumForm [name="' + k + '"]');
        if (!el) return;
        el.value = Array.isArray(S.materials[k]) ? S.materials[k].join('\n') : S.materials[k];
      });
    }
    syncSummaryFromContext();
    generateSummary();
    switchTab('plan');
    toast('示例全流程已跑通：策划 → 报名汇总 → 新闻稿');
  }

  function resetAll() {
    if (!confirm('确定清空所有填写内容与生成结果吗？')) return;
    try { localStorage.removeItem(LS_KEY); } catch (e) { /* ignore */ }
    location.reload();
  }

  /* ---------------------------------------------------------------- 事件绑定 */
  function bind() {
    Array.prototype.forEach.call(document.querySelectorAll('.step'), function (btn) {
      btn.addEventListener('click', function () { switchTab(btn.dataset.tab); });
    });

    var planForm = $('planForm');
    planForm.addEventListener('input', debounce(function () {
      state.planForm = formData(planForm);
      updateProfile();
      save();
    }, 250));
    planForm.addEventListener('submit', function (e) { e.preventDefault(); generatePlan(); });

    var sumForm = $('sumForm');
    sumForm.addEventListener('input', debounce(function () {
      state.sumForm = formData(sumForm);
      save();
    }, 250));

    $('btnGenPlan').addEventListener('click', function () { generatePlan(); });
    $('btnPlanExport').addEventListener('click', exportPlan);
    $('btnPlanXlsx').addEventListener('click', exportPlan);
    $('btnPlanPrint').addEventListener('click', function () { window.print(); });
    $('btnFillDemo').addEventListener('click', applySamples);

    $('btnPick').addEventListener('click', function () { $('fileInput').click(); });
    $('fileInput').addEventListener('change', function (e) {
      handleFiles(e.target.files);
      e.target.value = '';
    });

    var dz = $('dropzone');
    ['dragenter', 'dragover'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('is-over'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('is-over'); });
    });
    dz.addEventListener('drop', function (e) {
      if (e.dataTransfer && e.dataTransfer.files) handleFiles(e.dataTransfer.files);
    });

    $('btnSampleReg').addEventListener('click', function () {
      var S = window.CLUB_SAMPLES;
      if (!S) { toast('示例数据未加载', true); return; }
      addSources([{ name: '报名表-A（线上收集）.csv', rows: parseCSV(S.csvA) },
                  { name: '报名表-B（线下补录）.csv', rows: parseCSV(S.csvB) }]);
      summarize();
    });
    $('btnSummarize').addEventListener('click', summarize);
    $('btnExportStats').addEventListener('click', exportStats);
    $('rosterSearch').addEventListener('input', debounce(function (e) {
      state.rosterQuery = e.target.value;
      renderRoster();
    }, 150));

    $('btnGenSummary').addEventListener('click', generateSummary);
    $('btnSumExport').addEventListener('click', exportSummary);
    $('btnSumCopy').addEventListener('click', copySocial);
    $('btnSumPrint').addEventListener('click', function () { window.print(); });
    $('btnFillSample').addEventListener('click', function () {
      var S = window.CLUB_SAMPLES;
      if (!S || !S.materials) { toast('示例素材未加载', true); return; }
      Object.keys(S.materials).forEach(function (k) {
        var el = document.querySelector('#sumForm [name="' + k + '"]');
        if (!el) return;
        el.value = Array.isArray(S.materials[k]) ? S.materials[k].join('\n') : S.materials[k];
      });
      state.sumForm = formData($('sumForm'));
      save();
      toast('示例素材已填入');
    });

    // ---- 活动图集 ----
    $('btnAlbumPick').addEventListener('click', function () { $('albumInput').click(); });
    $('albumInput').addEventListener('change', function (e) {
      addAlbumFiles(e.target.files);
      e.target.value = '';
    });
    var albumDrop = $('albumDrop');
    ['dragenter', 'dragover'].forEach(function (ev) {
      albumDrop.addEventListener(ev, function (e) { e.preventDefault(); albumDrop.classList.add('is-over'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      albumDrop.addEventListener(ev, function (e) { e.preventDefault(); albumDrop.classList.remove('is-over'); });
    });
    albumDrop.addEventListener('drop', function (e) {
      if (e.dataTransfer && e.dataTransfer.files) addAlbumFiles(e.dataTransfer.files);
    });
    $('albumList').addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('button[data-act]') : null;
      if (!btn) return;
      var card = btn.closest('.photo-card');
      var id = card && card.dataset.id;
      if (!id) return;
      if (btn.dataset.act === 'up') movePhoto(id, -1);
      else if (btn.dataset.act === 'down') movePhoto(id, 1);
      else if (btn.dataset.act === 'del') removePhoto(id);
    });
    $('albumList').addEventListener('input', function (e) {
      if (!e.target.classList.contains('photo-caption')) return;
      var id = e.target.dataset.id;
      var photo = state.album.photos.find(function (p) { return p.id === id; });
      if (photo) {
        photo.caption = e.target.value;
        state.album.built = null;
        save();
      }
    });
    $('btnGenAlbum').addEventListener('click', generateAlbum);
    $('btnAlbumExport').addEventListener('click', exportAlbum);
    $('btnAlbumPrint').addEventListener('click', function () { window.print(); });
    $('btnAlbumClear').addEventListener('click', clearAlbum);
    ['albumLayout', 'albumCredit', 'albumIntro'].forEach(function (id) {
      $(id).addEventListener('input', debounce(function () {
        state.album.layout = num($('albumLayout').value, 2);
        state.album.credit = $('albumCredit').value;
        state.album.intro = $('albumIntro').value;
        save();
      }, 300));
    });

    $('btnDemo').addEventListener('click', loadDemoAll);
    $('btnReset').addEventListener('click', resetAll);
  }

  /* ---------------------------------------------------------------- 启动 */
  function boot() {
    loadSaved();
    applyForm($('planForm'), state.planForm);
    applyForm($('sumForm'), state.sumForm);
    if (!state.planForm.date) $('p-date').value = todayISO();
    var dl = document.getElementById('p-deadline');
    if (dl && !dl.value) {
      var d = new Date();
      d.setDate(d.getDate() + 7);
      dl.value = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
    }
    state.planForm = formData($('planForm'));
    updateProfile();
    renderSources();

    $('albumLayout').value = String(state.album.layout || 2);
    $('albumCredit').value = state.album.credit || '';
    $('albumIntro').value = state.album.intro || '';
    renderAlbumList();

    if (state.plan) { renderPlanTabs(); renderPlanDoc(); }
    if (state.stats) { renderStats(); }
    if (state.summary) { renderSumTabs(); renderSumDoc(); }
    syncSummaryFromContext();
    updateProgress();
    bind();
  }

  window.addEventListener('error', function (e) {
    if (e && e.message) toast('运行出错：' + e.message, true);
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

